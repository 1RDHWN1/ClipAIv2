import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import 'dotenv/config';
import { Mutex } from 'async-mutex';

import { segmentWordsIntoSentences } from './sentenceSegmenter.js';
import { detectSilence } from './silenceDetector.js';

const TRANSCRIBE_PROVIDER = (process.env.TRANSCRIBE_PROVIDER || 'assemblyai').toLowerCase();
const TRANSCRIBE_CHUNK_TARGET_MB = parseInt(process.env.TRANSCRIBE_CHUNK_TARGET_MB || '22', 10);
const TRANSCRIBE_CHUNK_TARGET_BYTES = TRANSCRIBE_CHUNK_TARGET_MB * 1024 * 1024;
const TRANSCRIBE_AUDIO_BITRATE = process.env.TRANSCRIBE_AUDIO_BITRATE || '32k';
const TRANSCRIBE_AUDIO_SAMPLE_RATE = parseInt(process.env.TRANSCRIBE_AUDIO_SAMPLE_RATE || '16000', 10);
const rawTranscribeLang = process.env.TRANSCRIBE_LANGUAGE;
const TRANSCRIBE_LANGUAGE = (rawTranscribeLang && rawTranscribeLang.trim())
  ? rawTranscribeLang.trim().toLowerCase()
  : 'auto';
const TRANSCRIBE_RATE_LIMIT_MAX_RETRIES = parseInt(process.env.TRANSCRIBE_RATE_LIMIT_MAX_RETRIES || '2', 10);
const TRANSCRIBE_RATE_LIMIT_MAX_WAIT_SECONDS = parseInt(process.env.TRANSCRIBE_RATE_LIMIT_MAX_WAIT_SECONDS || '900', 10);
const ASSEMBLYAI_BASE_URL = process.env.ASSEMBLYAI_BASE_URL || 'https://api.assemblyai.com';
const ASSEMBLYAI_POLL_INTERVAL_MS = parseInt(process.env.ASSEMBLYAI_POLL_INTERVAL_MS || '3000', 10);
const ASSEMBLYAI_UPLOAD_TIMEOUT_MS = parseInt(process.env.ASSEMBLYAI_UPLOAD_TIMEOUT_MS || '180000', 10);
const ASSEMBLYAI_TRANSCRIPT_TIMEOUT_MS = parseInt(process.env.ASSEMBLYAI_TRANSCRIPT_TIMEOUT_MS || '600000', 10);

/**
 * Normalizes any language string (full name, BCP-47 tag, or YouTube sub-tag)
 * into a standardized lowercase ISO-639-1 2-letter language code.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeLanguageCode(raw) {
  if (!raw || typeof raw !== 'string') return 'unknown';
  const cleaned = raw.trim().toLowerCase();
  const langMap = {
    english: 'en',
    indonesian: 'id',
    spanish: 'es',
    french: 'fr',
    german: 'de',
    japanese: 'ja',
    chinese: 'zh',
    korean: 'ko',
    portuguese: 'pt',
    italian: 'it',
    russian: 'ru',
    arabic: 'ar',
    hindi: 'hi',
  };
  if (langMap[cleaned]) return langMap[cleaned];
  const prefix = cleaned.split(/[-_]/)[0];
  if (prefix && prefix.length === 2) return prefix;
  return cleaned;
}

/**
 * Lightweight heuristic language detection from transcript text (English vs Indonesian).
 * @param {string} text
 * @param {string} [fallback='id'] - Default language fallback on tie or neutral text
 * @returns {string} 'en' | 'id'
 */
