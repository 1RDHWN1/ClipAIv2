// tests/unit/challenger_m2_1.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  SUBTITLE_SAFE_MARGIN_V,
  VIRAL_PRESETS,
  SUBTITLE_PRESETS,
  getPreset,
  hexToAssColor,
  formatAssTime,
  chunkWords,
  generateAssSubtitles,
  formatFfmpegSubFilter,
} from '../../utils/subtitleGenerator.js';

/**
 * Challenger 1 Adversarial & Empirical Test Suite: Subtitle Generator Engine
 * Milestone: M2 (Features F6, F7, F8, F9, F10, F11, F12)
 * Requirements: ORIGINAL_REQUEST.md (2026-09-18T20:23:27Z R2, R3), PROJECT.md
 */

// ============================================================================
// SUITE 1: Preset Conformance & Fallback Architecture (F12)
// ============================================================================
test('Challenger M2 - Suite 1: Preset Conformance & Fallback Architecture', async (t) => {
  await t.test('1.1 Presets identity and completeness', () => {
    assert.strictEqual(SUBTITLE_PRESETS, VIRAL_PRESETS, 'SUBTITLE_PRESETS must alias VIRAL_PRESETS');
    const requiredPresets = ['hormozi', 'mrbeast', 'cyber', 'minimal'];
    for (const key of requiredPresets) {
      assert(VIRAL_PRESETS[key], `Preset "${key}" must exist in VIRAL_PRESETS`);
      assert.strictEqual(VIRAL_PRESETS[key].id, key);
    }
  });

  await t.test('1.2 Hormozi Yellow preset specifications', () => {
    const p = VIRAL_PRESETS.hormozi;
    assert.strictEqual(p.name, 'Hormozi Yellow');
    assert.strictEqual(p.fontFamily, 'Impact');
    assert.strictEqual(p.fontSize, 80);
    assert.strictEqual(p.primaryColor, '#FFFFFF');
    assert.strictEqual(p.highlightColor, '#FFE600');
    assert.strictEqual(p.outlineColor, '#000000');
    assert.strictEqual(p.outlineWidth, 5);
    assert.strictEqual(p.shadow, 0);
    assert.strictEqual(p.alignment, 2);
    // Safe-zone margin: clears the YouTube Shorts / TikTok / Reels UI.
    assert.strictEqual(p.marginV, SUBTITLE_SAFE_MARGIN_V);
    assert.strictEqual(p.uppercase, true);
  });

  await t.test('1.3 MrBeast Green preset specifications', () => {
    const p = VIRAL_PRESETS.mrbeast;
    assert.strictEqual(p.name, 'MrBeast Green');
    assert.strictEqual(p.fontFamily, 'Impact');
    assert.strictEqual(p.fontSize, 84);
    assert.strictEqual(p.primaryColor, '#FFFFFF');
    assert.strictEqual(p.highlightColor, '#00FF66');
    assert.strictEqual(p.outlineColor, '#000000');
    assert.strictEqual(p.outlineWidth, 6);
    assert.strictEqual(p.shadow, 2);
    assert.strictEqual(p.alignment, 2);
    // Safe-zone margin: clears the YouTube Shorts / TikTok / Reels UI.
    assert.strictEqual(p.marginV, SUBTITLE_SAFE_MARGIN_V);
    assert.strictEqual(p.uppercase, true);
  });

  await t.test('1.4 Cyber Cyan preset specifications', () => {
    const p = VIRAL_PRESETS.cyber;
    assert.strictEqual(p.name, 'Cyber Cyan');
    assert(p.fontFamily.includes('Montserrat'));
    assert.strictEqual(p.fontSize, 76);
    assert.strictEqual(p.primaryColor, '#FFFFFF');
    assert.strictEqual(p.highlightColor, '#00E5FF');
    assert.strictEqual(p.outlineColor, '#000000');
    assert.strictEqual(p.outlineWidth, 4);
    assert.strictEqual(p.shadow, 1);
    assert.strictEqual(p.alignment, 2);
    // Safe-zone margin: clears the YouTube Shorts / TikTok / Reels UI.
    assert.strictEqual(p.marginV, SUBTITLE_SAFE_MARGIN_V);
    assert.strictEqual(p.uppercase, true);
  });

  await t.test('1.5 Clean Minimal preset specifications', () => {
    const p = VIRAL_PRESETS.minimal;
    assert.strictEqual(p.name, 'Clean Minimal');
    assert.strictEqual(p.fontFamily, 'Arial');
    assert.strictEqual(p.fontSize, 68);
    assert.strictEqual(p.primaryColor, '#FFFFFF');
    assert.strictEqual(p.highlightColor, '#FFFFFF');
    assert.strictEqual(p.outlineColor, '#000000');
    assert.strictEqual(p.outlineWidth, 2);
    assert.strictEqual(p.shadow, 2);
    assert.strictEqual(p.alignment, 2);
    assert.strictEqual(p.marginV, SUBTITLE_SAFE_MARGIN_V);
    assert.strictEqual(p.uppercase, false);
  });

  await t.test('1.6 getPreset alias resolution and normalization', () => {
    assert.strictEqual(getPreset('hormozi').name, 'Hormozi Yellow');
    assert.strictEqual(getPreset('HORMOZI').name, 'Hormozi Yellow');
    assert.strictEqual(getPreset('Hormozi Yellow').name, 'Hormozi Yellow');
    assert.strictEqual(getPreset('hormozi-yellow').name, 'Hormozi Yellow');
    assert.strictEqual(getPreset('hormozi_yellow').name, 'Hormozi Yellow');

    assert.strictEqual(getPreset('mrbeast').name, 'MrBeast Green');
    assert.strictEqual(getPreset('MrBeast Green').name, 'MrBeast Green');
    assert.strictEqual(getPreset('beast').name, 'MrBeast Green');
    assert.strictEqual(getPreset('mrbeast_green').name, 'MrBeast Green');

    assert.strictEqual(getPreset('cyber').name, 'Cyber Cyan');
    assert.strictEqual(getPreset('Cyber Cyan').name, 'Cyber Cyan');
    assert.strictEqual(getPreset('cyan').name, 'Cyber Cyan');

    assert.strictEqual(getPreset('minimal').name, 'Clean Minimal');
    assert.strictEqual(getPreset('Clean Minimal').name, 'Clean Minimal');
    assert.strictEqual(getPreset('clean').name, 'Clean Minimal');
  });

  await t.test('1.7 getPreset fallback resilience', () => {
    assert.strictEqual(getPreset(null).name, 'Hormozi Yellow');
    assert.strictEqual(getPreset(undefined).name, 'Hormozi Yellow');
    assert.strictEqual(getPreset('').name, 'Hormozi Yellow');
    assert.strictEqual(getPreset(12345).name, 'Hormozi Yellow');
    assert.strictEqual(getPreset({}).name, 'Hormozi Yellow');
    assert.strictEqual(getPreset('nonexistent_random_preset').name, 'Hormozi Yellow');
  });
});

