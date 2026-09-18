# ClipAIv2 Testing Infrastructure (`TEST_INFRA.md`)

## 1. Executive Summary

This document defines the architecture, methodology, fixture generation, and verification harness for **ClipAIv2**.
Built strictly in accordance with `ORIGINAL_REQUEST.md` and `PROJECT.md`, the testing suite uses **Node.js 24 native test runner (`node:test` and `node:assert`)** and native **FFmpeg 7.1 (`lavfi`)** for zero external test dependency bloat, high execution velocity, and 100% offline self-containment.

---

## 2. Testing Framework & Philosophy

1. **Native Runner**: Uses `node:test` and `node:assert`. Eliminates heavy external frameworks (Jest, Mocha, Vitest) and runs natively in sub-second times.
2. **Progressive Testability & Determinism**: All expected values are mathematically derived or extracted from authoritative schemas in `PROJECT.md`.
3. **Synthetic Media Independence**: Audio and video fixtures are generated on-the-fly or via pre-generation using FFmpeg `lavfi` synthetic source generators (`testsrc`, `sine`, `anullsrc`, `drawbox`, `concat`), requiring zero network downloads or binary blobs in Git.
4. **Active Speech Hard Invariant**: For all spoken word tokens $w \in \text{words}$, no cut point $T$ may ever fall inside $(w.\text{start}, w.\text{end})$.

---

## 3. The 4-Tier Testing Methodology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     TIER 4: REAL-WORLD SCENARIOS                        │
│   (Multi-Speaker Podcast, Fast Monologue Lecture, Noisy Audio Stream)    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                  TIER 3: CROSS-FEATURE INTERACTIONS                     │
│ (Words->Sentences->Silences->Snapping, IDs->Narrative->Resolution, ...) │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                 TIER 2: BOUNDARY & CORNER CASES                         │
│ (Empty arrays, single word, long pauses, zero silences, extreme ratios) │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                    TIER 1: FEATURE COVERAGE                             │
│       (>= 5 test cases per feature for all 16 features F1 - F16)        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tier 1: Feature Coverage (F1 – F16)
Every single feature defined in `PROJECT.md` is tested with at least 5 distinct test cases exercising primary behaviors, schema adherence, and interfaces:
- **F1: Word-Level Transcript Preservation**: Start/end timestamps, confidence preservation, speaker labeling, full text assembly, chronological ordering.
- **F2: Discrete Sentence Segmentation**: Terminal punctuation splitting, pause threshold splitting (>=0.8s), speaker turn transitions, sequential ID assignment (`s1`..`sN`), token attribution.
- **F3: Dual-Layer Silence Detection**: Linguistic gaps (>=300ms), lead-in silence, trailing silence, acoustic silence via FFmpeg stderr parsing, hybrid interval merging.
- **F4: Boundary Snapping Engine**: Start snapping (<100ms), end snapping (<100ms), trailing silence snapping, leading silence snapping, dual boundary snapping.
- **F5: Active Speech Protection**: Hard invariant test ($\forall w: T \notin (w.\text{start}, w.\text{end})$), mid-word start push, mid-word end push, collision detector accuracy, continuous speech handling.
- **F6: Audio Seam Crossfading**: 30ms fade-in at `st=0`, 30ms fade-out ending at duration, comma-separated filter graph generation, arbitrary duration math, FFmpeg audio fade verification.
- **F7: Discrete Sentence ID Prompting**: Prompt formatting with `[s1]..[sN]`, video duration embedding, output field requirements, speaker labels, standardized hook taxonomy inclusion.
- **F8: Hook Classification Engine**: Standard taxonomy validation (`question`, `bold_statement`, `negative_hook`, `story_anecdote`, `shocking_fact`, `action_instruction`), hook text extraction.
- **F9: Narrative Arc Evaluation**: Complete arc validation (setup, climax, conclusion, `isCompleteArc: true`), incomplete arc detection, setup/climax/conclusion semantics.
- **F10: Virality Scoring & Rationale**: Range enforcement [0, 100], descending rank sorting, rationale non-empty check, high virality correlation, parsing integrity.
- **F11: Deterministic Sentence ID Resolution**: Start/end ID mapping to pre-snapped timestamps, $O(1)$ `SentenceMap` lookup, metadata preservation, resolved sentence counting, snapping detail attachment.
- **F12: OpenCV-based Face Tracking**: Normalized coordinate range [0.0, 1.0], moving average temporal smoothing, multi-speaker anchor mapping, center fallback (0.5), safe margin clamping [0.15, 0.85].
- **F13: Smooth Camera Easing (9:16)**: Cosine easing curve, smoothstep curve, numerical derivative verification ($\max \Delta x \le 25\text{px/frame}$ at 30fps), continuous position curve (no jump discontinuities), FFmpeg easing crop expression builder.
- **F14: Stacked Split-Screen Layout**: `vstack=inputs=2` filter graph, top panel 1080x960 cropping/scaling, bottom panel 1080x960 cropping/scaling, 1080x1920 combined output, FFmpeg 2-speaker dialogue render verification.
- **F15: Production 9:16 Conformance**: Even dimension enforcement (preventing 607x1079 odd dimension bug), 9/16 aspect ratio accuracy, fixed 1080x1920 render targets, 4K downscaling, YUV420p chroma subsampling compliance.
- **F16: Automated Verification Test Suite**: Automated boundary check, speech collision validator, narrative quality validator, camera velocity validator, video conformance probe.

