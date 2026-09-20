import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIPPER_SRC = readFileSync(path.join(__dirname, '../../utils/clipper.js'), 'utf-8');

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// ---------------------------------------------------------------------------
// The bug this file exists for:
//
// With GPU (VAAPI) encoding, `format=nv12,hwupload` used to be appended AFTER
// the branding drawtext filter. hwupload hands the next filter `vaapi` surfaces
// and drawtext is a CPU-only filter, so ffmpeg died with
//     "Error : Filter not found"
// ...which cascaded into the CPU fallback and then a failed job. The whole
// render was lost. drawtext MUST therefore run before the upload.
// ---------------------------------------------------------------------------

test('GPU + branding: hwupload must be the final stage', async (t) => {
  await t.test('a CPU filter chained after hwupload is rejected with a clear error', async () => {
    const { buildBrandingFilters } = await import('../../utils/brandingOverlay.js');
    const cfg = { sourceChannel: 'X', watermarkText: '@me', showSource: true, showWatermark: true };
    const filters = buildBrandingFilters(cfg, { fontFile: FONT });
    assert.ok(filters.length > 0, 'precondition: branding produces filters');

    // Build the WRONG ordering on purpose and prove ffmpeg refuses it.
    const wrongGraph = `[0:v]scale=1080:1920,format=nv12,hwupload,${filters[0]}[vout]`;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-brand-'));
    const src = path.join(tmp, 'src.mp4');
    try {
      await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=1',
        '-pix_fmt', 'yuv420p', src,
      ], { timeout: 60000 });

      let failed = false;
      let message = '';
      try {
        await execFileAsync('ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-vaapi_device', '/dev/dri/renderD128',
          '-i', src,
          '-filter_complex', wrongGraph,
          '-map', '[vout]',
          '-c:v', 'h264_vaapi', '-f', 'null', '-',
        ], { timeout: 60000 });
      } catch (err) {
        failed = true;
        message = String(err.stderr || err.message || '');
      }

      // On a machine with no VAAPI device ffmpeg fails earlier for a different
      // reason; the ordering bug is only reproducible where GPU exists.
      const hasVaapi = fs.existsSync('/dev/dri/renderD128');
      if (!hasVaapi) {
        t.diagnostic('no /dev/dri/renderD128 — skipping the live repro');
        return;
      }

      assert.ok(failed, 'the wrong filter order must be rejected by ffmpeg');
      assert.ok(
        /filter not found|impossible to convert|invalid argument/i.test(message),
        `expected a filter/format error, got: ${message.slice(0, 200)}`
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('the correct order renders successfully with branding + GPU', async () => {
    if (!fs.existsSync('/dev/dri/renderD128')) {
      t.diagnostic('no /dev/dri/renderD128 — skipping');
      return;
    }

    const { buildBrandingFilters, resetFontCache } = await import('../../utils/brandingOverlay.js');
    // The shared font cache may have been invalidated by an earlier test.
    resetFontCache();
    const filters = buildBrandingFilters(
      { sourceChannel: 'X', watermarkText: '@me', showSource: true, showWatermark: true },
      { fontFile: FONT }
    );
    assert.ok(filters.length > 0, 'precondition: branding must produce at least one filter');

    // The RIGHT ordering: every CPU filter first, upload last.
    const rightGraph =
      `[0:v]scale=1080:1920:flags=lanczos,setsar=1,${filters.join(',')},format=nv12,hwupload[vout]`;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-brand-ok-'));
    const src = path.join(tmp, 'src.mp4');
    const out = path.join(tmp, 'out.mp4');
    try {
      await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=10:duration=1',
        '-pix_fmt', 'yuv420p', src,
      ], { timeout: 60000 });

      await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-vaapi_device', '/dev/dri/renderD128',
        '-i', src,
        '-filter_complex', rightGraph,
        '-map', '[vout]',
        '-c:v', 'h264_vaapi', '-rc_mode', 'CQP', '-qp', '18',
        '-profile:v', 'high', out,
      ], { timeout: 120000 });

      assert.ok(fs.existsSync(out), 'the correct order must produce a file');
      assert.ok(fs.statSync(out).size > 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('clipper asserts the upload is last (guard is wired in, not just defined)', () => {
    // Guard must be DEFINED...
    assert.ok(
      /function assertGpuUploadIsLast\s*\(/.test(CLIPPER_SRC),
      'assertGpuUploadIsLast must exist in clipper.js'
    );
    // ...and actually CALLED, once per ffmpeg invocation path.
    const calls = (CLIPPER_SRC.match(/assertGpuUploadIsLast\(/g) || []).length;
    assert.ok(
      calls >= 5,
      `expected the guard to be called on every path (definition + 4 call sites), found ${calls}`
    );
  });

  await t.test('branding is applied BEFORE the gpu upload in the vf path', () => {
    // The vf branch must order: build filter -> branding -> hwupload.
    const vfBranch = CLIPPER_SRC.slice(CLIPPER_SRC.indexOf('let vfFilter = buildVideoFilter'));
    const brandingIdx = vfBranch.indexOf('appendBrandingToVideoFilters');
    const uploadIdx = vfBranch.indexOf('format=nv12,hwupload');

    assert.ok(brandingIdx !== -1, 'vf path must apply branding');
    assert.ok(uploadIdx !== -1, 'vf path must upload for the GPU encoder');
    assert.ok(
      brandingIdx < uploadIdx,
      'drawtext must be chained BEFORE hwupload or ffmpeg fails with "Filter not found"'
    );
  });

  await t.test('every complexFilter path applies branding before uploading', () => {
    // Walk each `appendBrandingToGraph` call and confirm the following
    // hwupload (if any) comes after it in source order.
    const graphCalls = [...CLIPPER_SRC.matchAll(/appendBrandingToGraph\(/g)].map((m) => m.index);
    assert.ok(graphCalls.length >= 1, 'expected at least one graph branding call');

    for (const callIdx of graphCalls) {
      // Look at the next ~600 chars: the upload for that branch should appear
      // only AFTER the branding call, never before it.
      const before = CLIPPER_SRC.slice(Math.max(0, callIdx - 600), callIdx);
      assert.ok(
        !before.includes('format=nv12,hwupload'),
        'branding call must not sit after an hwupload in the same branch'
      );
    }
  });
});
