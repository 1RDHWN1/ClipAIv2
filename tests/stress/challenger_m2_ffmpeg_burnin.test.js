// tests/stress/challenger_m2_ffmpeg_burnin.test.js
/**
 * Empirical Challenger 2 Test Suite: FFmpeg Subtitle Burn-In Execution for ClipAIv2 (Milestone 2)
 *
 * Verification Requirements:
 * 1. Empirically test FFmpeg subtitle burn-in execution on Windows.
 * 2. Use video fixture (sample_standard_1080p.mp4) and verify FFmpeg processes the chained ASS filter without crashing.
 * 3. Verify output video is valid 9:16 (1080x1920) with non-zero size via ffprobe.
 * 4. Verify disabling subtitles (subtitleConfig.enabled = false) cleanly executes without the ass filter.
 * 5. Stress-test all presets, custom positions, special characters, paths with spaces, and resource cleanup.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { processClips } from '../../utils/clipper.js';
import {
  generateAssSubtitles,
  chunkWords,
  formatFfmpegSubFilter,
  hexToAssColor,
  VIRAL_PRESETS,
} from '../../utils/subtitleGenerator.js';

const FIXTURE_VIDEO = path.resolve('tests/fixtures/media/sample_standard_1080p.mp4');
const TEMP_BASE_DIR = path.resolve('tests/fixtures/temp/m2_challenger');

// Helper to probe media using ffprobe directly
function ffprobeMedia(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];
    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe failed (code ${code}): ${stderr}`));
      }
      try {
        const json = JSON.parse(stdout);
        const videoStream = json.streams?.find((s) => s.codec_type === 'video');
        const audioStream = json.streams?.find((s) => s.codec_type === 'audio');
        const duration = parseFloat(json.format?.duration || videoStream?.duration || 0);
        resolve({
          width: videoStream ? parseInt(videoStream.width, 10) : undefined,
          height: videoStream ? parseInt(videoStream.height, 10) : undefined,
          videoCodec: videoStream?.codec_name,
          audioCodec: audioStream?.codec_name,
          duration,
          size: parseInt(json.format?.size || '0', 10),
          format: json.format,
          videoStream,
          audioStream,
        });
      } catch (err) {
        reject(err);
      }
    });
    proc.on('error', reject);
  });
}

// Cleanup helper that retries on Windows file locking
function safeUnlink(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_) {
    // Retry once after a brief yield if EBUSY
    setTimeout(() => {
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    }, 100);
  }
}

test('Challenger 2 Suite: FFmpeg Burn-In Execution & Windows Filter Chaining', async (t) => {
  // Ensure fixture exists
  assert(fs.existsSync(FIXTURE_VIDEO), `Fixture video missing at ${FIXTURE_VIDEO}`);
  if (!fs.existsSync(TEMP_BASE_DIR)) {
    fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });
  }

  const sampleWords = [
    { word: 'Welcome', start: 0.2, end: 0.6 },
    { word: 'to', start: 0.6, end: 0.8 },
    { word: 'ClipAI', start: 0.8, end: 1.3 },
    { word: 'shorts', start: 1.3, end: 1.8 },
  ];

  await t.test('1. Subtitle Burn-In: Hormozi Yellow Preset renders valid 1080x1920 video', async () => {
    const jobId = `burnin_hormozi_${Date.now()}`;
    const clip = {
      start: 0.0,
      end: 2.0,
      title: 'Hormozi Test',
      words: sampleWords,
    };

    const results = await processClips(
      FIXTURE_VIDEO,
      [clip],
      jobId,
      '9:16',
      {
        subtitleConfig: {
          enabled: true,
          preset: 'hormozi',
        },
      }
    );

    assert.strictEqual(results.length, 1, 'Should output exactly 1 clip result');
    const outPath = results[0].outputPath;
    assert(fs.existsSync(outPath), `Rendered file must exist: ${outPath}`);

    const meta = await ffprobeMedia(outPath);
    assert.strictEqual(meta.width, 1080, `Width must be exactly 1080, got ${meta.width}`);
    assert.strictEqual(meta.height, 1920, `Height must be exactly 1920, got ${meta.height}`);
    assert(meta.size > 20000, `Video size must be non-zero (>20KB), got ${meta.size}`);
    assert(meta.duration >= 1.8, `Duration must be ~2s, got ${meta.duration}`);
    assert.strictEqual(meta.videoCodec, 'h264', `Video codec must be h264, got ${meta.videoCodec}`);
    assert.strictEqual(meta.audioCodec, 'aac', `Audio codec must be aac, got ${meta.audioCodec}`);

    // Verify temp .ass file was deleted
    const tempAss = path.join(path.dirname(outPath), `${jobId}_subs_1.ass`);
    assert(!fs.existsSync(tempAss), `Temporary .ass file must be removed: ${tempAss}`);

    safeUnlink(outPath);
  });

  await t.test('2. Subtitles Disabled (enabled = false): Renders cleanly without ASS filter', async () => {
    const jobId = `burnin_disabled_${Date.now()}`;
    const clip = {
      start: 0.0,
      end: 2.0,
      title: 'Disabled Subs Test',
      words: sampleWords,
    };

    const results = await processClips(
      FIXTURE_VIDEO,
      [clip],
      jobId,
      '9:16',
      {
        subtitleConfig: {
          enabled: false,
          preset: 'hormozi',
        },
      }
    );

    assert.strictEqual(results.length, 1);
    const outPath = results[0].outputPath;
    assert(fs.existsSync(outPath), `Rendered file must exist: ${outPath}`);

    const meta = await ffprobeMedia(outPath);
    assert.strictEqual(meta.width, 1080, `Width must be 1080, got ${meta.width}`);
    assert.strictEqual(meta.height, 1920, `Height must be 1920, got ${meta.height}`);
    assert(meta.size > 20000, `Video size must be non-zero, got ${meta.size}`);

    const tempAss = path.join(path.dirname(outPath), `${jobId}_subs_1.ass`);
    assert(!fs.existsSync(tempAss), 'No temp .ass file should ever be created');

    safeUnlink(outPath);
  });

  await t.test('3. Subtitles Omitted: Clean execution without ass filter when subtitleConfig is absent', async () => {
    const jobId = `burnin_omitted_${Date.now()}`;
    const clip = {
      start: 0.0,
      end: 1.5,
      title: 'Omitted Subs Test',
      words: sampleWords,
    };

    const results = await processClips(
      FIXTURE_VIDEO,
      [clip],
      jobId,
      '9:16',
      {} // subtitleConfig omitted
    );

    assert.strictEqual(results.length, 1);
    const outPath = results[0].outputPath;
    assert(fs.existsSync(outPath));

    const meta = await ffprobeMedia(outPath);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1920);

    safeUnlink(outPath);
  });

  await t.test('4. Subtitles Enabled with Zero Words: Clean fallback without error', async () => {
    const jobId = `burnin_zerowords_${Date.now()}`;
    const clip = {
      start: 0.0,
      end: 1.5,
      title: 'Zero Words Test',
      words: [],
    };

    const results = await processClips(
      FIXTURE_VIDEO,
      [clip],
      jobId,
      '9:16',
      {
        subtitleConfig: {
          enabled: true,
          preset: 'hormozi',
        },
        words: [],
      }
    );

    assert.strictEqual(results.length, 1);
    const outPath = results[0].outputPath;
    assert(fs.existsSync(outPath));

    const meta = await ffprobeMedia(outPath);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1920);

    safeUnlink(outPath);
  });

  await t.test('5. Preset Conformance: MrBeast Green, Cyber Cyan, and Clean Minimal', async () => {
    const presetsToTest = ['mrbeast', 'cyber', 'minimal'];

    for (const presetName of presetsToTest) {
      const jobId = `preset_${presetName}_${Date.now()}`;
      const clip = {
        start: 0.0,
        end: 1.5,
        title: `Preset ${presetName}`,
        words: sampleWords,
      };

      const results = await processClips(
        FIXTURE_VIDEO,
        [clip],
        jobId,
        '9:16',
        {
          subtitleConfig: {
            enabled: true,
            preset: presetName,
          },
        }
      );

      assert.strictEqual(results.length, 1, `Preset ${presetName} should succeed`);
      const outPath = results[0].outputPath;
      assert(fs.existsSync(outPath));

      const meta = await ffprobeMedia(outPath);
      assert.strictEqual(meta.width, 1080, `${presetName}: width 1080`);
      assert.strictEqual(meta.height, 1920, `${presetName}: height 1920`);
      assert(meta.size > 15000, `${presetName}: size > 15KB`);

      safeUnlink(outPath);
    }
  });

  await t.test('6. Custom Styling & Alignment: Top, Center, Custom Colors', async () => {
    // Custom top alignment
    const jobIdTop = `burnin_custom_top_${Date.now()}`;
    const clipTop = {
      start: 0.0,
      end: 1.5,
      title: 'Top Subs Test',
      words: sampleWords,
    };

    const resultsTop = await processClips(
      FIXTURE_VIDEO,
      [clipTop],
      jobIdTop,
      '9:16',
      {
        subtitleConfig: {
          enabled: true,
          verticalAlignment: 'top',
          primaryColor: '#00FFFF',
          highlightColor: '#FF00AA',
          fontSize: 90,
          outlineWidth: 6,
        },
      }
    );

    assert.strictEqual(resultsTop.length, 1);
    const outTop = resultsTop[0].outputPath;
    assert(fs.existsSync(outTop));
    const metaTop = await ffprobeMedia(outTop);
    assert.strictEqual(metaTop.width, 1080);
    assert.strictEqual(metaTop.height, 1920);
    safeUnlink(outTop);

    // Custom center alignment
    const jobIdCenter = `burnin_custom_center_${Date.now()}`;
    const clipCenter = {
      start: 0.0,
      end: 1.5,
      title: 'Center Subs Test',
      words: sampleWords,
    };

    const resultsCenter = await processClips(
      FIXTURE_VIDEO,
      [clipCenter],
      jobIdCenter,
      '9:16',
      {
        subtitleConfig: {
          enabled: true,
          verticalAlignment: 'center',
          fontSize: 70,
        },
      }
    );

    assert.strictEqual(resultsCenter.length, 1);
    const outCenter = resultsCenter[0].outputPath;
    assert(fs.existsSync(outCenter));
    const metaCenter = await ffprobeMedia(outCenter);
    assert.strictEqual(metaCenter.width, 1080);
    assert.strictEqual(metaCenter.height, 1920);
    safeUnlink(outCenter);
  });

  await t.test('7. Adversarial Dialogue: Special characters, braces, quotes, emojis, and punctuation', async () => {
    const adversarialWords = [
      { word: 'Hello!', start: 0.1, end: 0.4 },
      { word: '{hack_tag}', start: 0.4, end: 0.8 },
      { word: '"quote"', start: 0.8, end: 1.1 },
      { word: "it's", start: 1.1, end: 1.4 },
      { word: 'keren-banget!', start: 1.4, end: 1.8 },
    ];

    // Verify generateAssSubtitles neutralizes curly braces
    const rawAss = generateAssSubtitles(adversarialWords, 0, 2.0, { preset: 'hormozi' });
    assert(!rawAss.includes('{hack_tag}'), 'Braces inside words must be stripped to prevent broken ASS override tags');
    assert(rawAss.includes('HACK_TAG'), 'Word text itself is preserved in uppercase');

    const jobId = `burnin_adversarial_${Date.now()}`;
    const clip = {
      start: 0.0,
      end: 2.0,
      title: 'Adversarial Subtitle Words',
      words: adversarialWords,
    };

    const results = await processClips(
      FIXTURE_VIDEO,
      [clip],
      jobId,
      '9:16',
      {
        subtitleConfig: {
          enabled: true,
          preset: 'cyber',
        },
      }
    );

    assert.strictEqual(results.length, 1);
    const outPath = results[0].outputPath;
    assert(fs.existsSync(outPath));

    const meta = await ffprobeMedia(outPath);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1920);
    assert(meta.size > 20000);

    safeUnlink(outPath);
  });

  await t.test('8. Multi-Clip Batch: Concurrent clips receive independent .ass files and clean up cleanly', async () => {
    const jobId = `batch_multi_${Date.now()}`;
    const clips = [
      {
        start: 0.0,
        end: 1.5,
        title: 'Clip One',
        words: [
          { word: 'First', start: 0.2, end: 0.7 },
          { word: 'Clip', start: 0.7, end: 1.2 },
        ],
      },
      {
        start: 1.5,
        end: 3.0,
        title: 'Clip Two',
        words: [
          { word: 'Second', start: 1.7, end: 2.2 },
          { word: 'Clip', start: 2.2, end: 2.8 },
        ],
      },
    ];

    const results = await processClips(
      FIXTURE_VIDEO,
      clips,
      jobId,
      '9:16',
      {
        subtitleConfig: {
          enabled: true,
          preset: 'mrbeast',
        },
      }
    );

    assert.strictEqual(results.length, 2, 'Both clips should complete successfully');

    for (let i = 0; i < 2; i++) {
      const outPath = results[i].outputPath;
      assert(fs.existsSync(outPath), `Clip ${i + 1} output must exist`);
      const meta = await ffprobeMedia(outPath);
      assert.strictEqual(meta.width, 1080, `Clip ${i + 1} width 1080`);
      assert.strictEqual(meta.height, 1920, `Clip ${i + 1} height 1920`);

      const tempAss = path.join(path.dirname(outPath), `${jobId}_subs_${i + 1}.ass`);
      assert(!fs.existsSync(tempAss), `Clip ${i + 1} temporary .ass file must be removed`);
      safeUnlink(outPath);
    }
  });

  await t.test('9. Windows Path Escaping Formatter: Correct colon and backslash escaping', () => {
    // Windows absolute path
    const winPath = 'C:\\Users\\eniku\\Documents\\test\\subs.ass';
    const filter = formatFfmpegSubFilter(winPath);
    assert.strictEqual(filter, "ass='C\\:/Users/eniku/Documents/test/subs.ass'");

    // Path with spaces
    const winPathSpaces = 'C:\\My Projects\\Clip AI\\subs 1.ass';
    const filterSpaces = formatFfmpegSubFilter(winPathSpaces);
    assert.strictEqual(filterSpaces, "ass='C\\:/My Projects/Clip AI/subs 1.ass'");

    // Empty or null
    assert.strictEqual(formatFfmpegSubFilter(''), '');
    assert.strictEqual(formatFfmpegSubFilter(null), '');
  });

  await t.test('10. Non-Zero Clip Offset: Absolute timestamps shifted correctly to clip-relative ASS events', async () => {
    // Clip from 2.0s to 4.0s with absolute words between 2.2s and 3.8s
    const absoluteWords = [
      { word: 'Middle', start: 2.2, end: 2.7 },
      { word: 'of', start: 2.7, end: 3.0 },
      { word: 'the', start: 3.0, end: 3.3 },
      { word: 'video', start: 3.3, end: 3.8 },
    ];

    // Generate ASS directly to verify relative timestamps
    const ass = generateAssSubtitles(absoluteWords, 2.0, 4.0, { preset: 'hormozi' });
    assert(ass.includes('Dialogue: 0,0:00:00.20,'), 'First word must start at 0.20s relative to clip start');
    assert(ass.includes('MIDDLE'), 'Active highlight contains uppercase MIDDLE');

    const jobId = `burnin_offset_${Date.now()}`;
    const clip = {
      start: 2.0,
      end: 4.0,
      title: 'Offset Clip',
      words: absoluteWords,
    };

    const results = await processClips(
      FIXTURE_VIDEO,
      [clip],
      jobId,
      '9:16',
      {
        subtitleConfig: {
          enabled: true,
          preset: 'hormozi',
        },
      }
    );

    assert.strictEqual(results.length, 1);
    const outPath = results[0].outputPath;
    assert(fs.existsSync(outPath));

    const meta = await ffprobeMedia(outPath);
    assert.strictEqual(meta.width, 1080);
    assert.strictEqual(meta.height, 1920);
    assert(meta.duration >= 1.9);

    safeUnlink(outPath);
  });

  await t.test('11. Output Directory with Spaces: FFmpeg burn-in handles spaces in path', async () => {
    const spaceDir = path.resolve('tests/fixtures/temp/dir with spaces');
    if (!fs.existsSync(spaceDir)) fs.mkdirSync(spaceDir, { recursive: true });

    const prevOutputDir = process.env.OUTPUT_DIR;
    process.env.OUTPUT_DIR = spaceDir;

    try {
      const jobId = `space_path_${Date.now()}`;
      const clip = {
        start: 0.0,
        end: 1.5,
        title: 'Space Path Test',
        words: sampleWords,
      };

      const results = await processClips(
        FIXTURE_VIDEO,
        [clip],
        jobId,
        '9:16',
        {
          subtitleConfig: {
            enabled: true,
            preset: 'hormozi',
          },
        }
      );

      assert.strictEqual(results.length, 1);
      const outPath = results[0].outputPath;
      assert(fs.existsSync(outPath));
      assert(outPath.includes('dir with spaces'), 'Output path should be in directory with spaces');

      const meta = await ffprobeMedia(outPath);
      assert.strictEqual(meta.width, 1080);
      assert.strictEqual(meta.height, 1920);

      safeUnlink(outPath);
    } finally {
      process.env.OUTPUT_DIR = prevOutputDir || './outputs';
      try { fs.rmdirSync(spaceDir); } catch (_) {}
    }
  });
});

