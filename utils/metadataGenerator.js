// utils/metadataGenerator.js
//
// Generates viral-ready publishing metadata for each clip: a scroll-stopping
// title, an SEO/social description, hashtags, a platform-tuned caption, and a
// pinned-comment CTA.
//
// Design constraints (deliberate):
//  * ONE extra LLM call per JOB (not per clip) — every clip's transcript slice is
//    labelled and batched into a single request, so the cost stays flat and the
//    model can see the whole set and keep the hooks differentiated.
//  * NULL means "use the in-prompt title" — the caller keeps the analyzer title.
//    We never let a metadata failure take down an otherwise good render.
//  * `metadataMode: 'off'` skips the call entirely for air-gapped / no-budget runs.

import axios from 'axios';
import {
  resolveModelConfiguration,
  buildGatewayCandidates,
} from './analyzer.js';

export const VALID_METADATA_MODES = ['off', 'simple', 'viral', 'seo'];
export const DEFAULT_METADATA_MODE = 'viral';

// Bounds from the platforms we target — exceeding them gets content truncated
// silently by the uploader, or rejected outright.
export const TITLE_MAX_CHARS = 100;   // YouTube Shorts hard limit
export const TIKTOK_CAPTION_MAX_CHARS = 2200;
export const REELS_CAPTION_MAX_CHARS = 2200;
export const HASHTAG_MAX_COUNT = 30;

const METADATA_MAX_COMPLETION_TOKENS = parseInt(
  process.env.AI_METADATA_MAX_COMPLETION_TOKENS || '2000',
  10
);
const METADATA_TIMEOUT_MS = parseInt(process.env.AI_METADATA_TIMEOUT_MS || '90000', 10);
const METADATA_MAX_RETRIES = parseInt(process.env.AI_METADATA_MAX_RETRIES || '2', 10);

/**
 * Normalise a requested metadata mode. Unknown/blank falls back to the default
 * so a stray form value can never disable metadata generation silently.
 * @param {string} [mode]
 * @returns {'off'|'simple'|'viral'|'seo'}
 */
export function normalizeMetadataMode(mode) {
  if (typeof mode !== 'string') return DEFAULT_METADATA_MODE;
  const clean = mode.trim().toLowerCase();
  return VALID_METADATA_MODES.includes(clean) ? clean : DEFAULT_METADATA_MODE;
}

/**
 * Build the publishing-metadata prompt for a batch of clips.
 *
 * @param {Array<{index:number, title?:string, hookText?:string, viralityRationale?:string, clipText?:string, duration?:number}>} clipInputs
 * @param {Object} [options]
 * @param {string} [options.language='id']
 * @param {string} [options.metadataMode='viral']
 * @param {string} [options.videoTitle]  Original source video title (trend context)
 * @param {string} [options.targetPlatform='all']
 * @returns {string}
 */
