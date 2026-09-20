// utils/singletonLock.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Atomic singleton lock for the start-all stack (audit finding H4).
 *
 * The original implementation checked `existsSync`, read the holder pid, and
 * only then wrote its own pid. Those are three separate syscalls, so two
 * starters launched at the same moment could both observe "no lock" and both
 * proceed — spawning two server+worker pairs against one BullMQ queue, which is
 * exactly the double-processing the lock was meant to prevent.
 *
 * This module uses `open(O_CREAT | O_EXCL)` via the `wx` flag, which the OS
 * guarantees is atomic: exactly one caller creates the file, all others receive
 * EEXIST. Stale locks (holder pid no longer alive) are still reclaimed, but
 * reclamation re-attempts the atomic create so a third racing process is safe.
 */

export const DEFAULT_LOCK_FILE = path.join(os.tmpdir(), 'clipaiv2-start-all.lock');

// A lock file younger than this is assumed to belong to a starter that is still
// flushing its pid, never to a dead process. Prevents the TOCTOU race where a
// second starter reads a not-yet-written lock, calls it stale, and takes over.
export const FRESH_LOCK_GRACE_MS = parseInt(process.env.START_ALL_FRESH_LOCK_MS || '2000', 10);

/** @returns {number|null} mtime of the lock file in ms, or null if absent */
function lockMtimeMs(lockFile) {
  try {
    return fs.statSync(lockFile).mtimeMs;
  } catch (_) {
    return null;
  }
}

/** @returns {number|null} age of the lock file in ms, or null if absent */
export function lockAgeMs(lockFile) {
  const mtime = lockMtimeMs(lockFile);
  return mtime === null ? null : Date.now() - mtime;
}

/** @returns {boolean} whether a pid is still alive on this host */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user — still alive.
    return err.code === 'EPERM';
  }
}

/**
 * Attempt to create the lock file atomically.
 * @param {string} lockFile
 * @param {number} pid
 * @returns {boolean} true when this call created the file
 */
export function tryCreateLock(lockFile, pid) {
  let fd;
  try {
    fd = fs.openSync(lockFile, 'wx', 0o644);
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
  try {
    fs.writeSync(fd, String(pid));
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

/** Read the pid recorded in a lock file, or null. */
export function readLockPid(lockFile) {
  try {
    const raw = fs.readFileSync(lockFile, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isInteger(pid) ? pid : null;
  } catch (_) {
    return null;
  }
}

/**
 * Acquire the singleton lock.
 *
 * @param {Object} [options]
 * @param {string} [options.lockFile]
 * @param {number} [options.pid] - the pid to record (defaults to process.pid)
 * @param {(pid:number)=>boolean} [options.isAlive]
 * @returns {{ acquired: boolean, reason: string, holderPid: number|null }}
 */
export function acquireSingletonLock(options = {}) {
  const lockFile = options.lockFile || DEFAULT_LOCK_FILE;
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid;
  const alive = options.isAlive || isProcessAlive;

  if (tryCreateLock(lockFile, pid)) {
    return { acquired: true, reason: 'created', holderPid: pid };
  }

  const holderPid = readLockPid(lockFile);

  // A live holder that is not us: refuse.
  if (holderPid !== null && holderPid !== pid && alive(holderPid)) {
    return { acquired: false, reason: 'held-by-live-process', holderPid };
  }

  // Guard against a TOCTOU race observed with 12 concurrent starters:
  // process A created the lock but had not yet flushed its pid when process B
  // read the (empty) file, concluded "stale", unlinked it and took over — two
  // ACQUIRED results and a duplicate stack. A lock file that is younger than a
  // short grace period is treated as "holder still starting", never as stale.
  const ageMs = lockAgeMs(lockFile);
  if (ageMs !== null && ageMs < FRESH_LOCK_GRACE_MS) {
    // Re-read once in case the pid landed while we looked; otherwise refuse.
    const retryPid = readLockPid(lockFile);
    if (retryPid === null || retryPid === pid || alive(retryPid) || Date.now() - lockMtimeMs(lockFile) < FRESH_LOCK_GRACE_MS) {
      return { acquired: false, reason: 'fresh-lock-race', holderPid: retryPid };
    }
  }

  // Stale (or unreadable) lock. Reclaim, then re-attempt the atomic create so a
  // concurrent reclaimer cannot also succeed.
  try {
    fs.unlinkSync(lockFile);
  } catch (_) {}

  if (tryCreateLock(lockFile, pid)) {
    return { acquired: true, reason: 'reclaimed-stale', holderPid: pid };
  }

  return { acquired: false, reason: 'lost-reclaim-race', holderPid: readLockPid(lockFile) };
}

/**
 * Release the lock only if this pid still owns it.
 * @param {Object} [options]
 * @returns {boolean} whether the file was removed
 */
export function releaseSingletonLock(options = {}) {
  const lockFile = options.lockFile || DEFAULT_LOCK_FILE;
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid;
  const holderPid = readLockPid(lockFile);
  if (holderPid !== pid) return false;
  try {
    fs.unlinkSync(lockFile);
    return true;
  } catch (_) {
    return false;
  }
}
