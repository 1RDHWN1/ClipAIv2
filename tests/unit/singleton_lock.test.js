// tests/unit/singleton_lock.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  acquireSingletonLock,
  releaseSingletonLock,
  tryCreateLock,
  readLockPid,
  isProcessAlive,
  lockAgeMs,
} from '../../utils/singletonLock.js';

/**
 * Regression: atomic singleton lock (audit finding H4).
 *
 * The previous guard was `existsSync -> readFileSync -> writeFileSync`. Because
 * those are three separate syscalls, two `npm start` invocations at the same
 * moment could both see "no lock" and both come up, giving two server+worker
 * pairs fighting over one BullMQ queue (double-processing jobs).
 *
 * It now uses an atomic `open(…, 'wx')`, plus a freshness grace period to close
 * a TOCTOU hole found when 12 processes were started in parallel: the first
 * created the lock but had not yet written its pid, so a second read an empty
 * file, called it stale, and took over.
 */

function tmpLock(t) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-')), 'x.lock');
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  return file;
}

test('Singleton lock: first caller acquires, second is refused (H4)', (t) => {
  const lock = tmpLock(t);

  const a = acquireSingletonLock({ lockFile: lock, pid: 11111, isAlive: () => true });
  assert.strictEqual(a.acquired, true);
  assert.strictEqual(a.reason, 'created');

  const b = acquireSingletonLock({ lockFile: lock, pid: 22222, isAlive: () => true });
  assert.strictEqual(b.acquired, false);
  assert.strictEqual(b.reason, 'held-by-live-process');
  assert.strictEqual(b.holderPid, 11111);
});

test('Singleton lock: atomic create returns false on the second attempt (H4)', (t) => {
  const lock = tmpLock(t);
  assert.strictEqual(tryCreateLock(lock, 1), true);
  assert.strictEqual(tryCreateLock(lock, 2), false);
  assert.strictEqual(readLockPid(lock), 1);
});

test('Singleton lock: a dead holder is reclaimed (H4)', (t) => {
  const lock = tmpLock(t);
  acquireSingletonLock({ lockFile: lock, pid: 99999, isAlive: () => false });
  assert.strictEqual(readLockPid(lock), 99999);

  // Backdate the file past the freshness grace so it is treated as stale.
  const old = (Date.now() - 60_000) / 1000;
  fs.utimesSync(lock, old, old);

  const again = acquireSingletonLock({ lockFile: lock, pid: 4242, isAlive: () => false });
  assert.strictEqual(again.acquired, true);
  assert.strictEqual(again.reason, 'reclaimed-stale');
  assert.strictEqual(readLockPid(lock), 4242);
});

test('Singleton lock: a fresh lock is never treated as stale (TOCTOU guard)', (t) => {
  const lock = tmpLock(t);
  // Simulate the exact race: file exists but is empty (pid not written yet).
  fs.writeFileSync(lock, '');

  const res = acquireSingletonLock({ lockFile: lock, pid: 7777, isAlive: () => false });

  assert.strictEqual(res.acquired, false, 'must not steal a lock that was just created');
  assert.strictEqual(res.reason, 'fresh-lock-race');
  assert.strictEqual(lockAgeMs(lock) < 2000, true);
});

test('Singleton lock: release only by the owning pid (H4)', (t) => {
  const lock = tmpLock(t);
  acquireSingletonLock({ lockFile: lock, pid: 5555, isAlive: () => true });

  assert.strictEqual(releaseSingletonLock({ lockFile: lock, pid: 1111 }), false, 'foreign pid must not release');
  assert.strictEqual(fs.existsSync(lock), true);

  assert.strictEqual(releaseSingletonLock({ lockFile: lock, pid: 5555 }), true);
  assert.strictEqual(fs.existsSync(lock), false);
});

test('Singleton lock: an absent lock file releases cleanly (H4)', (t) => {
  const lock = tmpLock(t);
  assert.strictEqual(releaseSingletonLock({ lockFile: lock, pid: 1 }), false);
});

test('Singleton lock: isProcessAlive detects this process and rejects garbage (H4)', () => {
  assert.strictEqual(isProcessAlive(process.pid), true);
  assert.strictEqual(isProcessAlive(0), false);
  assert.strictEqual(isProcessAlive(-1), false);
  assert.strictEqual(isProcessAlive('abc'), false);
  assert.strictEqual(isProcessAlive(null), false);
  // A pid far above any possible limit should not exist.
  assert.strictEqual(isProcessAlive(2 ** 30), false);
});

test('Singleton lock: 12 genuinely parallel processes yield exactly ONE winner (H4)', async (t) => {
  const lock = tmpLock(t);
  const script = path.join(path.dirname(lock), 'child.mjs');
  const moduleUrl = new URL('../../utils/singletonLock.js', import.meta.url).href;

  fs.writeFileSync(script, `
import { acquireSingletonLock } from ${JSON.stringify(moduleUrl)};
const r = acquireSingletonLock({ lockFile: ${JSON.stringify(lock)} });
process.stdout.write(r.acquired ? 'ACQUIRED' : 'REFUSED');
`);

  const { spawn } = await import('node:child_process');
  const runs = Array.from({ length: 12 }, () =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d.toString(); });
      p.on('close', () => resolve(out.trim()));
    })
  );

  const results = await Promise.all(runs);
  const winners = results.filter((r) => r === 'ACQUIRED');

  assert.strictEqual(winners.length, 1, `exactly one process must win, got ${winners.length} (${results.join(',')})`);
});
