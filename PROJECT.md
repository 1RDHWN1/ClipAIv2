# Project: ClipAIv2 Modernization & Auto-Subtitle Engine

## Architecture
ClipAIv2 is a high-performance Node.js (ESM) video highlight detection and clipping service. This phase upgrades the AI narrative intelligence to `ag/gemini-3.8-flash-high` with an elite virality strategist prompt, and introduces a production-ready animated auto-subtitle engine (.ass / FFmpeg burn-in) with viral presets, Web UI/API controls, and comprehensive verification.

```
[Source Video / YouTube / Upload]
         │
         ▼
[Audio Extraction & Transcription] (AssemblyAI / Groq / YouTube Subs)
         │
         ▼ (UnifiedTranscript with WordToken[])
[Sentence Segmenter & Silence Detector]
         │
         ▼ (discrete SentenceSegment[]: s1, s2...)
[AI Narrative Analyzer: Gemini 3.8 Flash High]
(0-3s pattern interrupts, curiosity gaps, high-CTR titles in source language,
 4-pillar virality scoring: hook, pacing, retention, payoff)
         │
         ▼ (recommended clips with discrete sentence IDs)
[Boundary Snapper & Speech Protection]
         │
         ▼ (snapped start/end timestamps, clip word tokens)
┌────────────────────────────────────────────────────────────────────────┐
│ Clipper & Subtitle Engine (processClips)                               │
│                                                                        │
│   [Subtitle Generator] (utils/subtitleGenerator.js)                    │
│   - Word-by-word active highlighting ({\c&H...&})                      │
│   - 2-4 punchy words per frame chunking                                │
│   - Viral presets: Hormozi, MrBeast, Cyber Cyan, Clean Minimal         │
│   - Scaled for 1080x1920 (PlayResX: 1080, PlayResY: 1920)              │
│   - Windows-safe path escaping: ass='C\:/path/to/subs.ass'             │
│                                                                        │
│   [Visual Reframer & FFmpeg Filterchain]                               │
│   - Face tracking + smooth easing crop filter                          │
│   - Scale & pad to 1080x1920                                           │
│   - Chained ASS subtitle burn-in (toggleable on/off)                   │
└────────────────────────────────────────────────────────────────────────┘
         │
         ▼
[Production 9:16 (1080x1920) Video Output with Burned-in Subtitles]
```

## Feature Inventory
Every feature from ORIGINAL_REQUEST.md (specifically 2026-09-18T20:23:27Z) is mapped here to its assigned milestone:

