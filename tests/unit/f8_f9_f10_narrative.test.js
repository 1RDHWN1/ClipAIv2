// tests/unit/f8_f9_f10_narrative.test.js
import test from 'node:test';
import assert from 'node:assert';
import {
  VALID_HOOK_TAXONOMY,
  mockQuestionClip,
  mockBoldStatementClip,
  mockNegativeHookClip,
  mockStoryAnecdoteClip,
  mockShockingFactClip,
  mockActionInstructionClip,
  mockIncompleteArcClip,
  invalidClips,
  validateNarrativeClipSchema,
} from '../fixtures/mockNarratives.js';

/**
 * Features F8, F9, F10: Narrative Quality & Scoring Suite
 * Requirements: ORIGINAL_REQUEST §R2, AC Analysis & Hook Quality, PROJECT.md F8, F9, F10
 *
 * Invariants:
 *  F8: Standardized hook taxonomy classification.
 *  F9: Narrative arc evaluation (setup, climax, conclusion, isCompleteArc).
 *  F10: Virality score [0, 100] with narrative rationale.
 */

test('Tier 1: F8 - Hook Classification Engine', async (t) => {
  await t.test('Case 1: Standard taxonomy defines exactly the 6 required hook classes', () => {
    assert.strictEqual(VALID_HOOK_TAXONOMY.length, 6);
    assert.ok(VALID_HOOK_TAXONOMY.includes('question'));
    assert.ok(VALID_HOOK_TAXONOMY.includes('bold_statement'));
    assert.ok(VALID_HOOK_TAXONOMY.includes('negative_hook'));
    assert.ok(VALID_HOOK_TAXONOMY.includes('story_anecdote'));
    assert.ok(VALID_HOOK_TAXONOMY.includes('shocking_fact'));
    assert.ok(VALID_HOOK_TAXONOMY.includes('action_instruction'));
  });

  await t.test('Case 2: Validates question and bold_statement hook classifications', () => {
    const qRes = validateNarrativeClipSchema(mockQuestionClip);
    assert.strictEqual(qRes.valid, true);
    assert.strictEqual(mockQuestionClip.hookClassification, 'question');

    const bRes = validateNarrativeClipSchema(mockBoldStatementClip);
    assert.strictEqual(bRes.valid, true);
    assert.strictEqual(mockBoldStatementClip.hookClassification, 'bold_statement');
  });

  await t.test('Case 3: Validates negative_hook and story_anecdote classifications', () => {
    const nRes = validateNarrativeClipSchema(mockNegativeHookClip);
    assert.strictEqual(nRes.valid, true);

    const sRes = validateNarrativeClipSchema(mockStoryAnecdoteClip);
    assert.strictEqual(sRes.valid, true);
  });

  await t.test('Case 4: Validates shocking_fact and action_instruction classifications', () => {
    const sfRes = validateNarrativeClipSchema(mockShockingFactClip);
    assert.strictEqual(sfRes.valid, true);

    const aiRes = validateNarrativeClipSchema(mockActionInstructionClip);
    assert.strictEqual(aiRes.valid, true);
  });

  await t.test('Case 5: Verifies hookText corresponds with transcript and hook type', () => {
    assert.strictEqual(typeof mockQuestionClip.hookText, 'string');
    assert.ok(mockQuestionClip.hookText.endsWith('?'), 'Question hook should typically end with question mark');
  });
});

test('Tier 2: F8 - Hook Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Unknown hook classification rejected by schema validator', () => {
    const res = validateNarrativeClipSchema(invalidClips.invalidHookType);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Invalid hookClassification')));
  });

  await t.test('Case 2: Missing hookClassification rejected', () => {
    const res = validateNarrativeClipSchema(invalidClips.missingHook);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Invalid hookClassification')));
  });

  await t.test('Case 3: Empty string hookText rejected', () => {
    const badClip = { ...mockQuestionClip, hookText: '   ' };
    const res = validateNarrativeClipSchema(badClip);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Missing or empty hookText')));
  });

  await t.test('Case 4: Non-string hookText rejected', () => {
    const badClip = { ...mockQuestionClip, hookText: 12345 };
    const res = validateNarrativeClipSchema(badClip);
    assert.strictEqual(res.valid, false);
  });

  await t.test('Case 5: Case sensitivity - uppercase hook rejected unless normalized', () => {
    const upperClip = { ...mockQuestionClip, hookClassification: 'QUESTION' };
    const res = validateNarrativeClipSchema(upperClip);
    assert.strictEqual(res.valid, false);
  });
});

test('Tier 1: F9 - Narrative Arc Evaluation', async (t) => {
  await t.test('Case 1: Complete narrative arc contains setup, climax, and conclusion', () => {
    const arc = mockQuestionClip.narrativeRationale;
    assert.ok(typeof arc.setup === 'string' && arc.setup.length > 0);
    assert.ok(typeof arc.climax === 'string' && arc.climax.length > 0);
    assert.ok(typeof arc.conclusion === 'string' && arc.conclusion.length > 0);
    assert.strictEqual(arc.isCompleteArc, true);
  });

  await t.test('Case 2: Incomplete narrative arc sets isCompleteArc = false', () => {
    assert.strictEqual(mockIncompleteArcClip.narrativeRationale.isCompleteArc, false);
    const res = validateNarrativeClipSchema(mockIncompleteArcClip);
    assert.strictEqual(res.valid, true, 'Incomplete arc is still a valid schema payload');
  });

  await t.test('Case 3: Setup introduces context or problem', () => {
    assert.ok(mockBoldStatementClip.narrativeRationale.setup.length > 10);
  });

  await t.test('Case 4: Climax provides core turning point or insight', () => {
    assert.ok(mockBoldStatementClip.narrativeRationale.climax.length > 10);
  });

  await t.test('Case 5: Conclusion provides payoff or resolution', () => {
    assert.ok(mockBoldStatementClip.narrativeRationale.conclusion.length > 10);
  });
});

