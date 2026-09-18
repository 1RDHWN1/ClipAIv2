// tests/fixtures/mockTranscripts.js
/**
 * Mock Transcripts for 4-Tier Automated Verification
 *
 * Covers:
 * - Standard multi-sentence dialog
 * - Empty / single word boundaries
 * - Continuous speech (zero silences)
 * - Long pauses (>2s)
 * - Overlapping speech
 * - Abbreviations & numeric decimals
 * - Multi-speaker podcast
 * - Fast monologue lecture
 * - Noisy audio transcript
 */

/**
 * Helper to build a UnifiedTranscript from word tokens
 * @param {Array<{ word: string, start: number, end: number, confidence?: number, speaker?: string }>} words
 * @param {string} [language='en']
 * @returns {Object}
 */
export function buildMockUnifiedTranscript(words, language = 'en') {
  const text = words.map((w) => w.word).join(' ').trim();
  const speakerTurns = [];
  let currentTurn = null;

  for (const w of words) {
    if (!w.speaker) continue;
    if (!currentTurn) {
      currentTurn = { speaker: w.speaker, start: w.start, end: w.end };
    } else if (currentTurn.speaker === w.speaker) {
      currentTurn.end = w.end;
    } else {
      speakerTurns.push({ ...currentTurn });
      currentTurn = { speaker: w.speaker, start: w.start, end: w.end };
    }
  }
  if (currentTurn) speakerTurns.push({ ...currentTurn });

  return {
    text,
    language,
    words,
    sentences: [], // Populated by sentenceSegmenter during tests
    speakerTurns,
  };
}

/** 1. Standard Transcript: 3 sentences, clear pauses (>600ms) */
export const standardWords = [
  // Sentence 1: s1 [1.00s - 2.40s]
  { word: 'Welcome', start: 1.00, end: 1.40, confidence: 0.98, speaker: 'Speaker 1' },
  { word: 'to', start: 1.45, end: 1.60, confidence: 0.99, speaker: 'Speaker 1' },
  { word: 'our', start: 1.65, end: 1.85, confidence: 0.97, speaker: 'Speaker 1' },
  { word: 'podcast.', start: 1.90, end: 2.40, confidence: 0.96, speaker: 'Speaker 1' },
  // Pause 2.40s - 3.10s (700ms silence gap)
  // Sentence 2: s2 [3.10s - 4.70s]
  { word: 'Today', start: 3.10, end: 3.40, confidence: 0.99, speaker: 'Speaker 2' },
  { word: 'we', start: 3.45, end: 3.60, confidence: 0.98, speaker: 'Speaker 2' },
  { word: 'have', start: 3.65, end: 3.85, confidence: 0.95, speaker: 'Speaker 2' },
  { word: 'an', start: 3.90, end: 4.05, confidence: 0.99, speaker: 'Speaker 2' },
  { word: 'incredible', start: 4.10, end: 4.45, confidence: 0.92, speaker: 'Speaker 2' },
  { word: 'guest.', start: 4.50, end: 4.70, confidence: 0.97, speaker: 'Speaker 2' },
  // Pause 4.70s - 5.40s (700ms silence gap)
  // Sentence 3: s3 [5.40s - 6.80s]
  { word: 'Tell', start: 5.40, end: 5.65, confidence: 0.96, speaker: 'Speaker 1' },
  { word: 'us', start: 5.70, end: 5.85, confidence: 0.98, speaker: 'Speaker 1' },
  { word: 'your', start: 5.90, end: 6.10, confidence: 0.95, speaker: 'Speaker 1' },
  { word: 'secret', start: 6.15, end: 6.45, confidence: 0.94, speaker: 'Speaker 1' },
  { word: 'story.', start: 6.50, end: 6.80, confidence: 0.99, speaker: 'Speaker 1' },
];

export const standardTranscript = buildMockUnifiedTranscript(standardWords);

/** 2. Empty Transcript */
export const emptyWords = [];
export const emptyTranscript = buildMockUnifiedTranscript(emptyWords);

/** 3. Single Word Transcript */
export const singleWordList = [
  { word: 'Phenomenal.', start: 2.00, end: 2.80, confidence: 0.99, speaker: 'Speaker 1' },
];
export const singleWordTranscript = buildMockUnifiedTranscript(singleWordList);

/** 4. Continuous Speech (Zero silences between words) */
export const continuousWords = [
  { word: 'The', start: 0.00, end: 0.20, confidence: 0.95, speaker: 'Speaker 1' },
  { word: 'quick', start: 0.20, end: 0.50, confidence: 0.96, speaker: 'Speaker 1' },
  { word: 'brown', start: 0.50, end: 0.80, confidence: 0.94, speaker: 'Speaker 1' },
  { word: 'fox', start: 0.80, end: 1.10, confidence: 0.98, speaker: 'Speaker 1' },
  { word: 'jumps', start: 1.10, end: 1.40, confidence: 0.97, speaker: 'Speaker 1' },
  { word: 'over', start: 1.40, end: 1.65, confidence: 0.95, speaker: 'Speaker 1' },
  { word: 'the', start: 1.65, end: 1.80, confidence: 0.99, speaker: 'Speaker 1' },
  { word: 'lazy', start: 1.80, end: 2.10, confidence: 0.93, speaker: 'Speaker 1' },
  { word: 'dog.', start: 2.10, end: 2.50, confidence: 0.98, speaker: 'Speaker 1' },
];
export const continuousTranscript = buildMockUnifiedTranscript(continuousWords);

