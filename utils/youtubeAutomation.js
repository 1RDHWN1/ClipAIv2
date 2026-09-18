// utils/youtubeAutomation.js
import { spawn } from 'child_process';
import path from 'path';
import { parseGeminiTranscript } from './geminiTranscriptParser.js';

/**
 * Menjalankan scripts/extract_youtube_transcript.py menggunakan Playwright & Camoufox.
 * Mencoba mengekstrak transkrip dari fitur 'Tanya' (Gemini) atau Panel Transkrip YouTube.
 *
 * @param {string} url - YouTube URL
 * @param {Object} [options={}]
 * @param {number} [options.timeout=45] - Batas waktu dalam detik
 * @param {number} [options.duration] - Total durasi video
 * @returns {Promise<Object|null>} UnifiedTranscript atau null jika tidak ditemukan
 */
export async function extractTranscriptViaBrowser(url, options = {}) {
  return new Promise((resolve) => {
    const scriptPath = path.resolve('scripts', 'extract_youtube_transcript.py');
    const pythonExe = process.env.FACE_TRACKING_PYTHON || 'python';

    console.log(`🌐 [Browser Otomasi] Mencoba ekstraksi transkrip otomatis via Camoufox untuk: ${url}...`);

    const child = spawn(pythonExe, [scriptPath, url], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: (options.timeout || 45) * 1000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      const line = data.toString().trim();
      if (line.startsWith('[Otomasi]')) {
        console.log(`   ${line}`);
      }
    });

    child.on('error', (err) => {
      console.warn(`⚠️ [Browser Otomasi] Gagal menjalankan Python: ${err.message}`);
      resolve(null);
    });

    child.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        console.warn(`⚠️ [Browser Otomasi] Browser selesai tanpa hasil (code ${code})`);
        return resolve(null);
      }

      try {
        const parsedJson = JSON.parse(stdout.trim());
        if (parsedJson.success && parsedJson.transcript) {
          console.log(`⚡ [Browser Otomasi] Berhasil mengekstrak transkrip dari sumber: ${parsedJson.source}!`);
          const unified = parseGeminiTranscript(parsedJson.transcript, {
            totalDuration: options.duration,
            language: options.language || 'auto',
          });
          return resolve(unified);
        }
      } catch (parseErr) {
        console.warn(`⚠️ [Browser Otomasi] Gagal parse JSON output: ${parseErr.message}`);
      }

      resolve(null);
    });
  });
}