// ============================================================================
// SUITE 2: Color Space & ASS BGR Hex Conversion (hexToAssColor)
// ============================================================================
test('Challenger M2 - Suite 2: Color Space & ASS BGR Hex Conversion', async (t) => {
  await t.test('2.1 Standard 6-digit hex conversion to ASS BGR format', () => {
    // RGB #FFE600 -> BGR &H0000E6FF&
    assert.strictEqual(hexToAssColor('#FFE600'), '&H0000E6FF&');
    // RGB #00FF66 -> BGR &H0066FF00&
    assert.strictEqual(hexToAssColor('#00FF66'), '&H0066FF00&');
    // RGB #00E5FF -> BGR &H00FFE500&
    assert.strictEqual(hexToAssColor('#00E5FF'), '&H00FFE500&');
    // Pure Red #FF0000 -> BGR &H000000FF&
    assert.strictEqual(hexToAssColor('#FF0000'), '&H000000FF&');
    // Pure Blue #0000FF -> BGR &H00FF0000&
    assert.strictEqual(hexToAssColor('#0000FF'), '&H00FF0000&');
    // Pure White #FFFFFF -> &H00FFFFFF&
    assert.strictEqual(hexToAssColor('#FFFFFF'), '&H00FFFFFF&');
    // Pure Black #000000 -> &H00000000&
    assert.strictEqual(hexToAssColor('#000000'), '&H00000000&');
  });

  await t.test('2.2 Shorthand 3-digit hex expansion', () => {
    assert.strictEqual(hexToAssColor('#FFF'), '&H00FFFFFF&');
    assert.strictEqual(hexToAssColor('#000'), '&H00000000&');
    assert.strictEqual(hexToAssColor('#F00'), '&H000000FF&');
    assert.strictEqual(hexToAssColor('#0F0'), '&H0000FF00&');
    assert.strictEqual(hexToAssColor('#00F'), '&H00FF0000&');
  });

  await t.test('2.3 Custom alpha channel handling', () => {
    assert.strictEqual(hexToAssColor('#000000', '80'), '&H80000000&');
    assert.strictEqual(hexToAssColor('#FFFFFF', 'FF'), '&HFFFFFFFF&');
    assert.strictEqual(hexToAssColor('#FFE600', '40'), '&H4000E6FF&');
  });

  await t.test('2.4 Existing ASS color idempotency', () => {
    assert.strictEqual(hexToAssColor('&H0000E6FF&'), '&H0000E6FF&');
    assert.strictEqual(hexToAssColor('&H0066FF00&'), '&H0066FF00&');
    // 6-digit raw ASS string without alpha
    assert.strictEqual(hexToAssColor('&H00E6FF&', '00'), '&H0000E6FF&');
  });

  await t.test('2.5 Malformed and boundary color inputs', () => {
    assert.strictEqual(hexToAssColor(null), '&H00FFFFFF&');
    assert.strictEqual(hexToAssColor(undefined), '&H00FFFFFF&');
    assert.strictEqual(hexToAssColor(''), '&H00FFFFFF&');
    assert.strictEqual(hexToAssColor('invalid_color'), '&H00FFFFFF&');
    assert.strictEqual(hexToAssColor('#12'), '&H00FFFFFF&');
    assert.strictEqual(hexToAssColor('#12345'), '&H00FFFFFF&');
  });
});