| # | Feature | Description | Milestone | Source |
|---|---|---|---|---|
| F1 | AI Model Upgrade (`ag/gemini-3.8-flash-high`) | Update default model in `.env`, `server.js`, and `utils/analyzer.js` to `ag/gemini-3.8-flash-high` with resilient fallback cascade | M1 | ORIGINAL_REQUEST §R1 |
| F2 | 0-3s Pattern Interrupt & Curiosity Hook Prompt | Re-engineer analyzer prompt into an elite viral content strategist prioritizing 0-3s hooks, pattern interrupts, and curiosity gaps | M1 | ORIGINAL_REQUEST §R1 |
| F3 | High-CTR Source-Language Title Generation | Prompt engine crafts punchy, curiosity-inducing titles in the video's detected source language, avoiding generic labels | M1 | ORIGINAL_REQUEST §R1 |
| F4 | 4-Pillar Virality Scoring | Score virality strictly on hook strength, pacing, retention potential, and payoff clarity (0-100) | M1 | ORIGINAL_REQUEST §R1 |
| F5 | Fallback Resilience to Local Gateway | Resilient multi-tier candidate cascade for AI endpoints (primary local 9Router -> fallback gateway -> OpenRouter) with robust error recovery | M1 | ORIGINAL_REQUEST §R1 |
| F6 | Animated Auto-Subtitle Generator (`.ass`) | Build `utils/subtitleGenerator.js` compiling word timestamps from `UnifiedTranscript.words` into styled `.ass` subtitles | M2 | ORIGINAL_REQUEST §R2 |
| F7 | Word-by-Word Active Highlighting | Implement karaoke/pop active illumination where each spoken word highlights in real-time | M2 | ORIGINAL_REQUEST §R2 |
| F8 | Pacing Optimization (2-4 Words/Frame) | Chunk spoken dialogue into 2-4 punchy words per frame synchronized to speech start/end | M2 | ORIGINAL_REQUEST §R2 |
| F9 | Full Styling Customization | Support font family, font size for 1080x1920, primary text color, active highlight color, outline width/color, shadow, vertical alignment, and uppercase toggle | M2 | ORIGINAL_REQUEST §R2 |
| F10 | FFmpeg Filter Chaining & Windows Path Escaping | Chain `ass='...'` after 9:16 crop/scale/pad in `utils/clipper.js` using Windows-safe single-quoted, escaped-colon paths | M2 | ORIGINAL_REQUEST §R2 |
| F11 | Subtitle Toggleability (On/Off) | Clean on/off switch: when disabled, no ASS filter attached, zero performance overhead | M2 | ORIGINAL_REQUEST §R2 |
| F12 | Viral Subtitle Presets | Built-in presets: Hormozi Yellow, MrBeast Green, Cyber Cyan, Clean Minimal | M3 | ORIGINAL_REQUEST §R3 |
| F13 | Web UI Controls | Toggle switch ("✨ Enable Auto Subtitles"), preset selector, and collapsible custom styling controls in `public/index.html` | M3 | ORIGINAL_REQUEST §R3 |
| F14 | API & Worker Subtitle Integration | `routes/api.js` accepts and validates `subtitleConfig`, forwards via BullMQ job payload, and `workers/videoWorker.js` passes it to `processClips` | M3 | ORIGINAL_REQUEST §R3 |
| F15 | Subtitle Unit Test Suite | Comprehensive unit tests for `.ass` generation, word timing sync, style presets, and model config | M4 | ORIGINAL_REQUEST §R4 |
| F16 | FFmpeg Subtitle Burn-In Fixture Test | Automated test verifying FFmpeg burns subtitles into a media clip fixture without errors | M4 | ORIGINAL_REQUEST §R4 |
| F17 | Zero-Regression Invariant | Verify all 285 existing unit tests pass cleanly (`npm test`) and `npm run verify` runs with 0 violations across all 6 acceptance criteria | M4 | ORIGINAL_REQUEST §R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | AI Model Upgrade & High-Virality Narrative Engine | F1, F2, F3, F4, F5: `ag/gemini-3.8-flash-high`, viral prompt engine, high-CTR titles, virality scoring, gateway fallback | None | DONE |
| M2 | Animated Auto-Subtitle Rendering Engine | F6, F7, F8, F9, F10, F11: `utils/subtitleGenerator.js`, active highlighting, 2-4 words/frame, `utils/clipper.js` FFmpeg filter chaining | None | PLANNED |
| M3 | Viral Presets, Web UI Controls & API Integration | F12, F13, F14: 4 viral presets, `public/index.html` UI controls, `routes/api.js` validation, `videoWorker.js` payload forwarding | M2 | PLANNED |
| M4 | Automated Verification Suite & Zero-Regression | F15, F16, F17: unit tests, FFmpeg burn-in fixture test, 285 tests passing, `npm run verify` passing 6/6 | M1, M2, M3 | PLANNED |

## Interface Contracts

### M1: Analyzer & Virality Prompt Engine Contract
- Model Configuration:
  - Default Model: `ag/gemini-3.8-flash-high` in `.env`, `server.js`, and `utils/analyzer.js`.
  - Fallback Cascade: local gateway port 20128 -> fallback endpoint -> OpenRouter.
