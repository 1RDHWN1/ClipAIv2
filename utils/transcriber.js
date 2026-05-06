import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import 'dotenv/config';

const TRANSCRIBE_PROVIDER = (process.env.TRANSCRIBE_PROVIDER || 'assemblyai').toLowerCase();
const TRANSCRIBE_CHUNK_TARGET_MB = parseInt(process.env.TRANSCRIBE_CHUNK_TARGET_MB || '22', 10);
const TRANSCRIBE_CHUNK_TARGET_BYTES = TRANSCRIBE_CHUNK_TARGET_MB * 1024 * 1024;
const TRANSCRIBE_AUDIO_BITRATE = process.env.TRANSCRIBE_AUDIO_BITRATE || '32k';
const TRANSCRIBE_AUDIO_SAMPLE_RATE = parseInt(process.env.TRANSCRIBE_AUDIO_SAMPLE_RATE || '16000', 10);
const TRANSCRIBE_LANGUAGE = process.env.TRANSCRIBE_LANGUAGE || 'id';
const TRANSCRIBE_RATE_LIMIT_MAX_RETRIES = parseInt(process.env.TRANSCRIBE_RATE_LIMIT_MAX_RETRIES || '2', 10);
const TRANSCRIBE_RATE_LIMIT_MAX_WAIT_SECONDS = parseInt(process.env.TRANSCRIBE_RATE_LIMIT_MAX_WAIT_SECONDS || '900', 10);
const ASSEMBLYAI_BASE_URL = process.env.ASSEMBLYAI_BASE_URL || 'https://api.assemblyai.com';
const ASSEMBLYAI_POLL_INTERVAL_MS = parseInt(process.env.ASSEMBLYAI_POLL_INTERVAL_MS || '3000', 10);
const ASSEMBLYAI_UPLOAD_TIMEOUT_MS = parseInt(process.env.ASSEMBLYAI_UPLOAD_TIMEOUT_MS || '180000', 10);
const ASSEMBLYAI_TRANSCRIPT_TIMEOUT_MS = parseInt(process.env.ASSEMBLYAI_TRANSCRIPT_TIMEOUT_MS || '600000', 10);

/**
 * Transkripsi audio menggunakan Groq Whisper (gratis & cepat)
 * @param {string} audioPath - Path ke file audio MP3
 * @param {{ onStatus?: Function }} options
 * @returns {Promise<{text: string, segments: Array, speakerTurns: Array}>}
 */
