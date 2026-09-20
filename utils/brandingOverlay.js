// utils/brandingOverlay.js
//
// Builds the FFmpeg filter chain that brands a finished vertical clip:
//   * a source-attribution card ("Sumber: <channel>") so a re-uploaded clip
//     credits where the footage came from
//   * a channel watermark that stays on screen for the whole clip
//
// Design notes:
//  * Text is DRAWN by FFmpeg (`drawtext`), not composited from an image, so
//    there is no extra asset to ship and the look is identical on every machine.
//  * Every value that reaches the filter string is escaped for drawtext's own
//    parser (colons, commas, quotes, percent signs, backslashes) — an unescaped
//    colon in a channel name would otherwise corrupt the whole filter chain.
//  * The filters are inserted AFTER the layout/subtitle stage, so branding sits
//    on top of the finished frame instead of being cropped or covered by subs.

import fs from 'node:fs';

export const VALID_WATERMARK_POSITIONS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/**
 * Anchor values for the watermark/attribution text.
 *
 * The four corners are absolute. `above-subtitles` is relative: it is placed
 * just above the burned-in subtitle band (which sits ~160px above the bottom
 * edge for the default preset) so a channel handle reads as part of the
 * caption block instead of fighting it for space.
 */
export const VALID_ANCHORS = [
  ...VALID_WATERMARK_POSITIONS,
  'above-subtitles',
];

// Subtitle band height below which the 'above-subtitles' anchor sits. Mirrors
// the default subtitle marginV so the two elements do not collide.
const SUBTITLE_BAND_PX = 160;
// Gap between the subtitle band and the anchored text.
//
// The burned-in captions render at font size ~72-90px, so the band is tall and
// extends UPWARD from marginV. A small gap leaves the watermark sitting on the
// last caption line; 150px clears the tallest preset line without floating off
// into the middle of the picture.
const ABOVE_SUBTITLE_GAP_PX = 150;

// Fonts are probed once and cached — fs.existsSync on every clip adds up.
let cachedFont = undefined;

/**
 * Pick a font file that is actually present. drawtext fails the whole render if
 * the font path does not exist, so never hardcode a path we have not checked.
 *
 * @returns {string|null}
 */
export function resolveFontFile() {
  if (cachedFont !== undefined) return cachedFont;

  const candidates = [
    process.env.BRANDING_FONT_FILE,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedFont = candidate;
        return cachedFont;
      }
    } catch {
      // Unreadable path — keep looking.
    }
  }

  cachedFont = null;
  return cachedFont;
}

/** Test seam: forget the probed font so a test can change the environment. */
export function resetFontCache() {
  cachedFont = undefined;
}

/**
 * Escape a value for FFmpeg's drawtext filter.
 *
 * drawtext parses the filter-graph string, so these characters are special:
 *   \  :  '  ,  ;  [  ]  %  and a leading space
 * `%` is safest neutralised as a literal expansion of itself, since drawtext
 * treats `%{...}` as an expansion directive.
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeDrawtext(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/%/g, '\\%')
    // A newline would terminate the filter option list.
    .replace(/[\r\n]+/g, ' ');
}

/**
 * Normalise the branding request from the API into a shape the renderer trusts.
 *
 * @param {Object|null|undefined} input
 * @returns {Object} normalised branding config (may be disabled)
 */
