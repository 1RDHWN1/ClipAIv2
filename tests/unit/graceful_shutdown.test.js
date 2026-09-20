import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const readSource = (rel) => readFileSync(path.join(ROOT, rel), 'utf-8');

/**
 * Strip comments so assertions test CODE, not the prose that documents it.
 * Without this, a comment explaining the old bug (e.g. quoting `child.killed`)
 * would trip a "must not contain" assertion.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (keeps `https://`)
}

// ---------------------------------------------------------------------------
// start-all.js: the shutdown supervisor
//
// The original bug: Ctrl+C appeared to do nothing. `child.killed` is only true
// after WE send a signal, so a child that had already exited on its own was
// still treated as alive; the exit handler also skipped `children.delete()`
// during shutdown, so `children.size === 0` never became true and the parent
// always burned the full grace window before exiting.
// ---------------------------------------------------------------------------

test('Shutdown supervisor: liveness and signal handling', async (t) => {
  const src = stripComments(readSource('scripts/start-all.js'));

  await t.test('tracks child liveness via exitCode/signalCode, not the killed flag', () => {
    assert.ok(
      /function isChildAlive\(child\)/.test(src),
      'a dedicated liveness helper must exist'
    );
    assert.ok(
      /child\.exitCode === null && child\.signalCode === null/.test(src),
      'liveness must consult exitCode/signalCode — the authoritative termination signal'
    );
    // A bare `if (!child.killed)` guard is the defect: it skips children that
    // self-terminated and tries to signal ones that ignored us.
    const guardUses = src.match(/if \(!child\.killed\)/g) || [];
    assert.strictEqual(guardUses.length, 0, 'no shutdown path may gate on child.killed');
  });

  await t.test('always drops a child from the live set on exit', () => {
    // The delete must happen BEFORE the shutdown early-return, otherwise a
    // child that exits during shutdown lingers in the map forever.
    const exitHandler = src.slice(
      src.indexOf("child.on('exit'"),
      src.indexOf("child.on('error'")
    );
    const deleteIdx = exitHandler.indexOf('children.delete(name)');
    const earlyReturnIdx = exitHandler.indexOf('if (shuttingDown) return');
    assert.ok(deleteIdx > -1, 'the exit handler must delete the child');
    assert.ok(
      deleteIdx < earlyReturnIdx,
      'children.delete() must run before the shuttingDown early-return'
    );
  });

  await t.test('waits on real liveness with a bounded grace window', () => {
    assert.ok(/SHUTDOWN_GRACE_MS/.test(src), 'grace window must be a named constant');
    assert.ok(
      /live\.every\(\(child\) => !isChildAlive\(child\)\)/.test(src),
      'the wait loop must poll actual liveness'
    );
    // Waiting on `children.size === 0` was the hang.
    assert.ok(
      !/children\.size === 0/.test(src),
      'must not wait on the map size — it never reached 0 during shutdown'
    );
  });

  await t.test('escalates to SIGKILL only for processes that ignored SIGTERM', () => {
    assert.ok(/const stubborn = live\.filter\(isChildAlive\)/.test(src));
    assert.ok(/child\.kill\('SIGKILL'\)/.test(src));
  });

  await t.test('Ctrl+C and SIGTERM both route through shutdown()', () => {
    assert.ok(/process\.on\('SIGINT', \(\) => \{ armHardExit\(\); shutdown\(0\); \}\)/.test(src));
    assert.ok(/process\.on\('SIGTERM', \(\) => \{ armHardExit\(\); shutdown\(0\); \}\)/.test(src));
  });

  await t.test('SIGHUP stays ignored so a closed terminal does not kill the stack', () => {
    assert.ok(/process\.on\('SIGHUP'/.test(src));
    assert.ok(/SIGHUP[^\n]*ignoring/.test(src));
  });
});

// ---------------------------------------------------------------------------
// downloader.js: orphan prevention
// ---------------------------------------------------------------------------

test('Shutdown supervisor: media tool orphan prevention', async (t) => {
  const src = stripComments(readSource('utils/downloader.js'));

  await t.test('every yt-dlp invocation goes through the tracking wrapper', () => {
    const direct = src.match(/execFileAsync\(YTDLP_BIN/g) || [];
    assert.strictEqual(direct.length, 0, 'no call may bypass the tracked wrapper');
    assert.ok((src.match(/runTool\(YTDLP_BIN/g) || []).length > 0);
  });

  await t.test('tools run in their own process group so descendants can be reaped', () => {
    assert.ok(
      /detached: true/.test(src),
      'yt-dlp must get its own process group (it spawns its own ffmpeg)'
    );
    assert.ok(/process\.kill\(-pid, 'SIGKILL'\)/.test(src), 'must kill the whole group');
  });

  await t.test('SIGKILLing a tool mid-write cannot crash us with EPIPE', () => {
    assert.ok(/function ignoreStreamError\(/.test(src));
    assert.ok((src.match(/ignoreStreamError\(child\./g) || []).length >= 3,
      'stdin/stdout/stderr must all be guarded');
  });

  await t.test('exposes a shutdown flag and a reaper for the worker to call', () => {
    assert.ok(/export function killActiveToolChildren\(/.test(src));
    assert.ok(/export function beginShutdown\(/.test(src));
  });

  await t.test('retry loops ABORT during shutdown instead of respawning tools', () => {
    // Each `for (…strategies…)` loop needs the guard, otherwise killing the
    // download makes the catch block fall through and spawn a fresh one.
    const guards = src.match(/if \(shuttingDown\) \{\s*throw new Error\('Shutdown in progress/g) || [];
    assert.ok(
      guards.length >= 4,
      `every retry loop needs a shutdown abort (found ${guards.length}, need >= 4)`
    );
  });
});

// ---------------------------------------------------------------------------
// videoWorker.js: ordering of the shutdown sequence
// ---------------------------------------------------------------------------

test('Shutdown supervisor: worker teardown order', async (t) => {
  const src = stripComments(readSource('workers/videoWorker.js'));

  await t.test('flags the shutdown before killing tools', () => {
    const body = src.slice(src.indexOf('async function gracefulShutdown'));
    const flagIdx = body.indexOf('beginShutdown()');
    const killIdx = body.indexOf('killActiveToolChildren()');
    assert.ok(flagIdx > -1, 'beginShutdown() must be called');
    assert.ok(killIdx > -1, 'killActiveToolChildren() must be called');
    assert.ok(
      flagIdx < killIdx,
      'the flag must be set first, or a killed download retries and respawns'
    );
  });

  await t.test('reaps tools BEFORE draining the queue', () => {
    const body = src.slice(src.indexOf('async function gracefulShutdown'));
    const killIdx = body.indexOf('killActiveToolChildren()');
    const closeIdx = body.indexOf('await worker.close()');
    assert.ok(
      killIdx < closeIdx,
      'worker.close() waits for the running job, so tools must die first'
    );
  });

  await t.test('worker still exits explicitly so the process cannot linger', () => {
    assert.ok(/finally \{\s*process\.exit\(0\)/.test(src));
  });
});
