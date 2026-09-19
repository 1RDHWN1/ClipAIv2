// utils/subtitleGenerator.js
import path from 'path';

/**
 * Pre-configured viral subtitle presets inspired by top short-form creators
 */
export const VIRAL_PRESETS = {
  hormozi: {
    id: 'hormozi',
    name: 'Hormozi Yellow',
    fontFamily: 'Impact',
    fontSize: 80,
    primaryColor: '#FFFFFF',
    highlightColor: '#FFE600',
    outlineColor: '#000000',
    outlineWidth: 5,
    shadow: 0,
    alignment: 2, // Bottom-center
    marginV: 300,
    uppercase: true,
  },
  mrbeast: {
    id: 'mrbeast',
    name: 'MrBeast Green',
    fontFamily: 'Impact',
    fontSize: 84,
    primaryColor: '#FFFFFF',
    highlightColor: '#00FF66',
    outlineColor: '#000000',
    outlineWidth: 6,
    shadow: 2,
    alignment: 2, // Bottom-center
    marginV: 300,
    uppercase: true,
  },
  cyber: {
    id: 'cyber',
    name: 'Cyber Cyan',
    // NOTE: ASS format separates style fields with commas, so a font name must
    // NEVER contain a comma. A CSS-style stack like 'Montserrat, Arial' corrupts
    // the whole style line and libass silently renders NO subtitles at all.
    // Always specify a single font family here (see sanitizeAssFontName).
    fontFamily: 'Montserrat',
    fontSize: 76,
    primaryColor: '#FFFFFF',
    highlightColor: '#00E5FF',
    outlineColor: '#000000',
    outlineWidth: 4,
    shadow: 1,
    alignment: 2, // Bottom-center
    marginV: 300,
    uppercase: true,
  },
  minimal: {
    id: 'minimal',
    name: 'Clean Minimal',
    fontFamily: 'Arial',
    fontSize: 68,
    primaryColor: '#FFFFFF',
    highlightColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    shadow: 2,
    alignment: 2, // Bottom-center
    marginV: 240,
    uppercase: false,
  },
};

export const SUBTITLE_PRESETS = VIRAL_PRESETS;

/**
 * Sanitize a font family name for safe use inside an ASS style line.
 *
 * ASS styles are comma-delimited, so a font name containing a comma (e.g. a
 * CSS-style stack like "Montserrat, Arial") shifts every following field and
 * silently breaks rendering — libass then draws NO subtitles at all.
 *
 * Rules:
 *  - keep only the FIRST family from a CSS-style comma/`;` separated stack
 *  - strip characters that are illegal or dangerous inside an ASS style line
 *  - collapse whitespace, cap length, and fall back to a safe default
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitizeAssFontName(name) {
  const DEFAULT_FONT = 'Arial';
  if (typeof name !== 'string' || name.trim() === '') return DEFAULT_FONT;

  // Take the first family from a CSS-style stack: "Montserrat, Arial" -> "Montserrat"
  let font = name.split(/[,;]/)[0];

  // Remove characters that break ASS parsing or allow tag injection.
  // ASS style fields must not contain commas; braces/newlines/slashes are unsafe.
  font = font.replace(/[{}()\[\]\\/<>:"'\r\n\t]/g, '');

  // Collapse repeated whitespace.
  font = font.replace(/\s+/g, ' ').trim();

  // Reject anything that is now empty or absurdly long.
  if (font.length === 0) return DEFAULT_FONT;
  if (font.length > 64) font = font.slice(0, 64).trim();

  return font || DEFAULT_FONT;
}

/**
 * Resolves a preset by name or key with fallback to Hormozi Yellow
 * @param {string} presetKey
 * @returns {object}
 */
export function getPreset(presetKey) {
  if (!presetKey || typeof presetKey !== 'string') {
    return VIRAL_PRESETS.hormozi;
  }
  const normalized = presetKey.toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized.includes('hormozi')) return VIRAL_PRESETS.hormozi;
  if (normalized.includes('mrbeast') || normalized.includes('beast')) return VIRAL_PRESETS.mrbeast;
  if (normalized.includes('cyber') || normalized.includes('cyan')) return VIRAL_PRESETS.cyber;
  if (normalized.includes('minimal') || normalized.includes('clean')) return VIRAL_PRESETS.minimal;
  return VIRAL_PRESETS[presetKey] || VIRAL_PRESETS.hormozi;
}