// ============================================================================
// SUITE 3: ASS Timestamp Precision, Centiseconds & Rollovers (formatAssTime)
// ============================================================================
test('Challenger M2 - Suite 3: ASS Timestamp Precision & Rollovers', async (t) => {
  await t.test('3.1 Sub-second and zero timestamps', () => {
    assert.strictEqual(formatAssTime(0), '0:00:00.00');
    assert.strictEqual(formatAssTime(0.01), '0:00:00.01');
    assert.strictEqual(formatAssTime(0.05), '0:00:00.05');
    assert.strictEqual(formatAssTime(0.5), '0:00:00.50');
    assert.strictEqual(formatAssTime(0.99), '0:00:00.99');
    assert.strictEqual(formatAssTime(1.4), '0:00:01.40');
  });

  await t.test('3.2 Minute boundary rollover precision', () => {
    assert.strictEqual(formatAssTime(59.99), '0:00:59.99');
    // 59.996 rounds to 60.00s -> 0:01:00.00
    assert.strictEqual(formatAssTime(59.996), '0:01:00.00');
    assert.strictEqual(formatAssTime(60.0), '0:01:00.00');
    assert.strictEqual(formatAssTime(61.25), '0:01:01.25');
  });

  await t.test('3.3 Hour boundary rollover and long duration', () => {
    assert.strictEqual(formatAssTime(3599.99), '0:59:59.99');
    assert.strictEqual(formatAssTime(3599.996), '1:00:00.00');
    assert.strictEqual(formatAssTime(3600.0), '1:00:00.00');
    assert.strictEqual(formatAssTime(3665.25), '1:01:05.25');
    assert.strictEqual(formatAssTime(7325.42), '2:02:05.42');
  });

  await t.test('3.4 Negative and non-numeric inputs', () => {
    assert.strictEqual(formatAssTime(-5), '0:00:00.00');
    assert.strictEqual(formatAssTime(-0.01), '0:00:00.00');
    assert.strictEqual(formatAssTime(null), '0:00:00.00');
    assert.strictEqual(formatAssTime(undefined), '0:00:00.00');
    assert.strictEqual(formatAssTime(NaN), '0:00:00.00');
    assert.strictEqual(formatAssTime('invalid'), '0:00:00.00');
  });
});

