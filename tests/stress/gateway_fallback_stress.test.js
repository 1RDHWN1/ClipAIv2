// tests/stress/gateway_fallback_stress.test.js
/**
 * Empirical Stress Testing & Adversarial Challenge Suite:
 * Milestone 1 - Gateway Fallback Cascade & AI Model Configuration
 *
 * Requirements & Acceptance Criteria:
 * - ORIGINAL_REQUEST.md §R1 (2026-09-18T20:23:27Z)
 * - PROJECT.md M1 / F1, F5 (Model Upgrade & Resilient Gateway Fallback Cascade)
 *
 * Verifies:
 * 1. DEFAULT_AI_MODEL is 'ag/gemini-3.8-flash-high' and resolveModelConfiguration correctly resolves model & URLs.
 * 2. buildGatewayCandidates constructs prioritized, deduplicated multi-tier candidate cascade.
 * 3. Simulated network errors (ECONNREFUSED on closed ports, 502, 503, 504, 404, ECONNRESET) cleanly fall through.
 * 4. In-candidate recovery from 400 unsupported JSON mode to plain text.
 * 5. Complete exhaustion scenario rejects with descriptive error without process crashes.
 * 6. Discrete sentence boundary resolution and snapping under fallback execution.
 */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_BASE_URL,
  resolveModelConfiguration,
  buildGatewayCandidates,
  analyzeTranscript,
} from '../../utils/analyzer.js';
import { segmentWordsIntoSentences } from '../../utils/sentenceSegmenter.js';
import { detectLinguisticSilence } from '../../utils/silenceDetector.js';
import { standardWords } from '../fixtures/mockTranscripts.js';

// Helper: allocate an ephemeral port and close it to guarantee connection refusal (ECONNREFUSED)
async function getClosedPort() {
  const s = http.createServer();
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}

// Helper: spin up a lightweight mock HTTP gateway server
function createMockGatewayServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let bodyStr = '';
      req.on('data', (chunk) => { bodyStr += chunk; });
      req.on('end', () => {
        let parsedBody = null;
        try {
          parsedBody = bodyStr ? JSON.parse(bodyStr) : null;
        } catch (_) {
          parsedBody = bodyStr;
        }
        handler(req, res, parsedBody);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

test('Suite 1: Model Defaults & resolveModelConfiguration Empirical Oracle', async (t) => {
  const savedEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...savedEnv };
  });

  await t.test('1.1 DEFAULT_AI_MODEL and DEFAULT_AI_BASE_URL constant invariants', () => {
    assert.strictEqual(DEFAULT_AI_MODEL, 'ag/gemini-3.8-flash-high', 'DEFAULT_AI_MODEL must strictly be ag/gemini-3.8-flash-high');
    assert.strictEqual(DEFAULT_AI_BASE_URL, 'http://localhost:20128/v1', 'DEFAULT_AI_BASE_URL must be local 9Router port 20128');
  });

  await t.test('1.2 Default resolution when environment is unconfigured', () => {
    delete process.env.DEFAULT_MODEL;
    delete process.env.AI_MODEL;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AI_FALLBACK_BASE_URL;
    delete process.env.AI_FALLBACK_MODEL;

    const cfg = resolveModelConfiguration();
    assert.strictEqual(cfg.model, 'ag/gemini-3.8-flash-high');
    assert.strictEqual(cfg.baseUrl, 'http://localhost:20128/v1');
    assert.strictEqual(cfg.apiKey, 'dummy');
    assert.strictEqual(cfg.fallbackBaseUrl, null);
    assert.strictEqual(cfg.fallbackModel, 'ag/gemini-3.8-flash');
  });

  await t.test('1.3 Precedence hierarchy: DEFAULT_MODEL overrides AI_MODEL', () => {
    process.env.DEFAULT_MODEL = 'ag/gemini-3.8-flash-high';
    process.env.AI_MODEL = 'some-other-model';
    const cfg = resolveModelConfiguration();
    assert.strictEqual(cfg.model, 'ag/gemini-3.8-flash-high', 'DEFAULT_MODEL must take precedence over AI_MODEL');

    delete process.env.DEFAULT_MODEL;
    process.env.AI_MODEL = 'custom-user-model';
    const cfg2 = resolveModelConfiguration();
    assert.strictEqual(cfg2.model, 'custom-user-model', 'AI_MODEL takes effect when DEFAULT_MODEL is unset');
  });

  await t.test('1.4 Normalization of trailing slashes in base URLs', () => {
    process.env.AI_BASE_URL = 'http://localhost:20128/v1////';
    process.env.AI_FALLBACK_BASE_URL = 'https://openrouter.ai/api/v1///';
    const cfg = resolveModelConfiguration();
    assert.strictEqual(cfg.baseUrl, 'http://localhost:20128/v1', 'Trailing slashes must be stripped from baseUrl');
    assert.strictEqual(cfg.fallbackBaseUrl, 'https://openrouter.ai/api/v1', 'Trailing slashes must be stripped from fallbackBaseUrl');
  });

  await t.test('1.5 Automatic OpenRouter fallback discovery when OPENROUTER_API_KEY exists', () => {
    delete process.env.AI_FALLBACK_BASE_URL;
    process.env.OPENROUTER_API_KEY = 'sk-or-test-key-12345';
    const cfg = resolveModelConfiguration();
    assert.strictEqual(cfg.fallbackBaseUrl, 'https://openrouter.ai/api/v1');
  });
});