export async function transcribeAudio(audioPath, options = {}) {
  console.log(`🎙️ Transcribing audio: ${audioPath}`);

  const fileSize = fs.statSync(audioPath).size;
  console.log(`   Original size: ${formatMB(fileSize)} MB`);

  const tempFiles = [];

  try {
    const preparedAudioPath = await optimizeAudioForTranscription(audioPath);
    tempFiles.push(preparedAudioPath);

    const preparedSize = fs.statSync(preparedAudioPath).size;
    console.log(`   Prepared size: ${formatMB(preparedSize)} MB`);

    if (TRANSCRIBE_PROVIDER === 'assemblyai') {
      return await transcribeWithAssemblyAI(preparedAudioPath, options);
    }

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY tidak ditemukan di .env');

    if (preparedSize <= TRANSCRIBE_CHUNK_TARGET_BYTES) {
      return await transcribeSingleFile(preparedAudioPath, GROQ_API_KEY, 0, options);
    }

    const { duration } = await getAudioInfo(preparedAudioPath);
    if (!duration || duration <= 0) {
      throw new Error('Durasi audio tidak valid untuk dipecah ke beberapa bagian.');
    }

    const chunkCount = Math.ceil(preparedSize / TRANSCRIBE_CHUNK_TARGET_BYTES);
    const chunkDuration = Math.ceil(duration / chunkCount);

    console.log(`   Audio panjang terdeteksi, membagi ke ${chunkCount} chunk (~${chunkDuration}s per chunk)`);

    const chunkPaths = await splitAudioIntoChunks(preparedAudioPath, duration, chunkDuration);
    tempFiles.push(...chunkPaths);

    return await transcribeChunks(chunkPaths, GROQ_API_KEY, options);
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

async function transcribeWithAssemblyAI(audioPath, options = {}) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY tidak ditemukan di .env');

  const headers = { authorization: apiKey };

  if (typeof options.onStatus === 'function') {
    await options.onStatus({
      message: 'Mengupload audio ke AssemblyAI...',
      percent: 31,
    });
  }

  const uploadUrl = await uploadFileToAssemblyAI(audioPath, headers);
  console.log('   AssemblyAI upload selesai');

  if (typeof options.onStatus === 'function') {
    await options.onStatus({
      message: 'AssemblyAI sedang membuat transcript...',
      percent: 34,
    });
  }

  const transcriptId = await submitAssemblyAITranscript(uploadUrl, headers);
  console.log(`   AssemblyAI transcript id: ${transcriptId}`);

  const transcript = await pollAssemblyAITranscript(transcriptId, headers, options);

  const segments = buildSegmentsFromAssemblyAI(transcript);
  console.log(`✅ AssemblyAI transcription done. ${segments.length} segments, ${transcript.text?.length || 0} chars`);

  return {
    text: transcript.text || '',
    segments,
    language: transcript.language_code || 'unknown',
    speakerTurns: buildSpeakerTurnsFromAssemblyAI(transcript),
  };
}

async function uploadFileToAssemblyAI(filePath, headers) {
  const response = await axios.post(
    `${ASSEMBLYAI_BASE_URL}/v2/upload`,
    fs.createReadStream(filePath),
    {
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: ASSEMBLYAI_UPLOAD_TIMEOUT_MS,
    }
  );

  if (!response.data?.upload_url) {
    throw new Error('AssemblyAI tidak mengembalikan upload_url');
  }

  return response.data.upload_url;
}

async function submitAssemblyAITranscript(audioUrl, headers) {
  const payload = {
    audio_url: audioUrl,
    speech_models: ['universal-3-pro', 'universal-2'],
    language_detection: true,
    speaker_labels: true,
  };

  const response = await axios.post(
    `${ASSEMBLYAI_BASE_URL}/v2/transcript`,
    payload,
    {
      headers,
      timeout: ASSEMBLYAI_UPLOAD_TIMEOUT_MS,
    }
  );

  if (!response.data?.id) {
    throw new Error('AssemblyAI tidak mengembalikan transcript id');
  }

  return response.data.id;
}

async function pollAssemblyAITranscript(transcriptId, headers, options = {}) {
  const startedAt = Date.now();
  let pollCount = 0;

  while (Date.now() - startedAt < ASSEMBLYAI_TRANSCRIPT_TIMEOUT_MS) {
    const response = await axios.get(
      `${ASSEMBLYAI_BASE_URL}/v2/transcript/${transcriptId}`,
      {
        headers,
        timeout: 30000,
      }
    );

    const transcript = response.data;
    pollCount += 1;

    if (transcript.status === 'completed') {
      return transcript;
    }

    if (transcript.status === 'error') {
      throw new Error(`Transkripsi gagal: ${transcript.error || 'AssemblyAI error'}`);
    }

    if (typeof options.onStatus === 'function' && (pollCount === 1 || pollCount % 3 === 0)) {
      await options.onStatus({
        message: 'AssemblyAI sedang memproses transcript...',
        percent: 40,
      });
    }

    await sleep(ASSEMBLYAI_POLL_INTERVAL_MS);
  }

  throw new Error('Transkripsi gagal: timeout menunggu hasil dari AssemblyAI');
}

function buildSegmentsFromAssemblyAI(transcript) {
  if (Array.isArray(transcript.utterances) && transcript.utterances.length > 0) {
    return transcript.utterances.map((utterance, index) => ({
      id: index,
      start: parseFloat((utterance.start / 1000).toFixed(2)),
      end: parseFloat((utterance.end / 1000).toFixed(2)),
      text: String(utterance.text || '').trim(),
    })).filter((segment) => segment.text);
  }

  if (Array.isArray(transcript.words) && transcript.words.length > 0) {
    return groupAssemblyWordsIntoSegments(transcript.words);
  }

  return [];
}

function buildSpeakerTurnsFromAssemblyAI(transcript) {
  if (!Array.isArray(transcript.utterances)) {
    return [];
  }

  return transcript.utterances
    .map((utterance, index) => ({
      id: index,
      speaker: utterance.speaker || 'unknown',
      start: parseFloat((utterance.start / 1000).toFixed(2)),
      end: parseFloat((utterance.end / 1000).toFixed(2)),
      text: String(utterance.text || '').trim(),
    }))
    .filter((turn) => turn.text && turn.end > turn.start);
}

function groupAssemblyWordsIntoSegments(words) {
  const segments = [];
  let current = null;

  for (const word of words) {
    const text = String(word.text || '').trim();
    if (!text) continue;

    const start = (word.start || 0) / 1000;
    const end = (word.end || 0) / 1000;

    if (!current) {
      current = { start, end, words: [text] };
      continue;
    }

    const gap = start - current.end;
    const duration = end - current.start;
    const shouldSplit = gap > 1.5 || duration > 12;

    if (shouldSplit) {
      segments.push({
        id: segments.length,
        start: parseFloat(current.start.toFixed(2)),
        end: parseFloat(current.end.toFixed(2)),
        text: current.words.join(' ').trim(),
      });
      current = { start, end, words: [text] };
      continue;
    }

    current.end = end;
    current.words.push(text);
  }

  if (current) {
    segments.push({
      id: segments.length,
      start: parseFloat(current.start.toFixed(2)),
      end: parseFloat(current.end.toFixed(2)),
      text: current.words.join(' ').trim(),
    });
  }

  return segments;
}

async function transcribeChunks(chunkPaths, apiKey, options = {}) {
  const allSegments = [];
  const textParts = [];
  let offsetSeconds = 0;
  let detectedLanguage = 'unknown';

  for (let i = 0; i < chunkPaths.length; i++) {
    const chunkPath = chunkPaths[i];
    const chunkSize = fs.statSync(chunkPath).size;
    const { duration } = await getAudioInfo(chunkPath);

    console.log(`   Chunk ${i + 1}/${chunkPaths.length}: ${formatMB(chunkSize)} MB, durasi ${Math.round(duration)}s`);

    const partial = await transcribeSingleFile(chunkPath, apiKey, offsetSeconds, options);
    if (partial.text.trim()) textParts.push(partial.text.trim());
    allSegments.push(...partial.segments);

    if (detectedLanguage === 'unknown' && partial.language !== 'unknown') {
      detectedLanguage = partial.language;
    }

    offsetSeconds += duration;
  }

  const mergedSegments = allSegments.map((seg, index) => ({
    ...seg,
    id: index,
  }));

  console.log(`✅ Transcription done from ${chunkPaths.length} chunk(s). ${mergedSegments.length} segments`);

  return {
    text: textParts.join('\n\n'),
    segments: mergedSegments,
    language: detectedLanguage,
    speakerTurns: [],
  };
}

async function transcribeSingleFile(filePath, apiKey, offsetSeconds = 0, options = {}) {
  const result = await requestGroqTranscription(filePath, apiKey, options);

  const segments = (result.segments || []).map((seg, index) => ({
    id: index,
    start: parseFloat((seg.start + offsetSeconds).toFixed(2)),
    end: parseFloat((seg.end + offsetSeconds).toFixed(2)),
    text: seg.text.trim(),
  }));

  return {
    text: result.text || '',
    segments,
    language: result.language || 'unknown',
    speakerTurns: [],
  };
}

async function requestGroqTranscription(filePath, apiKey, options = {}) {
  for (let attempt = 1; attempt <= TRANSCRIBE_RATE_LIMIT_MAX_RETRIES; attempt++) {
    const formData = buildGroqFormData(filePath);

    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 180000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      return response.data;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      const waitSeconds = parseRetryAfterSeconds(msg);
      const canRetry =
        waitSeconds !== null &&
        attempt < TRANSCRIBE_RATE_LIMIT_MAX_RETRIES &&
        waitSeconds <= TRANSCRIBE_RATE_LIMIT_MAX_WAIT_SECONDS;

      if (!canRetry) {
        throw new Error(`Transkripsi gagal: ${msg}`);
      }

      const waitLabel = formatWaitTime(waitSeconds);
      console.warn(`⏳ Groq rate limit, menunggu ${waitLabel} sebelum retry (${attempt}/${TRANSCRIBE_RATE_LIMIT_MAX_RETRIES})`);

      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          message: `Quota transkripsi Groq penuh, menunggu ${waitLabel} untuk retry...`,
          percent: 32,
        });
      }

      await sleep(waitSeconds * 1000);
    }
  }

  throw new Error('Transkripsi gagal: retry Groq habis');
}

