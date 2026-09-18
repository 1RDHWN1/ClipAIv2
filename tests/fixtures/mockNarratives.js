// tests/fixtures/mockNarratives.js
/**
 * Mock Narrative Payloads and Schema Validators for M2 / R2
 * Standardizes hook classifications, narrative arcs, and virality scoring.
 */

export const VALID_HOOK_TAXONOMY = [
  'question',
  'bold_statement',
  'negative_hook',
  'story_anecdote',
  'shocking_fact',
  'action_instruction',
];

/** Valid recommended clip with 'question' hook */
export const mockQuestionClip = {
  startSentenceId: 's1',
  endSentenceId: 's2',
  start: 1.00,
  end: 4.70,
  title: 'Have You Ever Lost Everything?',
  hookClassification: 'question',
  hookText: 'Have you ever lost everything?',
  narrativeRationale: {
    setup: 'Host questions whether the guest experienced catastrophic failure.',
    climax: 'Guest reveals their company went bankrupt in 2020.',
    conclusion: 'They pivoted the entire company into AI and found massive growth.',
    isCompleteArc: true,
  },
  viralityScore: 92,
  viralityRationale: 'High emotional stakes with relatable failure and turnaround story.',
};

/** Valid recommended clip with 'bold_statement' hook */
export const mockBoldStatementClip = {
  startSentenceId: 's1',
  endSentenceId: 's2',
  start: 0.50,
  end: 6.55,
  title: 'AI is Transforming Every Industry',
  hookClassification: 'bold_statement',
  hookText: 'Artificial intelligence is fundamentally transforming every single industry.',
  narrativeRationale: {
    setup: 'A bold claim about technological disruption sweeping through the economy.',
    climax: 'Warning that inaction leads to getting left behind permanently.',
    conclusion: 'Call to adapt immediately to the technological wave.',
    isCompleteArc: true,
  },
  viralityScore: 88,
  viralityRationale: 'Urgency and fear-of-missing-out trigger strong viewer retention.',
};

/** Valid recommended clip with 'negative_hook' */
export const mockNegativeHookClip = {
  startSentenceId: 's1',
  endSentenceId: 's2',
  start: 1.00,
  end: 5.50,
  title: 'Stop Making This Huge Mistake',
  hookClassification: 'negative_hook',
  hookText: 'Never invest your savings without understanding this one fatal mistake.',
  narrativeRationale: {
    setup: 'Warning viewers about a hidden trap in everyday personal finance.',
    climax: 'Explaining how inflation quietly destroys uninvested cash.',
    conclusion: 'Practical rule of thumb to preserve purchasing power.',
    isCompleteArc: true,
  },
  viralityScore: 85,
  viralityRationale: 'Negative framing outperforms positive advice in social click-through.',
};

/** Valid recommended clip with 'story_anecdote' */
export const mockStoryAnecdoteClip = {
  startSentenceId: 's2',
  endSentenceId: 's4',
  start: 3.10,
  end: 8.90,
  title: 'The Secret That Changed Everything',
  hookClassification: 'story_anecdote',
  hookText: 'Back when I had only fifty dollars in my bank account...',
  narrativeRationale: {
    setup: 'Personal origin story during extreme scarcity.',
    climax: 'First breakthrough client after fifty cold outreach calls.',
    conclusion: 'Lesson on perseverance in early business stages.',
    isCompleteArc: true,
  },
  viralityScore: 89,
  viralityRationale: 'Underdog narrative structure with relatable emotional payoff.',
};

/** Valid recommended clip with 'shocking_fact' */
export const mockShockingFactClip = {
  startSentenceId: 's1',
  endSentenceId: 's3',
  start: 0.00,
  end: 5.00,
  title: '90 Percent of People Do Not Know This',
  hookClassification: 'shocking_fact',
  hookText: 'Ninety percent of video editors waste three hours every day doing this manually.',
  narrativeRationale: {
    setup: 'Astonishing productivity statistic that challenges common practice.',
    climax: 'Demonstrating automated pipeline in under thirty seconds.',
    conclusion: 'Workflow takeaway for professional creators.',
    isCompleteArc: true,
  },
  viralityScore: 91,
  viralityRationale: 'Counterintuitive statistic produces curiosity gap.',
};

/** Valid recommended clip with 'action_instruction' */
export const mockActionInstructionClip = {
  startSentenceId: 's1',
  endSentenceId: 's2',
  start: 2.00,
  end: 7.00,
  title: 'Try This 30-Second Productivity Hack',
  hookClassification: 'action_instruction',
  hookText: 'Do this first thing tomorrow morning before opening your email.',
  narrativeRationale: {
    setup: 'Direct tactical instruction that can be tested immediately.',
    climax: 'Scientific explanation of dopamine management and focus.',
    conclusion: 'Actionable step for daily routine.',
    isCompleteArc: true,
  },
  viralityScore: 84,
  viralityRationale: 'Immediate tactical utility drives high saves and shares.',
};