### Tier 2: Boundary & Corner Cases (F1 – F16)
Tests edge conditions, extreme parameters, and invalid input combinations:
- **Empty inputs**: Empty word arrays, empty sentence lists, empty silence intervals.
- **Single elements**: Single word transcript, single sentence prompt, single sample trajectory.
- **Extreme durations**: Zero-duration words, 40ms ultra-short clips (<60ms crossfade), 1-hour long clips, negative timestamps.
- **Extreme ratios & resolutions**: 4K (3840x2160), 720p (1280x720), 4:3 (1440x1080), odd dimensions (1921x1079), pre-vertical (1080x1920).
- **Adversarial speech intervals**: Continuous speech with zero pauses, overlapping speech tokens, micro-words (50ms), abbreviations/decimals ("Dr. Smith", "3.14").
- **Error cascading**: Non-existent sentence IDs (`s999`), inverted sentence IDs (`s3` to `s1`), invalid hook classifications, scores outside [0, 100].

### Tier 3: Cross-Feature Interactions
Pairwise and end-to-end multi-module pipelines:
- **Interaction 1 (F1+F2+F3+F4+F5)**: Word tokens -> Sentences -> Silences -> Boundary Snapping with Active Speech Protection.
- **Interaction 2 (F2+F7+F8+F9+F10+F11)**: Sentences -> Discrete ID Prompting -> Hook Classification -> Deterministic Sentence ID Resolution.
- **Interaction 3 (F3+F4+F6)**: Silence Detection + Boundary Snapping + 30ms Audio Seam Crossfading.
- **Interaction 4 (F12+F13+F15)**: Face Tracking Anchors + Smooth Camera Easing Expression + Production 9:16 Video Rendering.
- **Interaction 5 (F14+F6+F15)**: Stacked Split-Screen Multi-Speaker Layout + Audio Crossfade + 1080x1920 Render Conformance.

### Tier 4: Real-World Scenarios
High-fidelity simulated production scenarios:
- **Scenario 1: Multi-Speaker Podcast Dialogue**: Alternating Host & Guest turns, natural conversational pauses (>700ms), question hook, stacked split-screen layout (`vstack`), 30ms audio seam crossfade.
- **Scenario 2: Fast Monologue Lecture**: Solo lecturer, high words per minute, continuous rapid speech, bold statement hook, single smooth camera tracking with even crop dimensions.
- **Scenario 3: Noisy Audio Environment**: Low-confidence word tokens (0.35 - 0.60), background acoustic noise, robust silence intervals, speech collision protection under degraded transcript quality.

---

## 4. Test Suite Layout

```
ClipAIv2/
├── scripts/
│   ├── generate-fixtures.js     # CLI fixture generator (synthetic media & transcripts)
│   └── verify-pipeline.js       # Single executable acceptance criteria runner
├── tests/
│   ├── fixtures/
│   │   ├── syntheticMedia.js    # FFmpeg lavfi generator & ffprobe media prober
│   │   ├── mockTranscripts.js   # Word-level mock transcripts for all edge cases
│   │   ├── mockNarratives.js    # Standard hook taxonomy & narrative schema validators
│   │   └── testHarnessHelpers.js# Pure helper implementations for test assertions
│   ├── unit/
│   │   ├── f1_transcription.test.js           # Feature F1 (Tier 1 & 2)
│   │   ├── f2_segmentation.test.js            # Feature F2 (Tier 1 & 2)
│   │   ├── f3_silence.test.js                 # Feature F3 (Tier 1 & 2)
│   │   ├── f4_f5_snapping.test.js             # Features F4 & F5 (Tier 1 & 2)
│   │   ├── f6_crossfade.test.js               # Feature F6 (Tier 1 & 2)
│   │   ├── f7_f11_prompting_resolution.test.js# Features F7 & F11 (Tier 1 & 2)
│   │   ├── f8_f9_f10_narrative.test.js        # Features F8, F9, F10 (Tier 1 & 2)
│   │   ├── f12_facetracking.test.js           # Feature F12 (Tier 1 & 2)
│   │   ├── f13_easing.test.js                 # Feature F13 (Tier 1 & 2)
│   │   ├── f14_splitscreen.test.js            # Feature F14 (Tier 1 & 2)
│   │   ├── f15_conformance.test.js            # Feature F15 (Tier 1 & 2)
│   │   └── f16_verification.test.js           # Feature F16 (Tier 1 & 2)
│   └── integration/
│       ├── tier3_cross_feature.test.js        # Tier 3 Cross-feature interactions
│       ├── tier4_real_world.test.js           # Tier 4 Real-world production scenarios
│       └── e2e_pipeline.test.js               # Full end-to-end integration pass
├── TEST_INFRA.md                # This document
└── TEST_READY.md                # Readiness sign-off and verification report
```

---

## 5. How to Run the Tests

### 1. Generate Synthetic Media Fixtures
```bash
node scripts/generate-fixtures.js
```
*(Creates `tests/fixtures/media/sample_dialogue_1080p.mp4`, `sample_standard_1080p.mp4`, `sample_silence_audio.wav`, and `mock_transcripts.json` using native FFmpeg `lavfi` in ~4 seconds).*

### 2. Run the Complete Automated Test Suite (220 Tests)
```bash
node --test tests/unit/*.test.js tests/integration/*.test.js
```
*(Executes all Tier 1, Tier 2, Tier 3, and Tier 4 test suites using Node 24 native test runner in ~4 seconds with 0 external npm dependencies).*

### 3. Run Acceptance Criteria Verification Harness
```bash
node scripts/verify-pipeline.js
```
*(Validates all 6 Acceptance Criteria from `ORIGINAL_REQUEST.md` and generates the final Verification Report Card).*
