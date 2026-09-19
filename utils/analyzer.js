import axios from 'axios';
import 'dotenv/config';
import { buildSentenceMap } from './sentenceSegmenter.js';
import { snapBoundary } from './boundarySnapper.js';
import { normalizeLanguageCode, detectLanguageFromText } from './transcriber.js';

export const DEFAULT_AI_MODEL = 'ag/gemini-3.8-flash-high';
export const DEFAULT_AI_BASE_URL = 'http://localhost:20128/v1';

const AI_ANALYSIS_MAX_SEGMENTS = parseInt(process.env.AI_ANALYSIS_MAX_SEGMENTS || '400', 10);
const AI_ANALYSIS_WINDOW_SECONDS = parseInt(process.env.AI_ANALYSIS_WINDOW_SECONDS || '30', 10);
const AI_ANALYSIS_MAX_RETRIES = parseInt(process.env.AI_ANALYSIS_MAX_RETRIES || '2', 10);
const AI_ANALYSIS_MAX_COMPLETION_TOKENS = parseInt(process.env.AI_ANALYSIS_MAX_COMPLETION_TOKENS || '2500', 10);

export const VALID_HOOK_TAXONOMY = [
  'question',
  'bold_statement',
  'negative_hook',
  'story_anecdote',
  'shocking_fact',
  'action_instruction',
];

/**
 * Resolve AI model and gateway configuration with multi-tier fallback support.
 * @returns {{ model: string, baseUrl: string, apiKey: string, fallbackBaseUrl: string|null, fallbackModel: string }}
 */
export function resolveModelConfiguration() {
  const model = process.env.DEFAULT_MODEL || process.env.AI_MODEL || DEFAULT_AI_MODEL;
  const baseUrl = (process.env.AI_BASE_URL || DEFAULT_AI_BASE_URL).replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || 'dummy';
  const fallbackBaseUrl = process.env.AI_FALLBACK_BASE_URL
    ? process.env.AI_FALLBACK_BASE_URL.replace(/\/+$/, '')
    : (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : null);
  const fallbackModel = process.env.AI_FALLBACK_MODEL || 'ag/gemini-3.8-flash';

  return {
    model,
    baseUrl,
    apiKey,
    fallbackBaseUrl,
    fallbackModel,
  };
}

/**
 * Build an ordered candidate list for gateway resilience.
 * Order: Primary local 9Router -> Local loopback (127.0.0.1) -> Fallback Gateway / OpenRouter -> Model fallbacks
 * @param {Object} [config]
 * @returns {Array<{ baseUrl: string, model: string, apiKey: string, label: string }>}
 */
