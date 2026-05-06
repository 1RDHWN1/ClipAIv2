import { spawn } from 'child_process';

const children = [];
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
    shutdown(code ?? 1);
  });

  child.on('error', (err) => {
    if (shuttingDown) return;

    console.error(`\n[${name}] failed to start: ${err.message}`);
    shutdown(1);
  });

  children.push(child);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(exitCode);
}

console.log('Starting API server and video worker...');
startProcess('server', 'server.js');
startProcess('worker', 'workers/videoWorker.js');

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