export function detectLanguageFromText(text, fallback = 'id') {
  const normFallback = normalizeLanguageCode(fallback);
  const safeFallback = (normFallback && normFallback !== 'unknown' && normFallback !== 'auto') ? normFallback : 'id';

  if (!text || typeof text !== 'string') return safeFallback;
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return safeFallback;

  const enStopwords = new Set([
    'the', 'and', 'to', 'of', 'a', 'in', 'that', 'is', 'was', 'he', 'for', 'it', 'with', 'as',
    'his', 'on', 'be', 'at', 'by', 'i', 'this', 'had', 'not', 'are', 'but', 'from', 'or',
    'have', 'an', 'they', 'which', 'one', 'you', 'were', 'her', 'all', 'she', 'there',
    'would', 'their', 'we', 'him', 'been', 'has', 'when', 'who', 'will', 'more', 'no', 'if',
    'out', 'so', 'said', 'what', 'up', 'its', 'about', 'into', 'than', 'them', 'can', 'only',
    'other', 'new', 'some', 'could', 'time', 'these', 'two', 'may', 'then', 'do', 'first',
    'any', 'my', 'now', 'such', 'like', 'our', 'over', 'man', 'me', 'even', 'most', 'made',
    'after', 'also', 'did', 'many', 'before', 'must', 'through', 'back', 'years', 'where',
    'much', 'your', 'way', 'well', 'down', 'should', 'because', 'each', 'just', 'those',
    'people', 'how', 'too', 'little', 'state', 'good', 'very', 'make', 'world', 'still',
    'own', 'see', 'men', 'work', 'long', 'get', 'here', 'between', 'both', 'life', 'being',
    'under', 'never', 'day', 'same', 'another', 'know', 'while', 'last', 'might', 'great',
    'old', 'year', 'off', 'come', 'since', 'against', 'go', 'came', 'right', 'used', 'take',
    'three', 'yeah', 'yes', 'hey', 'hi', 'hello', 'bro', 'dude', 'guy', 'guys', 'gonna',
    'wanna', 'gotta', 'really', 'actually', 'look', 'watch', 'video', 'crazy', 'omg', 'god',
    'oh', 'ok', 'okay', 'wait', 'listen', 'talking', 'say', 'think', 'thought', 'tell', 'told',
    'let', 'lets', 'why', 'went', 'going', 'doing', 'today', 'tonight', 'always', 'something',
    'anything', 'nothing', 'everything', 'someone', 'everyone'
  ]);

  const idStopwords = new Set([
    'yang', 'di', 'dan', 'ini', 'itu', 'dari', 'untuk', 'dengan', 'ada', 'tidak', 'adalah',
    'akan', 'pada', 'juga', 'ke', 'bisa', 'kita', 'saya', 'dia', 'mereka', 'sudah', 'lebih',
    'karena', 'kamu', 'oleh', 'saat', 'dalam', 'setelah', 'hanya', 'bukan', 'bagi', 'harus',
    'seperti', 'kami', 'secara', 'sangat', 'tahun', 'hari', 'orang', 'tentang', 'banyak',
    'maupun', 'jadi', 'lalu', 'namun', 'saja', 'atau', 'telah', 'kalau', 'mana', 'masih',
    'sedang', 'tanpa', 'sampai', 'semua', 'hal', 'antara', 'nggak', 'gak', 'ngga', 'udah',
    'banget', 'gitu', 'gini', 'aja', 'kok', 'nih', 'tuh', 'dong', 'deh', 'kan', 'lah', 'loh',
    'bener', 'beneran', 'kenapa', 'gimana', 'kalo', 'kapan', 'siapa', 'apa', 'mau', 'tau',
    'tahu', 'iya', 'ya', 'yuk', 'bray', 'sob', 'halo', 'selamat', 'pagi', 'siang', 'malam',
    'kemarin', 'besok', 'makanya', 'terus', 'emang', 'coba', 'lihat', 'dulu', 'lagi', 'tapi',
    'biar', 'supaya', 'pas', 'pernah', 'belum', 'belom'
  ]);

  let enCount = 0;
  let idCount = 0;

  for (const w of words) {
    const cleanW = w.replace(/[^a-z]/g, '');
    if (enStopwords.has(cleanW)) enCount++;
    if (idStopwords.has(cleanW)) idCount++;
  }

  if (enCount > idCount) return 'en';
  if (idCount > enCount) return 'id';
  return safeFallback;
}

/**
 * Pool dan rotasi otomatis API Key Groq untuk mencegah hambatan Rate Limit.
 * Thread-safe menggunakan async-mutex untuk mencegah race condition pada concurrent workers.
 */
export class GroqKeyPool {
  constructor() {
    this.keys = [];
    this.currentIndex = 0;
    this.mutex = new Mutex();
    this.refreshKeys();
  }