// ============================================================================
// SUITE 4: Pacing, Linguistic Chunking & Pause Detection (chunkWords)
// ============================================================================
test('Challenger M2 - Suite 4: Pacing, Linguistic Chunking & Pause Detection', async (t) => {
  await t.test('4.1 Pacing constraint: continuous speech chunks to 2-4 words per frame', () => {
    const rapidContinuousWords = [
      { word: 'one', start: 0.0, end: 0.2 },
      { word: 'two', start: 0.2, end: 0.4 },
      { word: 'three', start: 0.4, end: 0.6 },
      { word: 'four', start: 0.6, end: 0.8 },
      { word: 'five', start: 0.8, end: 1.0 },
      { word: 'six', start: 1.0, end: 1.2 },
      { word: 'seven', start: 1.2, end: 1.4 },
      { word: 'eight', start: 1.4, end: 1.6 },
    ];
    const chunks = chunkWords(rapidContinuousWords, 0, 2.0);
    assert(chunks.length >= 2, 'Should divide continuous speech into multiple chunks');
    for (const chunk of chunks) {
      assert(chunk.length >= 1 && chunk.length <= 4, `Chunk length ${chunk.length} must be <= 4 words`);
    }
  });

  await t.test('4.2 Pause boundary detection: gap >= 300ms splits chunks', () => {
    const wordsWithPause = [
      { word: 'First', start: 0.0, end: 0.4 },
      { word: 'part', start: 0.4, end: 0.8 },
      // Gap: 1.2 - 0.8 = 0.4s (400ms >= 300ms)
      { word: 'Second', start: 1.2, end: 1.6 },
      { word: 'part', start: 1.6, end: 2.0 },
    ];
    const chunks = chunkWords(wordsWithPause, 0, 2.5);
    assert.strictEqual(chunks.length, 2, 'Should split exactly across the 400ms pause');
    assert.strictEqual(chunks[0].map((w) => w.word).join(' '), 'First part');
    assert.strictEqual(chunks[1].map((w) => w.word).join(' '), 'Second part');
  });

  await t.test('4.3 Pause boundary: micro-gap < 300ms keeps words in same chunk', () => {
    const wordsWithMicroGap = [
      { word: 'Stay', start: 0.0, end: 0.4 },
      // Gap: 0.6 - 0.4 = 0.2s (200ms < 300ms)
      { word: 'together', start: 0.6, end: 1.0 },
    ];
    const chunks = chunkWords(wordsWithMicroGap, 0, 2.0);
    assert.strictEqual(chunks.length, 1, 'Micro-gap < 300ms must not split chunk');
    assert.strictEqual(chunks[0].length, 2);
  });

  await t.test('4.4 Terminal punctuation triggers chunk boundary', () => {
    const punctSentences = [
      { word: 'Stop!', start: 0.0, end: 0.3 },
      { word: 'Now', start: 0.35, end: 0.6 },
      { word: 'look.', start: 0.6, end: 0.9 },
      { word: 'Are', start: 0.95, end: 1.2 },
      { word: 'you', start: 1.2, end: 1.4 },
      { word: 'ready?', start: 1.4, end: 1.7 },
      { word: 'Yes…', start: 1.75, end: 2.0 },
      { word: 'Go!', start: 2.05, end: 2.3 },
    ];
    const chunks = chunkWords(punctSentences, 0, 3.0);
    // 'Stop!', 'Now look.', 'Are you ready?', 'Yes…', 'Go!' -> 5 distinct chunks
    assert.strictEqual(chunks.length, 5);
    assert.strictEqual(chunks[0][0].word, 'Stop!');
    assert.strictEqual(chunks[1].map((w) => w.word).join(' '), 'Now look.');
    assert.strictEqual(chunks[2].map((w) => w.word).join(' '), 'Are you ready?');
    assert.strictEqual(chunks[3][0].word, 'Yes…');
    assert.strictEqual(chunks[4][0].word, 'Go!');
  });

  await t.test('4.5 Non-terminal punctuation does not trigger false split', () => {
    const nonTerminalWords = [
      { word: 'Well,', start: 0.0, end: 0.3 },
      { word: 'actually,', start: 0.35, end: 0.7 },
      { word: 'yes', start: 0.75, end: 1.0 },
    ];
    const chunks = chunkWords(nonTerminalWords, 0, 1.5);
    assert.strictEqual(chunks.length, 1, 'Commas should not split words prematurely');
    assert.strictEqual(chunks[0].length, 3);
  });

  await t.test('4.6 Max character limit threshold per chunk', () => {
    const longWords = [
      { word: 'Supercalifragilistic', start: 0.0, end: 0.8 },
      { word: 'expialidocious', start: 0.85, end: 1.6 },
      { word: 'extraordinary', start: 1.65, end: 2.4 },
    ];
    const chunks = chunkWords(longWords, 0, 3.0, { maxCharsPerChunk: 26 });
    assert(chunks.length >= 2, 'Should split when characters exceed maxCharsPerChunk');
  });

  await t.test('4.7 Malformed and zero-duration word tokens', () => {
    const dirtyWords = [
      null,
      undefined,
      { word: '', start: 0.0, end: 0.5 },
      { word: '   ', start: 0.5, end: 1.0 },
      { word: 'valid', start: 1.0, end: 1.5 },
      { word: 'inverted', start: 2.0, end: 1.8 }, // end <= start
      { word: 'instant', start: 2.5, end: 2.5 }, // end === start
    ];
    const chunks = chunkWords(dirtyWords, 0, 3.0);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].length, 1);
    assert.strictEqual(chunks[0][0].word, 'valid');
  });
});

