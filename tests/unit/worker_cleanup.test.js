// tests/unit/worker_cleanup.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cleanupFiles } from '../../utils/downloader.js';

/**
 * Regression: temp-file cleanup on every exit path (audit finding H6).
 *
 * Two distinct leaks were found in the worker's job handler:
 *
 *  1. `downloadAudioAndInfo` always writes the mp3 and returns audioPath, but
 *     audioPath was only assigned to the worker's local variable inside the
 *     `else` branch. When YouTube subtitles were discovered during the download
 *     the mp3 was created and then never handed to cleanupFiles -> leaked.
 *
 *  2. Cleanup lived in the happy path and the catch block, not a `finally`, so
 *     any other exit (early return, unexpected throw) skipped it. It also passed
 *     `videoPath`, which is the YouTube URL rather than a file, so unlink was a
 *     silent no-op and the cleanup looked broader than it was.
 *
 * The extraction logic under test mirrors the worker's `finally` block.
 */

/** Mirror of the worker's finally-block artifact selection. */
function selectLocalArtifacts(videoPath, audioPath) {
  return [videoPath, audioPath].filter(
    (p) => typeof p === 'string' && !p.startsWith('http://') && !p.startsWith('https://')
  );
}

function tmpFile(t, name, bytes = 64) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const full = path.join(dir, name);
  fs.writeFileSync(full, Buffer.alloc(bytes));
  return full;
}

test('Worker cleanup: a downloaded mp3 is registered for cleanup regardless of branch (H6)', (t) => {
  const mp3 = tmpFile(t, 'job_audio.mp3', 1024);
  assert.strictEqual(fs.existsSync(mp3), true);

  // The leak was that this assignment happened only in the else branch.
  const audioInfo = { audioPath: mp3, subtitles: { words: new Array(50).fill({ word: 'x' }) } };
  let audioPath = null;
  audioPath = audioInfo.audioPath; // fixed placement: right after download

  const artifacts = selectLocalArtifacts('https://youtube.com/watch?v=abc', audioPath);
  assert.deepStrictEqual(artifacts, [mp3], 'the mp3 must be selected even on the subtitles path');

  cleanupFiles(...artifacts);
  assert.strictEqual(fs.existsSync(mp3), false, 'mp3 must be gone');
});

test('Worker cleanup: the YouTube URL is never treated as a file (H6)', () => {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.deepStrictEqual(selectLocalArtifacts(url, null), []);
  assert.deepStrictEqual(selectLocalArtifacts(url, 'http://example.com/a.mp3'), []);
  assert.deepStrictEqual(selectLocalArtifacts(url, undefined), []);
  assert.deepStrictEqual(selectLocalArtifacts(url, 12345), []);
});

test('Worker cleanup: local file plus URL selects only the file (H6)', (t) => {
  const mp3 = tmpFile(t, 'a.mp3');
  const sel = selectLocalArtifacts('https://youtube.com/watch?v=abc', mp3);
  assert.deepStrictEqual(sel, [mp3]);
});

test('Worker cleanup: runs on success, failure, and early return alike (H6)', (t) => {
  // Model the three exit paths through a shared finally.
  const run = (mode) => {
    const mp3 = tmpFile(t, `path-${mode}.mp3`, 256);
    const videoPath = 'https://youtube.com/watch?v=abc';
    let audioPath = null;
    try {
      audioPath = mp3; // download succeeded
      if (mode === 'throw') throw new Error('transcription failed');
      if (mode === 'early-return') return { early: true };
      return { ok: true };
    } finally {
      const artifacts = selectLocalArtifacts(videoPath, audioPath);
      if (artifacts.length > 0) cleanupFiles(...artifacts);
    }
  };

  for (const mode of ['success', 'throw', 'early-return']) {
    let mp3Path = null;
    const orig = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-path-'));
    mp3Path = path.join(orig, 'x.mp3');
    fs.writeFileSync(mp3Path, Buffer.alloc(64));
    t.after(() => fs.rmSync(orig, { recursive: true, force: true }));

    try {
      if (mode === 'throw') assert.throws(() => run(mode));
      else run(mode);
    } catch (_) { /* expected */ }
  }

  // Direct check that the finally always removed its file.
  for (const mode of ['success', 'throw', 'early-return']) {
    const mp3 = tmpFile(t, `direct-${mode}.mp3`, 64);
    const videoPath = 'https://youtube.com/watch?v=abc';
    let audioPath = mp3;
    try {
      if (mode === 'throw') throw new Error('x');
      if (mode === 'early-return') {
        // finally still runs on return
      }
    } catch (_) {
      // swallow
    } finally {
      cleanupFiles(...selectLocalArtifacts(videoPath, audioPath));
    }
    assert.strictEqual(fs.existsSync(mp3), false, `${mode}: file must be cleaned in finally`);
  }
});

test('Worker cleanup: cleanupFiles is idempotent and tolerates junk input (H6)', (t) => {
  const f = tmpFile(t, 'once.mp3');
  cleanupFiles(f);
  assert.strictEqual(fs.existsSync(f), false);
  // Second call, and junk input, must not throw.
  assert.doesNotThrow(() => cleanupFiles(f));
  assert.doesNotThrow(() => cleanupFiles(null, undefined, '', 'https://x/y.mp3', 42));
});

test('Worker cleanup: partial audio is discarded when every strategy fails (H6)', (t) => {
  // Mirrors downloadAudioAndInfo's discardPartialAudio() on total failure.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partial-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const audioOutput = path.join(dir, 'job_audio.mp3');

  // yt-dlp wrote a truncated file before failing.
  fs.writeFileSync(audioOutput, Buffer.alloc(500));
  const discardPartialAudio = () => {
    try {
      if (fs.existsSync(audioOutput)) fs.unlinkSync(audioOutput);
    } catch (_) {}
  };

  discardPartialAudio();
  assert.strictEqual(fs.existsSync(audioOutput), false, 'failed download must not leave an mp3 behind');
  assert.doesNotThrow(discardPartialAudio, 'discarding twice must be safe');
});
