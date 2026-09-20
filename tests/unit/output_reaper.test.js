// tests/unit/output_reaper.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { reapOutputs, deleteJobOutputs, _internal } from '../../utils/outputReaper.js';

/**
 * Regression: output lifecycle management (audit finding H7).
 *
 * `removeOnComplete` on the BullMQ queue prunes Redis JOB METADATA only; it never
 * touched the rendered .mp4 files. Nothing else deleted them either, so
 * outputs/ grew unbounded (observed 501 MB / 47 files, zero retention policy),
 * which eventually fills the disk on a small VPS.
 *
 * These tests drive reapOutputs()/deleteJobOutputs() against an isolated temp
 * directory with controlled mtimes. OUTPUT_DIR is set per-test.
 */

const MIN = 60_000;
const HOUR = 3_600_000;

function makeDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-test-'));
  const prev = process.env.OUTPUT_DIR;
  process.env.OUTPUT_DIR = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.OUTPUT_DIR;
    else process.env.OUTPUT_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** Create a file of `size` bytes whose mtime is `ageMs` in the past. */
function touch(dir, name, size, ageMs, now = Date.now()) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, Buffer.alloc(size));
  const t = (now - ageMs) / 1000;
  fs.utimesSync(full, t, t);
  return full;
}

const listing = (dir) => fs.readdirSync(dir).sort();

test('Output reaper: temp artifacts are removed once past the min age (H7)', async (t) => {
  const dir = makeDir(t);
  touch(dir, 'jobA_subs_1.ass', 500, 30 * MIN);
  touch(dir, 'jobA_temp_sec_1.mp4', 2_000, 30 * MIN);
  touch(dir, 'jobA_clip1_Kept.mp4', 1_000, 2 * MIN);

  const res = reapOutputs({ minAgeMs: 10 * MIN, ttlMs: 24 * HOUR });

  assert.deepStrictEqual(res.deleted.sort(), ['jobA_subs_1.ass', 'jobA_temp_sec_1.mp4']);
  assert.deepStrictEqual(listing(dir), ['jobA_clip1_Kept.mp4']);
  assert.strictEqual(res.freedBytes, 2_500);
});

test('Output reaper: clips past the TTL are removed (H7)', async (t) => {
  const dir = makeDir(t);
  touch(dir, 'jobOld_clip1_Gone.mp4', 5_000, 30 * HOUR);
  touch(dir, 'jobNew_clip1_Stay.mp4', 1_000, 1 * HOUR);

  reapOutputs({ ttlMs: 24 * HOUR, minAgeMs: 10 * MIN });

  assert.deepStrictEqual(listing(dir), ['jobNew_clip1_Stay.mp4']);
});

test('Output reaper: never touches files it did not create (H7)', async (t) => {
  const dir = makeDir(t);
  touch(dir, 'README.txt', 100, 100 * HOUR);
  touch(dir, 'notes.md', 100, 100 * HOUR);
  touch(dir, 'user_upload.mp4', 100, 100 * HOUR); // .mp4 but no _clip<N>_ shape

  const res = reapOutputs({ ttlMs: 1 * HOUR, minAgeMs: 1 * MIN });

  assert.strictEqual(res.deleted.length, 0);
  assert.deepStrictEqual(listing(dir), ['README.txt', 'notes.md', 'user_upload.mp4']);
});

test('Output reaper: respects minAgeMs even for temp artifacts (H7)', async (t) => {
  const dir = makeDir(t);
  // A job that is still running may have just written these.
  touch(dir, 'jobLive_subs_1.ass', 500, 30_000); // 30s old
  touch(dir, 'jobLive_temp_sec_1.mp4', 500, 30_000);

  const res = reapOutputs({ minAgeMs: 10 * MIN });

  assert.strictEqual(res.deleted.length, 0);
  assert.strictEqual(listing(dir).length, 2);
});

test('Output reaper: prunes oldest clips when over the size budget (H7)', async (t) => {
  const dir = makeDir(t);
  // Five 1 MB clips, all young enough to survive TTL, total 5 MB vs a 3 MB budget.
  // NOTE: age increases with the index, so job4 is the OLDEST and job0 the
  // NEWEST — the reaper must delete oldest-first.
  for (let i = 0; i < 5; i++) {
    touch(dir, `job${i}_clip1_X.mp4`, 1_000_000, (10 + i) * MIN);
  }

  const res = reapOutputs({ ttlMs: 999 * HOUR, maxTotalBytes: 3_000_000, minAgeMs: 5 * MIN });

  assert.strictEqual(res.deleted.length, 2, 'must delete exactly enough to fit the budget');
  assert.strictEqual(listing(dir).length, 3);
  // The two oldest (job4, job3) are the ones that must go.
  assert.deepStrictEqual(res.deleted.sort(), ['job3_clip1_X.mp4', 'job4_clip1_X.mp4']);
  assert.deepStrictEqual(listing(dir), ['job0_clip1_X.mp4', 'job1_clip1_X.mp4', 'job2_clip1_X.mp4']);
});

