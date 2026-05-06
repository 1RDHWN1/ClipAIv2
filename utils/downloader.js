// utils/downloader.js
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

const execAsync = promisify(exec);

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

/**
 * Download video YouTube menggunakan yt-dlp
 * @param {string} url - YouTube URL
 * @param {string} jobId - ID job untuk penamaan file
 * @returns {Promise<{videoPath: string, audioPath: string, title: string, duration: number}>}
 */
export async function downloadVideo(url, jobId) {
  const outputDir = path.resolve(UPLOAD_DIR);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const videoOutput = path.join(outputDir, `${jobId}_video.%(ext)s`);
  const audioOutput = path.join(outputDir, `${jobId}_audio.mp3`);

  // Download video (max 720p untuk hemat storage)
  console.log(`📥 Downloading video: ${url}`);
  const downloadCmd = `yt-dlp -f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]" --merge-output-format mp4 -o "${videoOutput}" "${url}" --no-playlist`;

  try {
    await execAsync(downloadCmd, { timeout: 300000 }); // timeout 5 menit
  } catch (err) {
    throw new Error(`Gagal download video: ${err.message}`);
  }

  // Cari file video yang sudah didownload
  const files = fs.readdirSync(outputDir).filter(f => f.startsWith(`${jobId}_video`));
  if (files.length === 0) throw new Error('File video tidak ditemukan setelah download');
  const videoPath = path.join(outputDir, files[0]);

  // Extract audio ke MP3 untuk transkripsi
  console.log(`🎵 Extracting audio...`);
  const audioCmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${audioOutput}" "${url}" --no-playlist`;
  await execAsync(audioCmd, { timeout: 180000 });

  // Ambil info video (title, durasi)
  const infoCmd = `yt-dlp --print "%(title)s|||%(duration)s" "${url}" --no-playlist`;
  const { stdout } = await execAsync(infoCmd);
  const [title, durationStr] = stdout.trim().split('|||');

  return {
    videoPath,
    audioPath: audioOutput,
    title: title || 'Unknown Video',
    duration: parseInt(durationStr) || 0,
  };
}

/**
 * Hapus file temporary setelah selesai
 */
export function cleanupFiles(...filePaths) {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
  }
}
