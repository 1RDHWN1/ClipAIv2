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

  const position = VALID_WATERMARK_POSITIONS.includes(cfg.watermarkPosition)
    ? cfg.watermarkPosition
    : 'bottom-right';

  const rawOpacity = Number(cfg.watermarkOpacity);
  const opacity = Number.isFinite(rawOpacity)
    ? Math.min(1, Math.max(0.1, rawOpacity))
    : 0.65;

  const rawFontSize = Number(cfg.watermarkFontSize);
  const fontSize = Number.isFinite(rawFontSize)
    ? Math.min(96, Math.max(14, Math.round(rawFontSize)))
    : 30;

  return {
    showSource: cfg.showSource !== false,
    showWatermark: cfg.showWatermark !== false,
    sourceLabel: str(cfg.sourceLabel, 80),
    sourceChannel: str(cfg.sourceChannel, 80),
    sourceColor: hexColor(cfg.sourceColor, '#FFFFFF'),
    sourceBgColor: hexColor(cfg.sourceBgColor, '#000000'),
    sourceDuration: Math.min(20, Math.max(1, Number(cfg.sourceDuration) || 4)),
    sourcePosition: VALID_WATERMARK_POSITIONS.includes(cfg.sourcePosition)
      ? cfg.sourcePosition
      : 'top-left',
    watermarkText: str(cfg.watermarkText, 60),
    watermarkPosition: position,
    watermarkOpacity: opacity,
    watermarkFontSize: fontSize,
    watermarkColor: hexColor(cfg.watermarkColor, '#FFFFFF'),
    watermarkBgColor: hexColor(cfg.watermarkBgColor, '#000000'),
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
 * Centre-align anchor (x) for a drawtext label in the given corner.
 * Padding is applied by the caller via the boxborderw option.
 *
 * @param {'top-left'|'top-right'|'bottom-left'|'bottom-right'} pos
 * @returns {string} ffmpeg x expression
 */
function xExprFor(pos, margin = 40) {
  return (pos === 'top-right' || pos === 'bottom-right')
    ? `w-tw-${margin}`
    : `${margin}`;
}

/**
 * Vertical anchor (y) for a drawtext label in the given corner.
 * @param {'top-left'|'top-right'|'bottom-left'|'bottom-right'} pos
 * @returns {string} ffmpeg y expression
 */
function yExprFor(pos, margin = 40) {
  return (pos === 'bottom-left' || pos === 'bottom-right')
    ? `h-th-${margin}`
    : `${margin}`;
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
    filters.push(
      `drawtext=${fontPart}` +
      `:text='${escapeDrawtext(cfg.watermarkText)}'` +
      `:fontcolor=${cfg.watermarkColor}@${cfg.watermarkOpacity}` +
      `:fontsize=${cfg.watermarkFontSize}` +
      `:box=1:boxcolor=${cfg.watermarkBgColor}@${(cfg.watermarkOpacity * 0.5).toFixed(2)}:boxborderw=10` +
      `:x=${xExprFor(cfg.watermarkPosition, 30)}` +
      `:y=${yExprFor(cfg.watermarkPosition, 30)}`
    );
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
