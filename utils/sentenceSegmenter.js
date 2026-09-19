// utils/sentenceSegmenter.js
/**
 * Sentence Segmentation Engine (Requirement R1 / Feature F2)
 *
 * Segments word-level tokens into discrete, grammatically coherent sentences (s1, s2... sN).
 * Triggers boundaries based on:
 *  1. Grammatical terminal punctuation (. ? ! …) with abbreviation protection.
 *  2. Natural speech pause intervals (>= 0.8s inter-word pause).
 *  3. Speaker turn transitions.
 *  4. Maximum duration threshold guard (preventing run-on segments > 15s).
 */

const DEFAULT_MIN_PAUSE_THRESHOLD = 0.8; // seconds
const DEFAULT_MAX_SENTENCE_DURATION = 15.0; // seconds
const DEFAULT_MAX_SILENCE_IN_LONG_SENTENCE = 0.35; // seconds

const COMMON_ABBREVIATIONS = new Set([
  // English honorifics, titles & discourse
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'vs.', 'inc.', 'ltd.',
  'co.', 'corp.', 'st.', 'ave.', 'u.s.', 'u.k.', 'e.g.', 'i.e.', 'etc.',
  'gen.', 'rep.', 'sen.', 'gov.', 'pres.', 'dept.', 'est.', 'approx.',
  'vol.', 'jan.', 'feb.', 'mar.', 'apr.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.',
  // Expanded English corporate, academic, military & discourse
  'llc.', 'plc.', 'univ.', 'assoc.', 'al.', 'cf.', 'col.', 'maj.', 'capt.', 'lt.', 'sgt.', 'rev.', 'hon.',
  'blvd.', 'rd.', 'sq.', 'ct.',
  // Indonesian discourse, honorifics & corporate
  'dsb.', 'dll.', 'dst.', 'tsb.', 'dkk.', 'bpk.', 'ibu.', 'pt.', 'cv.', 'jl.', 'jln.',
  'hal.', 'hlm.', 'yth.', 'tbk.', 'sdr.', 'sdri.', 'tn.', 'ny.', 'drg.', 'drs.', 'dra.', 'ir.', 'ust.'
]);

/**
 * Check whether a word token is a recognized abbreviation or numeric decimal.
 * @param {string} word
 * @param {string} [nextWord=null]
 * @returns {boolean}
 */