/** 5. Long Pauses Transcript (Sentence gaps > 3.0s) */
export const longPauseWords = [
  { word: 'Wait', start: 1.00, end: 1.30, confidence: 0.95, speaker: 'Speaker 1' },
  { word: 'for', start: 1.35, end: 1.50, confidence: 0.98, speaker: 'Speaker 1' },
  { word: 'it.', start: 1.55, end: 1.90, confidence: 0.97, speaker: 'Speaker 1' },
  // 3.1 second pause
  { word: 'Here', start: 5.00, end: 5.30, confidence: 0.98, speaker: 'Speaker 1' },
  { word: 'it', start: 5.35, end: 5.50, confidence: 0.99, speaker: 'Speaker 1' },
  { word: 'comes.', start: 5.55, end: 5.95, confidence: 0.96, speaker: 'Speaker 1' },
  // 4.05 second pause
  { word: 'Boom.', start: 10.00, end: 10.50, confidence: 0.99, speaker: 'Speaker 1' },
];
export const longPauseTranscript = buildMockUnifiedTranscript(longPauseWords);

/** 6. Overlapping Speech Transcript */
export const overlappingWords = [
  { word: 'I', start: 1.00, end: 1.20, confidence: 0.95, speaker: 'Host' },
  { word: 'think', start: 1.25, end: 1.50, confidence: 0.92, speaker: 'Host' },
  { word: 'that', start: 1.55, end: 1.80, confidence: 0.94, speaker: 'Host' },
  { word: 'Wait', start: 1.70, end: 1.95, confidence: 0.88, speaker: 'Guest' }, // overlap
  { word: 'listen', start: 2.00, end: 2.30, confidence: 0.90, speaker: 'Guest' },
  { word: 'completely.', start: 2.10, end: 2.50, confidence: 0.91, speaker: 'Host' }, // overlap
];
export const overlappingTranscript = buildMockUnifiedTranscript(overlappingWords);

/** 7. Abbreviations & Decimals Transcript */
export const abbreviationWords = [
  { word: 'Dr.', start: 1.00, end: 1.30, confidence: 0.98, speaker: 'Speaker 1' },
  { word: 'Smith', start: 1.35, end: 1.70, confidence: 0.97, speaker: 'Speaker 1' },
  { word: 'visited', start: 1.75, end: 2.10, confidence: 0.96, speaker: 'Speaker 1' },
  { word: 'the', start: 2.15, end: 2.30, confidence: 0.99, speaker: 'Speaker 1' },
  { word: 'U.S.', start: 2.35, end: 2.70, confidence: 0.95, speaker: 'Speaker 1' },
  { word: 'at', start: 2.75, end: 2.90, confidence: 0.99, speaker: 'Speaker 1' },
  { word: '3.14', start: 2.95, end: 3.40, confidence: 0.94, speaker: 'Speaker 1' },
  { word: 'PM.', start: 3.45, end: 3.80, confidence: 0.96, speaker: 'Speaker 1' },
  { word: 'It', start: 4.50, end: 4.70, confidence: 0.98, speaker: 'Speaker 1' },
  { word: 'was', start: 4.75, end: 4.95, confidence: 0.97, speaker: 'Speaker 1' },
  { word: 'great.', start: 5.00, end: 5.40, confidence: 0.99, speaker: 'Speaker 1' },
];
export const abbreviationTranscript = buildMockUnifiedTranscript(abbreviationWords);

