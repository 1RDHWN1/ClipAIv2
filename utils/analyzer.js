// utils/analyzer.js
import axios from 'axios';
import 'dotenv/config';

const AI_ANALYSIS_MAX_SEGMENTS = parseInt(process.env.AI_ANALYSIS_MAX_SEGMENTS || '400', 10);
const AI_ANALYSIS_WINDOW_SECONDS = parseInt(process.env.AI_ANALYSIS_WINDOW_SECONDS || '30', 10);
const AI_ANALYSIS_MAX_RETRIES = parseInt(process.env.AI_ANALYSIS_MAX_RETRIES || '2', 10);
const AI_ANALYSIS_MAX_COMPLETION_TOKENS = parseInt(process.env.AI_ANALYSIS_MAX_COMPLETION_TOKENS || '2200', 10);

/**
 * Analisis transkrip menggunakan AI untuk menemukan momen terbaik
 * @param {string} transcript - Full teks transkrip
 * @param {Array} segments - Segments dengan timestamp [{start, end, text}]
 * @param {number} videoDuration - Durasi total video (detik)
 * @param {number} clipCount - Jumlah clip yang diinginkan (default 3)
 * @returns {Promise<Array<{start, end, title, reason, score}>>}
 */
export async function analyzeTranscript(transcript, segments, videoDuration, clipCount = 3) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY tidak ditemukan di .env');

  const model = process.env.AI_MODEL || 'deepseek/deepseek-chat-v3-0324';

  console.log(`🤖 Analyzing transcript with AI (${model})...`);

  const analysisSegments = compactSegmentsForAnalysis(segments, videoDuration);

  // Format segments untuk prompt
  const segmentsText = analysisSegments
    .map((s) => `[${s.start}s - ${s.end}s]: ${s.text}`)
    .join('\n');

  const prompt = buildAnalysisPrompt(segmentsText, videoDuration, clipCount);

  for (let attempt = 1; attempt <= AI_ANALYSIS_MAX_RETRIES; attempt++) {
    const useJsonMode = attempt === 1;

    try {
      const response = await requestClipAnalysis({
        apiKey: OPENROUTER_API_KEY,
        model,
        prompt,
        useJsonMode,
      });

      const meta = {
        attempt,
        finishReason: response.data.choices?.[0]?.finish_reason || 'unknown',
        provider: response.data.provider || 'unknown',
      };
      console.log('🤖 AI response meta:', meta);

      const rawContent = extractAssistantContent(response.data);
      console.log('🤖 AI raw response:', rawContent.substring(0, 200) || '[empty]');

      const parsed = parseClipPayload(rawContent);
      const validated = validateClips(parsed, videoDuration, clipCount);

      if (validated.length > 0) {
        console.log(`✅ AI found ${validated.length} clips`);
        return validated;
      }

      console.warn(`⚠️ AI attempt ${attempt} tidak menghasilkan clip valid`);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      const unsupportedJsonMode =
        useJsonMode &&
        /response_format|json_schema|json_object|structured output|unsupported/i.test(msg);

      console.warn(`⚠️ AI attempt ${attempt} gagal: ${msg}`);

      if (attempt === AI_ANALYSIS_MAX_RETRIES) {
        throw new Error(`AI analisis gagal: ${msg}`);
      }

      if (unsupportedJsonMode) {
        console.log('↪️ Model/provider tidak mendukung JSON mode, retry dengan prompt biasa...');
      } else {
        console.log('↪️ Retry analisis AI dengan fallback parser...');
      }
    }
  }

  throw new Error('AI analisis gagal: model tidak mengembalikan clip yang valid');
}

function buildAnalysisPrompt(segmentsText, videoDuration, clipCount) {
  return `Kamu adalah AI video editor yang ahli dalam menemukan momen-momen viral dan menarik dari sebuah video.

Berikut adalah transkrip video beserta timestamp-nya:
Durasi total video: ${videoDuration} detik

=== TRANSKRIP ===
${segmentsText}
================

Tugasmu: Pilih TEPAT ${clipCount} segmen terbaik dari video ini yang paling menarik, informatif, atau berpotensi viral sebagai short video (durasi 30-90 detik).

Aturan:
- Setiap clip harus punya durasi minimal 30 detik dan maksimal 90 detik
- Pilih momen dengan konten yang paling engaging (hook kuat, insight menarik, momen emosional, dll)
- Pastikan setiap clip memiliki konteks yang lengkap (tidak putus di tengah kalimat)
- Timestamp start dan end HARUS SESUAI dengan data segmen yang diberikan
- Jangan pilih bagian yang sama / overlap antar clip

Balas HANYA dengan JSON object valid tanpa markdown, format:
{
  "clips": [
    {
      "start": 12.5,
      "end": 67.3,
      "title": "Judul singkat clip ini (maks 8 kata)",
      "reason": "Mengapa segment ini menarik (1-2 kalimat)",
      "score": 95
    }
  ]
}

score adalah skor viral potential 0-100.`;
}

