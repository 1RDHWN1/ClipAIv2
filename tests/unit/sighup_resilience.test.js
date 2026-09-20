import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

/**
 * Regression guard for the "clip keputus di tengah jalan" bug.
 *
 * Symptom: running `npm start`, the stack died mid-render with a bare
 * `[server] SIGTERM received`, with no user action and no crash trace.
 *
 * Cause: closing the terminal window (or an ssh drop, a tmux/screen detach)
 * makes the kernel send SIGHUP to the session's foreground process group.
 * Node's DEFAULT disposition for SIGHUP is "terminate", so the API server died
 * with it, and because server + worker are a coupled pair `scripts/start-all.js`
 * tore the whole stack down — including the worker that was mid-render.
 *
 * Contract: every stack process must SURVIVE a SIGHUP. The live child is
 * spawned and signalled for real (a source-text assertion alone would pass on a
 * subtly mis-wired handler).
 */
test('SIGHUP resilience — a closed terminal must not kill the stack', async (t) => {
  const stackFiles = ['server.js', 'workers/videoWorker.js', 'scripts/start-all.js'];

  await t.test('Case 1: SIGHUP is handled as a no-op, never wired to a shutdown path', () => {
    for (const rel of stackFiles) {
      const source = readFileSync(path.join(repoRoot, rel), 'utf8');
      assert.match(source, /on\(\s*['"]SIGHUP['"]/, `${rel} must install a SIGHUP handler`);
      // The handler body must not be a shutdown call.
      assert.doesNotMatch(
        source,
        /on\(\s*['"]SIGHUP['"][\s\S]{0,80}?(armHardExit|gracefulShutdown)\s*\(/,
        `${rel} must not run a shutdown routine on SIGHUP`,
      );
    }
  });

  await t.test('Case 2: the API server survives a real SIGHUP', async () => {
    await assertSurvivesSighup('server.js');
  });

  await t.test('Case 3: the video worker survives a real SIGHUP', async () => {
    await assertSurvivesSighup('workers/videoWorker.js');
  });
});

/**
 * Spawn *script* on the real Node runtime, send it a genuine SIGHUP, and assert
 * it is still running afterwards. A process that exits during startup (no Redis,
 * port taken) fails loudly rather than passing vacuously.
 */
async function assertSurvivesSighup(script) {
  const testPort = String(3100 + Math.floor(Math.random() * 500));
  const child = spawn(process.execPath, [script], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: testPort },
  });

  let exited = false;
  let exitDetail = '';
  child.on('exit', (code, signal) => {
    exited = true;
    exitDetail = signal ? `signal ${signal}` : `code ${code}`;
  });

  // Give the process time to bind its ports / connect to Redis and install the
  // signal handlers before probing.
  await new Promise((resolve) => setTimeout(resolve, 2500));

  if (exited) {
    child.kill('SIGKILL');
    assert.fail(`${script} exited before the SIGHUP probe (${exitDetail})`);
  }

  child.kill('SIGHUP');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const survived = !exited;
  if (survived) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  if (!exited) child.kill('SIGKILL');

  assert.ok(survived, `${script} died on SIGHUP (${exitDetail})`);
}
