// utils/outputReaper.js
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

/**
 * Output lifecycle management (audit finding H7).
 *
 * Why this exists: `removeOnComplete` on the BullMQ queue only removes JOB
 * METADATA from Redis — it never touches the rendered .mp4 files. Nothing else
 * deleted them either, so `outputs/` grew without bound (observed: 501 MB / 47
 * files with no retention policy at all). On a small VPS this eventually fills
 * the disk and the whole pipeline dies.
 *
 * This module provides:
 *   - reapOutputs()      age-based + size-based pruning of rendered clips
 *   - deleteJobOutputs() targeted removal for a single job (used by the API)
 *   - startOutputReaper() interval scheduler for the worker process
 *
 * Safety rules:
 *   - Never delete files modified within `minAgeMs` (a job may still be writing).
 *   - Only delete files matching the expected clip/temp filename shapes; an
 *     unrelated file dropped into outputs/ is left alone.
 */

const OUTPUT_DIR = () => path.resolve(process.env.OUTPUT_DIR || './outputs');

// Artifacts this pipeline creates inside OUTPUT_DIR.
//   <jobId>_clip<N>_<title>.mp4     final rendered clip (kept, subject to TTL)
//   <jobId>_subs_<N>.ass            intermediate subtitle file (always disposable)
//   <jobId>_temp_sec_<N>.mp4        intermediate downloaded section (always disposable)
//   <jobId>_sub.<lang>.json3        youtube subtitle JSON (lives in UPLOAD_DIR)
const FINAL_CLIP_RE = /_clip\d+_.*\.mp4$/i;
const TEMP_ARTIFACT_RE = /_(subs_\d+\.ass|temp_sec_\d+\.mp4|sub\..*\.json3)$/i;

/**
 * @typedef {Object} ReapOptions
 * @property {number} [ttlMs]        max age for a finished clip (default 24h)
 * @property {number} [maxTotalBytes] total budget for outputs/ (default 5 GiB)
 * @property {number} [minAgeMs]     never touch anything younger than this (default 10 min)
 * @property {boolean} [dryRun]      report what would happen without deleting
 * @property {number} [now]          injectable clock (tests)
 */

/**
 * Reap the output directory.
 *
 * Two independent passes:
 *   1) TEMP pass — every intermediate artifact is deleted once it is older than
 *      minAgeMs. These are never meant to survive a job; leftovers mean a crash
 *      skipped the per-clip `finally` cleanup.
 *   2) FINAL pass — clips older than ttlMs are deleted. If the directory still
 *      exceeds maxTotalBytes, the OLDEST remaining clips are deleted until the
 *      budget is satisfied (never touching files younger than minAgeMs).
 *
 * @param {ReapOptions} [options]
 * @returns {{ deleted: string[], freedBytes: number, kept: number, scanned: number }}
 */