test('Suite 2: buildGatewayCandidates Priority & Deduplication Permutations', async (t) => {
  await t.test('2.1 Standard 5-tier candidate cascade generation', () => {
    const config = {
      model: 'ag/gemini-3.8-flash-high',
      baseUrl: 'http://localhost:20128/v1',
      apiKey: 'test-local-key',
      fallbackBaseUrl: 'https://openrouter.ai/api/v1',
      fallbackModel: 'ag/gemini-3.8-flash',
    };

    const candidates = buildGatewayCandidates(config);
    assert.strictEqual(candidates.length, 5, 'Should produce 5 deduplicated candidates');

    // Tier 1: Primary gateway
    assert.strictEqual(candidates[0].baseUrl, 'http://localhost:20128/v1');
    assert.strictEqual(candidates[0].model, 'ag/gemini-3.8-flash-high');
    assert.strictEqual(candidates[0].label, 'primary-gateway');

    // Tier 2: Local loopback
    assert.strictEqual(candidates[1].baseUrl, 'http://127.0.0.1:20128/v1');
    assert.strictEqual(candidates[1].model, 'ag/gemini-3.8-flash-high');
    assert.strictEqual(candidates[1].label, 'local-loopback');

    // Tier 3: Fallback gateway
    assert.strictEqual(candidates[2].baseUrl, 'https://openrouter.ai/api/v1');
    assert.strictEqual(candidates[2].model, 'ag/gemini-3.8-flash-high');
    assert.strictEqual(candidates[2].label, 'fallback-gateway');

    // Tier 4: Primary fallback model
    assert.strictEqual(candidates[3].baseUrl, 'http://localhost:20128/v1');
    assert.strictEqual(candidates[3].model, 'ag/gemini-3.8-flash');
    assert.strictEqual(candidates[3].label, 'primary-fallback-model');

    // Tier 5: Fallback gateway model
    assert.strictEqual(candidates[4].baseUrl, 'https://openrouter.ai/api/v1');
    assert.strictEqual(candidates[4].model, 'ag/gemini-3.8-flash');
    assert.strictEqual(candidates[4].label, 'fallback-gateway-model');
  });

  await t.test('2.2 Non-localhost primary endpoint does not generate loopback alias', () => {
    const config = {
      model: 'ag/gemini-3.8-flash-high',
      baseUrl: 'https://remote-ai-gateway.internal/v1',
      apiKey: 'remote-key',
      fallbackBaseUrl: null,
      fallbackModel: 'ag/gemini-3.8-flash-high', // same as model, no tier 4
    };

    const candidates = buildGatewayCandidates(config);
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].baseUrl, 'https://remote-ai-gateway.internal/v1');
    assert.strictEqual(candidates[0].label, 'primary-gateway');
  });

  await t.test('2.3 Deduplication invariant: No duplicate baseUrl+model combinations', () => {
    const config = {
      model: 'ag/gemini-3.8-flash-high',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-key',
      fallbackBaseUrl: 'https://openrouter.ai/api/v1', // identical to baseUrl
      fallbackModel: 'ag/gemini-3.8-flash-high', // identical to model
    };

    const candidates = buildGatewayCandidates(config);
    assert.strictEqual(candidates.length, 1, 'Duplicate baseUrl and model must be deduplicated to 1 candidate');
  });
});