function buildGroqFormData(filePath) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'audio/mp3',
  });
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');

  if (TRANSCRIBE_LANGUAGE && TRANSCRIBE_LANGUAGE !== 'auto') {
    formData.append('language', TRANSCRIBE_LANGUAGE);
  }

  return formData;
}

async function optimizeAudioForTranscription(inputPath) {
  const { dir, name } = path.parse(inputPath);
  const outputPath = path.join(dir, `${name}_transcribe.mp3`);

  console.log(`   Optimizing audio untuk podcast panjang...`);

  await renderAudioChunk(inputPath, outputPath, 0, null);
  return outputPath;
}

async function splitAudioIntoChunks(inputPath, totalDuration, chunkDuration) {
  const { dir, name } = path.parse(inputPath);
  const chunkPaths = [];

  for (let start = 0, index = 1; start < totalDuration; start += chunkDuration, index++) {
    const outputPath = path.join(dir, `${name}_chunk${index}.mp3`);
    const duration = Math.min(chunkDuration, totalDuration - start);

    await renderAudioChunk(inputPath, outputPath, start, duration);
    chunkPaths.push(outputPath);
  }

  return chunkPaths;
}

function renderAudioChunk(inputPath, outputPath, startTime, duration) {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioChannels(1)
      .audioFrequency(TRANSCRIBE_AUDIO_SAMPLE_RATE)
      .audioBitrate(TRANSCRIBE_AUDIO_BITRATE)
      .format('mp3')
      .outputOptions([
        '-map_metadata -1',
        '-y',
      ]);

    if (startTime > 0) {
      command = command.seekInput(startTime);
    }

    if (duration !== null && duration > 0) {
      command = command.duration(duration);
    }

    command
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`Gagal menyiapkan audio transkripsi: ${err.message}`)))
      .save(outputPath);
  });
}

function getAudioInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe error: ${err.message}`));

      resolve({
        duration: parseFloat(metadata.format?.duration) || 0,
        bitrate: parseInt(metadata.format?.bit_rate, 10) || 0,
      });
    });
  });
}

function cleanupTempFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {}
  }
}

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function parseRetryAfterSeconds(message) {
  if (!/try again in/i.test(message) || !/rate limit/i.test(message)) {
    return null;
  }

  const minutesMatch = message.match(/(\d+)m/i);
  const secondsMatch = message.match(/(\d+)s/i);
  const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
  const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;
  const total = (minutes * 60) + seconds;

  return total > 0 ? total : null;
}

function formatWaitTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds} detik`;
  if (seconds === 0) return `${minutes} menit`;
  return `${minutes}m${seconds}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
