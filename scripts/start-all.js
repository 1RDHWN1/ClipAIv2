import { spawn, execSync } from 'child_process';
import net from 'node:net';
import path from 'node:path';
import * as singletonLock from '../utils/singletonLock.js';

const children = new Map();
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Singleton guard: prevent multiple `start-all.js` stacks from stacking up.
// Without this, repeated invocations spawn duplicate server+worker pairs that
// fight over the same BullMQ queue (double-processing) and leak Redis conns.
//
// Audit finding H4: acquisition now lives in utils/singletonLock.js, which uses
// an atomic `open(…, 'wx')` (O_CREAT|O_EXCL) create instead of the old
// check-then-write sequence that two simultaneous starters could both pass.
// ---------------------------------------------------------------------------
const { DEFAULT_LOCK_FILE, acquireSingletonLock, releaseSingletonLock } = singletonLock;

const LOCK_FILE = process.env.START_ALL_LOCK_FILE || DEFAULT_LOCK_FILE;

function acquireLock() {
  let result;
  try {
    result = acquireSingletonLock({ lockFile: LOCK_FILE });
  } catch (err) {
    // Unwritable temp dir, etc. — refuse rather than run without the guard.
    console.error(`\n[lock] Tidak bisa membuat lock file (${LOCK_FILE}): ${err.message}`);
    process.exit(1);
  }

  if (!result.acquired) {
    const holder = result.holderPid !== null ? `PID ${result.holderPid}` : 'proses lain';
    console.error(
      `\n[lock] Another start-all.js instance is already running (${holder}).\n` +
      `[lock] Refusing to start a duplicate stack. Stop it first, or remove ${LOCK_FILE} if it is stale.\n` +
      `[lock] Alasan: ${result.reason}`
    );
    process.exit(1);
  }

  if (result.reason === 'reclaimed-stale') {
    console.warn('[lock] Cleared a stale lock file (previous holder is not running).');
  }
  console.log(`[lock] Acquired singleton lock (PID ${process.pid}).`);
}

function releaseLock() {
  try {
    if (releaseSingletonLock({ lockFile: LOCK_FILE })) {
      console.log('[lock] Released singleton lock.');
    }
  } catch (_) {}
}

function startProcess(name, script) {
  const child = spawn(process.execPath, [script], {
    stdio: 'inherit',
    env: process.env,
  });

  let settled = false;

  child.on('exit', (code, signal) => {
    if (settled) return;
    settled = true;
    children.delete(name);

    // During an intentional shutdown we just let the shutdown() routine
    // finish its own bookkeeping.
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`\n[${name}] stopped with ${reason}`);

    // A child died unexpectedly. The server and worker are a coupled pair:
    // running the worker without the API (or vice-versa) leaves a half-alive
    // stack that silently accepts no requests. Tear everything down.
    if (code === 0) {
      // Clean exit — shut down the sibling too and exit 0.
      console.error(`[${name}] exited cleanly. Shutting down the stack.`);
      shutdown(0);
    } else {
      console.error(`[${name}] exited with a non-zero code. Shutting down the stack.`);
      shutdown(1);
    }
  });

  child.on('error', (err) => {
    if (settled) return;
    settled = true;

    console.error(`\n[${name}] failed to start: ${err.message}`);
    if (!shuttingDown) shutdown(1);
  });

  children.set(name, child);
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\nShutting down all processes...');

  // Send SIGTERM first, wait a bit, then SIGKILL
  for (const [name, child] of children) {
    if (!child.killed) {
      console.log(`[${name}] sending SIGTERM...`);
      child.kill('SIGTERM');
    }
  }

  // Wait for graceful shutdown (max 5 seconds)
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('Force killing remaining processes...');
      for (const [name, child] of children) {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }
      resolve();
    }, 5000);

    // Check if all children exited
    const checkInterval = setInterval(() => {
      if (children.size === 0) {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });

  releaseLock();
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
acquireLock();

// Always release the lock no matter how we exit.
process.on('exit', releaseLock);

// Failsafe: if a child ignores SIGTERM (or any handle keeps the event loop
// alive), force the whole stack down after a hard deadline. Without this the
// parent can linger forever holding the lock file.
const HARD_EXIT_MS = 10000;
function armHardExit() {
  const timer = setTimeout(() => {
    console.error(`\n[failsafe] Shutdown exceeded ${HARD_EXIT_MS}ms — forcing exit.`);
    for (const [, child] of children) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
    releaseLock();
    process.exit(1);
  }, HARD_EXIT_MS);
  timer.unref?.();
}

async function ensureRedis(port = 6379, host = '127.0.0.1') {
  const probe = () =>
    new Promise((resolve) => {
      const sock = net.createConnection({ port, host });
      sock.setTimeout(800);
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => {
        sock.destroy();
        resolve(false);
      });
      sock.once('timeout', () => {
        sock.destroy();
        resolve(false);
      });
    });

  if (await probe()) return true;

  console.log('[redis] ⚡ Redis belum aktif di port 6379, mencoba auto-start...');
  try {
    execSync('systemctl start redis-server 2>/dev/null || redis-server --daemonize yes 2>/dev/null || true', {
      stdio: 'ignore',
      timeout: 3000,
    });
  } catch (_) {}

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    if (await probe()) {
      console.log('[redis] ✅ Redis server berhasil dinyalakan otomatis.');
      return true;
    }
  }

  console.warn(
    '[redis] ⚠️ Gagal mengaktifkan Redis otomatis. Pastikan service Redis berjalan ("sudo systemctl start redis-server").'
  );
  return false;
}

await ensureRedis();

console.log('Starting API server and video worker...');
startProcess('server', 'server.js');
startProcess('worker', 'workers/videoWorker.js');

process.on('SIGINT', () => { armHardExit(); shutdown(0); });
process.on('SIGTERM', () => { armHardExit(); shutdown(0); });

// A closed terminal (or ssh drop / tmux detach) sends SIGHUP to the foreground
// process group. Killing the stack there would abandon a render the user was
// watching; ignore it and let the children keep working. Ctrl+C (SIGINT) and
// SIGTERM still shut everything down cleanly.
process.on('SIGHUP', () => {
  console.log('[lock] SIGHUP received (terminal closed?) — ignoring, stack keeps running.');
});