// ============================================================================
// SUITE 5: Relative Timing & Boundary Clamping Invariants
// ============================================================================
test('Challenger M2 - Suite 5: Relative Timing & Boundary Clamping Invariants', async (t) => {
  await t.test('5.1 Absolute timestamps correctly converted to relative clip timestamps', () => {
    const words = [
      { word: 'Clip', start: 10.0, end: 10.5 },
      { word: 'starts', start: 10.5, end: 11.0 },
      { word: 'here', start: 11.0, end: 11.5 },
    ];
    const chunks = chunkWords(words, 10.0, 15.0);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0][0].start, 0.0);
    assert.strictEqual(chunks[0][0].end, 0.5);
    assert.strictEqual(chunks[0][1].start, 0.5);
    assert.strictEqual(chunks[0][1].end, 1.0);
    assert.strictEqual(chunks[0][2].start, 1.0);
    assert.strictEqual(chunks[0][2].end, 1.5);
  });

  await t.test('5.2 Boundary straddling words properly clamped to [0, duration]', () => {
    const words = [
      { word: 'BeforeAndInto', start: 9.6, end: 10.4 }, // straddles start (clip 10-20)
      { word: 'Inside', start: 14.0, end: 15.0 },
      { word: 'InsideAndAfter', start: 19.5, end: 20.6 }, // straddles end
    ];
    const chunks = chunkWords(words, 10.0, 20.0);
    const flattened = chunks.flat();
    assert.strictEqual(flattened[0].word, 'BeforeAndInto');
    assert.strictEqual(flattened[0].start, 0.0); // clamped to 0
    assert.strictEqual(Math.round(flattened[0].end * 100) / 100, 0.4);

    assert.strictEqual(flattened[1].word, 'Inside');
    assert.strictEqual(flattened[1].start, 4.0);
    assert.strictEqual(flattened[1].end, 5.0);

    assert.strictEqual(flattened[2].word, 'InsideAndAfter');
    assert.strictEqual(flattened[2].start, 9.5);
    assert.strictEqual(flattened[2].end, 10.0); // clamped to duration (10s)
  });

  await t.test('5.3 Words outside clip boundaries are excluded', () => {
    const words = [
      { word: 'TooEarly', start: 5.0, end: 9.9 },
      { word: 'ExactBoundaryBefore', start: 9.0, end: 10.0 }, // end <= clipStart
      { word: 'JustRight', start: 10.2, end: 11.0 },
      { word: 'ExactBoundaryAfter', start: 20.0, end: 21.0 }, // start >= clipEnd
      { word: 'TooLate', start: 22.0, end: 25.0 },
    ];
    const chunks = chunkWords(words, 10.0, 20.0);
    const flattened = chunks.flat();
    assert.strictEqual(flattened.length, 1);
    assert.strictEqual(flattened[0].word, 'JustRight');
  });

  await t.test('5.4 Pre-shifted relative words detection (avoids double shifting)', () => {
    // Caller already shifted words to [0, 5.0] relative to clip
    const preShiftedWords = [
      { word: 'Already', start: 0.5, end: 1.0 },
      { word: 'Relative', start: 1.0, end: 1.8 },
    ];
    // Passing clipStart = 15.0, clipEnd = 20.0
    const chunks = chunkWords(preShiftedWords, 15.0, 20.0);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0][0].start, 0.5, 'Should not subtract 15.0 again');
    assert.strictEqual(chunks[0][0].end, 1.0);
    assert.strictEqual(chunks[0][1].start, 1.0);
    assert.strictEqual(chunks[0][1].end, 1.8);
  });

  await t.test('5.5 Object parameter signature { start, end }', () => {
    const words = [{ word: 'ObjectSig', start: 12.0, end: 13.0 }];
    const chunks = chunkWords(words, { start: 10.0, end: 15.0 });
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0][0].start, 2.0);
    assert.strictEqual(chunks[0][0].end, 3.0);
  });

  await t.test('5.6 Strict monotonicity invariant: Dialogue start <= end and events monotonically ordered', () => {
    const words = [
      { word: 'One', start: 0.1, end: 0.3 },
      { word: 'two', start: 0.3, end: 0.6 },
      { word: 'three', start: 0.6, end: 0.9 },
      { word: 'four', start: 1.5, end: 1.8 },
      { word: 'five', start: 1.8, end: 2.2 },
    ];
    const ass = generateAssSubtitles(words, 0, 3.0);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert(dialogueLines.length > 0);

    let prevStartMs = -1;
    for (const line of dialogueLines) {
      const parts = line.split(',');
      const startStr = parts[1];
      const endStr = parts[2];

      const parseAssMs = (str) => {
        const [hms, cs] = str.split('.');
        const [h, m, s] = hms.split(':').map(Number);
        return ((h * 3600 + m * 60 + s) * 1000) + Number(cs) * 10;
      };

      const startMs = parseAssMs(startStr);
      const endMs = parseAssMs(endStr);

      assert(endMs >= startMs, `Event end ${endStr} must be >= start ${startStr}`);
      assert(startMs >= prevStartMs, `Event start ${startStr} must be >= previous event start`);
      prevStartMs = startMs;
    }
  });
});