/** Clip with incomplete narrative arc */
export const mockIncompleteArcClip = {
  startSentenceId: 's1',
  endSentenceId: 's1',
  start: 1.00,
  end: 2.50,
  title: 'Unfinished Thought',
  hookClassification: 'question',
  hookText: 'Why does this happen?',
  narrativeRationale: {
    setup: 'Speaker introduces a question.',
    climax: '',
    conclusion: '',
    isCompleteArc: false,
  },
  viralityScore: 45,
  viralityRationale: 'Lacks narrative resolution; abruptly cuts off before explanation.',
};

/** Invalid clip payloads for negative / boundary testing */
export const invalidClips = {
  missingHook: {
    startSentenceId: 's1',
    endSentenceId: 's2',
    start: 1.0,
    end: 4.0,
    title: 'No Hook',
    narrativeRationale: { setup: 's', climax: 'c', conclusion: 'co', isCompleteArc: true },
    viralityScore: 80,
  },
  invalidHookType: {
    startSentenceId: 's1',
    endSentenceId: 's2',
    start: 1.0,
    end: 4.0,
    hookClassification: 'unsupported_hook_type',
    viralityScore: 80,
  },
  scoreAbove100: {
    startSentenceId: 's1',
    endSentenceId: 's2',
    start: 1.0,
    end: 4.0,
    hookClassification: 'question',
    viralityScore: 150,
  },
  scoreBelowZero: {
    startSentenceId: 's1',
    endSentenceId: 's2',
    start: 1.0,
    end: 4.0,
    hookClassification: 'question',
    viralityScore: -10,
  },
  missingSentenceIds: {
    start: 1.0,
    end: 4.0,
    hookClassification: 'question',
    viralityScore: 85,
  },
};

/**
 * Validates a clip object against the M2 / R2 contract schema.
 * @param {Object} clip
 * @returns {{ valid: boolean, errors: Array<string> }}
 */
export function validateNarrativeClipSchema(clip) {
  const errors = [];
  if (!clip || typeof clip !== 'object') {
    return { valid: false, errors: ['Clip must be a non-null object'] };
  }

  // startSentenceId and endSentenceId
  if (typeof clip.startSentenceId !== 'string' || !/^s\d+$/.test(clip.startSentenceId)) {
    errors.push(`Invalid or missing startSentenceId: "${clip.startSentenceId}"`);
  }
  if (typeof clip.endSentenceId !== 'string' || !/^s\d+$/.test(clip.endSentenceId)) {
    errors.push(`Invalid or missing endSentenceId: "${clip.endSentenceId}"`);
  }

  // start and end timestamps
  if (typeof clip.start !== 'number' || isNaN(clip.start) || clip.start < 0) {
    errors.push(`Invalid start timestamp: ${clip.start}`);
  }
  if (typeof clip.end !== 'number' || isNaN(clip.end) || clip.end <= clip.start) {
    errors.push(`Invalid end timestamp: ${clip.end} (must be > start ${clip.start})`);
  }

  // hookClassification
  if (!VALID_HOOK_TAXONOMY.includes(clip.hookClassification)) {
    errors.push(`Invalid hookClassification: "${clip.hookClassification}". Must be one of: ${VALID_HOOK_TAXONOMY.join(', ')}`);
  }

  // hookText
  if (typeof clip.hookText !== 'string' || clip.hookText.trim().length === 0) {
    errors.push('Missing or empty hookText');
  }

  // narrativeRationale
  if (!clip.narrativeRationale || typeof clip.narrativeRationale !== 'object') {
    errors.push('Missing narrativeRationale object');
  } else {
    const { setup, climax, conclusion, isCompleteArc } = clip.narrativeRationale;
    if (typeof setup !== 'string') errors.push('narrativeRationale.setup must be a string');
    if (typeof climax !== 'string') errors.push('narrativeRationale.climax must be a string');
    if (typeof conclusion !== 'string') errors.push('narrativeRationale.conclusion must be a string');
    if (typeof isCompleteArc !== 'boolean') errors.push('narrativeRationale.isCompleteArc must be a boolean');
  }

  // viralityScore
  if (typeof clip.viralityScore !== 'number' || isNaN(clip.viralityScore) || clip.viralityScore < 0 || clip.viralityScore > 100) {
    errors.push(`viralityScore must be a number between 0 and 100, got: ${clip.viralityScore}`);
  }

  // viralityRationale
  if (typeof clip.viralityRationale !== 'string' || clip.viralityRationale.trim().length === 0) {
    errors.push('viralityRationale must be a non-empty string');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