  refreshKeys() {
    const rawList = [];
    if (process.env.GROQ_API_KEYS) {
      rawList.push(...process.env.GROQ_API_KEYS.split(/[,;\s]+/));
    }
    if (process.env.GROQ_API_KEY) {
      rawList.push(...process.env.GROQ_API_KEY.split(/[,;\s]+/));
    }
    for (let i = 1; i <= 20; i++) {
      const k = process.env[`GROQ_API_KEY_${i}`];
      if (k) rawList.push(k);
    }

    const unique = [...new Set(rawList.map((k) => k.trim()).filter(Boolean))];
    this.keys = unique.map((key, idx) => ({
      index: idx + 1,
      key,
      masked: `${key.substring(0, 7)}...${key.substring(key.length - 4)}`,
      rateLimitedUntil: 0,
      totalRequests: 0,
      successCount: 0,
      errorCount: 0,
    }));
  }

  getPoolSize() {
    if (this.keys.length === 0) this.refreshKeys();
    return this.keys.length;
  }

  async getNextKey() {
    return this.mutex.runExclusive(async () => {
      if (this.keys.length === 0) this.refreshKeys();
      if (this.keys.length === 0) {
        throw new Error('GROQ_API_KEY tidak ditemukan di .env');
      }

      const now = Date.now();
      // Cari key yang saat ini tidak sedang rate-limited
      for (let i = 0; i < this.keys.length; i++) {
        const idx = (this.currentIndex + i) % this.keys.length;
        const keyObj = this.keys[idx];
        if (keyObj.rateLimitedUntil <= now) {
          this.currentIndex = (idx + 1) % this.keys.length;
          return { keyObj, waitMs: 0 };
        }
      }

      // Jika seluruh key dalam pool sedang rate-limited, cari yang cooldown-nya paling cepat selesai
      const sorted = [...this.keys].sort((a, b) => a.rateLimitedUntil - b.rateLimitedUntil);
      const soonest = sorted[0];
      const waitMs = Math.max(0, soonest.rateLimitedUntil - now);
      return { keyObj: soonest, waitMs };
    });
  }

  async markRateLimited(keyStr, waitSeconds = 60) {
    await this.mutex.runExclusive(() => {
      const item = this.keys.find((k) => k.key === keyStr);
      if (item) {
        item.rateLimitedUntil = Date.now() + (waitSeconds * 1000);
        item.errorCount++;
        console.warn(`⏳ Groq Key #${item.index} (${item.masked}) tercatat rate-limited hingga ${waitSeconds} detik ke depan.`);
      }
    });
  }

  async markSuccess(keyStr) {
    await this.mutex.runExclusive(() => {
      const item = this.keys.find((k) => k.key === keyStr);
      if (item) {
        item.successCount++;
        item.totalRequests++;
      }
    });
  }
}

export const groqKeyPool = new GroqKeyPool();

/**
 * Transkripsi audio menggunakan AssemblyAI atau Groq Whisper (dengan word-level timestamps).
 * Menghasilkan UnifiedTranscript lengkap (Requirement R1 / Feature F1).
 *
 * @param {string} audioPath - Path ke file audio MP3
 * @param {Object} [options={}]
 * @param {Function} [options.onStatus]
 * @param {Object} [options.mockTranscript] - Mock transcript payload for testing/offline runs
 * @returns {Promise<UnifiedTranscript>}
 */
