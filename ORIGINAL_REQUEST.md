# Original User Request

## 2026-09-18T04:58:26Z

Upgrade and modernize the ClipAIv2 video clipping codebase to achieve high-precision highlight detection, seamless sentence-boundary trimming, and production-grade 9:16 vertical video reframing.

Working directory: C:\Users\eniku\Documents\antigravity\ClipAIv2
Integrity mode: development

## Requirements

### R1. Sentence-Boundary Snapping and Word-Level Alignment
The audio/transcript processing pipeline must align transcription data down to word-level timestamps. The system must eliminate abrupt mid-word or mid-sentence cuts by automatically snapping clip start and end boundaries to natural linguistic pauses and silence intervals.

### R2. High-Precision Narrative Scoring
The AI analysis module must evaluate transcripts using contextual sentence chunks, identifying viral hooks, complete narrative arcs (setup, climax, conclusion), and compelling standalone stories. The model output must reference explicit sentence boundary identifiers rather than arbitrary floating-point timestamps.

### R3. Smooth Vertical Reframing (9:16)
The visual cropping system must track primary speakers smoothly across frames. Abrupt coordinate jumping must be replaced with smooth camera easing/transitions or multi-speaker layout detection (such as stacked split-screen for dialogues).

### R4. Automated Verification Suite
Provide an automated verification script that feeds a sample media file (or realistic mock data) through the pipeline and validates that:
- Timestamps strictly align with sentence boundaries.
- No audio cuts occur during active speech tokens.
- Generated output video files adhere to valid 9:16 aspect ratios with non-zero durations.

## Acceptance Criteria

### Audio & Boundary Precision
- [ ] Automated boundary test confirms clip start and end timestamps snap to within 100ms of a sentence boundary or silence gap (>300ms pause).
- [ ] No clip cuts off in the middle of a spoken word.

### Analysis & Hook Quality
- [ ] Every recommended clip includes a valid hook classification, narrative rationale, and virality score.
- [ ] Clip recommendations reference valid discrete sentence or segment IDs from the input transcript.

### Visual Cropping & Reframing
- [ ] Framing coordinates transition smoothly between speaker shifts without 1-frame coordinate snapping artifacts.
- [ ] Output video streams produce valid 9:16 (1080x1920 or scaled equivalent) render outputs.

### Pipeline Reliability
- [ ] End-to-end integration test passes successfully with zero unhandled promise rejections or worker crashes.

## 2026-09-18T19:09:24Z

The user requested a full team with separate reviewers and specialists to implement universal multilingual processing in ClipAIv2.

Upgrade the ClipAIv2 video clipping pipeline to support universal multilingual processing—specifically providing first-class English and Indonesian support with dynamic language detection across subtitle extraction, audio transcription, sentence boundary tokenization, and AI narrative analysis.

Working directory: C:\Users\eniku\Documents\antigravity\ClipAIv2
Integrity mode: development

## Requirements

### R1. Universal Audio Transcription and Subtitle Ingestion
The transcription pipeline (Groq Whisper, AssemblyAI, YouTube subtitles, and Gemini) must dynamically detect the spoken language rather than forcing Indonesian (`id`). The YouTube subtitle downloader must query and parse available native or auto-generated subtitles across languages (`--sub-lang "id-orig,id,en-orig,en,all"` or dynamic priority matching) and attach the correct ISO language code.

### R2. Multilingual Sentence Segmentation and Abbreviation Resilience
The linguistic segmentation engine (`sentenceSegmenter.js`) must support international abbreviation rules (e.g., English honorifics and terms like `Mr.`, `Mrs.`, `Dr.`, `Prof.`, `e.g.`, `i.e.`, `Inc.`, `vs.` alongside Indonesian `No.`, `dsb.`) without prematurely cutting sentences mid-abbreviation.

### R3. Language-Adaptive AI Narrative and Hook Analysis
The AI analyzer prompt (`analyzer.js`) must identify the source language of the transcript and produce clip recommendations, titles, hook descriptions, and virality rationales in that matching native language (e.g., English source produces natural English titles and hooks; Indonesian source produces Indonesian).

### R4. Automated Verification and Backward Compatibility
Provide programmatic test coverage confirming English audio and subtitle ingestion, abbreviation-safe sentence segmentation, and language-adaptive prompting. All existing 252 unit tests and pipeline acceptance criteria (`npm test` and `npm run verify`) must continue to pass with zero regressions.

## Acceptance Criteria

### Audio & Subtitle Language Detection
- [ ] Pipeline correctly tags transcripts from English sources with `language: 'en'`.
- [ ] YouTube subtitle downloader successfully retrieves English subtitles when Indonesian is unavailable, without failing or falling back prematurely.
- [ ] Whisper / AssemblyAI configurations operate with dynamic language auto-detection when `TRANSCRIBE_LANGUAGE` is unset or set to `auto`.

### Segmentation & Linguistic Precision
- [ ] Automated test confirms sentences containing English abbreviations (`Mr.`, `Mrs.`, `Dr.`, `e.g.`, `i.e.`, `Inc.`) do not split at abbreviation periods.
- [ ] Start and end timestamps for multilingual clips maintain strict sentence-boundary snapping and silence gap protection.

### Language-Adaptive Analysis Quality
- [ ] When presented with an English transcript, the AI analyzer generates clip titles, hooks, and rationales in natural English.
- [ ] Hook taxonomy remains normalized and valid across languages while hook text reflects the source video dialogue.