/**
 * Converts standard CSS/HTML hex (#RRGGBB or #RGB) to ASS color format (&H<alpha><BB><GG><RR>&)
 * @param {string} hex - Standard hex color
 * @param {string} alpha - Alpha channel hex (00 = opaque, FF = fully transparent)
 * @returns {string} - ASS color formatted as &HAABBGGRR&
 */
export function hexToAssColor(hex, alpha = '00') {
  const safeAlpha = String(alpha || '00').padStart(2, '0').toUpperCase();
  if (!hex || typeof hex !== 'string') return `&H${safeAlpha}FFFFFF&`;
  let clean = hex.trim();

  // If already in ASS color format
  if (clean.startsWith('&H') || clean.startsWith('&h')) {
    let raw = clean.replace(/^&[hH]/i, '').replace(/&$/, '').trim().toUpperCase();
    if (raw.length === 6) raw = safeAlpha + raw;
    return `&H${raw}&`;
  }

  clean = clean.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length !== 6) return `&H${safeAlpha}FFFFFF&`;

  const r = clean.substring(0, 2).toUpperCase();
  const g = clean.substring(2, 4).toUpperCase();
  const b = clean.substring(4, 6).toUpperCase();

  return `&H${safeAlpha}${b}${g}${r}&`;
}

/**
 * Formats a duration in seconds into ASS timestamp format: H:MM:SS.cc
 * @param {number} seconds
 * @returns {string}
 */
export function formatAssTime(seconds) {
  const safeSec = Math.max(0, Number(seconds) || 0);
  const totalCentiseconds = Math.round(safeSec * 100);
  const cs = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const cc = String(cs).padStart(2, '0');

  return `${h}:${mm}:${ss}.${cc}`;
}

/**
 * Groups word tokens into punchy short-form subtitle chunks (2-4 words per frame)
 * based on pause boundaries (>300ms pause) and natural timing.
 *
 * @param {Array} words - Array of word tokens [{word, start, end, ...}]
 * @param {number|object} clipStart - Clip start time in seconds, or clip object {start, end}
 * @param {number|object} clipEnd - Clip end time in seconds, or options object
 * @param {object} options - Chunking options {maxWordsPerChunk, pauseThreshold, maxCharsPerChunk}
 * @returns {Array<Array<{word, start, end}>>} - Array of word chunks with relative timestamps
 */