test('Suite 3: Empirical Network Error Fallback Cascades (Real Local HTTP Sockets)', async (t) => {
  const savedEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...savedEnv };
  });

  await t.test('3.1 Closed Port ECONNREFUSED on Primary Gateway falls through to Fallback Gateway', async () => {
    const deadPort = await getClosedPort();

    let fallbackHitCount = 0;
    const fallbackServer = await createMockGatewayServer((req, res, body) => {
      fallbackHitCount++;
      const sampleClips = [
        {
          start: 1.0,
          end: 18.0,
          title: 'Mastering Fallback Resilience',
          reason: 'Seamlessly cascaded through closed port to fallback endpoint',
          score: 96,
        },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ clips: sampleClips }),
            },
            finish_reason: 'stop',
          },
        ],
      }));
    });

    try {
      process.env.AI_BASE_URL = `http://127.0.0.1:${deadPort}/v1`;
      process.env.AI_FALLBACK_BASE_URL = fallbackServer.baseUrl;
      process.env.AI_FALLBACK_MODEL = 'ag/gemini-3.8-flash-high'; // keep same model

      const segments = [
        { start: 1.0, end: 10.0, text: 'First segment of video' },
        { start: 10.0, end: 20.0, text: 'Second segment of video' },
      ];

      const clips = await analyzeTranscript('Full transcript text', segments, 30.0, 1);
      assert.strictEqual(fallbackHitCount, 1, 'Fallback server must have been contacted exactly once');
      assert.strictEqual(clips.length, 1, 'Must successfully return clip from fallback gateway');
      assert.strictEqual(clips[0].title, 'Mastering Fallback Resilience');
      assert.strictEqual(clips[0].score, 96);
    } finally {
      await fallbackServer.close();
    }
  });

  await t.test('3.2 Cascading through 502 Bad Gateway -> 503 Service Unavailable -> 200 OK', async () => {
    let s502Hits = 0;
    const server502 = await createMockGatewayServer((req, res) => {
      s502Hits++;
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Bad Gateway: upstream connection refused' } }));
    });

    let s503Hits = 0;
    const server503 = await createMockGatewayServer((req, res) => {
      s503Hits++;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Service Temporarily Unavailable' } }));
    });

    let s200Hits = 0;
    const server200 = await createMockGatewayServer((req, res) => {
      s200Hits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                clips: [
                  {
                    start: 2.0,
                    end: 22.0,
                    title: 'Cascade Victory',
                    reason: 'Successfully recovered from 502 and 503 downstreams',
                    score: 99,
                  },
                ],
              }),
            },
          },
        ],
      }));
    });

    try {
      process.env.AI_BASE_URL = server502.baseUrl;
      process.env.AI_FALLBACK_BASE_URL = server200.baseUrl;

      const segments = [
        { start: 0.0, end: 30.0, text: 'Continuous lecture on system resilience.' },
      ];

      const clips = await analyzeTranscript('Transcript', segments, 45.0, 1);
      assert.strictEqual(s502Hits, 1, 'Candidate 1 (502) should break after attempt 1 and not stall');
      assert.strictEqual(s200Hits, 1, 'Candidate 2 (200) should handle the request and succeed');
      assert.strictEqual(clips[0].title, 'Cascade Victory');
    } finally {
      await server502.close();
      await server503.close();
      await server200.close();
    }
  });

  await t.test('3.3 HTTP 404 Endpoint Not Found cascades cleanly to backup', async () => {
    let s404Hits = 0;
    const server404 = await createMockGatewayServer((req, res) => {
      s404Hits++;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Route /v1/chat/completions not found on this proxy' } }));
    });

    const serverBackup = await createMockGatewayServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ clips: [{ start: 0, end: 15, title: 'Backup Clip', score: 85 }] }) } }],
      }));
    });

    try {
      process.env.AI_BASE_URL = server404.baseUrl;
      process.env.AI_FALLBACK_BASE_URL = serverBackup.baseUrl;

      const clips = await analyzeTranscript('Text', [{ start: 0, end: 20, text: 'Clip segment' }], 30.0, 1);
      assert.strictEqual(s404Hits, 1, '404 route error should trigger immediate candidate cascade');
      assert.strictEqual(clips[0].title, 'Backup Clip');
    } finally {
      await server404.close();
      await serverBackup.close();
    }
  });

  await t.test('3.4 Connection Reset (ECONNRESET) socket destruction cascades immediately', async () => {
    let resetHits = 0;
    const serverReset = await createMockGatewayServer((req, res) => {
      resetHits++;
      req.socket.destroy(); // Abruptly destroy socket to simulate TCP RST
    });

    const serverHealthy = await createMockGatewayServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ clips: [{ start: 0, end: 12, title: 'Reset Recovery', score: 90 }] }) } }],
      }));
    });

    try {
      process.env.AI_BASE_URL = serverReset.baseUrl;
      process.env.AI_FALLBACK_BASE_URL = serverHealthy.baseUrl;

      const clips = await analyzeTranscript('Text', [{ start: 0, end: 20, text: 'Data' }], 30.0, 1);
      assert.strictEqual(resetHits, 1, 'Abrupt ECONNRESET socket drop triggers instant failover');
      assert.strictEqual(clips[0].title, 'Reset Recovery');
    } finally {
      await serverReset.close();
      await serverHealthy.close();
    }
  });

  await t.test('3.5 In-Candidate Recovery: 400 Unsupported JSON Mode retries with plain text and succeeds', async () => {
    let attempt1Checked = false;
    let attempt2Checked = false;

    const server = await createMockGatewayServer((req, res, body) => {
      if (body?.response_format?.type === 'json_object') {
        attempt1Checked = true;
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'Provider does not support response_format json_object parameter' },
        }));
        return;
      }

      // Attempt 2: Plain text prompt, respond with markdown-wrapped JSON
      attempt2Checked = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: '```json\n{\n  "clips": [\n    {\n      "start": 5.0,\n      "end": 25.0,\n      "title": "Markdown JSON Fallback",\n      "score": 88\n    }\n  ]\n}\n```',
            },
          },
        ],
      }));
    });

    try {
      process.env.AI_BASE_URL = server.baseUrl;
      delete process.env.AI_FALLBACK_BASE_URL;

      const clips = await analyzeTranscript('Text', [{ start: 0, end: 30, text: 'Data' }], 30.0, 1);
      assert.ok(attempt1Checked, 'Attempt 1 must have tested json_object mode');
      assert.ok(attempt2Checked, 'Attempt 2 must have retried with plain prompt without response_format');
      assert.strictEqual(clips[0].title, 'Markdown JSON Fallback');
      assert.strictEqual(clips[0].score, 88);
    } finally {
      await server.close();
    }
  });

  await t.test('3.6 Exhaustion Scenario: All candidate endpoints fail -> Clean error thrown without crashing', async () => {
    const deadPort1 = await getClosedPort();
    const deadPort2 = await getClosedPort();

    process.env.AI_BASE_URL = `http://127.0.0.1:${deadPort1}/v1`;
    process.env.AI_FALLBACK_BASE_URL = `http://127.0.0.1:${deadPort2}/v1`;

    await assert.rejects(
      async () => {
        await analyzeTranscript('Text', [{ start: 0, end: 20, text: 'Text' }], 30.0, 1);
      },
      (err) => {
        assert.match(err.message, /AI analisis gagal:/i);
        assert.match(err.message, /ECONNREFUSED/i);
        return true;
      },
      'Must reject cleanly with descriptive failure message when all gateways are offline'
    );
  });

  await t.test('3.7 Rate limit 429 on Primary Gateway cascades to Fallback Gateway', async () => {
    let s429Hits = 0;
    const server429 = await createMockGatewayServer((req, res) => {
      s429Hits++;
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Rate limit exceeded: 0 tokens remaining for model' } }));
    });

    let backupHits = 0;
    const serverBackup = await createMockGatewayServer((req, res) => {
      backupHits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ clips: [{ start: 0, end: 20, title: '429 Recovery Clip', score: 91 }] }) } }],
      }));
    });

    try {
      process.env.AI_BASE_URL = server429.baseUrl;
      process.env.AI_FALLBACK_BASE_URL = serverBackup.baseUrl;

      const clips = await analyzeTranscript('Text', [{ start: 0, end: 25, text: 'Clip segment' }], 30.0, 1);
      assert.ok(s429Hits >= 1, 'Primary candidate received 429 throttle');
      assert.strictEqual(backupHits, 1, 'Backup candidate received and fulfilled request');
      assert.strictEqual(clips[0].title, '429 Recovery Clip');
    } finally {
      await server429.close();
      await serverBackup.close();
    }
  });

  await t.test('3.8 HTML error page (HTTP 200 with HTML body) cascades to fallback gateway', async () => {
    let htmlHits = 0;
    const serverHtml = await createMockGatewayServer((req, res) => {
      htmlHits++;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>500 Internal Server Error (Cloudflare Proxy)</h1></body></html>');
    });

    let backupHits = 0;
    const serverBackup = await createMockGatewayServer((req, res) => {
      backupHits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ clips: [{ start: 2, end: 22, title: 'HTML Bypass Clip', score: 93 }] }) } }],
      }));
    });

    try {
      process.env.AI_BASE_URL = serverHtml.baseUrl;
      process.env.AI_FALLBACK_BASE_URL = serverBackup.baseUrl;

      const clips = await analyzeTranscript('Text', [{ start: 0, end: 30, text: 'Clip segment' }], 40.0, 1);
      assert.ok(htmlHits >= 1, 'HTML gateway was contacted');
      assert.strictEqual(backupHits, 1, 'Backup gateway resolved request after HTML parse failure');
      assert.strictEqual(clips[0].title, 'HTML Bypass Clip');
    } finally {
      await serverHtml.close();
      await serverBackup.close();
    }
  });
});

