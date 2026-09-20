// server.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import apiRouter from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(cors());

// Body parser dengan limit eksplisit. Default express adalah 100kb; kita beri
// ruang untuk transkrip yang ditempel manual tanpa membuka pintu ke payload
// raksasa (request gigabyte yang menghabiskan memori event loop).
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '512kb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '512kb' }));

// Static files: frontend dan output video
app.use(express.static(path.join(__dirname, 'public')));
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));

// ── API Routes ──────────────────────────────────────────────
app.use('/api', apiRouter);

// ── Health Check ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Video Clipper AI',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Catch all - serve frontend ──────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error', detail: err.message });
});

// ── Start server ─────────────────────────────────────────────
const httpServer = app.listen(PORT, () => {
  const activeModel =
    process.env.DEFAULT_MODEL || process.env.AI_MODEL || '(not configured — set DEFAULT_MODEL in .env)';
  const activeBaseUrl = process.env.AI_BASE_URL || 'http://localhost:20128/v1';
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  🎬 Video Clipper AI`);
  console.log(`  🌐 Server: http://localhost:${PORT}`);
  console.log(`  📁 Output dir: ${process.env.OUTPUT_DIR || './outputs'}`);
  console.log(`  🤖 AI Model: ${activeModel}`);
  console.log(`  🔌 AI Gateway: ${activeBaseUrl}`);
  console.log(`${'═'.repeat(50)}\n`);
  console.log(`  ▶️  Jalankan \`npm start\` untuk server + worker sekaligus`);
  console.log(`  🛠️  Jika server dijalankan sendiri, lanjutkan dengan: npm run worker\n`);
});

// ── Graceful shutdown ────────────────────────────────────────
// Stop accepting new connections, let in-flight requests drain, then exit.
// Without this the process ignores SIGTERM and the parent `start-all.js` is
// forced to SIGKILL it after its failsafe deadline.
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n[server] ${signal} received — closing HTTP server...`);

  httpServer.close(() => {
    console.log('[server] HTTP server closed gracefully.');
    process.exit(0);
  });

  // Safety net: if keep-alive connections prevent close() from resolving,
  // force the exit rather than hanging forever.
  const forceTimer = setTimeout(() => {
    console.error('[server] Forcing exit after 5s (lingering connections).');
    process.exit(1);
  }, 5000);
  forceTimer.unref?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── SIGHUP must NOT kill the stack ───────────────────────────
// POSIX delivers SIGHUP to a session's foreground process group when its
// controlling terminal goes away: closing the terminal window or tab, an ssh
// drop, or a tmux/screen detach. Node's DEFAULT disposition for SIGHUP is to
// terminate, which killed the API server mid-render and made the paired
// worker's parent (start-all.js) tear the whole stack down — the job the user
// was watching simply vanished.
//
// Ignoring it means `npm start` survives a terminal close and keeps serving;
// an explicit `kill -HUP <pid>` is the only way to reach this handler and it
// is deliberately a no-op. To stop the stack use SIGINT (Ctrl+C) or SIGTERM.
process.on('SIGHUP', () => {
  console.log('[server] SIGHUP received (terminal closed?) — ignoring, stack keeps running.');
});

// ── Listen error handling ────────────────────────────────────
// A raw EADDRINUSE dump is unhelpful and hides the real cause (usually a
// stale instance still holding :3000). Print an actionable message instead.
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n❌ Port ${PORT} sudah dipakai proses lain.\n` +
      `   Kemungkinan ada instance ClipAIv2 yang masih jalan.\n` +
      `   Cek dengan:  ss -tlnp | grep :${PORT}   atau   lsof -i :${PORT}\n` +
      `   Matikan dulu, lalu jalankan ulang.\n`
    );
  } else {
    console.error(`\n❌ HTTP server error: ${err.message}`);
  }
  process.exit(1);
});