// ============================================================================
// SUITE 6: Word-by-Word Active Highlighting (Karaoke / Pop Animation)
// ============================================================================
test('Challenger M2 - Suite 6: Word-by-Word Active Highlighting', async (t) => {
  await t.test('6.1 Emits discrete dialogue event for each word in chunk with active highlight', () => {
    const chunkWordsSample = [
      { word: 'THIS', start: 0.0, end: 0.4 },
      { word: 'IS', start: 0.4, end: 0.7 },
      { word: 'AWESOME', start: 0.7, end: 1.2 },
    ];
    const ass = generateAssSubtitles(chunkWordsSample, 0, 2.0, { preset: 'hormozi' });
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.strictEqual(dialogueLines.length, 3, 'Must emit 3 discrete dialogue lines for 3 words');

    // Event 1: THIS highlighted
    assert(dialogueLines[0].includes('{\\c&H0000E6FF&}THIS{\\c&H00FFFFFF&} IS AWESOME'));
    // Event 2: IS highlighted
    assert(dialogueLines[1].includes('THIS {\\c&H0000E6FF&}IS{\\c&H00FFFFFF&} AWESOME'));
    // Event 3: AWESOME highlighted
    assert(dialogueLines[2].includes('THIS IS {\\c&H0000E6FF&}AWESOME{\\c&H00FFFFFF&}'));
  });

  await t.test('6.2 Active word stays illuminated across micro-pauses until next word starts', () => {
    const microPauseWords = [
      { word: 'First', start: 0.0, end: 0.3 },
      // 100ms micro-pause
      { word: 'Second', start: 0.4, end: 0.8 },
    ];
    const ass = generateAssSubtitles(microPauseWords, 0, 1.5);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // First word ends at 0.4s (when Second starts), not at 0.3s
    const firstEvent = dialogueLines[0].split(',');
    assert.strictEqual(firstEvent[1], '0:00:00.00');
    assert.strictEqual(firstEvent[2], '0:00:00.40', 'First word must stay illuminated until second word starts');
  });

  await t.test('6.3 Minimum display duration threshold (>= 80ms)', () => {
    // Ultra-short word of 20ms
    const ultraShortWords = [{ word: 'Brief', start: 0.0, end: 0.02 }];
    const ass = generateAssSubtitles(ultraShortWords, 0, 1.0);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    const parts = dialogueLines[0].split(',');
    assert.strictEqual(parts[1], '0:00:00.00');
    // Math.max(0 + 0.08, 0.02) = 0.08 -> 0:00:00.08
    assert.strictEqual(parts[2], '0:00:00.08');
  });

  await t.test('6.4 Uppercase toggle behavior across presets and custom configs', () => {
    const words = [{ word: 'mixedCaseText', start: 0.0, end: 0.5 }];
    // Hormozi preset defaults uppercase: true
    const assHormozi = generateAssSubtitles(words, 0, 1.0, { preset: 'hormozi' });
    assert(assHormozi.includes('MIXEDCASETEXT'));

    // Clean minimal preset defaults uppercase: false
    const assMinimal = generateAssSubtitles(words, 0, 1.0, { preset: 'minimal' });
    assert(assMinimal.includes('mixedCaseText'));

    // Explicit override uppercase: false
    const assCustom = generateAssSubtitles(words, 0, 1.0, { preset: 'hormozi', uppercase: false });
    assert(assCustom.includes('mixedCaseText'));
  });
});