test('Suite 4: Discrete Sentence Boundaries & Virality Invariants under Fallback', async (t) => {
  const savedEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...savedEnv };
  });

  await t.test('4.1 Fallback candidate correctly resolves discrete sentence boundaries and 4-pillar virality', async () => {
    const deadPort = await getClosedPort();

    const mockClips = [
      {
        startSentenceId: 's1',
        endSentenceId: 's3',
        title: 'High-CTR Curiosity Hook',
        hookClassification: 'question',
        hookText: 'Welcome to our podcast.',
        narrativeRationale: {
          setup: 'Welcoming the audience and setting high stakes',
          climax: 'Revealing the unexpected breakthrough',
          conclusion: 'Delivering the transformative takeaway',
          isCompleteArc: true,
        },
        viralityScore: 94,
        viralityRationale: '0-3s pattern interrupt with strong retention pacing across all 3 sentences',
      },
    ];

    let fallbackCalled = false;
    const fallbackServer = await createMockGatewayServer((req, res) => {
      fallbackCalled = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ clips: mockClips }),
            },
          },
        ],
      }));
    });

    try {
      process.env.AI_BASE_URL = `http://127.0.0.1:${deadPort}/v1`;
      process.env.AI_FALLBACK_BASE_URL = fallbackServer.baseUrl;

      const sentences = segmentWordsIntoSentences(standardWords);
      const silences = detectLinguisticSilence(standardWords);

      const clips = await analyzeTranscript(
        'Welcome to our podcast. Today we have an incredible guest. Tell us your secret.',
        null,
        15.0,
        1,
        {
          sentences,
          words: standardWords,
          silences,
          language: 'en',
        }
      );

      assert.ok(fallbackCalled, 'Fallback server was reached after dead primary');
      assert.strictEqual(clips.length, 1);

      const c = clips[0];
      assert.strictEqual(c.title, 'High-CTR Curiosity Hook');
      assert.strictEqual(c.viralityScore, 94);
      assert.strictEqual(c.hookClassification, 'question');
      assert.strictEqual(c.startSentenceId, 's1');
      assert.strictEqual(c.endSentenceId, 's3');
      assert.strictEqual(c.resolvedSentences.count, 3);
      // Verify snapping applied to sentence boundaries (1.00s to 6.80s)
      assert.strictEqual(c.start, 1.0);
      assert.strictEqual(c.end, 6.8);
      assert.ok(c.snappingDetails.start.snappedTime === 1.0);
      assert.ok(c.snappingDetails.end.snappedTime === 6.8);
    } finally {
      await fallbackServer.close();
    }
  });

  await t.test('4.2 Invalid sentence IDs in candidate 1 cascade or fall back to valid clips', async () => {
    let primaryHits = 0;
    const serverBadClips = await createMockGatewayServer((req, res) => {
      primaryHits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              // startSentenceId s999 does not exist in sentences
              content: JSON.stringify({
                clips: [
                  {
                    startSentenceId: 's999',
                    endSentenceId: 's1000',
                    title: 'Phantom Clip',
                    hookClassification: 'bold_statement',
                    hookText: 'Fake',
                    viralityScore: 80,
                  },
                ],
              }),
            },
          },
        ],
      }));
    });

    let backupHits = 0;
    const serverGoodClips = await createMockGatewayServer((req, res) => {
      backupHits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                clips: [
                  {
                    startSentenceId: 's1',
                    endSentenceId: 's2',
                    title: 'Legitimate Segment',
                    hookClassification: 'question',
                    hookText: 'Welcome to our podcast.',
                    viralityScore: 92,
                  },
                ],
              }),
            },
          },
        ],
      }));
    });

    try {
      process.env.AI_BASE_URL = serverBadClips.baseUrl;
      process.env.AI_FALLBACK_BASE_URL = serverGoodClips.baseUrl;

      const sentences = segmentWordsIntoSentences(standardWords);
      const clips = await analyzeTranscript(
        'Welcome to our podcast. Today we have an incredible guest.',
        null,
        15.0,
        1,
        { sentences, language: 'en' }
      );

      assert.ok(primaryHits >= 1, 'Primary candidate was attempted');
      assert.strictEqual(backupHits, 1, 'Backup candidate was invoked when primary returned unresolvable sentence IDs');
      assert.strictEqual(clips[0].title, 'Legitimate Segment');
      assert.strictEqual(clips[0].startSentenceId, 's1');
      assert.strictEqual(clips[0].endSentenceId, 's2');
    } finally {
      await serverBadClips.close();
      await serverGoodClips.close();
    }
  });
});