test('Output reaper: size pruning never violates minAgeMs (H7)', async (t) => {
  const dir = makeDir(t);
  // Over budget, but everything is fresher than minAgeMs.
  for (let i = 0; i < 4; i++) touch(dir, `job${i}_clip1_X.mp4`, 1_000_000, 60_000);

  const res = reapOutputs({ ttlMs: 999 * HOUR, maxTotalBytes: 1, minAgeMs: 10 * MIN });

  assert.strictEqual(res.deleted.length, 0, 'must not delete active-looking files to hit a budget');
  assert.strictEqual(listing(dir).length, 4);
});

test('Output reaper: dryRun reports without deleting (H7)', async (t) => {
  const dir = makeDir(t);
  touch(dir, 'jobOld_clip1_X.mp4', 5_000, 30 * HOUR);
  touch(dir, 'jobOld_subs_1.ass', 500, 30 * MIN);

  const res = reapOutputs({ dryRun: true, ttlMs: 24 * HOUR, minAgeMs: 10 * MIN });

  assert.strictEqual(res.deleted.length, 2, 'dry run must still report what it would remove');
  assert.strictEqual(res.freedBytes, 5_500);
  assert.strictEqual(listing(dir).length, 2, 'nothing may actually be deleted');
});

test('Output reaper: missing directory is safe (H7)', async (t) => {
  const dir = path.join(os.tmpdir(), `reap-missing-${Date.now()}-${Math.random()}`);
  const prev = process.env.OUTPUT_DIR;
  process.env.OUTPUT_DIR = dir;
  t.after(() => { process.env.OUTPUT_DIR = prev; });

  const res = reapOutputs();
  assert.deepStrictEqual(res.deleted, []);
  assert.strictEqual(res.freedBytes, 0);
});

test('Output reaper: deleteJobOutputs targets exactly one job (H7)', async (t) => {
  const dir = makeDir(t);
  touch(dir, 'aaa111_clip1_A.mp4', 100, MIN);
  touch(dir, 'aaa111_subs_1.ass', 50, MIN);
  touch(dir, 'bbb222_clip1_B.mp4', 100, MIN);

  const res = deleteJobOutputs('aaa111');

  assert.deepStrictEqual(res.deleted.sort(), ['aaa111_clip1_A.mp4', 'aaa111_subs_1.ass']);
  assert.strictEqual(res.freedBytes, 150);
  assert.deepStrictEqual(listing(dir), ['bbb222_clip1_B.mp4']);
});

test('Output reaper: deleteJobOutputs refuses traversal-shaped ids (H7)', async (t) => {
  const dir = makeDir(t);
  touch(dir, 'aaa111_clip1_A.mp4', 100, MIN);

  for (const bad of ['../etc', '..', 'a/b', 'a\\b', '', 'ab', 'x'.repeat(200), 'has space', 'id*glob']) {
    const res = deleteJobOutputs(bad);
    assert.deepStrictEqual(res.deleted, [], `id ${JSON.stringify(bad)} must not match anything`);
  }
  assert.strictEqual(listing(dir).length, 1, 'no file may be removed by an invalid id');
});

test('Output reaper: deleteJobOutputs ignores non-string input (H7)', async (t) => {
  makeDir(t);
  for (const bad of [null, undefined, 123, {}, [], true]) {
    const res = deleteJobOutputs(bad);
    assert.deepStrictEqual(res.deleted, []);
  }
});

test('Output reaper: filename patterns match only intended artifacts (H7)', async (t) => {
  const { FINAL_CLIP_RE, TEMP_ARTIFACT_RE } = _internal;

  for (const name of ['abc123_clip1_My_Title.mp4', 'abc123_clip12_x.mp4']) {
    assert.ok(FINAL_CLIP_RE.test(name), `${name} should be a final clip`);
  }
  for (const name of ['abc123_subs_2.ass', 'abc123_temp_sec_3.mp4', 'abc123_sub.en.json3']) {
    assert.ok(TEMP_ARTIFACT_RE.test(name), `${name} should be a temp artifact`);
  }
  for (const name of ['abc123_clip1_x.txt', 'random.mp4', 'abc123.mp4', 'keep.ass']) {
    assert.ok(!FINAL_CLIP_RE.test(name) && !TEMP_ARTIFACT_RE.test(name), `${name} must not match`);
  }
});