// ============================================================================
// SUITE 7: Extreme Adversarial Scenarios & Boundary Edge Cases
// ============================================================================
test('Challenger M2 - Suite 7: Extreme Adversarial Scenarios & Edge Cases', async (t) => {
  await t.test('7.1 Empty word list returns valid ASS structure without dialogue events', () => {
    const assEmptyArray = generateAssSubtitles([], 0, 10.0);
    assert(assEmptyArray.includes('[Script Info]'));
    assert(assEmptyArray.includes('PlayResX: 1080'));
    assert(assEmptyArray.includes('PlayResY: 1920'));
    assert(assEmptyArray.includes('[V4+ Styles]'));
    assert(assEmptyArray.includes('Style: Default'));
    assert(assEmptyArray.includes('[Events]'));
    assert(!assEmptyArray.includes('Dialogue:'));

    const assNull = generateAssSubtitles(null, 0, 10.0);
    assert(!assNull.includes('Dialogue:'));

    const assUndefined = generateAssSubtitles(undefined, 0, 10.0);
    assert(!assUndefined.includes('Dialogue:'));
  });

  await t.test('7.2 Single word transcript', () => {
    const singleWord = [{ word: 'Legendary', start: 1.0, end: 2.5 }];
    const ass = generateAssSubtitles(singleWord, 1.0, 3.0);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.strictEqual(dialogueLines.length, 1);
    assert(dialogueLines[0].includes('LEGENDARY'));
    const parts = dialogueLines[0].split(',');
    assert.strictEqual(parts[1], '0:00:00.00'); // relative to clipStart 1.0
    assert.strictEqual(parts[2], '0:00:01.50');
  });

  await t.test('7.3 Rapid fire speech (<100ms per word)', () => {
    const rapidSpeech = [
      { word: 'Quick', start: 0.00, end: 0.05 },
      { word: 'brown', start: 0.05, end: 0.10 },
      { word: 'fox', start: 0.10, end: 0.15 },
      { word: 'jumps', start: 0.15, end: 0.20 },
      { word: 'over', start: 0.20, end: 0.25 },
    ];
    const ass = generateAssSubtitles(rapidSpeech, 0, 1.0);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.strictEqual(dialogueLines.length, 5);
    for (const line of dialogueLines) {
      assert(!line.includes('NaN'), 'No NaN timestamps allowed');
    }
  });

  await t.test('7.4 Long conversational pauses (>1s, >5s, >20s)', () => {
    const longPauses = [
      { word: 'Hello', start: 0.0, end: 0.5 },
      // 5-second silence
      { word: 'Are', start: 5.5, end: 5.8 },
      { word: 'you', start: 5.8, end: 6.0 },
      { word: 'there?', start: 6.0, end: 6.5 },
      // 15-second silence
      { word: 'Goodbye.', start: 21.5, end: 22.0 },
    ];
    const ass = generateAssSubtitles(longPauses, 0, 30.0);
    const chunks = chunkWords(longPauses, 0, 30.0);
    assert.strictEqual(chunks.length, 3, 'Must create 3 isolated chunks for silence periods');

    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.strictEqual(dialogueLines.length, 5);

    // Event 1 ends at 0.5s
    const ev1 = dialogueLines[0].split(',');
    assert.strictEqual(ev1[2], '0:00:00.50');

    // Event 2 begins at 5.5s
    const ev2 = dialogueLines[1].split(',');
    assert.strictEqual(ev2[1], '0:00:05.50');

    // From 0.50s to 5.50s there is no dialogue event (subtitle clean gap)
  });

  await t.test('7.5 ASS syntax injection protection: braces stripped', () => {
    const injectedWords = [
      { word: 'Safe', start: 0.0, end: 0.4 },
      { word: '{injection}', start: 0.4, end: 0.8 },
      { word: '{\\b1}BoldHack{\\b0}', start: 0.8, end: 1.2 },
    ];
    const ass = generateAssSubtitles(injectedWords, 0, 2.0);
    // Curly braces must be stripped from word content so they don't break ASS tag parsing
    assert(!ass.includes('{injection}'), 'Raw curly braces should be stripped');
    assert(ass.includes('INJECTION'), 'Sanitized text should be preserved');
    assert(!ass.includes('{\\b1}'), 'Arbitrary injected tags inside words should be stripped');
  });

  await t.test('7.6 Commas, quotes, symbols, and Unicode Indonesian/English text', () => {
    const specialChars = [
      { word: '"Benar,', start: 0.0, end: 0.4 },
      { word: 'katanya!', start: 0.4, end: 0.8 },
      { word: 'Rp50.000', start: 0.8, end: 1.2 },
      { word: '&', start: 1.2, end: 1.4 },
      { word: '100%!', start: 1.4, end: 1.8 },
    ];
    const ass = generateAssSubtitles(specialChars, 0, 2.5);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert(dialogueLines.length > 0);

    for (const line of dialogueLines) {
      // In ASS Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      // Text is after 9 commas. Split by comma up to 9 times.
      const commaCount = (line.match(/,/g) || []).length;
      assert(commaCount >= 9, 'Dialogue line must have at least 9 commas for standard ASS format');
    }
  });

  await t.test('7.7 Custom styling overrides: font, colors, alignment, safe areas', () => {
    // Custom top alignment
    const assTop = generateAssSubtitles(
      [{ word: 'TopText', start: 0.0, end: 1.0 }],
      0,
      2.0,
      {
        fontFamily: 'Montserrat',
        fontSize: 92,
        primaryColor: '#00FF00',
        highlightColor: '#FF00FF',
        outlineColor: '#0000FF',
        outlineWidth: 7,
        shadow: 4,
        verticalAlignment: 'top',
      }
    );
    assert(assTop.includes('Style: Default,Montserrat,92,&H0000FF00&,&H0000FFFF&,&H00FF0000&,&H80000000&,-1,0,0,0,100,100,0,0,1,7,4,8,40,40,220,1'));
    assert(assTop.includes('{\\c&H00FF00FF&}TOPTEXT{\\c&H0000FF00&}'));

    // Custom center alignment
    const assCenter = generateAssSubtitles(
      [{ word: 'CenterText', start: 0.0, end: 1.0 }],
      0,
      2.0,
      {
        position: 'center',
        marginV: 50,
      }
    );
    assert(assCenter.includes(',5,40,40,50,1'), 'Center alignment 5 with custom marginV');

    // Custom bottom with custom marginV
    const assBottom = generateAssSubtitles(
      [{ word: 'BottomText', start: 0.0, end: 1.0 }],
      0,
      2.0,
      {
        verticalAlignment: 'bottom',
        marginV: 350,
      }
    );
    assert(assBottom.includes(',2,40,40,350,1'), 'Bottom alignment 2 with custom marginV 350');
  });
});

