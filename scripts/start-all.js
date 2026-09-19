import { spawn } from 'child_process';

const children = new Map();
let shuttingDown = false;

function startProcess(name, script) {
  const child = spawn(process.execPath, [script], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`\n[${name}] stopped with ${reason}`);

    // Only shutdown if the OTHER process also died, or if this was unexpected
    children.delete(name);
    if (children.size === 0) {
      console.error(`\nAll processes exited. Shutting down.`);
      process.exit(code ?? 1);
    }
  });

  child.on('error', (err) => {
    if (shuttingDown) return;

    console.error(`\n[${name}] failed to start: ${err.message}`);
    shutdown(1);
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

  process.exit(exitCode);
}

console.log('Starting API server and video worker...');
startProcess('server', 'server.js');
startProcess('worker', 'workers/videoWorker.js');

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Handle child exit to clean up map
for (const [name, child] of children) {
  child.on('exit', () => children.delete(name));
}