### Regression & Pipeline Health
- [ ] All existing 252 unit and integration tests pass cleanly via `npm test`.
- [ ] `npm run verify` runs with 0 violations and all 6 acceptance criteria passing.

## 2026-09-18T20:23:27Z

The user requested a full team with separate reviewers and specialists to implement the Gemini 3.8 Flash High brain upgrade, high-virality prompt engine, and modern animated auto-subtitle system in ClipAIv2.

Upgrade ClipAIv2's AI brain to `ag/gemini-3.8-flash-high` with an elite virality-scoring and high-CTR title generation prompt, and implement a production-ready animated auto-subtitle system (word-by-word active highlighting, popular viral presets, customizable fonts/colors/position, and Web UI/API controls) burned into the 9:16 vertical video renders.

Working directory: C:\Users\eniku\Documents\antigravity\ClipAIv2
Integrity mode: development

## Requirements

### R1. AI Model Upgrade & High-Virality Narrative Strategy Engine
- Update the default AI model in `.env`, `analyzer.js`, and the worker cascade to `ag/gemini-3.8-flash-high` (with resilient fallback to configured local AI gateway endpoints).
- Re-engineer the narrative analyzer prompt to act as an elite viral content strategist (inspired by Opus Clip and modern short-form virality formulas):
  - Prioritize strong pattern interrupts, curiosity gaps, and emotional hooks in the first 0–3 seconds of each clip.
  - Generate punchy, high-CTR titles (avoiding bland summaries like "Compelling Clip" or generic labels; crafting curiosity-inducing titles with power words in the video's source language).
  - Score virality strictly on hook strength, pacing, retention potential, and payoff clarity.

### R2. Animated Auto-Subtitle Rendering Engine (ASS / FFmpeg Burn-in)
- Build an auto-subtitle module (`utils/subtitleGenerator.js`) converting word-level timestamps from `UnifiedTranscript.words` into styled Advanced SubStation Alpha (`.ass`) subtitle files.
- Support dynamic word-by-word active highlighting (karaoke/pop animation where each spoken word illuminates with a highlight color as it is spoken) with 2–4 punchy words per frame for short-form video pacing.
- Support customizable styling:
  - Font family (e.g., Arial, Impact, Montserrat, Roboto, The Bold Font).
  - Font size scaled properly for 1080x1920 (9:16 vertical resolution).
  - Primary text color, active highlight color (e.g., neon yellow, toxic green, electric cyan), outline/stroke width and color, and shadow.
  - Vertical alignment (bottom safe area, center, top).
  - Uppercase/all-caps toggle.
- Integrate subtitle burn-in into `utils/clipper.js` (`processClips`) so the `.ass` filter is applied cleanly alongside the face-tracking 9:16 crop filter without coordinate conflicts or FFmpeg crashes.
- Subtitle rendering must be toggleable (On/Off).

### R3. Viral Presets, Web UI Controls & API Integration
- Implement pre-configured viral subtitle presets:
  - **Hormozi Yellow**: Bold white text, active word neon yellow (`#FFE600`), thick black outline, bottom-center position.
  - **MrBeast Green**: Bold white text, active word toxic green (`#00FF66`), thick black outline.
  - **Cyber Cyan**: Bold white text, active word electric cyan (`#00E5FF`), sleek modern outline.
  - **Clean Minimal**: Crisp white text with subtle shadow, lower-third position.
- Update the Web UI (`public/index.html`, `public/app.js` or client script):
  - Toggle switch/checkbox: "✨ Enable Auto Subtitles (Burn-in)".
  - Preset style dropdown selector.
  - Expandable styling controls: Font selector, Active Highlight Color picker, Font size slider, Vertical Position selector (Bottom, Center, Top).
- Update the API route (`routes/api.js`) to accept `subtitleConfig` in `POST /api/process` and forward it via BullMQ job payload.

### R4. Automated Verification Suite & Zero-Regression Invariant
- Add unit tests verifying `.ass` subtitle generation, word timing synchronization, style preset compilation, and model configuration.
- Add an automated test verifying FFmpeg burns subtitles into a media clip fixture without errors.
- Ensure all 285 existing tests and acceptance verification checks (`npm test` and `npm run verify`) continue to pass with zero regressions.

## Acceptance Criteria

### AI Brain & Prompt Virality
- [ ] AI model resolves to `ag/gemini-3.8-flash-high` in `analyzer.js` and `.env`.
- [ ] Recommended clips feature high-CTR titles and clear 0–3s hook rationales aligned with the source video language.

### Auto-Subtitle Generation & Video Rendering
- [ ] Word timestamps from transcript correctly compile into valid `.ass` subtitle files with active-word highlight tags.
- [ ] FFmpeg successfully renders 9:16 video with burned-in subtitles when enabled.
- [ ] Video renders cleanly without subtitles when the feature is toggled off.

### Web UI & API Customization
- [ ] Web UI displays subtitle enable/disable toggle, preset selector, and custom styling controls (font, color, position).
- [ ] API endpoint `POST /api/process` accepts and passes `subtitleConfig` to the worker pipeline.

### Pipeline Reliability & Test Coverage
- [ ] All 285 existing unit tests pass cleanly via `npm test`.
- [ ] `npm run verify` runs with 0 violations across all 6 acceptance criteria.