function isAbbreviationOrDecimal(word, nextWord = null) {
  if (!word) return false;
  let clean = word.toLowerCase().replace(/["'()[\]{}]/g, '').trim();

  // "No." is an abbreviation only when followed by a number (e.g. "No. 5")
  if (clean === 'no.' || clean === 'no.,') {
    if (nextWord) {
      const cleanNext = String(nextWord).trim().replace(/["'()[\]{}]/g, '');
      if (/^\d+/.test(cleanNext)) {
        return true;
      }
    }
    return false;
  }

  // Strip trailing intra-sentence punctuation (,, ;, :) before checking dictionary/patterns
  clean = clean.replace(/[,;:]+$/, '');

  // Check decimal numbers and multi-dot versions e.g. "3.14", "0.5", "2.0.1"
  if (/^\d+(\.\d+)+$/.test(clean)) {
    return true;
  }

  // Check common abbreviation dictionary
  if (COMMON_ABBREVIATIONS.has(clean)) {
    return true;
  }

  // Check single-letter initial e.g. "J.", "A."
  if (/^[a-z]\.$/i.test(clean)) {
    return true;
  }

  // Check multi-dot abbreviations e.g. "p.h.d.", "u.s.a."
  if (/^([a-z]\.){2,}$/i.test(clean)) {
    return true;
  }

  return false;
}

/**
 * Check whether a word ends with terminal sentence punctuation (. ? ! … ...)
 * @param {string} word
 * @param {string} [nextWord=null]
 * @returns {boolean}
 */
function hasTerminalPunctuation(word, nextWord = null) {
  if (!word) return false;
  const trimmed = word.trim();
  // Matches terminal punctuation possibly followed by quotes or brackets
  const terminalRegex = /[.?!…]+["')\]}]*$/;
  if (!terminalRegex.test(trimmed)) {
    return false;
  }
  // Exclude abbreviations and decimals
  return !isAbbreviationOrDecimal(trimmed, nextWord);
}

/**
 * Segments an array of WordToken objects into discrete SentenceSegment objects.
 *
 * @param {Array<{ word: string, start: number, end: number, confidence?: number, speaker?: string }>} words
 * @param {Object} [options={}]
 * @param {number} [options.minPauseThreshold=0.8] - Inter-word pause triggering sentence boundary (seconds)
 * @param {number} [options.maxSentenceDuration=15.0] - Maximum duration before forcing split at next pause (seconds)
 * @returns {Array<{ id: string, index: number, start: number, end: number, text: string, speaker?: string, words: Array }>}
 */
export function segmentWordsIntoSentences(words, options = {}) {
  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }

  const minPauseThreshold = typeof options.minPauseThreshold === 'number'
    ? options.minPauseThreshold
    : DEFAULT_MIN_PAUSE_THRESHOLD;

  const maxSentenceDuration = typeof options.maxSentenceDuration === 'number'
    ? options.maxSentenceDuration
    : DEFAULT_MAX_SENTENCE_DURATION;

  // Validate and sort words chronologically
  const validWords = words
    .filter((w) => (
      w &&
      typeof w.word === 'string' &&
      w.word.trim().length > 0 &&
      typeof w.start === 'number' &&
      Number.isFinite(w.start) &&
      w.start >= 0 &&
      typeof w.end === 'number' &&
      Number.isFinite(w.end) &&
      w.end >= w.start
    ))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (validWords.length === 0) {
    return [];
  }

  const sentences = [];
  let currentGroup = [];
  let groupMaxEnd = 0;
  let sentenceIndex = 0;

  for (let i = 0; i < validWords.length; i++) {
    const currentWord = validWords[i];
    currentGroup.push(currentWord);
    groupMaxEnd = Math.max(groupMaxEnd, currentWord.end);

    const isLastWord = (i === validWords.length - 1);
    let shouldSplit = false;

    if (isLastWord) {
      shouldSplit = true;
    } else {
      const nextWord = validWords[i + 1];
      const pause = nextWord.start - groupMaxEnd;
      const currentDuration = groupMaxEnd - currentGroup[0].start;

      // Condition 1: Speaker transition
      const speakerChanged = Boolean(
        currentWord.speaker &&
        nextWord.speaker &&
        String(currentWord.speaker).trim() !== String(nextWord.speaker).trim()
      );

      // Condition 2: Natural speech pause (>= 0.8s)
      const isLongPause = pause >= minPauseThreshold;

      // Condition 3: Grammatical terminal punctuation (. ? ! …)
      const hasTerminal = hasTerminalPunctuation(currentWord.word, nextWord.word);

      // Condition 4: Excessive duration guard with moderate pause or hard cap
      const isOverMaxDuration = (currentDuration >= maxSentenceDuration && pause >= DEFAULT_MAX_SILENCE_IN_LONG_SENTENCE) ||
                                (currentDuration >= maxSentenceDuration * 1.5 && pause >= DEFAULT_MAX_SILENCE_IN_LONG_SENTENCE);

      if (speakerChanged || isLongPause || hasTerminal || isOverMaxDuration) {
        shouldSplit = true;
      }
    }

    if (shouldSplit && currentGroup.length > 0) {
      const firstWord = currentGroup[0];
      const sentenceEnd = Math.max(...currentGroup.map((w) => w.end));

      // Find dominant speaker in this sentence
      const speakerCounts = {};
      for (const w of currentGroup) {
        if (w.speaker) {
          speakerCounts[w.speaker] = (speakerCounts[w.speaker] || 0) + 1;
        }
      }
      let dominantSpeaker = firstWord.speaker || undefined;
      let maxCount = 0;
      for (const [spk, count] of Object.entries(speakerCounts)) {
        if (count > maxCount) {
          maxCount = count;
          dominantSpeaker = spk;
        }
      }

      const sentenceId = `s${sentenceIndex + 1}`;
      const text = currentGroup.map((w) => w.word.trim()).join(' ').trim();

      sentences.push({
        id: sentenceId,
        index: sentenceIndex,
        start: parseFloat(firstWord.start.toFixed(3)),
        end: parseFloat(sentenceEnd.toFixed(3)),
        text,
        speaker: dominantSpeaker,
        words: currentGroup.map((w) => ({
          word: w.word.trim(),
          start: parseFloat(w.start.toFixed(3)),
          end: parseFloat(w.end.toFixed(3)),
          ...(typeof w.confidence === 'number' ? { confidence: parseFloat(w.confidence.toFixed(3)) } : {}),
          ...(w.speaker ? { speaker: w.speaker } : {}),
        })),
      });

      sentenceIndex += 1;
      currentGroup = [];
      groupMaxEnd = 0;
    }
  }

  return sentences;
}

/**
 * Builds a lookup Map from sentence ID (e.g. "s1") to SentenceSegment.
 * @param {Array<SentenceSegment>} sentences
 * @returns {Map<string, SentenceSegment>}
 */
export function buildSentenceMap(sentences) {
  const map = new Map();
  if (Array.isArray(sentences)) {
    for (const s of sentences) {
      if (s && s.id) {
        map.set(s.id, s);
      }
    }
  }
  return map;
}

/**
 * Finds the sentence segment containing or closest to a specific timestamp.
 * @param {Array<SentenceSegment>} sentences
 * @param {number} time
 * @returns {SentenceSegment|null}
 */
export function findSentenceAtTime(sentences, time) {
  if (!Array.isArray(sentences) || sentences.length === 0 || typeof time !== 'number' || !Number.isFinite(time)) {
    return null;
  }

  // Check exact inclusion
  for (const s of sentences) {
    if (time >= s.start && time <= s.end) {
      return s;
    }
  }

  // If outside all sentences, find nearest
  let closest = sentences[0];
  let minDistance = Math.min(Math.abs(time - sentences[0].start), Math.abs(time - sentences[0].end));

  for (let i = 1; i < sentences.length; i++) {
    const s = sentences[i];
    const distToStart = Math.abs(time - s.start);
    const distToEnd = Math.abs(time - s.end);
    const d = Math.min(distToStart, distToEnd);
    if (d < minDistance) {
      minDistance = d;
      closest = s;
    }
  }

  return closest;
}

export const segmentSentences = segmentWordsIntoSentences;
export default segmentWordsIntoSentences;