export function normalizeBrandingConfig(input) {
  const cfg = (input && typeof input === 'object') ? input : {};

  const str = (v, max = 120) => {
    if (typeof v !== 'string') return null;
    const clean = v.trim();
    if (!clean) return null;
    return clean.slice(0, max);
  };

  const hexColor = (v, fallback) => {
    if (typeof v !== 'string') return fallback;
    const clean = v.trim();
    return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
  };

  const position = VALID_ANCHORS.includes(cfg.watermarkPosition)
    ? cfg.watermarkPosition
    : 'above-subtitles';

  const rawOpacity = Number(cfg.watermarkOpacity);
  const opacity = Number.isFinite(rawOpacity)
    ? Math.min(1, Math.max(0.05, rawOpacity))
    : 0.45;

  const rawFontSize = Number(cfg.watermarkFontSize);
  const fontSize = Number.isFinite(rawFontSize)
    ? Math.min(96, Math.max(14, Math.round(rawFontSize)))
    : 30;

  // Subtitle band is transparent by default: the watermark is meant to sit
  // quietly beside the captions, not to draw a second black box over the video.
  const showWatermarkBg = cfg.watermarkBackground === true;

  return {
    showSource: cfg.showSource !== false,
    showWatermark: cfg.showWatermark !== false,
    sourceLabel: str(cfg.sourceLabel, 80),
    sourceChannel: str(cfg.sourceChannel, 80),
    sourceColor: hexColor(cfg.sourceColor, '#FFFFFF'),
    sourceBgColor: hexColor(cfg.sourceBgColor, '#000000'),
    sourceDuration: Math.min(20, Math.max(1, Number(cfg.sourceDuration) || 4)),
    sourcePosition: VALID_ANCHORS.includes(cfg.sourcePosition)
      ? cfg.sourcePosition
      : 'top-left',
    watermarkText: str(cfg.watermarkText, 60),
    watermarkPosition: position,
    watermarkOpacity: opacity,
    watermarkFontSize: fontSize,
    watermarkColor: hexColor(cfg.watermarkColor, '#FFFFFF'),
    watermarkBgColor: hexColor(cfg.watermarkBgColor, '#000000'),
    watermarkBackground: showWatermarkBg,
  };
}

/**
 * True when the config would actually draw anything.
 * @param {Object} cfg normalised branding config
 * @returns {boolean}
 */
export function brandingIsActive(cfg) {
  if (!cfg) return false;
  const sourceText = cfg.sourceChannel || cfg.sourceLabel;
  return Boolean((cfg.showSource && sourceText) || (cfg.showWatermark && cfg.watermarkText));
}

/**
 * Centre-align anchor (x) for a drawtext label.
 *
 * `above-subtitles` is horizontally centred — it reads as part of the caption
 * block rather than as a corner badge.
 *
 * @param {string} pos
 * @param {number} [margin=40]
 * @param {boolean} [centered=false]
 * @returns {string} ffmpeg x expression
 */
function xExprFor(pos, margin = 40, centered = false) {
  if (centered || pos === 'above-subtitles') {
    // Optional `ws` scaling keeps the label centred after the text value is
    // substituted, so a wide channel name still lines up.
    return margin === 30 ? '(w-tw)/2' : `(w-tw)/2`;
  }
  return (pos === 'top-right' || pos === 'bottom-right')
    ? `w-tw-${margin}`
    : `${margin}`;
}

/**
 * Vertical anchor (y) for a drawtext label.
 *
 * @param {string} pos
 * @param {number} [margin=40]
 * @returns {string} ffmpeg y expression
 */
function yExprFor(pos, margin = 40) {
  if (pos === 'above-subtitles') {
    // Sit clear ABOVE the caption band. The captions are centred on the frame
    // (Alignment 2 only anchors them to the bottom margin), so the watermark is
    // also centred and pushed high enough that a tall caption line cannot reach
    // it. Offsetting only by the band edge leaves the two on the same line.
    return `h-th-${SUBTITLE_BAND_PX + ABOVE_SUBTITLE_GAP_PX}`;
  }
  return (pos === 'bottom-left' || pos === 'bottom-right')
    ? `h-th-${margin}`
    : `${margin}`;
}

/**
 * Convert a 0..1 opacity into drawtext's `@alpha` suffix.
 *
 * @param {number} opacity
 * @returns {string} e.g. "0.45"
 */
function alphaOf(opacity) {
  const n = Number(opacity);
  if (!Number.isFinite(n)) return '0.45';
  return String(Math.min(1, Math.max(0, n)));
}

/**
 * Build the drawtext filter statements for a clip.
 *
 * @param {Object} cfg normalised branding config (see normalizeBrandingConfig)
 * @param {Object} [options]
 * @param {string} [options.fontFile] override; auto-probed when omitted
 * @returns {string[]} one or more drawtext filter strings (without the leading label)
 */
