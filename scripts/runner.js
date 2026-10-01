#!/usr/bin/env node
// scripts/runner.js
//
// Cross-platform lifecycle runner for ClipAIv2:
// - On POSIX (Linux, macOS): delegates to daemon-wrapper.sh for true background daemonization.
// - On Windows: runs start-all.js / stop-all.js directly with Node runtime.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const action = process.argv[2] || 'start';

const isWindows = process.platform === 'win32';

if (!isWindows) {
  const daemonScript = path.join(__dirname, 'daemon-wrapper.sh');
  if (fs.existsSync(daemonScript)) {
    const child = spawn('bash', [daemonScript, action], {
      cwd: rootDir,
      stdio: 'inherit',
    });
    child.on('close', (code) => process.exit(code ?? 0));
  } else {
    runDirectly(action);
  }
} else {
  runDirectly(action);
}

function runDirectly(act) {
  if (act === 'start') {
    const child = spawn(process.execPath, [path.join(__dirname, 'start-all.js')], {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => process.exit(code ?? 0));
  } else if (act === 'stop') {
    const child = spawn(process.execPath, [path.join(__dirname, 'stop-all.js')], {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => process.exit(code ?? 0));
  } else if (act === 'restart') {
    console.log('🛑 [runner] Menghentikan ClipAIv2...');
    const stopChild = spawn(process.execPath, [path.join(__dirname, 'stop-all.js')], {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    });
    stopChild.on('close', () => {
      console.log('🚀 [runner] Memulai ulang ClipAIv2...');
      const startChild = spawn(process.execPath, [path.join(__dirname, 'start-all.js')], {
        cwd: rootDir,
        stdio: 'inherit',
        env: process.env,
      });
      startChild.on('close', (code) => process.exit(code ?? 0));
    });
  } else if (act === 'status') {
    import('../utils/singletonLock.js').then(({ lockAgeMs, readLockPid, isProcessAlive, DEFAULT_LOCK_FILE }) => {
      const lockFile = process.env.START_ALL_LOCK_FILE || DEFAULT_LOCK_FILE;
      const pid = readLockPid(lockFile);
      if (pid && isProcessAlive(pid)) {
        console.log(`✅ ClipAIv2 aktif berjalan (PID ${pid}, lock age: ${Math.round((lockAgeMs(lockFile) || 0) / 1000)}s)`);
      } else {
        console.log(`ℹ️  ClipAIv2 tidak sedang berjalan.`);
      }
    }).catch((err) => {
      console.error(`Status check failed: ${err.message}`);
    });
  } else {
    console.error(`Unknown action: ${act}. Expected: start, stop, restart, status`);
    process.exit(1);
  }
}
