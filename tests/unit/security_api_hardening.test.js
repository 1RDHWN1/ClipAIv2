// tests/unit/security_api_hardening.test.js
import test from 'node:test';
import assert from 'node:assert';

import { createRateLimiter } from '../../utils/rateLimiter.js';

/**
 * Security regression: API hardening (audit findings C2 & C3).
 *
 * C2 — POST /api/process had no authentication and no rate limit, so an
 *      unauthenticated caller could flood the (expensive) video queue.
 * C3 — No explicit JSON body limit; default express 100kb was implicit and
 *      transcriptText had no logical cap.
 *
 * These tests exercise the limiter in isolation with fake req/res objects, so
 * they need no HTTP server or Redis.
 */

function makeReq({ ip = '1.2.3.4', headers = {} } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ip,
    socket: { remoteAddress: ip },
    get(name) {
      return lower[String(name).toLowerCase()];
    },
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

test('Security: rate limiter allows up to max then returns 429', async (t) => {
  await t.test('Case 1: requests within the window pass through', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) {
      const req = makeReq();
      const res = makeRes();
      let nextCalled = false;
      limiter(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true, `request ${i + 1} should pass`);
      assert.strictEqual(res.statusCode, 200);
    }
  });

  await t.test('Case 2: the request that exceeds max is rejected with 429 + Retry-After', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    const pass = () => { const r = makeRes(); limiter(makeReq(), r, () => {}); return r; };
    pass();
    pass();

    const res = makeRes();
    let nextCalled = false;
    limiter(makeReq(), res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'overflow request must not reach the handler');
    assert.strictEqual(res.statusCode, 429);
    assert.ok(res.headers['Retry-After'], 'must set Retry-After header');
    assert.match(res.body.error, /Terlalu banyak/i);
    assert.ok(res.body.retryAfterSeconds >= 1);
  });

  await t.test('Case 3: limiter is per-client — one abuser does not block others', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    const hammer = (ip) => {
      const res = makeRes();
      limiter(makeReq({ ip }), res, () => {});
      return res.statusCode;
    };

    assert.strictEqual(hammer('10.0.0.1'), 200);
    assert.strictEqual(hammer('10.0.0.1'), 200);
    assert.strictEqual(hammer('10.0.0.1'), 429, 'abuser is limited');

    assert.strictEqual(hammer('10.0.0.2'), 200, 'innocent client unaffected');
  });

  await t.test('Case 4: window expiry frees the client again', async () => {
    // windowMs kecil supaya tidak memperlambat test suite.
    const limiter = createRateLimiter({ windowMs: 40, max: 1 });
    const attempt = () => {
      const res = makeRes();
      limiter(makeReq(), res, () => {});
      return res.statusCode;
    };

    assert.strictEqual(attempt(), 200);
    assert.strictEqual(attempt(), 429);
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(attempt(), 200, 'after the window elapses the client is allowed again');
  });
});

test('Security: API hardening config is present in the environment template', async (t) => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  await t.test('Case 1: .env.example documents the security knobs', () => {
    const example = readFileSync(path.join(root, '.env.example'), 'utf-8');
    for (const key of ['API_KEY', 'JSON_BODY_LIMIT', 'MAX_TRANSCRIPT_CHARS', 'RATE_LIMIT_MAX']) {
      assert.match(example, new RegExp(`^${key}=`, 'm'), `.env.example must document ${key}`);
    }
  });

  await t.test('Case 2: server.js sets an explicit json body limit', () => {
    const server = readFileSync(path.join(root, 'server.js'), 'utf-8');
    assert.match(server, /express\.json\(\s*\{[^}]*limit:/s, 'express.json must declare a limit');
  });

  await t.test('Case 3: api.js applies auth + rate limit to POST /process', () => {
    const api = readFileSync(path.join(root, 'routes', 'api.js'), 'utf-8');
    assert.match(
      api,
      /router\.post\(\s*'\/process'\s*,\s*requireApiKey\s*,\s*processRateLimiter/,
      'POST /process must chain requireApiKey and processRateLimiter'
    );
    assert.match(api, /MAX_TRANSCRIPT_CHARS/, 'transcript length must be capped');
  });
});
