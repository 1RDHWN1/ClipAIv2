import { segmentWordsIntoSentences } from './sentenceSegmenter.js';
import { detectLanguageFromText, normalizeLanguageCode } from './transcriber.js';

/**
 * Normalisasi string timestamp (misal "0:00", "08:53", "1:02:15", "(0:03)") menjadi detik (float).
 * @param {string} tsStr
 * @returns {number}
 */
export function parseTimestampToSeconds(tsStr) {
  if (!tsStr) return 0;
  const cleaned = String(tsStr).trim().replace(/[\[\]\(\)]/g, '');
  const parts = cleaned.split(':').map((p) => parseFloat(p));
  if (parts.some((p) => isNaN(p))) return 0;

  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

/**
 * Regex untuk mendeteksi baris transkrip YouTube Gemini / Tanya / timestamped dialog.
 * Mendukung format:
 * - ([0:00](https://www.youtube.com/watch?t=0s)) Katanya manusia...
 * - • (0:00) Katanya manusia...
 * - - (0:03) Heeh.
 * - [00:04] Berarti kita saudara...
 * - (0:07) Saya jalan ke ujung dunia.
 * - 0:10 Hm.
 */
// Regex untuk mendeteksi baris transkrip YouTube Gemini / Tanya / timestamped dialog.
// Mendukung:
// - ([0:00](https://...)) Teks
// - [0:00](https://...) Teks
// - • (0:00) Teks atau - (0:00) Teks
// - [00:04] Teks atau (0:07) Teks
// - 0:10 Teks
const LINE_REGEX = /^(?:[•\-\*]\s*)?(?:\(?\[|\(|\b)(\d{1,2}:\d{2}(?::\d{2})?|\d+:\d{2})(?:\]\([^\)]*\)\)?|\)?\]|\)|\b)\s*[:\-–]?\s*(.+)$/;

/**
 * Parse teks mentah dari fitur "Tanya" Gemini YouTube atau transkrip teks ber-timestamp lainnya.
 * Menghasilkan objek UnifiedTranscript yang kompatibel dengan seluruh pipeline ClipAIv2.
 *
 * @param {string} rawText - Teks transkrip mentah
 * @param {Object} [options={}]
 * @param {number} [options.totalDuration] - Durasi total video jika diketahui
 * @param {string} [options.language='id'] - Bahasa transkrip
 * @returns {Object} UnifiedTranscript { text, sentences, words, segments, silenceIntervals, language, duration }
 */
export function parseGeminiTranscript(rawText, options = {}) {
  if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new Error('Teks transkrip Gemini tidak boleh kosong');
  }

  const lines = rawText.split(/\r?\n/);
  const rawItems = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Abaikan baris header umum seperti "Berikut adalah transkrip..." atau intro
    if (/^berikut adalah transkrip/i.test(trimmed) || (/^transkrip/i.test(trimmed) && !trimmed.match(/\d+:\d+/))) {
      continue;
    }

    const match = trimmed.match(LINE_REGEX);
    if (match) {
      const tsStr = match[1];
      let content = match[2].trim().replace(/^[)\s:\-–]+/, '').trim();

      // Deteksi opsional speaker label, e.g. "[Deddy]: halo" atau "Deddy: halo"
      let speaker = null;
      const speakerMatch = content.match(/^(?:\[([^\]]+)\]|([A-Za-z0-9_\s]{2,20}))\s*:\s*(.+)$/);
      if (speakerMatch) {
        speaker = (speakerMatch[1] || speakerMatch[2]).trim();
        content = speakerMatch[3].trim();
      }

      const startSeconds = parseTimestampToSeconds(tsStr);
      if (content.length > 0) {
        rawItems.push({
          start: startSeconds,
          text: content,
          speaker,
        });
      }
    }
  }

  if (rawItems.length === 0) {
    throw new Error('Tidak ditemukan format timestamp yang valid dalam teks transkrip.');
  }

  // Urutkan berdasarkan waktu mulai
  rawItems.sort((a, b) => a.start - b.start);

  const sentences = [];
  const allWords = [];
  const silenceIntervals = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const nextItem = rawItems[i + 1];

    const wordsInItem = item.text.split(/\s+/).filter(Boolean);
    const wordCount = Math.max(1, wordsInItem.length);

    // Estimasi durasi ucapan alami: ~0.35s per kata, minimal 1.2 detik
    const estimatedDuration = Math.max(1.2, parseFloat((wordCount * 0.35).toFixed(3)));

    let endSeconds;
    if (nextItem) {
      if (nextItem.start > item.start) {
        const gap = nextItem.start - item.start;
        if (gap > 15.0) {
          // Jeda sangat panjang antar segmen (>15 detik), anggap sebagai jeda/hening
          endSeconds = parseFloat((item.start + estimatedDuration).toFixed(3));
          silenceIntervals.push({
            start: endSeconds,
            end: nextItem.start,
            duration: parseFloat((nextItem.start - endSeconds).toFixed(3)),
          });
        } else {
          // Kalimat bersambung secara rapat ke timestamp berikutnya
          endSeconds = nextItem.start;
        }
      } else {
        // Timestamp sama (misal beberapa kalimat dalam detik yang sama)
        endSeconds = parseFloat((item.start + estimatedDuration).toFixed(3));
      }
    } else {
      // Kalimat terakhir
      const maxCap = options.totalDuration ? options.totalDuration : (item.start + estimatedDuration);
      endSeconds = parseFloat(Math.min(maxCap, item.start + estimatedDuration).toFixed(3));
    }

    // Pastikan end > start
    if (endSeconds <= item.start) {
      endSeconds = parseFloat((item.start + Math.max(0.5, estimatedDuration)).toFixed(3));
    }

    const sentenceId = `s${i + 1}`;
    const sentenceWords = [];

    // Sintesis token kata dengan pembagian waktu proporsional
    const sentenceSpan = endSeconds - item.start;
    const timePerWord = sentenceSpan / wordCount;

    for (let wIdx = 0; wIdx < wordsInItem.length; wIdx++) {
      const wText = wordsInItem[wIdx];
      const wStart = parseFloat((item.start + wIdx * timePerWord).toFixed(3));
      const wEnd = parseFloat((item.start + (wIdx + 1) * timePerWord).toFixed(3));

      const wordObj = {
        word: wText,
        start: wStart,
        end: wEnd,
        confidence: 0.98,
        ...(item.speaker ? { speaker: item.speaker } : {}),
      };

      sentenceWords.push(wordObj);
      allWords.push(wordObj);
    }

    sentences.push({
      id: sentenceId,
      index: i + 1,
      start: parseFloat(item.start.toFixed(3)),
      end: parseFloat(endSeconds.toFixed(3)),
      text: item.text,
      words: sentenceWords,
      ...(item.speaker ? { speaker: item.speaker } : {}),
    });
  }

  const fullText = sentences.map((s) => s.text).join(' ');
  let language = options.language;
  if (!language || language === 'auto' || language === 'unknown') {
    language = detectLanguageFromText(fullText);
  } else {
    language = normalizeLanguageCode(language);
  }
  const lastSentence = sentences[sentences.length - 1];
  const duration = options.totalDuration || (lastSentence ? lastSentence.end : 0);

  const segments = sentences.map((s) => ({
    id: s.id,
    start: s.start,
    end: s.end,
    text: s.text,
    ...(s.speaker ? { speaker: s.speaker } : {}),
  }));

  return {
    text: fullText,
    language,
    words: allWords,
    sentences,
    segments,
    silenceIntervals,
    duration,
    speakerTurns: [],
  };
}