async function requestClipAnalysis({ apiKey, model, prompt, useJsonMode }) {
  const payload = {
    model,
    messages: [
      {
        role: 'system',
        content: 'Kamu hanya boleh menjawab dengan JSON valid. Jangan tampilkan reasoning, analisis langkah demi langkah, atau teks selain JSON.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.2,
    top_p: 0.9,
    max_completion_tokens: AI_ANALYSIS_MAX_COMPLETION_TOKENS,
  };

  if (useJsonMode) {
    payload.response_format = { type: 'json_object' };
    payload.provider = {
      require_parameters: true,
      allow_fallbacks: true,
    };
  }

  return axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    payload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://video-clipper.local',
        'X-Title': 'Video Clipper AI',
      },
      timeout: 90000,
    }
  );
}

function extractAssistantContent(data) {
  const message = data?.choices?.[0]?.message;
  const content = message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        if (typeof item?.content === 'string') return item.content;
        return '';
      })
      .join('\n')
      .trim();
  }

  if (typeof message?.reasoning === 'string' && message.reasoning.trim()) {
    return message.reasoning.trim();
  }

  return '';
}

function parseClipPayload(rawContent) {
  const cleaned = rawContent
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  if (!cleaned) {
    throw new Error('AI tidak mengembalikan konten untuk dianalisis');
  }

  try {
    const direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) {
      return direct;
    }

    if (Array.isArray(direct?.clips)) {
      return direct.clips;
    }
  } catch (_) {
    // lanjut ke fallback regex di bawah
  }

  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    return JSON.parse(match[0]);
  }

  throw new Error('AI tidak mengembalikan format JSON yang valid');
}

function validateClips(clips, videoDuration, clipCount) {
  if (!Array.isArray(clips)) {
    throw new Error('AI response bukan array');
  }

  return clips
    .filter((c) => typeof c.start === 'number' && typeof c.end === 'number')
    .map((c) => ({
      start: Math.max(0, parseFloat(c.start.toFixed(2))),
      end: Math.min(videoDuration, parseFloat(c.end.toFixed(2))),
      title: c.title || 'Clip Menarik',
      reason: c.reason || '',
      score: Math.min(100, Math.max(0, parseInt(c.score, 10) || 80)),
    }))
    .filter((c) => c.end - c.start >= 10)
    .slice(0, clipCount);
}

function compactSegmentsForAnalysis(segments, videoDuration) {
  if (segments.length <= AI_ANALYSIS_MAX_SEGMENTS) {
    return segments;
  }

  const windowSeconds = Math.max(
    AI_ANALYSIS_WINDOW_SECONDS,
    Math.ceil(videoDuration / AI_ANALYSIS_MAX_SEGMENTS)
  );

  const compacted = [];
  let current = null;

  for (const segment of segments) {
    if (!current) {
      current = { start: segment.start, end: segment.end, texts: [segment.text] };
      continue;
    }

    const wouldExceedWindow = (segment.end - current.start) > windowSeconds;
    if (wouldExceedWindow) {
      compacted.push({
        start: parseFloat(current.start.toFixed(2)),
        end: parseFloat(current.end.toFixed(2)),
        text: current.texts.join(' ').trim(),
      });
      current = { start: segment.start, end: segment.end, texts: [segment.text] };
      continue;
    }

    current.end = segment.end;
    current.texts.push(segment.text);
  }

  if (current) {
    compacted.push({
      start: parseFloat(current.start.toFixed(2)),
      end: parseFloat(current.end.toFixed(2)),
      text: current.texts.join(' ').trim(),
    });
  }

  console.log(`   Compacting transcript for AI: ${segments.length} -> ${compacted.length} segment(s)`);
  return compacted;
}
