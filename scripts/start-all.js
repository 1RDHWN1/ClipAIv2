import { spawn } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const children = new Map();
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Singleton guard: prevent multiple `start-all.js` stacks from stacking up.
// Without this, repeated invocations spawn duplicate server+worker pairs that
// fight over the same BullMQ queue (double-processing) and leak Redis conns.
// ---------------------------------------------------------------------------
const LOCK_FILE = path.join(os.tmpdir(), 'clipaiv2-start-all.lock');

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const raw = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
    const existingPid = parseInt(raw, 10);

    if (Number.isInteger(existingPid) && existingPid !== process.pid && isProcessAlive(existingPid)) {
      console.error(
        `\n[lock] Another start-all.js instance is already running (PID ${existingPid}).\n` +
        `[lock] Refusing to start a duplicate stack. Stop it first, or remove ${LOCK_FILE} if it is stale.`
      );
      process.exit(1);
    }

    console.warn(`[lock] Removing stale lock file (PID ${raw} is not running).`);
    fs.unlinkSync(LOCK_FILE);
  }

  fs.writeFileSync(LOCK_FILE, String(process.pid), { mode: 0o644 });
  console.log(`[lock] Acquired singleton lock (PID ${process.pid}).`);
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
      if (parseInt(raw, 10) === process.pid) {
        fs.unlinkSync(LOCK_FILE);
        console.log('[lock] Released singleton lock.');
      }
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

console.log('Starting API server and video worker...');
startProcess('server', 'server.js');
startProcess('worker', 'workers/videoWorker.js');

process.on('SIGINT', () => { armHardExit(); shutdown(0); });
process.on('SIGTERM', () => { armHardExit(); shutdown(0); });