export function buildMetadataPrompt(clipInputs, options = {}) {
  if (!Array.isArray(clipInputs) || clipInputs.length === 0) {
    throw new Error('clipInputs must be a non-empty array');
  }

  const {
    language = 'id',
    metadataMode = DEFAULT_METADATA_MODE,
    videoTitle = '',
    targetPlatform = 'all',
  } = options;

  const isEn = String(language).toLowerCase().startsWith('en');
  const mode = normalizeMetadataMode(metadataMode);

  const clipBlocks = clipInputs.map((c) => {
    const lines = [
      `--- CLIP ${c.index} ---`,
      c.title ? `Working title: ${c.title}` : null,
      c.duration ? `Duration: ${Math.round(c.duration)} seconds` : null,
      c.hookText ? `Opening hook (first 0-3s): ${c.hookText}` : null,
      c.viralityRationale ? `Why it works: ${c.viralityRationale}` : null,
      c.clipText ? `Spoken content:\n${c.clipText}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  });

  const modeDirectives = {
    simple: isEn
      ? [
          `STYLE = SIMPLE: clear and informative. No clickbait, no exaggeration.`,
          `- title: descriptive and accurate, max 70 characters. State the concrete value plainly.`,
          `- description: 2-3 plain sentences summarising what is said.`,
          `- hashtags: 3-5 broad topical tags only.`,
          `- caption: one short neutral line.`,
        ]
      : [
          `GAYA = SEDERHANA: jelas dan informatif. Tanpa clickbait, tanpa berlebihan.`,
          `- title: deskriptif dan akurat, maks 70 karakter. Sebutkan nilai konkretnya secara lugas.`,
          `- description: 2-3 kalimat lugas yang merangkum isi.`,
          `- hashtags: 3-5 tag topik umum saja.`,
          `- caption: satu baris netral yang singkat.`,
        ],
    seo: isEn
      ? [
          `STYLE = SEO-FIRST: optimised for search discovery more than browse-feed impulse.`,
          `- title: lead with the primary search keyword/phrase people would actually type, max 70 characters. Keep it readable, not keyword-stuffed.`,
          `- description: keyword-aware, 3-5 sentences, front-load the main topic in the first sentence.`,
          `- hashtags: 10-15 tags mixing high-volume and niche terms.`,
          `- caption: search-friendly one-liner containing the primary phrase.`,
        ]
      : [
          `GAYA = SEO-FIRST: dioptimalkan untuk penemuan lewat pencarian, bukan sekadar impulse feed.`,
          `- title: awali dengan kata kunci/frasa utama yang benar-benar orang ketik di pencarian, maks 70 karakter. Tetap enak dibaca, jangan tumpuk kata kunci.`,
          `- description: sadar kata kunci, 3-5 kalimat, taruh topik utama di kalimat pertama.`,
          `- hashtags: 10-15 tag campuran volume tinggi dan niche.`,
          `- caption: satu baris ramah pencarian yang memuat frasa utama.`,
        ],
    viral: isEn
      ? [
          `STYLE = VIRAL: engineered for maximum scroll-stop and share impulse while staying fully honest about the content.`,
          `- title: max 60 characters, front-load the hook in the first 40 characters (that is the part viewers actually see before truncation). Use a curiosity gap, a stake, a number, or a bold claim that the clip genuinely delivers on.`,
          `- description: 3-5 sentences. Open with a curiosity-driven first line (this is what shows in-feed), then give real substance, then a soft CTA.`,
          `- hashtags: 12-20 tags mixing broad reach and specific niche.`,
          `- caption: a punchy 1-2 line version tuned per target platform.`,
        ]
      : [
          `GAYA = VIRAL: dirancang untuk menghentikan scroll dan memicu share, tapi tetap jujur dengan isi klipnya.`,
          `- title: maks 60 karakter, taruh hook-nya di 40 karakter pertama (itu bagian yang benar-benar terlihat sebelum terpotong). Pakai curiosity gap, taruhan/stakes, angka, atau klaim berani yang memang dipenuhi isi klip.`,
          `- description: 3-5 kalimat. Buka dengan kalimat pertama yang memicu rasa penasaran (ini yang tampil di feed), lalu beri substansi nyata, lalu CTA halus.`,
          `- hashtags: 12-20 tag campuran jangkauan luas dan niche spesifik.`,
          `- caption: versi 1-2 baris yang punchy, disesuaikan per platform target.`,
        ],
  };

  const languageBlock = isEn
    ? [
        `LANGUAGE REQUIREMENTS:`,
        `- The clip dialogue is in English.`,
        `- EVERYTHING you write (title, description, hashtags, caption, pinnedComment, trendKeywords) MUST be in natural, native English.`,
        `- Do NOT translate or transliterate; write like a native English short-form creator.`,
      ]
    : [
        `PETUNJUK BAHASA:`,
        `- Dialog klip dalam bahasa Indonesia.`,
        `- SEMUA yang kamu tulis (title, description, hashtags, caption, pinnedComment, trendKeywords) HARUS dalam bahasa Indonesia yang natural.`,
        `- JANGAN menerjemahkan ke bahasa lain; tulis seperti kreator short-form Indonesia asli.`,
        `- Boleh pakai istilah/Istilah gaul yang lazim dipakai kreator Indonesia, tapi jangan berlebihan sampai terkesan alay.`,
      ];

  const platformHint = targetPlatform && targetPlatform !== 'all'
    ? (isEn
        ? [`Optimise the "caption" field primarily for: ${targetPlatform}.`]
        : [`Optimalkan field "caption" terutama untuk platform: ${targetPlatform}.`])
    : (isEn
        ? [`Optimise "caption" for TikTok / YouTube Shorts / Instagram Reels alike (keep it platform-neutral enough to work on all three).`]
        : [`Optimalkan "caption" agar cocok untuk TikTok / YouTube Shorts / Instagram Reels sekaligus (cukup netral untuk ketiganya).`]);

  return [
    `You are an elite short-form publishing strategist who has grown multiple faceless channels past 1M followers. You write titles, descriptions and captions that get clicked, watched to the end, and shared.`,
    ``,
    videoTitle ? `Source video: "${videoTitle}"` : null,
    `You are given ${clipInputs.length} clip(s) that were cut from ONE longer video.`,
    `Generate publishing metadata for EACH clip.`,
    ``,
    ...modeDirectives[mode],
    ...languageBlock,
    `- trendKeywords: 3-6 topical keywords/topic-clusters this clip sits in (used for trend relevance), written in the same language as the rest.`,
    `- pinnedComment: a short engagement-bait comment the creator can pin to drive replies (ask a genuine question the clip makes people want to answer).`,
    ``,
    ...platformHint,
    ``,
    `HARD RULES:`,
    `- NEVER invent facts, numbers, names, or claims that are not present in the clip content. Honesty over hype.`,
    `- Make every clip's title DISTINCT — no two titles may share the same opening structure or phrasing.`,
    `- Do NOT use markdown, emoji-only titles, or ALL-CAPS shouting beyond one deliberate word.`,
    `- title MUST respect the character limit stated for the chosen style.`,
    `- If a clip has too little spoken content to judge, still produce honest metadata from what IS there.`,
    ``,
    `=== CLIPS ===`,
    ...clipBlocks,
    `=== END CLIPS ===`,
    ``,
    `Respond ONLY with a valid JSON object, no markdown, exactly this shape:`,
    `{`,
    `  "clips": [`,
    `    {`,
    `      "index": 1,`,
    `      "title": "the publishing title",`,
    `      "description": "the full description / caption body",`,
    `      "hashtags": ["#tag1", "#tag2"],`,
    `      "caption": "short platform caption",`,
    `      "pinnedComment": "engagement question to pin",`,
    `      "trendKeywords": ["keyword1", "keyword2"]`,
    `    }`,
    `  ]`,
    `}`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Sanitise + normalise one raw metadata object from the model.
 * Never throws; unknown shapes degrade to null fields.
 *
 * @param {Object} raw
 * @returns {Object|null}
 */
export function normalizeClipMetadata(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  const title = str(raw.title);
  const description = str(raw.description);
  const caption = str(raw.caption);
  const pinnedComment = str(raw.pinnedComment);

  let hashtags = [];
  if (Array.isArray(raw.hashtags)) {
    hashtags = raw.hashtags
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      // Keep the leading '#' plus letters/digits/underscore only. A tag that is
      // nothing but punctuation ("##", "#!!!") collapses to '#' and is dropped
      // by the length check below.
      .map((t) => '#' + t.slice(1).replace(/[^\p{L}\p{N}_]/gu, ''))
      .filter((t) => t.length > 2);
  }
  // De-dupe case-insensitively, then cap.
  const seen = new Set();
  hashtags = hashtags.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, HASHTAG_MAX_COUNT);

  let trendKeywords = [];
  if (Array.isArray(raw.trendKeywords)) {
    trendKeywords = raw.trendKeywords
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter(Boolean)
      .slice(0, 8);
  }

  // Title is the one field worth truncating rather than dropping: a 140-char
  // title still beats no title, but it must not break the platform limit.
  let safeTitle = title;
  if (safeTitle && safeTitle.length > TITLE_MAX_CHARS) {
    safeTitle = safeTitle.slice(0, TITLE_MAX_CHARS - 1).trimEnd() + '…';
  }

  if (!safeTitle && !description && !caption && hashtags.length === 0) return null;

  return {
    title: safeTitle,
    description,
    hashtags,
    caption,
    pinnedComment,
    trendKeywords,
  };
}

/**
 * Generate publishing metadata for the clips of one job.
 *
 * Returns a Map keyed by clip index. Returns an EMPTY Map — never throws — when
 * metadata is off, the gateway is unreachable, or the model returns junk: a
 * metadata failure must never fail the render.
 *
 * @param {Array<Object>} clipInputs
 * @param {Object} [options]
 * @param {string} [options.aiModel]
 * @param {string} [options.language='id']
 * @param {string} [options.metadataMode]
 * @param {string} [options.videoTitle]
 * @param {string} [options.targetPlatform='all']
 * @param {Function} [options.requestFn]  Injection seam for tests.
 * @returns {Promise<Map<number, Object>>}
 */
export async function generateClipMetadata(clipInputs, options = {}) {
  const {
    aiModel = null,
    language = 'id',
    metadataMode = DEFAULT_METADATA_MODE,
    videoTitle = '',
    targetPlatform = 'all',
    requestFn = null,
  } = options;

  const mode = normalizeMetadataMode(metadataMode);
  const result = new Map();

  if (mode === 'off') {
    console.log('🏷️ [metadata] Mode OFF — melewati generate judul & deskripsi.');
    return result;
  }
  if (!Array.isArray(clipInputs) || clipInputs.length === 0) return result;

  const config = resolveModelConfiguration(aiModel);
  const candidates = buildGatewayCandidates(config);
  if (candidates.length === 0) {
    console.warn('🏷️ [metadata] Tidak ada gateway AI yang terkonfigurasi — metadata dilewati.');
    return result;
  }

  const prompt = buildMetadataPrompt(clipInputs, {
    language,
    metadataMode: mode,
    videoTitle,
    targetPlatform,
  });

  console.log(
    `🏷️ [metadata] Generate ${clipInputs.length} set metadata (gaya: ${mode}) via ${config.model}...`
  );

  const send = requestFn || defaultRequest;

  let lastError = null;

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const candidate = candidates[cIdx];
    console.log(
      `🏷️ [metadata] Candidate ${cIdx + 1}/${candidates.length}: ${candidate.model} via ${candidate.baseUrl} (${candidate.label})...`
    );

    for (let attempt = 1; attempt <= METADATA_MAX_RETRIES; attempt++) {
      const useJsonMode = attempt === 1;
      try {
        const parsed = await send({
          apiKey: candidate.apiKey,
          model: candidate.model,
          baseUrl: candidate.baseUrl,
          prompt,
          useJsonMode,
          language,
        });

        const clips = Array.isArray(parsed) ? parsed : parsed?.clips;
        if (!Array.isArray(clips) || clips.length === 0) {
          console.warn(`🏷️ [metadata] Kandidat ${candidate.label} tidak mengembalikan clip metadata.`);
          continue;
        }

        for (const rawClip of clips) {
          const idx = Number(rawClip?.index);
          if (!Number.isFinite(idx)) continue;
          const clean = normalizeClipMetadata(rawClip);
          if (clean) result.set(idx, clean);
        }

        if (result.size > 0) {
          console.log(`✅ [metadata] Metadata siap untuk ${result.size} clip.`);
          return result;
        }
      } catch (err) {
        lastError = err;
        const msg = err?.response?.data?.error?.message || err?.message || String(err);
        console.warn(`🏷️ [metadata] Kandidat ${candidate.label} attempt ${attempt} gagal: ${msg}`);
      }
    }
  }

  console.warn(
    `⚠️ [metadata] Gagal generate metadata (${lastError?.message || 'model tidak mengembalikan data valid'}). ` +
      `Render tetap dilanjutkan tanpa metadata tambahan.`
  );
  return result;
}

async function defaultRequest({ apiKey, model, baseUrl, prompt, useJsonMode, language = 'id' }) {
  const isEn = String(language).toLowerCase().startsWith('en');
  const systemContent = isEn
    ? 'You are an elite short-form publishing strategist. Respond ONLY with the valid JSON object matching the requested schema. No markdown, no commentary, no text outside the JSON. Everything you write MUST be in natural English.'
    : 'Kamu adalah ahli strategi publikasi konten short-form. Jawab HANYA dengan objek JSON valid sesuai skema yang diminta. Tanpa markdown, tanpa komentar, tanpa teks selain JSON. Semua tulisan HARUS dalam bahasa Indonesia yang natural.';

  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');

  const payload = {
    model,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    top_p: 0.9,
    max_completion_tokens: METADATA_MAX_COMPLETION_TOKENS,
    stream: false,
  };

  if (useJsonMode) {
    payload.response_format = { type: 'json_object' };
    if (cleanBase.includes('openrouter.ai')) {
      payload.provider = { require_parameters: true, allow_fallbacks: true };
    }
  }

  const response = await axios.post(`${cleanBase}/chat/completions`, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://video-clipper.local',
      'X-Title': 'Video Clipper AI',
    },
    timeout: METADATA_TIMEOUT_MS,
  });

  const content = extractContent(response.data);
  if (!content) throw new Error('respons metadata kosong');
  return parseMetadataPayload(content);
}