export function buildGatewayCandidates(config = resolveModelConfiguration()) {
  const rawCandidates = [];

  // Tier 1: Primary configured gateway
  rawCandidates.push({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    label: 'primary-gateway',
  });

  // Tier 2: Local loopback alias (if localhost, also try 127.0.0.1)
  if (config.baseUrl.includes('localhost:20128')) {
    rawCandidates.push({
      baseUrl: config.baseUrl.replace('localhost:20128', '127.0.0.1:20128'),
      model: config.model,
      apiKey: config.apiKey,
      label: 'local-loopback',
    });
  }

  // Tier 3: Configured fallback gateway (e.g. OpenRouter or backup proxy)
  if (config.fallbackBaseUrl && config.fallbackBaseUrl !== config.baseUrl) {
    const fallbackApiKey = config.fallbackBaseUrl.includes('openrouter.ai')
      ? (process.env.OPENROUTER_API_KEY || config.apiKey)
      : config.apiKey;
    rawCandidates.push({
      baseUrl: config.fallbackBaseUrl,
      model: config.model,
      apiKey: fallbackApiKey,
      label: 'fallback-gateway',
    });
  } else if (process.env.OPENROUTER_API_KEY && !config.baseUrl.includes('openrouter.ai')) {
    rawCandidates.push({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: config.model,
      apiKey: process.env.OPENROUTER_API_KEY,
      label: 'openrouter-gateway',
    });
  }

  // Tier 4: Fallback model on primary gateway
  if (config.fallbackModel && config.fallbackModel !== config.model) {
    rawCandidates.push({
      baseUrl: config.baseUrl,
      model: config.fallbackModel,
      apiKey: config.apiKey,
      label: 'primary-fallback-model',
    });
    if (config.fallbackBaseUrl && config.fallbackBaseUrl !== config.baseUrl) {
      rawCandidates.push({
        baseUrl: config.fallbackBaseUrl,
        model: config.fallbackModel,
        apiKey: config.fallbackBaseUrl.includes('openrouter.ai')
          ? (process.env.OPENROUTER_API_KEY || config.apiKey)
          : config.apiKey,
        label: 'fallback-gateway-model',
      });
    }
  }

  // Deduplicate candidates by baseUrl + model + apiKey
  const seen = new Set();
  const candidates = [];
  for (const c of rawCandidates) {
    const key = `${c.baseUrl}|${c.model}|${c.apiKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(c);
    }
  }

  return candidates;
}

/**
 * Format AI prompt using discrete sentence IDs (s1..sN) instead of floating timestamps.
 * @param {Array<Object>} sentencesList
 * @param {number} duration
 * @param {number} clipCount
 * @param {Object} [options={}]
 * @returns {string}
 */
export function buildDiscreteSentencePrompt(sentencesList, duration, clipCount = 3, options = {}) {
  if (!Array.isArray(sentencesList) || sentencesList.length === 0) {
    throw new Error('sentencesList must be a non-empty array');
  }

  const formattedLines = sentencesList.map((s) => {
    const spk = s.speaker ? ` [${s.speaker}]` : '';
    const hype = s.isHypePeak ? ` [🔥 HYPE PEAK: ${s.hypeScore || 85}]` : '';
    return `[${s.id}]${spk}${hype}: ${s.text}`;
  });

  const rawLang = options.language || 'id';
  const isEn = String(rawLang).toLowerCase().startsWith('en');

  const languageDirectives = isEn
    ? [
        `LANGUAGE REQUIREMENTS:`,
        `- The video dialogue is in English.`,
        `- "title": MUST be written in natural, engaging English. MUST be a punchy, high-CTR title (max 8 words) with power words, curiosity gaps, or emotional stakes (avoiding bland summaries like "Compelling Clip" or generic labels).`,
        `- "hookText": MUST be the exact verbatim dialogue from the opening sentence segment (first 0-3 seconds).`,
        `- "narrativeRationale" ({ setup, climax, conclusion }): MUST be written in natural English.`,
        `- "viralityRationale": MUST be written in natural English, explaining how the clip delivers on 0-3s pattern interrupt, pacing, retention potential, and payoff clarity.`,
        `- STRICT TAXONOMY INVARIANT: "hookClassification" MUST strictly be one of the normalized English taxonomy strings: ["question", "bold_statement", "negative_hook", "story_anecdote", "shocking_fact", "action_instruction"]. DO NOT translate the taxonomy values into any other language.`,
      ]
    : [
        `PETUNJUK BAHASA:`,
        `- Dialog video dalam bahasa Indonesia.`,
        `- "title": HARUS ditulis dalam bahasa Indonesia yang menarik dan alami. HARUS berupa judul high-CTR yang memikat dan memicu rasa penasaran (maks 8 kata) menggunakan power words atau stakes emosional (hindari ringkasan hambar seperti "Clip Menarik" atau label umum).`,
        `- "hookText": HARUS teks asli verbatim dari segmen kalimat pembuka (0-3 detik pertama).`,
        `- "narrativeRationale" ({ setup, climax, conclusion }): HARUS ditulis dalam bahasa Indonesia yang alami.`,
        `- "viralityRationale": HARUS ditulis dalam bahasa Indonesia yang alami, menjelaskan kekuatan pattern interrupt 0-3 detik, pacing, potensi retensi, dan kejelasan payoff.`,
        `- STRICT TAXONOMY INVARIANT: "hookClassification" HARUS tetap menggunakan salah satu dari 6 istilah taksonomi bahasa Inggris: ["question", "bold_statement", "negative_hook", "story_anecdote", "shocking_fact", "action_instruction"]. JANGAN menerjemahkan hookClassification ke bahasa lain.`,
      ];

  return [
    `You are an elite viral content strategist and master short-form video editor (inspired by Opus Clip and modern TikTok, YouTube Shorts, and Instagram Reels virality formulas).`,
    `Video duration: ${duration} seconds. Total sentences: ${sentencesList.length}.`,
    `CRITICAL REQUIREMENTS:`,
    `- Select exactly ${clipCount} viral highlight clips for Shorts / TikTok / Reels.`,
    `- DURATION CONSTRAINT: Each clip MUST be between 30 and 90 seconds (optimal: 45-60 seconds).`,
    `- STRICT MAXIMUM DURATION: 90 SECONDS (1.5 minutes). Do NOT pick clips longer than 90 seconds!`,
    `- 0-3s PATTERN INTERRUPT: The opening sentence of each clip ("startSentenceId") MUST serve as an immediate 0-3 second pattern interrupt, curiosity gap, or emotional hook to prevent viewers from swiping away.`,
    `- 4-PILLAR VIRALITY SCORING FORMULA: "viralityScore" (0-100) MUST be strictly evaluated across four core 25-point dimensions:`,
    `  1. Hook Strength (0-25): Impact of the 0-3s pattern interrupt and curiosity capture.`,
    `  2. Pacing (0-25): High information density, brisk rhythm, zero dead air.`,
    `  3. Retention Potential (0-25): Escalating narrative tension preventing drop-off before climax.`,
    `  4. Payoff Clarity (0-25): Delivering a high-impact resolution, aha moment, or punchline.`,
    ...languageDirectives,
    `=== SENTENCE SEGMENTS ===`,
    ...formattedLines,
    `=========================`,
    `For every clip, return:`,
    `- startSentenceId: (e.g. "s1")`,
    `- endSentenceId: (e.g. "s3")`,
    `- title: punchy, high-CTR title (max 8 words)`,
    `- hookClassification: one of ["question", "bold_statement", "negative_hook", "story_anecdote", "shocking_fact", "action_instruction"]`,
    `- hookText: the exact text of the opening 0-3s hook`,
    `- narrativeRationale: { setup, climax, conclusion, isCompleteArc }`,
    `- viralityScore: 0-100 (evaluated strictly via the 4-pillar formula)`,
    `- viralityRationale: explanation of why this will hook and retain viewers`,
    ``,
    `Respond ONLY with valid JSON object:`,
    `{ "clips": [ ... ] }`,
  ].join('\n');
}

function normalizeSentenceId(rawId) {
  if (rawId == null) return null;
  const str = String(rawId).trim().replace(/^\[|\]$/g, '').toLowerCase();
  const match = str.match(/^s?0*(\d+)$/);
  if (match) {
    return `s${match[1]}`;
  }
  return str;
}

/**
 * Deterministic Sentence ID Resolution
 * Maps startSentenceId and endSentenceId to pre-snapped timestamps.
 * @param {Object} clip
 * @param {Map<string, Object>} map
 * @param {Object} context
 * @returns {Object}
 */
export function resolveSentenceIds(clip, map, context = {}) {
  if (!clip || typeof clip !== 'object') {
    throw new Error('Invalid clip object');
  }
  const { startSentenceId, endSentenceId } = clip;
  const normStart = normalizeSentenceId(startSentenceId);
  const normEnd = normalizeSentenceId(endSentenceId);
  const startKey = map.has(startSentenceId) ? startSentenceId : (map.has(normStart) ? normStart : startSentenceId);
  const endKey = map.has(endSentenceId) ? endSentenceId : (map.has(normEnd) ? normEnd : endSentenceId);

  if (!startKey || !map.has(startKey)) {
    throw new Error(`Invalid startSentenceId "${startSentenceId}" not found in sentence map`);
  }
  if (!endKey || !map.has(endKey)) {
    throw new Error(`Invalid endSentenceId "${endSentenceId}" not found in sentence map`);
  }

  const startSentence = map.get(startKey);
  let endSentence = map.get(endKey);

  if (startSentence.index > endSentence.index) {
    throw new Error(`startSentenceId "${startSentenceId}" (index ${startSentence.index}) cannot be after endSentenceId "${endSentenceId}" (index ${endSentence.index})`);
  }

  // Pre-snap boundaries using boundary snapper FIRST
  const startSnap = snapBoundary(startSentence.start, {
    ...context,
    boundaryType: 'start',
  });
  const endSnap = snapBoundary(endSentence.end, {
    ...context,
    boundaryType: 'end',
  });

  let snappedStart = startSnap.snappedTime;
  let snappedEnd = endSnap.snappedTime;

  // Enforce max duration constraint AFTER snapping (default 90 seconds / 1.5 minutes)
  const maxClipDuration = typeof context.maxClipDuration === 'number' ? context.maxClipDuration : 90;
  if (context.clampDuration !== false && (snappedEnd - snappedStart) > maxClipDuration) {
    // Need to adjust end boundary backward
    if (Array.isArray(context.sentences) && context.sentences.length > 0) {
      // Find the latest sentence that keeps us within maxClipDuration from snappedStart
      for (let idx = endSentence.index; idx >= startSentence.index; idx--) {
        const candidate = context.sentences.find((s) => s.index === idx);
        if (candidate) {
          const candidateEndSnap = snapBoundary(candidate.end, {
            ...context,
            boundaryType: 'end',
          });
          if ((candidateEndSnap.snappedTime - snappedStart) <= maxClipDuration) {
            endSentence = candidate;
            snappedEnd = candidateEndSnap.snappedTime;
            endSnap.snappedTo = candidateEndSnap.snappedTo;
            endSnap.adjustedDeltaMs = candidateEndSnap.adjustedDeltaMs;
            break;
          }
        }
      }
    }
  }

  const isEn = String(context.language || '').toLowerCase().startsWith('en');
  const defaultTitle = isEn ? 'Compelling Clip' : 'Clip Menarik';

  return {
    ...clip,
    title: clip.title || defaultTitle,
    start: startSnap.snappedTime,
    end: endSnap.snappedTime,
    resolvedSentences: {
      count: endSentence.index - startSentence.index + 1,
      startText: startSentence.text,
      endText: endSentence.text,
    },
    snappingDetails: {
      start: startSnap,
      end: endSnap,
    },
  };
}

/**
 * Validates clip schema conforming to narrative and virality standards
 * @param {Object} clip
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateNarrativeClipSchema(clip) {
  if (!clip || typeof clip !== 'object') {
    return { valid: false, reason: 'Clip must be an object' };
  }
  if (!clip.hookClassification || !VALID_HOOK_TAXONOMY.includes(clip.hookClassification)) {
    return { valid: false, reason: `Invalid or missing hookClassification: ${clip.hookClassification}` };
  }
  if (typeof clip.hookText !== 'string' || clip.hookText.trim().length === 0) {
    return { valid: false, reason: 'hookText must be a non-empty string' };
  }
  if (!clip.narrativeRationale || typeof clip.narrativeRationale !== 'object') {
    return { valid: false, reason: 'narrativeRationale must be an object' };
  }
  const { setup, climax, conclusion, isCompleteArc } = clip.narrativeRationale;
  if (typeof setup !== 'string' || typeof climax !== 'string' || typeof conclusion !== 'string') {
    return { valid: false, reason: 'setup, climax, and conclusion must be strings' };
  }
  if (typeof isCompleteArc !== 'boolean') {
    return { valid: false, reason: 'isCompleteArc must be a boolean' };
  }
  if (typeof clip.viralityScore !== 'number' || isNaN(clip.viralityScore) || clip.viralityScore < 0 || clip.viralityScore > 100) {
    return { valid: false, reason: 'viralityScore must be a number between 0 and 100' };
  }
  if (typeof clip.viralityRationale !== 'string' || clip.viralityRationale.trim().length === 0) {
    return { valid: false, reason: 'viralityRationale must be a non-empty string' };
  }
  return { valid: true };
}

/**
 * Analisis transkrip menggunakan AI untuk menemukan momen terbaik
 * @param {string} transcript - Full teks transkrip
 * @param {Array} segments - Segments dengan timestamp [{start, end, text}]
 * @param {number} videoDuration - Durasi total video (detik)
 * @param {number} clipCount - Jumlah clip yang diinginkan (default 3)
 * @param {Object} [context={}] - Context containing sentences, words, silences
 * @returns {Promise<Array<{start, end, title, reason, score}>>}
 */
export async function analyzeTranscript(transcript, segments, videoDuration, clipCount = 3, context = {}) {
  const config = resolveModelConfiguration();
  const candidates = buildGatewayCandidates(config);

  if (candidates.length === 0) {
    throw new Error('API key atau AI_BASE_URL tidak ditemukan di .env');
  }

  console.log(`🤖 Analyzing transcript with AI (${config.model}) via ${config.baseUrl} (${candidates.length} candidate endpoint(s))...`);

  // Use discrete sentence prompt if sentences available
  const hasSentences = Array.isArray(context.sentences) && context.sentences.length > 0;
  const sentenceMap = hasSentences ? buildSentenceMap(context.sentences) : null;

  // Resolve language from context or transcript text
  const resolvedLanguage = (context.language && context.language !== 'auto' && context.language !== 'unknown')
    ? normalizeLanguageCode(context.language)
    : detectLanguageFromText(transcript || (context.sentences ? context.sentences.map((s) => s.text).join(' ') : ''));

  let prompt;
  if (hasSentences) {
    prompt = buildDiscreteSentencePrompt(context.sentences, videoDuration, clipCount, { language: resolvedLanguage });
  } else {
    const analysisSegments = compactSegmentsForAnalysis(segments, videoDuration);
    const segmentsText = analysisSegments
      .map((s) => `[${s.start}s - ${s.end}s]: ${s.text}`)
      .join('\n');
    prompt = buildAnalysisPrompt(segmentsText, videoDuration, clipCount, resolvedLanguage);
  }

  let lastError = null;

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const candidate = candidates[cIdx];
    console.log(`🤖 [analyzer] Candidate ${cIdx + 1}/${candidates.length}: ${candidate.model} via ${candidate.baseUrl} (${candidate.label})...`);

    for (let attempt = 1; attempt <= AI_ANALYSIS_MAX_RETRIES; attempt++) {
      const useJsonMode = attempt === 1;

      try {
        const response = await requestClipAnalysis({
          apiKey: candidate.apiKey,
          model: candidate.model,
          baseUrl: candidate.baseUrl,
          prompt,
          useJsonMode,
          language: resolvedLanguage,
        });

        const meta = {
          candidate: candidate.label,
          attempt,
          finishReason: response.data?.choices?.[0]?.finish_reason || 'unknown',
          provider: response.data?.provider || 'unknown',
        };
        console.log('🤖 AI response meta:', meta);

        const rawContent = extractAssistantContent(response.data);
        console.log('🤖 AI raw response:', rawContent.substring(0, 200) || '[empty]');

        const parsed = parseClipPayload(rawContent);

        if (hasSentences && sentenceMap) {
          const resolvedClips = [];
          for (const rawClip of parsed) {
            try {
              const resolved = resolveSentenceIds(rawClip, sentenceMap, {
                sentences: context.sentences,
                words: context.words || [],
                silences: context.silences || [],
                language: resolvedLanguage,
              });
              resolvedClips.push(resolved);
            } catch (resErr) {
              console.warn(`[analyzer] Skipping clip due to resolution error: ${resErr.message}`);
            }
          }

          if (resolvedClips.length > 0) {
            resolvedClips.sort((a, b) => (b.viralityScore || 0) - (a.viralityScore || 0));
            console.log(`✅ AI found & resolved ${resolvedClips.length} clips with discrete sentence boundaries`);
            return resolvedClips.slice(0, clipCount);
          }
        }

        const validated = validateClips(parsed, videoDuration, clipCount, resolvedLanguage);
        if (validated.length > 0) {
          console.log(`✅ AI found ${validated.length} clips`);
          return validated;
        }

        console.warn(`⚠️ AI candidate ${candidate.label} attempt ${attempt} tidak menghasilkan clip valid`);
      } catch (err) {
        lastError = err;
        const msg = err.response?.data?.error?.message || err.message;
        const status = err.response?.status;
        const code = err.code;

        const isNetworkOrGateway =
          code === 'ECONNREFUSED' ||
          code === 'ENOTFOUND' ||
          code === 'ETIMEDOUT' ||
          code === 'ECONNRESET' ||
          status === 404 ||
          status === 502 ||
          status === 503 ||
          status === 504 ||
          /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|Bad Gateway|Gateway Timeout/i.test(msg);

        const unsupportedJsonMode =
          useJsonMode &&
          /response_format|json_schema|json_object|structured output|unsupported/i.test(msg);

        console.warn(`⚠️ AI candidate ${candidate.label} attempt ${attempt} failed: ${msg}`);

        if (isNetworkOrGateway && cIdx < candidates.length - 1) {
          console.warn(`⚠️ Gateway ${candidate.baseUrl} unavailable (${msg}). Cascading to next candidate...`);
          break;
        }

        if (unsupportedJsonMode) {
          console.log('↪️ Model/provider tidak mendukung JSON mode, retry dengan prompt biasa...');
        } else {
          console.log('↪️ Retry analisis AI dengan fallback parser...');
        }
      }
    }
  }

  throw new Error(`AI analisis gagal: ${lastError?.message || 'model tidak mengembalikan clip yang valid'}`);
}

function buildAnalysisPrompt(segmentsText, videoDuration, clipCount, language = 'id') {
  const isEn = String(language).toLowerCase().startsWith('en');
  if (isEn) {
    return `You are an elite viral content strategist specializing in finding high-retention, viral highlight clips for Shorts / TikTok / Reels.

Here is the video transcript with timestamps:
Total video duration: ${videoDuration} seconds

=== TRANSCRIPT ===
${segmentsText}
=================

Your task: Select EXACTLY ${clipCount} best segments from this video that have the strongest viral potential (duration 30-90 seconds).

Rules:
- Each clip MUST have a duration between 30 and 90 seconds (optimal: 45-60 seconds)
- Opening 0-3 seconds MUST have a strong pattern interrupt or curiosity hook to stop scrolling
- Titles MUST be punchy, high-CTR (max 8 words) in English, avoiding generic labels
- Virality score is 0-100 evaluated across hook strength, pacing, retention potential, and payoff clarity
- Ensure every clip has complete context (do not cut mid-sentence)
- Start and end timestamps MUST MATCH the provided segment data
- Do not select overlapping sections across clips

Respond ONLY with valid JSON object without markdown, format:
{
  "clips": [
    {
      "start": 12.5,
      "end": 67.3,
      "title": "High-CTR Punchy Title (max 8 words)",
      "reason": "Why this segment hooks and retains viewers (1-2 sentences)",
      "score": 95
    }
  ]
}

score is viral potential 0-100.`;
  }

  return `Kamu adalah ahli strategi konten viral (viral content strategist) yang ahli dalam menemukan momen-momen viral dan beretensi tinggi untuk Shorts / TikTok / Reels.

Berikut adalah transkrip video beserta timestamp-nya:
Durasi total video: ${videoDuration} detik

=== TRANSKRIP ===
${segmentsText}
================

Tugasmu: Pilih TEPAT ${clipCount} segmen terbaik dari video ini yang paling berpotensi viral (durasi 30-90 detik).

Aturan:
- Setiap clip HARUS punya durasi minimal 30 detik dan maksimal 90 detik (optimal: 45-60 detik)
- Pembuka 0-3 detik HARUS memiliki pattern interrupt atau hook rasa penasaran yang kuat
- Judul HARUS menarik, high-CTR (maks 8 kata) dalam bahasa Indonesia, hindari label umum
- Skor viral 0-100 dievaluasi berdasarkan kekuatan hook, pacing, potensi retensi, dan kejelasan payoff
- Pastikan setiap clip memiliki konteks yang lengkap (tidak putus di tengah kalimat)
- Timestamp start dan end HARUS SESUAI dengan data segmen yang diberikan
- Jangan pilih bagian yang sama / overlap antar clip

Balas HANYA dengan JSON object valid tanpa markdown, format:
{
  "clips": [
    {
      "start": 12.5,
      "end": 67.3,
      "title": "Judul High-CTR Menarik (maks 8 kata)",
      "reason": "Mengapa segmen ini memikat dan mempertahankan penonton (1-2 kalimat)",
      "score": 95
    }
  ]
}

score adalah skor viral potential 0-100.`;
}

async function requestClipAnalysis({ apiKey, model, prompt, useJsonMode, language = 'id', baseUrl: customBaseUrl }) {
  const isEn = String(language).toLowerCase().startsWith('en');
  const systemContent = isEn
    ? 'You are an elite viral content strategist. You must respond ONLY with a valid JSON object matching the requested schema. Do not output any markdown formatting, reasoning, or text outside the JSON. All titles, hooks, and rationales MUST be in natural English.'
    : 'Kamu adalah ahli strategi konten viral. Kamu hanya boleh menjawab dengan objek JSON valid sesuai skema yang diminta. Jangan tampilkan markdown formatting, reasoning, atau teks selain JSON. Semua judul, hook, dan narasi HARUS dalam bahasa Indonesia yang alami.';

  const payload = {
    model,
    messages: [
      {
        role: 'system',
        content: systemContent,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.2,
    top_p: 0.9,
    max_completion_tokens: AI_ANALYSIS_MAX_COMPLETION_TOKENS,
    stream: false,
  };

  const baseUrl = (customBaseUrl || process.env.AI_BASE_URL || DEFAULT_AI_BASE_URL).replace(/\/+$/, '');
  const isOpenRouter = baseUrl.includes('openrouter.ai');

  if (useJsonMode) {
    payload.response_format = { type: 'json_object' };
    if (isOpenRouter) {
      payload.provider = {
        require_parameters: true,
        allow_fallbacks: true,
      };
    }
  }

  return axios.post(
    `${baseUrl}/chat/completions`,
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
    .replace(/```json\n?/gi, '')
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
    // continue to regex extraction
  }

  // Attempt to extract JSON object containing clips array
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsedObj = JSON.parse(objMatch[0]);
      if (Array.isArray(parsedObj?.clips)) {
        return parsedObj.clips;
      }
      if (Array.isArray(parsedObj)) {
        return parsedObj;
      }
    } catch (_) {
      // continue to array match
    }
  }

  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    return JSON.parse(match[0]);
  }

  throw new Error('AI tidak mengembalikan format JSON yang valid');
}

function validateClips(clips, videoDuration, clipCount, language = 'id') {
  if (!Array.isArray(clips)) {
    throw new Error('AI response bukan array');
  }

  const isEn = String(language).toLowerCase().startsWith('en');
  const defaultTitle = isEn ? 'Compelling Clip' : 'Clip Menarik';

  return clips
    .filter((c) => typeof c.start === 'number' && typeof c.end === 'number')
    .map((c) => ({
      start: Math.max(0, parseFloat(c.start.toFixed(2))),
      end: Math.min(videoDuration, parseFloat(c.end.toFixed(2))),
      title: c.title || defaultTitle,
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