- Prompt & Response Schema:
  - System prompt includes viral content strategist persona, 0-3s pattern interrupt hooks, curiosity gaps, and source-language high-CTR titles.
  - Invariant tokens preserved: `'LANGUAGE REQUIREMENTS:'`, `'PETUNJUK BAHASA:'`, `'STRICT TAXONOMY INVARIANT:'`.
  - Output Clip schema preserves:
    ```javascript
    {
      startSentenceId: string,
      endSentenceId: string,
      title: string, // High-CTR, punchy title in source language
      hookClassification: string,
      hookText: string,
      narrativeRationale: { setup: string, climax: string, conclusion: string, isCompleteArc: boolean },
      viralityScore: number, // 0-100 strictly based on 4 pillars
      viralityRationale: string
    }
    ```

### M2: Subtitle Generator & Clipper Filterchain Contract
- Module: `utils/subtitleGenerator.js`:
  - `generateAssSubtitles(clipWords, clipStart, clipEnd, options = {})`:
    Returns `.ass` formatted string.
  - Options Schema (`subtitleConfig`):
    ```javascript
    {
      enabled: boolean, // default true when config provided
      preset: 'hormozi' | 'mrbeast' | 'cyberpunk' | 'minimal' | 'custom',
      fontFamily: string, // e.g. 'Impact', 'Arial', 'Montserrat'
      fontSize: number, // default 80 (scaled for 1080x1920)
      primaryColor: string, // hex e.g. '#FFFFFF'
      highlightColor: string, // hex e.g. '#FFE600'
      outlineColor: string, // hex e.g. '#000000'
      outlineWidth: number, // default 4
      shadow: number, // default 2
      verticalAlignment: 'bottom' | 'center' | 'top', // maps to ASS Alignment 2, 5, 8
      marginV: number, // default 300 for bottom safe area
      uppercase: boolean // default true for viral styles
    }
    ```
- FFmpeg Integration (`utils/clipper.js`):
  - If `subtitleConfig?.enabled` is true:
    - Write temporary `.ass` file: `path.join(outputDir, `subs_${clipIndex}.ass`)`.
    - Format Windows filter argument: `ass='${assPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'`.
    - Chain after crop/scale/pad filter in `-vf`.
    - Clean up temporary `.ass` file on completion.
  - If `subtitleConfig?.enabled` is false or omitted:
    - Omit `ass` filter completely. Existing video filter remains unchanged.

### M3: Web UI, API & Worker Integration Contract
- `POST /api/process` Payload:
  ```json
  {
    "url": "https://...",
    "aspectRatio": "9:16",
    "clipCount": 3,
    "subtitleConfig": {
      "enabled": true,
      "preset": "hormozi",
      "fontFamily": "Impact",
      "fontSize": 80,
      "highlightColor": "#FFE600",
      "verticalAlignment": "bottom",
      "uppercase": true
    }
  }
  ```
- BullMQ Job Data (`videoWorker.js`):
  `job.data.subtitleConfig` is forwarded directly into `processClips(videoPath, clips, metadata, { subtitleConfig, ... })`.

## Code Layout
- `.env`, `.env.example`: AI model defaults (`DEFAULT_MODEL=ag/gemini-3.8-flash-high`)
- `server.js`: Server-level model defaults
- `utils/analyzer.js`: High-virality prompt engine, model fallback cascade, narrative scoring
- `utils/subtitleGenerator.js`: ASS subtitle generation, word-by-word active highlighting, viral presets
- `utils/clipper.js`: FFmpeg filter chaining for ASS subtitles with Windows-safe escaping
- `public/index.html`: Web UI with subtitle toggle, preset selector, and custom styling controls
- `routes/api.js`: API route validation and `subtitleConfig` forwarding
- `workers/videoWorker.js`: BullMQ job worker forwarding `subtitleConfig` to `processClips`
- `tests/unit/subtitles_and_presets.test.js`: Unit tests for subtitle generation, presets, and model config
- `tests/integration/subtitle_burnin.test.js`: Automated FFmpeg subtitle burn-in fixture test
- `scripts/verify-pipeline.js`: Pipeline verification script ensuring 0 violations across all criteria