/** Pull assistant text out of the various shapes gateways return. */
export function extractContent(data) {
  const message = data?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string') return content;
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

/** Tolerant JSON extraction: fenced blocks, prose wrappers, bare objects. */
export function parseMetadataPayload(rawContent) {
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('payload metadata kosong');
  }

  const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : rawContent.trim();

  const tryParse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const sliced = tryParse(candidate.slice(firstBrace, lastBrace + 1));
    if (sliced) return sliced;
  }

  throw new Error('gagal mem-parsing JSON metadata dari respons AI');
}

/**
 * Merge generated metadata into the clip list, preserving existing titles when
 * the generator returned nothing for that clip.
 *
 * @param {Array<Object>} clips
 * @param {Map<number, Object>} metadataByIndex
 * @returns {Array<Object>}
 */
export function applyMetadataToClips(clips, metadataByIndex) {
  if (!Array.isArray(clips)) return clips;
  if (!metadataByIndex || metadataByIndex.size === 0) {
    return clips.map((c) => ({ ...c, metadata: null }));
  }

  return clips.map((clip) => {
    const idx = clip.clipIndex ?? clip.index;
    const meta = metadataByIndex.get(Number(idx)) || null;
    if (!meta) return { ...clip, metadata: null };

    // Prefer the generated title, but never end up with NO title: fall back to
    // the analyzer's title, then to whatever was already there.
    const title = meta.title || clip.title;

    return { ...clip, title, metadata: meta };
  });
}