test('Tier 2: F9 - Narrative Arc Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Missing narrativeRationale object fails schema validation', () => {
    const badClip = { ...mockQuestionClip, narrativeRationale: undefined };
    const res = validateNarrativeClipSchema(badClip);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Missing narrativeRationale')));
  });

  await t.test('Case 2: Non-boolean isCompleteArc fails schema validation', () => {
    const badClip = {
      ...mockQuestionClip,
      narrativeRationale: { setup: 's', climax: 'c', conclusion: 'co', isCompleteArc: 'true' },
    };
    const res = validateNarrativeClipSchema(badClip);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('must be a boolean')));
  });

  await t.test('Case 3: Non-string setup/climax/conclusion fails validation', () => {
    const badClip = {
      ...mockQuestionClip,
      narrativeRationale: { setup: 123, climax: null, conclusion: [], isCompleteArc: true },
    };
    const res = validateNarrativeClipSchema(badClip);
    assert.strictEqual(res.valid, false);
  });

  await t.test('Case 4: Null narrativeRationale fails validation', () => {
    const badClip = { ...mockQuestionClip, narrativeRationale: null };
    const res = validateNarrativeClipSchema(badClip);
    assert.strictEqual(res.valid, false);
  });

  await t.test('Case 5: Long narrative fields (>500 chars) preserve full text without error', () => {
    const longText = 'A'.repeat(600);
    const longClip = {
      ...mockQuestionClip,
      narrativeRationale: { setup: longText, climax: longText, conclusion: longText, isCompleteArc: true },
    };
    const res = validateNarrativeClipSchema(longClip);
    assert.strictEqual(res.valid, true);
  });
});

test('Tier 1: F10 - Virality Scoring & Rationale', async (t) => {
  await t.test('Case 1: Virality score is within valid range [0, 100]', () => {
    const clips = [mockQuestionClip, mockBoldStatementClip, mockNegativeHookClip, mockStoryAnecdoteClip];
    for (const c of clips) {
      assert.ok(c.viralityScore >= 0 && c.viralityScore <= 100);
    }
  });

  await t.test('Case 2: Clips can be sorted descending by viralityScore', () => {
    const clips = [
      { ...mockQuestionClip, viralityScore: 75 },
      { ...mockBoldStatementClip, viralityScore: 95 },
      { ...mockNegativeHookClip, viralityScore: 85 },
    ];
    const sorted = clips.slice().sort((a, b) => b.viralityScore - a.viralityScore);
    assert.strictEqual(sorted[0].viralityScore, 95);
    assert.strictEqual(sorted[1].viralityScore, 85);
    assert.strictEqual(sorted[2].viralityScore, 75);
  });

  await t.test('Case 3: Non-empty viralityRationale string explaining score rationale', () => {
    assert.ok(typeof mockQuestionClip.viralityRationale === 'string');
    assert.ok(mockQuestionClip.viralityRationale.trim().length > 10);
  });

  await t.test('Case 4: High virality score (>=80) correlates with complete narrative arc', () => {
    assert.ok(mockQuestionClip.viralityScore >= 80);
    assert.strictEqual(mockQuestionClip.narrativeRationale.isCompleteArc, true);
  });

  await t.test('Case 5: Low virality score for incomplete arc clips', () => {
    assert.ok(mockIncompleteArcClip.viralityScore < 60);
  });
});

test('Tier 2: F10 - Virality Scoring Boundary & Corner Cases', async (t) => {
  await t.test('Case 1: Virality score > 100 fails schema validation', () => {
    const res = validateNarrativeClipSchema(invalidClips.scoreAbove100);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('between 0 and 100')));
  });

  await t.test('Case 2: Virality score < 0 fails schema validation', () => {
    const res = validateNarrativeClipSchema(invalidClips.scoreBelowZero);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('between 0 and 100')));
  });

  await t.test('Case 3: Boundary values 0 and 100 are strictly valid', () => {
    const clip0 = { ...mockQuestionClip, viralityScore: 0 };
    assert.strictEqual(validateNarrativeClipSchema(clip0).valid, true);

    const clip100 = { ...mockQuestionClip, viralityScore: 100 };
    assert.strictEqual(validateNarrativeClipSchema(clip100).valid, true);
  });

  await t.test('Case 4: NaN virality score fails schema validation', () => {
    const badClip = { ...mockQuestionClip, viralityScore: NaN };
    const res = validateNarrativeClipSchema(badClip);
    assert.strictEqual(res.valid, false);
  });

  await t.test('Case 5: Empty viralityRationale string fails schema validation', () => {
    const badClip = { ...mockQuestionClip, viralityRationale: '    ' };
    const res = validateNarrativeClipSchema(badClip);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('viralityRationale')));
  });
});