// ============================================================================
// SUITE 8: Cross-Platform FFmpeg Filter Construction (formatFfmpegSubFilter)
// ============================================================================
test('Challenger M2 - Suite 8: Cross-Platform FFmpeg Filter Construction', async (t) => {
  await t.test('8.1 Windows drive-letter colon escaping and forward slashes', () => {
    const winFilter = formatFfmpegSubFilter('C:\\Users\\User\\ClipAI\\temp\\subs.ass');
    assert.strictEqual(winFilter, "ass='C\\:/Users/User/ClipAI/temp/subs.ass'");
  });

  await t.test('8.2 Path with spaces handled inside single quotes', () => {
    const spaceFilter = formatFfmpegSubFilter('C:\\My Videos\\Project Files\\clip_1.ass');
    assert.strictEqual(spaceFilter, "ass='C\\:/My Videos/Project Files/clip_1.ass'");
  });

  await t.test('8.3 Empty and invalid input handling', () => {
    assert.strictEqual(formatFfmpegSubFilter(''), '');
    assert.strictEqual(formatFfmpegSubFilter(null), '');
    assert.strictEqual(formatFfmpegSubFilter(undefined), '');
  });
});

// ============================================================================
// SUITE 9: Empirical FFmpeg Burn-In & Libass Execution
// ============================================================================
test('Challenger M2 - Suite 9: Empirical FFmpeg Burn-In & Libass Execution', async (t) => {
  const tempDir = path.resolve('tests/fixtures/temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const sampleVideo = path.resolve('tests/fixtures/media/sample_dialogue_1080p.mp4');
  assert(fs.existsSync(sampleVideo), 'Sample dialogue media fixture must exist');

  await t.test('9.1 Real FFmpeg burn-in test across all 4 presets', () => {
    const presetsToTest = ['hormozi', 'mrbeast', 'cyber', 'minimal'];
    const testWords = [
      { word: 'Testing', start: 0.1, end: 0.5 },
      { word: 'viral', start: 0.5, end: 0.9 },
      { word: 'preset', start: 0.9, end: 1.4 },
    ];

    for (const preset of presetsToTest) {
      const assContent = generateAssSubtitles(testWords, 0, 2.0, { preset });
      const assPath = path.join(tempDir, `empirical_test_${preset}.ass`);
      const outPath = path.join(tempDir, `empirical_out_${preset}.mp4`);

      fs.writeFileSync(assPath, assContent, 'utf-8');

      try {
        const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        const vfFilter = `crop=w=607:h=1080:x=656:y=0,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,ass='${escapedAssPath}'`;

        // Execute FFmpeg with libass filter for 1.0 second duration
        execFileSync('ffmpeg', [
          '-y',
          '-ss', '0',
          '-i', sampleVideo,
          '-t', '1.0',
          '-vf', vfFilter,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-c:a', 'aac',
          outPath,
        ], { stdio: 'pipe' });

        assert(fs.existsSync(outPath), `Output video for preset ${preset} must be generated`);
        const stat = fs.statSync(outPath);
        assert(stat.size > 10000, `Output video for preset ${preset} must be non-empty (size: ${stat.size})`);
      } finally {
        if (fs.existsSync(assPath)) fs.unlinkSync(assPath);
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      }
    }
  });

  await t.test('9.2 Real FFmpeg burn-in with edge-case characters and rapid speech', () => {
    const adversarialWords = [
      { word: '“Look,', start: 0.1, end: 0.2 },
      { word: 'it’s', start: 0.2, end: 0.28 },
      { word: 'amazing!”', start: 0.28, end: 0.6 },
      { word: '$100', start: 0.6, end: 0.8 },
      { word: '&', start: 0.8, end: 0.9 },
      { word: '50%!', start: 0.9, end: 1.2 },
    ];

    const assContent = generateAssSubtitles(adversarialWords, 0, 1.5, { preset: 'hormozi' });
    const assPath = path.join(tempDir, 'empirical_adversarial.ass');
    const outPath = path.join(tempDir, 'empirical_adversarial.mp4');

    fs.writeFileSync(assPath, assContent, 'utf-8');

    try {
      const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      const vfFilter = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,ass='${escapedAssPath}'`;

      execFileSync('ffmpeg', [
        '-y',
        '-ss', '0',
        '-i', sampleVideo,
        '-t', '1.0',
        '-vf', vfFilter,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        outPath,
      ], { stdio: 'pipe' });

      assert(fs.existsSync(outPath), 'Adversarial output video must be generated');
      const stat = fs.statSync(outPath);
      assert(stat.size > 10000, 'Adversarial output video must be non-empty');
    } finally {
      if (fs.existsSync(assPath)) fs.unlinkSync(assPath);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
  });
});