/** 8. Real-World Multi-Speaker Podcast Dialogue */
export const podcastDialogueWords = [
  { word: 'Have', start: 1.00, end: 1.20, confidence: 0.98, speaker: 'Host' },
  { word: 'you', start: 1.25, end: 1.35, confidence: 0.99, speaker: 'Host' },
  { word: 'ever', start: 1.40, end: 1.55, confidence: 0.97, speaker: 'Host' },
  { word: 'lost', start: 1.60, end: 1.85, confidence: 0.95, speaker: 'Host' },
  { word: 'everything?', start: 1.90, end: 2.45, confidence: 0.98, speaker: 'Host' },
  // Pause 2.45s - 3.20s (750ms)
  { word: 'Yes,', start: 3.20, end: 3.50, confidence: 0.96, speaker: 'Guest' },
  { word: 'in', start: 3.55, end: 3.70, confidence: 0.99, speaker: 'Guest' },
  { word: '2020', start: 3.75, end: 4.15, confidence: 0.92, speaker: 'Guest' },
  { word: 'my', start: 4.20, end: 4.35, confidence: 0.98, speaker: 'Guest' },
  { word: 'company', start: 4.40, end: 4.80, confidence: 0.97, speaker: 'Guest' },
  { word: 'went', start: 4.85, end: 5.10, confidence: 0.95, speaker: 'Guest' },
  { word: 'bankrupt.', start: 5.15, end: 5.75, confidence: 0.99, speaker: 'Guest' },
  // Pause 5.75s - 6.50s (750ms)
  { word: 'How', start: 6.50, end: 6.70, confidence: 0.98, speaker: 'Host' },
  { word: 'did', start: 6.75, end: 6.90, confidence: 0.99, speaker: 'Host' },
  { word: 'you', start: 6.95, end: 7.10, confidence: 0.98, speaker: 'Host' },
  { word: 'bounce', start: 7.15, end: 7.45, confidence: 0.94, speaker: 'Host' },
  { word: 'back?', start: 7.50, end: 7.90, confidence: 0.97, speaker: 'Host' },
  // Pause 7.90s - 8.60s (700ms)
  { word: 'We', start: 8.60, end: 8.80, confidence: 0.99, speaker: 'Guest' },
  { word: 'pivoted', start: 8.85, end: 9.20, confidence: 0.93, speaker: 'Guest' },
  { word: 'completely', start: 9.25, end: 9.70, confidence: 0.96, speaker: 'Guest' },
  { word: 'to', start: 9.75, end: 9.85, confidence: 0.99, speaker: 'Guest' },
  { word: 'AI.', start: 9.90, end: 10.35, confidence: 0.98, speaker: 'Guest' },
];
export const podcastDialogueTranscript = buildMockUnifiedTranscript(podcastDialogueWords);

/** 9. Fast Monologue Lecture (Solo Speaker, High WPM) */
export const monologueLectureWords = [
  { word: 'Artificial', start: 0.50, end: 0.85, confidence: 0.98, speaker: 'Lecturer' },
  { word: 'intelligence', start: 0.88, end: 1.35, confidence: 0.97, speaker: 'Lecturer' },
  { word: 'is', start: 1.38, end: 1.50, confidence: 0.99, speaker: 'Lecturer' },
  { word: 'fundamentally', start: 1.53, end: 2.05, confidence: 0.95, speaker: 'Lecturer' },
  { word: 'transforming', start: 2.08, end: 2.55, confidence: 0.96, speaker: 'Lecturer' },
  { word: 'every', start: 2.58, end: 2.80, confidence: 0.98, speaker: 'Lecturer' },
  { word: 'single', start: 2.83, end: 3.10, confidence: 0.99, speaker: 'Lecturer' },
  { word: 'industry.', start: 3.13, end: 3.65, confidence: 0.97, speaker: 'Lecturer' },
  // 450ms pause
  { word: 'If', start: 4.10, end: 4.25, confidence: 0.99, speaker: 'Lecturer' },
  { word: 'you', start: 4.28, end: 4.40, confidence: 0.98, speaker: 'Lecturer' },
  { word: 'ignore', start: 4.43, end: 4.75, confidence: 0.94, speaker: 'Lecturer' },
  { word: 'this', start: 4.78, end: 4.95, confidence: 0.99, speaker: 'Lecturer' },
  { word: 'wave,', start: 4.98, end: 5.30, confidence: 0.95, speaker: 'Lecturer' },
  { word: 'you', start: 5.33, end: 5.45, confidence: 0.98, speaker: 'Lecturer' },
  { word: 'will', start: 5.48, end: 5.65, confidence: 0.99, speaker: 'Lecturer' },
  { word: 'be', start: 5.68, end: 5.80, confidence: 0.99, speaker: 'Lecturer' },
  { word: 'left', start: 5.83, end: 6.05, confidence: 0.97, speaker: 'Lecturer' },
  { word: 'behind.', start: 6.08, end: 6.55, confidence: 0.99, speaker: 'Lecturer' },
];
export const monologueLectureTranscript = buildMockUnifiedTranscript(monologueLectureWords);

/** 10. Noisy Audio Transcript (Low confidence words, varying quality) */
export const noisyAudioWords = [
  { word: 'Can', start: 1.00, end: 1.25, confidence: 0.45, speaker: 'Speaker 1' },
  { word: 'you', start: 1.30, end: 1.45, confidence: 0.62, speaker: 'Speaker 1' },
  { word: 'hear', start: 1.50, end: 1.80, confidence: 0.38, speaker: 'Speaker 1' },
  { word: 'me', start: 1.85, end: 2.05, confidence: 0.55, speaker: 'Speaker 1' },
  { word: 'clearly?', start: 2.10, end: 2.65, confidence: 0.48, speaker: 'Speaker 1' },
  // Pause
  { word: 'There', start: 3.50, end: 3.75, confidence: 0.40, speaker: 'Speaker 1' },
  { word: 'is', start: 3.80, end: 3.95, confidence: 0.58, speaker: 'Speaker 1' },
  { word: 'too', start: 4.00, end: 4.20, confidence: 0.42, speaker: 'Speaker 1' },
  { word: 'much', start: 4.25, end: 4.55, confidence: 0.35, speaker: 'Speaker 1' },
  { word: 'static.', start: 4.60, end: 5.10, confidence: 0.50, speaker: 'Speaker 1' },
];
export const noisyAudioTranscript = buildMockUnifiedTranscript(noisyAudioWords);