export async function transcribeAudio(audioPath, options = {}) {
  // Support mock transcript for testing/offline pipeline verification
  if (options.mockTranscript) {
    return normalizeToUnifiedTranscript(options.mockTranscript, audioPath);
  }

  console.log(`🎙️ Transcribing audio: ${audioPath}`);

  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`File audio tidak ditemukan: ${audioPath}`);
  }

  const fileSize = fs.statSync(audioPath).size;
  console.log(`   Original size: ${formatMB(fileSize)} MB`);

  const tempFiles = [];

  try {
    const preparedAudioPath = await optimizeAudioForTranscription(audioPath);
    tempFiles.push(preparedAudioPath);

    const preparedSize = fs.statSync(preparedAudioPath).size;
    console.log(`   Prepared size: ${formatMB(preparedSize)} MB`);

    const { duration: audioDuration } = await getAudioInfo(preparedAudioPath);

    let rawTranscript;

    if (TRANSCRIBE_PROVIDER === 'assemblyai') {
      rawTranscript = await transcribeWithAssemblyAI(preparedAudioPath, options);
    } else {
      if (groqKeyPool.getPoolSize() === 0) {
        throw new Error('GROQ_API_KEY tidak ditemukan di .env');
      }

      console.log(`🔑 Groq API Key pool aktif: ${groqKeyPool.getPoolSize()} akun terdaftar untuk rotasi anti rate-limit`);

      if (preparedSize <= TRANSCRIBE_CHUNK_TARGET_BYTES) {
        rawTranscript = await transcribeSingleFile(preparedAudioPath, 0, options);
      } else {
        if (!audioDuration || audioDuration <= 0) {
          throw new Error('Durasi audio tidak valid untuk dipecah ke beberapa bagian.');
        }

        const chunkCount = Math.ceil(preparedSize / TRANSCRIBE_CHUNK_TARGET_BYTES);
        const chunkDuration = Math.ceil(audioDuration / chunkCount);

        console.log(`   Audio panjang terdeteksi, membagi ke ${chunkCount} chunk (~${chunkDuration}s per chunk)`);

        const chunkPaths = await splitAudioIntoChunks(preparedAudioPath, audioDuration, chunkDuration);
        tempFiles.push(...chunkPaths);

        rawTranscript = await transcribeChunks(chunkPaths, options);
      }
    }

    // Detect acoustic and linguistic silence intervals
    const silenceIntervals = await detectSilence({
      audioPath: preparedAudioPath,
      words: rawTranscript.words || [],
      totalDuration: audioDuration,
    });

    const unified = {
      text: rawTranscript.text || '',
      language: rawTranscript.language || 'unknown',
      words: rawTranscript.words || [],
      sentences: rawTranscript.sentences || [],
      speakerTurns: rawTranscript.speakerTurns || [],
      segments: (rawTranscript.sentences || []).map((s) => ({
        id: s.index,
        start: s.start,
        end: s.end,
        text: s.text,
      })),
      silenceIntervals,
      duration: audioDuration || 0,
    };

    return unified;
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

/**
 * Normalizes an external or mock transcript object into the standardized UnifiedTranscript schema.
 * @param {Object} raw
 * @param {string} [audioPath]
 * @returns {Promise<UnifiedTranscript>}
 */
export async function normalizeToUnifiedTranscript(raw, audioPath = null) {
  let words = Array.isArray(raw.words) ? raw.words.slice() : [];

  // If sentences were provided but words missing, synthesize words
  if (words.length === 0 && Array.isArray(raw.sentences)) {
    for (const s of raw.sentences) {
      if (Array.isArray(s.words)) {
        words.push(...s.words);
      }
    }
  }

  // Format and validate word objects
  words = words
    .filter((w) => w && typeof w.word === 'string' && w.word.trim().length > 0)
    .map((w) => ({
      word: String(w.word).trim(),
      start: parseFloat(Number(w.start || 0).toFixed(3)),
      end: parseFloat(Number(w.end || 0).toFixed(3)),
      confidence: typeof w.confidence === 'number' ? parseFloat(w.confidence.toFixed(3)) : 1.0,
      ...(w.speaker ? { speaker: String(w.speaker) } : {}),
    }))
    .sort((a, b) => a.start - b.start);

  const sentences = Array.isArray(raw.sentences) && raw.sentences.length > 0
    ? raw.sentences
    : segmentWordsIntoSentences(words);

  const text = raw.text || sentences.map((s) => s.text).join(' ');
  let language = 'id';
  const normRaw = normalizeLanguageCode(raw.language);
  if (normRaw && normRaw !== 'auto' && normRaw !== 'unknown') {
    language = normRaw;
  } else if (text && text.trim().length > 0) {
    language = detectLanguageFromText(text);
  }
  const speakerTurns = Array.isArray(raw.speakerTurns) ? raw.speakerTurns : [];

  let silenceIntervals = Array.isArray(raw.silenceIntervals) ? raw.silenceIntervals : [];
  if (silenceIntervals.length === 0) {
    silenceIntervals = await detectSilence({
      audioPath,
      words,
      totalDuration: raw.duration,
    });
  }

  return {
    text,
    language,
    words,
    sentences,
    speakerTurns,
    segments: sentences.map((s) => ({
      id: s.index,
      start: s.start,
      end: s.end,
      text: s.text,
    })),
    silenceIntervals,
    duration: raw.duration || (words.length > 0 ? words[words.length - 1].end : 0),
  };
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

  // Preserve word tokens with millisecond to second conversion
  const words = extractWordsFromAssemblyAI(transcript);
  const sentences = segmentWordsIntoSentences(words);
  const speakerTurns = buildSpeakerTurnsFromAssemblyAI(transcript);

  console.log(`✅ AssemblyAI transcription done. ${words.length} words, ${sentences.length} sentences, ${transcript.text?.length || 0} chars`);

  const normLang = normalizeLanguageCode(transcript.language_code);
  const resolvedLang = (normLang && normLang !== 'unknown' && normLang !== 'auto')
    ? normLang
    : detectLanguageFromText(transcript.text || '');

  return {
    text: transcript.text || sentences.map((s) => s.text).join(' '),
    words,
    sentences,
    language: resolvedLang || 'unknown',
    speakerTurns,
  };
}

function extractWordsFromAssemblyAI(transcript) {
  let rawWords = [];

  if (Array.isArray(transcript.words) && transcript.words.length > 0) {
    rawWords = transcript.words;
  } else if (Array.isArray(transcript.utterances)) {
    for (const u of transcript.utterances) {
      if (Array.isArray(u.words)) {
        for (const w of u.words) {
          rawWords.push({
            ...w,
            speaker: w.speaker || u.speaker,
          });
        }
      }
    }
  }

  return rawWords
    .map((w) => {
      const text = String(w.text || w.word || '').trim();
      if (!text) return null;

      const start = typeof w.start === 'number' ? w.start / 1000 : 0;
      const end = typeof w.end === 'number' ? w.end / 1000 : start;
      const confidence = typeof w.confidence === 'number' ? parseFloat(w.confidence.toFixed(3)) : 1.0;
      const speaker = w.speaker ? String(w.speaker) : undefined;

      return {
        word: text,
        start: parseFloat(start.toFixed(3)),
        end: parseFloat(end.toFixed(3)),
        confidence,
        ...(speaker ? { speaker } : {}),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function buildSpeakerTurnsFromAssemblyAI(transcript) {
  if (!Array.isArray(transcript.utterances)) {
    return [];
  }

  return transcript.utterances
    .map((utterance, index) => ({
      id: index,
      speaker: utterance.speaker || 'unknown',
      start: parseFloat((utterance.start / 1000).toFixed(3)),
      end: parseFloat((utterance.end / 1000).toFixed(3)),
      text: String(utterance.text || '').trim(),
    }))
    .filter((turn) => turn.text && turn.end > turn.start);
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
    speaker_labels: true,
  };

  if (TRANSCRIBE_LANGUAGE && TRANSCRIBE_LANGUAGE !== 'auto') {
    payload.language_code = TRANSCRIBE_LANGUAGE;
  } else {
    payload.language_detection = true;
  }

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

async function transcribeChunks(chunkPaths, options = {}) {
  const allWords = [];
  const textParts = [];
  let offsetSeconds = 0;
  let detectedLanguage = 'unknown';

  for (let i = 0; i < chunkPaths.length; i++) {
    const chunkPath = chunkPaths[i];
    const chunkSize = fs.statSync(chunkPath).size;
    const { duration } = await getAudioInfo(chunkPath);

    console.log(`   Chunk ${i + 1}/${chunkPaths.length}: ${formatMB(chunkSize)} MB, durasi ${Math.round(duration)}s`);

    const partial = await transcribeSingleFile(chunkPath, offsetSeconds, options);
    if (partial.text && partial.text.trim()) {
      textParts.push(partial.text.trim());
    }
    allWords.push(...partial.words);

    if (detectedLanguage === 'unknown' && partial.language !== 'unknown') {
      detectedLanguage = partial.language;
    }

    offsetSeconds += duration;
  }

  const sentences = segmentWordsIntoSentences(allWords);

  console.log(`✅ Transcription done from ${chunkPaths.length} chunk(s). ${allWords.length} words, ${sentences.length} sentences`);

  return {
    text: textParts.join('\n\n'),
    words: allWords,
    sentences,
    language: detectedLanguage,
    speakerTurns: [],
  };
}

async function transcribeSingleFile(filePath, offsetSeconds = 0, options = {}) {
  const result = await requestGroqTranscription(filePath, options);

  let words = [];

  // Parse word-level timestamps returned by Groq Whisper
  if (Array.isArray(result.words) && result.words.length > 0) {
    words = result.words
      .map((w) => {
        const text = String(w.word || '').trim();
        if (!text) return null;
        return {
          word: text,
          start: parseFloat((w.start + offsetSeconds).toFixed(3)),
          end: parseFloat((w.end + offsetSeconds).toFixed(3)),
          confidence: typeof w.confidence === 'number' ? parseFloat(w.confidence.toFixed(3)) : 1.0,
        };
      })
      .filter(Boolean);
  } else if (Array.isArray(result.segments) && result.segments.length > 0) {
    // Fallback: interpolate words from segments if result.words was not returned
    for (const seg of result.segments) {
      const segText = String(seg.text || '').trim();
      if (!segText) continue;
      const tokens = segText.split(/\s+/).filter(Boolean);
      const segStart = seg.start + offsetSeconds;
      const segEnd = seg.end + offsetSeconds;
      const segDuration = Math.max(0.01, segEnd - segStart);
      const tokenDuration = segDuration / tokens.length;

      tokens.forEach((token, idx) => {
        const tokenStart = segStart + idx * tokenDuration;
        const tokenEnd = Math.min(segEnd, tokenStart + tokenDuration);
        words.push({
          word: token,
          start: parseFloat(tokenStart.toFixed(3)),
          end: parseFloat(tokenEnd.toFixed(3)),
          confidence: 1.0,
        });
      });
    }
  }

  const sentences = segmentWordsIntoSentences(words);
  const normLang = normalizeLanguageCode(result.language);
  const resolvedLang = (normLang && normLang !== 'unknown' && normLang !== 'auto')
    ? normLang
    : detectLanguageFromText(result.text || '');

  return {
    text: result.text || '',
    words,
    sentences,
    language: resolvedLang || 'unknown',
    speakerTurns: [],
  };
}

async function requestGroqTranscription(filePath, options = {}) {
  const poolSize = groqKeyPool.getPoolSize();
  const maxAttempts = Math.max(poolSize * 2, 6);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { keyObj, waitMs } = await groqKeyPool.getNextKey();

    // Jika seluruh key dalam pool sedang rate-limited / cooldown
    if (waitMs > 0) {
      const waitSeconds = Math.ceil(waitMs / 1000);
      const waitLabel = formatWaitTime(waitSeconds);
      console.warn(`⏳ Semua (${poolSize}) API key Groq sedang cooldown. Menunggu key #${keyObj.index} (${keyObj.masked}) selama ${waitLabel}...`);
      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          message: `Semua API key Groq sedang cooldown. Menunggu ${waitLabel}...`,
          percent: 32,
        });
      }
      await sleep(Math.min(waitMs + 1000, 300000));
    }

    const currentKey = keyObj.key;
    const formData = buildGroqFormData(filePath);

    try {
      console.log(`🎙️ [Groq Whisper] Mengirim audio ke Key #${keyObj.index} (${keyObj.masked}) [Attempt ${attempt}/${maxAttempts}]...`);
      const response = await axios.post(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${currentKey}`,
          },
          timeout: 180000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      await groqKeyPool.markSuccess(currentKey);
      console.log(`✅ [Groq Whisper] Transkripsi sukses dengan Key #${keyObj.index} (${keyObj.masked})`);
      return response.data;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      const status = err.response?.status;
      const waitSeconds = parseRetryAfterSeconds(msg) || (status === 429 ? 60 : null);

      if (waitSeconds !== null || status === 429) {
        await groqKeyPool.markRateLimited(currentKey, waitSeconds || 60);
        console.warn(`🔄 Key #${keyObj.index} (${keyObj.masked}) terkena rate limit Groq! Otomatis rotasi ke API key berikutnya tanpa menunggu...`);
        if (typeof options.onStatus === 'function') {
          await options.onStatus({
            message: `Key #${keyObj.index} limit, otomatis rotasi ke API key lain...`,
            percent: 32,
          });
        }
        // Langsung lanjut ke percobaan berikutnya dengan key berikutnya!
        continue;
      }

      // Server error dari Groq (5xx)
      if (status >= 500 && attempt < maxAttempts) {
        console.warn(`⚠️ Groq server error ${status}, mencoba key berikutnya...`);
        await sleep(1500);
        continue;
      }

      throw new Error(`Transkripsi Groq gagal: ${msg}`);
    }
  }

  throw new Error(`Transkripsi gagal: seluruh (${poolSize}) API key Groq telah dicoba.`);
}

function buildGroqFormData(filePath) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'audio/mp3',
  });
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  // Request word-level timestamps from Groq Whisper API (Requirement R1 / Feature F1)
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');

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
