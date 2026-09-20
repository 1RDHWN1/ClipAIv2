// utils/transcriptSlice.js
//
// Pure helpers for carving dialogue out of a sentence list.
//
// Kept separate from workers/videoWorker.js on purpose: importing the worker
// boots a live BullMQ worker (Redis connections, output reaper timers), so any
// module that merely wants this maths would hang a test runner. Pure in, pure out.

/**
 * Return the dialogue that actually falls inside the [start, end] window of a clip.
 *
 * A sentence is kept when it OVERLAPS the window (not merely when it starts
 * inside it) — otherwise the first and last sentences of every clip, which are
 * the hook and the payoff, would be silently dropped.
 *
 * @param {Array<{start:number,end:number,text:string}>} sentences
 * @param {number} start  clip start, seconds
 * @param {number} end    clip end, seconds
 * @param {number} [maxChars=1800] hard cap so a long clip cannot blow the prompt budget
 * @returns {string} joined dialogue, '' when the window is unusable
 */
export function buildClipTranscriptSlice(sentences, start, end, maxChars = 1800) {
  if (!Array.isArray(sentences) || sentences.length === 0) return '';
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0) return '';

  const parts = [];
  for (const s of sentences) {
    const sStart = Number(s?.start);
    const sEnd = Number(s?.end);
    if (!Number.isFinite(sStart) || !Number.isFinite(sEnd)) continue;
    if (sEnd <= start || sStart >= end) continue;
    const text = typeof s.text === 'string' ? s.text.trim() : '';
    if (text) parts.push(text);
  }

  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (joined.length <= maxChars) return joined;

  // Cut on a word boundary: a half-word at the end reads as corruption to the model.
  return joined.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}