export function buildBrandingFilters(cfg, options = {}) {
  if (!brandingIsActive(cfg)) return [];

  const fontFile = options.fontFile !== undefined ? options.fontFile : resolveFontFile();
  if (!fontFile) {
    // Without a font drawtext aborts the render; better to skip branding than
    // to fail a clip the user already waited for.
    console.warn(
      '⚠️ [branding] Tidak ada font TTF yang bisa dipakai — sumber & watermark dilewati. ' +
      'Set BRANDING_FONT_FILE untuk menunjuk file font.'
    );
    return [];
  }

  const filters = [];
  const fontPart = `fontfile='${escapeDrawtext(fontFile)}'`;

  const sourceText = cfg.sourceChannel
    ? `${cfg.sourceLabel || 'Sumber'}: ${cfg.sourceChannel}`
    : (cfg.sourceLabel || '');

  if (cfg.showSource && sourceText) {
    // The attribution is the FIRST thing to go if the font cannot be read, and
    // it is drawn with a translucent box so it stays legible over any footage.
    filters.push(
      `drawtext=${fontPart}` +
      `:text='${escapeDrawtext(sourceText)}'` +
      `:fontcolor=${cfg.sourceColor}@1.0` +
      `:fontsize=${Math.round(cfg.watermarkFontSize * 0.85)}` +
      `:box=1:boxcolor=${cfg.sourceBgColor}@0.72:boxborderw=16` +
      `:x=${xExprFor(cfg.sourcePosition)}` +
      `:y=${yExprFor(cfg.sourcePosition)}` +
      `:enable='lte(t,${cfg.sourceDuration})'`
    );
  }

  if (cfg.showWatermark && cfg.watermarkText) {
    const alpha = alphaOf(cfg.watermarkOpacity);
    const parts = [
      `drawtext=${fontPart}`,
      `text='${escapeDrawtext(cfg.watermarkText)}'`,
      `fontcolor=${cfg.watermarkColor}@${alpha}`,
      `fontsize=${cfg.watermarkFontSize}`,
      // A drop shadow is what keeps thin, semi-transparent text legible over
      // busy footage without adding a solid box.
      `shadowcolor=#000000@${alphaOf(Math.min(1, cfg.watermarkOpacity + 0.25))}`,
      `shadowx=2`,
      `shadowy=2`,
      `x=${xExprFor(cfg.watermarkPosition, 30)}`,
      `y=${yExprFor(cfg.watermarkPosition, 30)}`,
    ];

    // A background box is OPT-IN: by default the watermark floats over the
    // video so it does not obscure the picture.
    if (cfg.watermarkBackground) {
      parts.push(`box=1`);
      parts.push(`boxcolor=${cfg.watermarkBgColor}@${alphaOf(cfg.watermarkOpacity * 0.5)}`);
      parts.push(`boxborderw=10`);
    }

    filters.push(parts.join(':'));
  }

  return filters;
}

/**
 * Append branding onto an existing output label inside a filter_complex graph.
 *
 * @param {string} filterComplex   the graph built so far
 * @param {string} inputLabel      label to consume, e.g. '[vout]'
 * @param {Object} cfg             normalised branding config
 * @param {Object} [options]
 * @returns {{ filterComplex: string, outputLabel: string }}
 */
export function appendBrandingToGraph(filterComplex, inputLabel, cfg, options = {}) {
  const filters = buildBrandingFilters(cfg, options);
  if (filters.length === 0) {
    return { filterComplex, outputLabel: inputLabel };
  }

  const label = inputLabel.replace(/^\[|\]$/g, '');
  const chain = `${label}${filters.map((f) => `,${f}`).join('')}[branded]`;
  return {
    filterComplex: `${filterComplex};${chain}`,
    outputLabel: '[branded]',
  };
}

/**
 * Append branding onto a simple -vf filter string (the non-graph path).
 *
 * @param {string} vfFilter  existing filter chain (may be empty)
 * @param {Object} cfg       normalised branding config
 * @param {Object} [options]
 * @returns {string} new filter chain
 */
export function appendBrandingToVideoFilters(vfFilter, cfg, options = {}) {
  const filters = buildBrandingFilters(cfg, options);
  if (filters.length === 0) return vfFilter;
  return [vfFilter, ...filters].filter(Boolean).join(',');
}

/**
 * Build a complete branding config straight from a job's metadata, so callers
 * do not have to remember every field name.
 *
 * @param {Object} source  { channelName, sourceUrl, ... }
 * @returns {Object} normalised config
 */
export function brandingFromSource(source = {}) {
  return normalizeBrandingConfig({
    ...source,
    sourceChannel: source.sourceChannel || source.channelName || null,
  });
}