export function chunkWords(words, clipStart = 0, clipEnd = Infinity, options = {}) {
  let start = Number(clipStart) || 0;
  let end = Number.isFinite(Number(clipEnd)) ? Number(clipEnd) : Infinity;
  let opts = options;

  if (typeof clipStart === 'object' && clipStart !== null) {
    start = Number(clipStart.start) || 0;
    end = Number.isFinite(Number(clipStart.end)) ? Number(clipStart.end) : Infinity;
    opts = (typeof clipEnd === 'object' && clipEnd !== null) ? clipEnd : {};
  }

  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }

  const maxWords = Math.min(4, Math.max(2, Number(opts.maxWordsPerChunk || opts.wordsPerChunk) || 3));
  const maxChars = Number(opts.maxCharsPerChunk) || 26;
  const pauseThreshold = Number(opts.pauseThreshold) || 0.30; // >300ms pause starts a new chunk

  const clipDuration = (Number.isFinite(end) && Number.isFinite(start))
    ? Math.max(0.1, end - start)
    : Infinity;

  // Detect if words are already relative (0..clipDuration) or absolute (0..videoDuration)
  // Heuristic: if first word's start < clipStart, assume relative; otherwise assume absolute
  const isAlreadyRelative = start > 0 &&
    words.length > 0 &&
    words.every((w) => (w.start || 0) < start && (w.end || 0) <= clipDuration + 1.0);
  const startOffset = isAlreadyRelative ? 0 : start;

  // Filter words strictly within clip boundary and normalize relative timestamps
  const clipWords = words
    .filter((w) => {
      if (!w || typeof w.word !== 'string') return false;
      const text = w.word.trim();
      if (!text) return false;
      if (isAlreadyRelative) {
        return (w.end || 0) > 0 && (w.start || 0) < clipDuration;
      }
      return (w.end || 0) > start && (w.start || 0) < end;
    })
    .map((w) => ({
      word: w.word.trim(),
      start: Math.max(0, (Number(w.start) || 0) - startOffset),
      end: Math.min(clipDuration, (Number(w.end) || 0) - startOffset),
    }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);

  if (clipWords.length === 0) return [];

  const chunks = [];
  let current = [];

  for (let i = 0; i < clipWords.length; i++) {
    const w = clipWords[i];
    current.push(w);

    const isLast = i === clipWords.length - 1;
    let shouldSplit = isLast;

    if (!shouldSplit) {
      const nextW = clipWords[i + 1];
      const gap = nextW.start - w.end;
      const currentChars = current.reduce((acc, item) => acc + item.word.length + 1, 0);

      const hasPunctuation = /[.?!…]+["')\]}]*$/.test(w.word);
      const isLongGap = gap >= pauseThreshold;
      const isMaxWords = current.length >= maxWords;
      const isMaxChars = (currentChars + nextW.word.length + 1) > maxChars && current.length >= 2;

      if (hasPunctuation || isLongGap || isMaxWords || isMaxChars) {
        shouldSplit = true;
      }
    }

    if (shouldSplit && current.length > 0) {
      chunks.push([...current]);
      current = [];
    }
  }

  return chunks;
}

/**
 * Generates an Advanced SubStation Alpha (.ass) subtitle script from word tokens
 * with word-by-word active highlighting (karaoke/pop animation) scaled for 9:16 vertical video.
 *
 * @param {Array} clipWords - Word tokens from transcript or clip slice
 * @param {number|object} clipStart - Clip start time in seconds, or clip object
 * @param {number|object} clipEnd - Clip end time in seconds, or options object
 * @param {object} options - Subtitle styling options (subtitleConfig)
 * @returns {string} - Full .ass subtitle file content
 */
export function generateAssSubtitles(clipWords, clipStart = 0, clipEnd = Infinity, options = {}) {
  let start = Number(clipStart) || 0;
  let end = Number.isFinite(Number(clipEnd)) ? Number(clipEnd) : Infinity;
  let config = options;

  if (typeof clipStart === 'object' && clipStart !== null) {
    start = Number(clipStart.start) || 0;
    end = Number.isFinite(Number(clipStart.end)) ? Number(clipStart.end) : Infinity;
    config = (typeof clipEnd === 'object' && clipEnd !== null) ? clipEnd : {};
  }

  const presetKey = config.preset || 'hormozi';
  const base = getPreset(presetKey);

  const fontFamily = sanitizeAssFontName(config.fontFamily || base.fontFamily);
  const fontSize = Number(config.fontSize) || base.fontSize;
  const primaryColor = config.primaryColor || base.primaryColor;
  const highlightColor = config.highlightColor || base.highlightColor;
  const outlineColor = config.outlineColor || base.outlineColor;
  const outlineWidth = (config.outlineWidth !== undefined && !isNaN(Number(config.outlineWidth)))
    ? Number(config.outlineWidth)
    : base.outlineWidth;
  const shadow = (config.shadow !== undefined && !isNaN(Number(config.shadow)))
    ? Number(config.shadow)
    : base.shadow;

  let alignment = base.alignment || 2;
  let marginV = (config.marginV !== undefined && !isNaN(Number(config.marginV)))
    ? Number(config.marginV)
    : base.marginV || 300;

  const verticalPos = (config.verticalAlignment || config.position || '').toLowerCase();
  if (verticalPos === 'center' || verticalPos === 'middle') {
    alignment = 5;
    marginV = config.marginV !== undefined ? Number(config.marginV) : 0;
  } else if (verticalPos === 'top') {
    alignment = 8;
    marginV = config.marginV !== undefined ? Number(config.marginV) : 220;
  } else if (verticalPos === 'bottom') {
    alignment = 2;
    marginV = config.marginV !== undefined ? Number(config.marginV) : (base.marginV || 300);
  } else if (config.alignment !== undefined && !isNaN(Number(config.alignment))) {
    alignment = Number(config.alignment);
  }

  const uppercase = config.uppercase !== undefined
    ? Boolean(config.uppercase)
    : (base.uppercase !== undefined ? Boolean(base.uppercase) : true);

  const assPrimary = hexToAssColor(primaryColor, '00');
  const assHighlight = hexToAssColor(highlightColor, '00');
  const assOutline = hexToAssColor(outlineColor, '00');
  const assBack = hexToAssColor(config.shadowColor || '#000000', '80');

  const header = `[Script Info]
Title: ClipAI Animated Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${fontSize},${assPrimary},&H0000FFFF&,${assOutline},${assBack},-1,0,0,0,100,100,0,0,1,${outlineWidth},${shadow},${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const chunks = chunkWords(clipWords, start, end, config);
  const events = [];

  // How long a caption may "hold" after its last word before going blank.
  //
  // Rationale: auto-generated transcripts (YouTube subs) have short 1-2s gaps
  // between sentences. Blanking the caption during those makes subtitles look
  // "missing" and choppy. But genuinely long silences (>3s) SHOULD be blank —
  // there is no speech to caption. So we hold across SHORT gaps only.
  const HOLD_AFTER_LAST_WORD = Number(config.holdAfterWordSeconds) > 0
    ? Number(config.holdAfterWordSeconds)
    : 2.0;

  // Gaps larger than this are treated as real silence: the caption is allowed
  // to disappear (existing behaviour, preserves "clean gap" semantics).
  const MAX_HOLD_GAP = Number(config.maxHoldGapSeconds) > 0
    ? Number(config.maxHoldGapSeconds)
    : 3.0;

  // Absolute end of the clip (relative seconds).
  const clipEndRelative = Number.isFinite(end) && Number.isFinite(start)
    ? Math.max(0, end - start)
    : Infinity;

  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    const chunk = chunks[cIdx];
    if (!chunk || chunk.length === 0) continue;

    const isLastChunk = cIdx === chunks.length - 1;

    // Find the start time of the next valid chunk to strictly prevent overlapping dialogue events
    let nextChunkStartSec = Infinity;
    for (let k = cIdx + 1; k < chunks.length; k++) {
      if (chunks[k] && chunks[k].length > 0 && Number.isFinite(chunks[k][0].start)) {
        nextChunkStartSec = chunks[k][0].start;
        break;
      }
    }

    for (let j = 0; j < chunk.length; j++) {
      const activeWord = chunk[j];
      const startSec = activeWord.start;

      const isLastWordInChunk = j === chunk.length - 1;

      const nextWordStartSec = isLastWordInChunk
        ? nextChunkStartSec
        : chunk[j + 1].start;

      // Compute event end.
      //  - Mid-chunk word: stay lit until the next word starts.
      //  - Last word of chunk: stay lit until the next chunk starts, but only
      //    across SHORT gaps. If the next chunk is far away (real silence),
      //    end at the spoken word's end (clean gap preserved).
      let endSec;
      if (!isLastWordInChunk) {
        endSec = Math.max(startSec + 0.08, chunk[j + 1].start);
      } else {
        const spokenEnd = Math.max(startSec + 0.08, activeWord.end);

        if (Number.isFinite(nextChunkStartSec) && nextChunkStartSec > startSec) {
          const gap = nextChunkStartSec - spokenEnd;
          if (gap <= MAX_HOLD_GAP) {
            // Short gap -> hold the caption right up to the next chunk.
            endSec = nextChunkStartSec;
          } else {
            // Long silence -> let the caption end with the word (clean gap).
            endSec = spokenEnd;
          }
        } else {
          // No following chunk (or it is the last one): never jump to the clip
          // end. Just respect the natural spoken end; the cap below bounds it.
          endSec = spokenEnd;
        }

        // Never hold longer than the configured cap.
        endSec = Math.min(endSec, spokenEnd + HOLD_AFTER_LAST_WORD);
      }

      // HARD INVARIANT: endSec cannot exceed nextWordStartSec!
      // This strictly prevents multiple subtitle events from colliding and stacking upwards in ASS!
      if (Number.isFinite(nextWordStartSec) && nextWordStartSec > startSec) {
        endSec = Math.min(endSec, nextWordStartSec);
      }

      // Guard: never emit a zero/negative-length event.
      if (!(endSec > startSec)) {
        endSec = startSec + 0.08;
      }

      const startStr = formatAssTime(startSec);
      const endStr = formatAssTime(endSec);

      // Build text with active spoken word wrapped with inline color override
      const lineParts = chunk.map((item, idx) => {
        const rawText = item.word.replace(/[{}]/g, '').trim();
        const text = uppercase ? rawText.toUpperCase() : rawText;
        if (idx === j) {
          return `{\\c${assHighlight}}${text}{\\c${assPrimary}}`;
        }
        return text;
      });

      const textLine = lineParts.join(' ');
      events.push(`Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${textLine}`);
    }
  }

  return header + events.join('\n') + (events.length > 0 ? '\n' : '');
}

/**
 * Formats a Windows and cross-platform safe FFmpeg ASS subtitle filter argument
 * @param {string} assFilePath
 * @returns {string} e.g. ass='C\:/path/to/subs.ass'
 */
export function formatFfmpegSubFilter(assFilePath) {
  if (!assFilePath) return '';
  let cleanPath = String(assFilePath).trim();
  if (!/^[a-zA-Z]:[\\/]/.test(cleanPath)) {
    cleanPath = path.resolve(cleanPath);
  }
  const normalized = cleanPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  return `ass='${normalized}'`;
}
