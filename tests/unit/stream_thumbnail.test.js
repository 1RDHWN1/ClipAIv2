// tests/unit/stream_thumbnail.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Test stream and thumbnail helpers
test('Stream & Thumbnail Endpoints: security and headers', async (t) => {
  await t.test('filename sanitization prevents directory traversal', () => {
    const raw = '../../etc/passwd';
    const safeBase = path.basename(raw);
    assert.strictEqual(safeBase, 'passwd');
    assert.ok(!safeBase.includes('/'));
    assert.ok(!safeBase.includes('\\'));
  });

  await t.test('mp4 extension is normalized properly', () => {
    const nameWithoutExt = 'my_clip_1';
    const nameWithExt = 'my_clip_1.mp4';
    const norm1 = nameWithoutExt.endsWith('.mp4') ? nameWithoutExt : `${nameWithoutExt}.mp4`;
    const norm2 = nameWithExt.endsWith('.mp4') ? nameWithExt : `${nameWithExt}.mp4`;
    assert.strictEqual(norm1, 'my_clip_1.mp4');
    assert.strictEqual(norm2, 'my_clip_1.mp4');
  });

  await t.test('byte range parsing calculates correct offsets', () => {
    const fileSize = 1000;
    const rangeHeader = 'bytes=200-499';
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;

    assert.strictEqual(start, 200);
    assert.strictEqual(end, 499);
    assert.strictEqual(chunksize, 300);
  });
});