export function reapOutputs(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : parseInt(process.env.OUTPUT_TTL_HOURS || '24', 10) * 3600_000;
  const maxTotalBytes = Number.isFinite(options.maxTotalBytes)
    ? options.maxTotalBytes
    : parseInt(process.env.OUTPUT_MAX_TOTAL_MB || String(5 * 1024), 10) * 1024 * 1024;
  const minAgeMs = Number.isFinite(options.minAgeMs) ? options.minAgeMs : parseInt(process.env.OUTPUT_MIN_AGE_MINUTES || '10', 10) * 60_000;
  const dryRun = Boolean(options.dryRun);
  const now = Number.isFinite(options.now) ? options.now : Date.now();

  const dir = OUTPUT_DIR();
  const result = { deleted: [], freedBytes: 0, kept: 0, scanned: 0 };

  if (!fs.existsSync(dir)) return result;

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return result;
  }

  const clips = [];

  for (const name of entries) {
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (!stat.isFile()) continue;
    result.scanned++;

    const age = now - stat.mtimeMs;
    const isTemp = TEMP_ARTIFACT_RE.test(name);
    const isClip = FINAL_CLIP_RE.test(name);

    if (!isTemp && !isClip) {
      result.kept++;
      continue; // not ours — leave it alone
    }

    // Safety: a job could still be writing this file.
    if (age < minAgeMs) {
      if (isClip) clips.push({ name, full, stat, age });
      else result.kept++;
      continue;
    }

    if (isTemp) {
      if (!dryRun) {
        try { fs.unlinkSync(full); } catch (_) { result.kept++; continue; }
      }
      result.deleted.push(name);
      result.freedBytes += stat.size;
      continue;
    }

    // Final clip: TTL first.
    if (age >= ttlMs) {
      if (!dryRun) {
        try { fs.unlinkSync(full); } catch (_) { result.kept++; continue; }
      }
      result.deleted.push(name);
      result.freedBytes += stat.size;
      continue;
    }

    clips.push({ name, full, stat, age });
  }

  // Size-based pruning: oldest first, never below minAgeMs.
  let totalBytes = clips.reduce((acc, c) => acc + c.stat.size, 0);
  clips.sort((a, b) => b.age - a.age); // oldest first

  for (const clip of clips) {
    if (totalBytes <= maxTotalBytes) break;
    if (clip.age < minAgeMs) break; // never delete a possibly-active file
    if (!dryRun) {
      try { fs.unlinkSync(clip.full); } catch (_) { continue; }
    }
    result.deleted.push(clip.name);
    result.freedBytes += clip.stat.size;
    totalBytes -= clip.stat.size;
  }

  result.kept = Math.max(0, result.scanned - result.deleted.length);
  return result;
}

/**
 * Delete every artifact belonging to one job. Used by `DELETE /api/job/:id`.
 *
 * Job ids are UUIDs; we compare the sanitized prefix to avoid path traversal.
 *
 * @param {string} jobId
 * @param {boolean} [dryRun]
 * @returns {{ deleted: string[], freedBytes: number }}
 */
export function deleteJobOutputs(jobId, dryRun = false) {
  const result = { deleted: [], freedBytes: 0 };
  if (typeof jobId !== 'string') return result;

  // Reject anything that is not a plain id (no slashes, dots, spaces).
  const safeId = jobId.trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(safeId)) return result;

  const dir = OUTPUT_DIR();
  if (!fs.existsSync(dir)) return result;

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return result;
  }

  for (const name of entries) {
    if (!name.startsWith(`${safeId}_`)) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (!stat.isFile()) continue;

    if (!dryRun) {
      try { fs.unlinkSync(full); } catch (_) { continue; }
    }
    result.deleted.push(name);
    result.freedBytes += stat.size;
  }

  return result;
}

/**
 * Schedule reapOutputs() on an interval inside a long-running process.
 *
 * @param {{ intervalMs?: number, onReap?: Function, runImmediately?: boolean }} [opts]
 * @returns {{ stop: Function }}
 */
export function startOutputReaper(opts = {}) {
  const intervalMs = Number.isFinite(opts.intervalMs)
    ? opts.intervalMs
    : parseInt(process.env.OUTPUT_REAP_INTERVAL_MINUTES || '30', 10) * 60_000;
  const onReap = typeof opts.onReap === 'function' ? opts.onReap : null;

  const runOnce = () => {
    try {
      const res = reapOutputs();
      if (res.deleted.length > 0) {
        const mb = (res.freedBytes / 1024 / 1024).toFixed(1);
        console.log(`🧹 [reaper] removed ${res.deleted.length} file(s), freed ${mb} MB`);
      }
      if (onReap) onReap(res);
      return res;
    } catch (err) {
      console.error(`🧹 [reaper] failed: ${err.message}`);
      return null;
    }
  };

  if (opts.runImmediately) runOnce();

  const timer = setInterval(runOnce, intervalMs);
  timer.unref?.(); // never keep the process alive just for the reaper

  return { stop: () => clearInterval(timer), runOnce };
}

export const _internal = { FINAL_CLIP_RE, TEMP_ARTIFACT_RE };
