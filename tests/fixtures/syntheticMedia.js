// tests/fixtures/syntheticMedia.js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Executes an external command asynchronously, returning stdout/stderr and exit code.
 * @param {string} cmd
 * @param {Array<string>} args
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function execAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const error = new Error(`Command "${cmd} ${args.join(' ')}" failed with code ${code}\n${stderr}`);
        error.code = code;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

/**
 * Creates a synthetic video file using FFmpeg testsrc and optional sine audio.
 * @param {Object} options
 * @param {string} options.outputPath - Destination file path
 * @param {number} [options.duration=5] - Duration in seconds
 * @param {number} [options.width=1920] - Video width
 * @param {number} [options.height=1080] - Video height
 * @param {number} [options.fps=30] - Frames per second
 * @param {boolean} [options.withAudio=true] - Include audio track
 * @returns {Promise<string>} Output path
 */
export async function createSyntheticVideo({
  outputPath,
  duration = 5,
  width = 1920,
  height = 1080,
  fps = 30,
  withAudio = true,
}) {
  const dir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const args = [
    '-y',
    '-hide_banner',
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `testsrc=duration=${duration}:size=${width}x${height}:rate=${fps}`,
  ];

  if (withAudio) {
    args.push(
      '-f', 'lavfi',
      '-i', `sine=frequency=1000:duration=${duration}`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest'
    );
  } else {
    args.push(
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p'
    );
  }

  args.push(outputPath);
  await execAsync('ffmpeg', args);
  return path.resolve(outputPath);
}

/**
 * Creates a synthetic 2-speaker video with visual targets on left and right sides.
 * Left speaker: blue box at x=380, y=440
 * Right speaker: red box at x=1340, y=440
 *
 * @param {Object} options
 * @param {string} options.outputPath
 * @param {number} [options.duration=6]
 * @param {number} [options.width=1920]
 * @param {number} [options.height=1080]
 * @returns {Promise<string>}
 */
export async function createTwoSpeakerVideo({
  outputPath,
  duration = 6,
  width = 1920,
  height = 1080,
}) {
  const dir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const vf = [
    `drawbox=x=380:y=440:w=200:h=200:color=blue:t=fill`,
    `drawbox=x=1340:y=440:w=200:h=200:color=red:t=fill`,
  ].join(',');

  const args = [
    '-y',
    '-hide_banner',
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `color=c=black:s=${width}x${height}:d=${duration}:r=30`,
    '-f', 'lavfi',
    '-i', `sine=frequency=800:duration=${duration}`,
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    outputPath,
  ];

  await execAsync('ffmpeg', args);
  return path.resolve(outputPath);
}

/**
 * Creates an audio file containing alternating tone bursts and silence gaps.
 * Useful for verifying dual-layer silence detection and boundary snapping.
 *
 * @param {Object} options
 * @param {string} options.outputPath
 * @param {number} [options.toneDuration=2.0] - Duration of each audible segment
 * @param {number} [options.silenceDuration=1.0] - Duration of each silent segment
 * @param {number} [options.cycles=2] - Number of [tone + silence] repetitions
 * @returns {Promise<string>}
 */
export async function createSyntheticAudioWithSilences({
  outputPath,
  toneDuration = 2.0,
  silenceDuration = 1.0,
  cycles = 2,
}) {
  const dir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Build filter graph: [tone][silence][tone][silence]...
  const filterInputs = [];
  const concatInputs = [];

  for (let c = 0; c < cycles; c++) {
    filterInputs.push(`sine=f=1000:d=${toneDuration}[a_tone_${c}]`);
    filterInputs.push(`anullsrc=r=44100:cl=mono,atrim=0:${silenceDuration}[a_sil_${c}]`);
    concatInputs.push(`[a_tone_${c}][a_sil_${c}]`);
  }

  const filterGraph = `${filterInputs.join(';')};${concatInputs.join('')}concat=n=${cycles * 2}:v=0:a=1[out]`;

  const args = [
    '-y',
    '-hide_banner',
    '-v', 'error',
    '-filter_complex', filterGraph,
    '-map', '[out]',
    '-c:a', 'pcm_s16le',
    outputPath,
  ];

  await execAsync('ffmpeg', args);
  return path.resolve(outputPath);
}

/**
 * Probes a media file using ffprobe and parses format and stream details.
 * @param {string} mediaPath
 * @returns {Promise<{ format: Object, streams: Array<Object>, videoStream?: Object, audioStream?: Object, width?: number, height?: number, duration: number }>}
 */
export async function probeMedia(mediaPath) {
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    mediaPath,
  ];

  const { stdout } = await execAsync('ffprobe', args);
  const data = JSON.parse(stdout);

  const videoStream = data.streams?.find((s) => s.codec_type === 'video');
  const audioStream = data.streams?.find((s) => s.codec_type === 'audio');
  const duration = parseFloat(data.format?.duration || videoStream?.duration || audioStream?.duration || 0);

  return {
    format: data.format,
    streams: data.streams,
    videoStream,
    audioStream,
    width: videoStream ? parseInt(videoStream.width, 10) : undefined,
    height: videoStream ? parseInt(videoStream.height, 10) : undefined,
    duration,
  };
}

/**
 * Safely removes a fixture file or directory.
 * @param {string} targetPath
 */
export function cleanupFixture(targetPath) {
  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  } catch (err) {
    // Ignore cleanup warnings
  }
}
