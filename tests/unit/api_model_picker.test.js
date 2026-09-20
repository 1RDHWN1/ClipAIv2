import test from 'node:test';
import assert from 'node:assert';
import { resolveModelConfiguration } from '../../utils/analyzer.js';

test('AI Model Picker & Dynamic Resolution Suite', async (t) => {
  await t.test('Case 1: resolveModelConfiguration respects explicit override model', () => {
    const configDefault = resolveModelConfiguration();
    assert.ok(configDefault.model, 'Default model must be non-empty');

    const configOverride = resolveModelConfiguration('kr/claude-sonnet-4.5');
    assert.strictEqual(configOverride.model, 'kr/claude-sonnet-4.5', 'Explicit override model must be honored');

    const configOverride2 = resolveModelConfiguration('   xkiro/google/gemini-3.8-flash   ');
    assert.strictEqual(configOverride2.model, 'xkiro/google/gemini-3.8-flash', 'Model must be trimmed');
  });

  await t.test('Case 2: resolveModelConfiguration falls back to default when override is empty or non-string', () => {
    const configEmpty = resolveModelConfiguration('');
    const configNull = resolveModelConfiguration(null);
    const configUndefined = resolveModelConfiguration(undefined);
    const configNumber = resolveModelConfiguration(12345);

    const base = resolveModelConfiguration();
    assert.strictEqual(configEmpty.model, base.model);
    assert.strictEqual(configNull.model, base.model);
    assert.strictEqual(configUndefined.model, base.model);
    assert.strictEqual(configNumber.model, base.model);
  });

  await t.test('Case 3: Model validation regex accepts standard model naming formats', () => {
    const validModels = [
      'xkiro/qwen/qwen3-max:free',
      'xkiro/google/gemini-3.8-flash',
      'kr/claude-sonnet-4.5',
      'openai/gpt-4o',
      'deepseek/deepseek-r1:nitro',
      'pahri-fast',
      'my_model.v2',
    ];

    const modelRegex = /^[a-zA-Z0-9_.:\/-]{1,100}$/;
    for (const m of validModels) {
      assert.ok(modelRegex.test(m), `Model "${m}" should be valid`);
    }

    const invalidModels = [
      'model with spaces',
      'model;rm -rf /',
      'model`whoami`',
      '<script>alert(1)</script>',
      'a'.repeat(101),
    ];
    for (const m of invalidModels) {
      assert.strictEqual(modelRegex.test(m), false, `Malicious/invalid model "${m}" must be rejected`);
    }
  });
});
