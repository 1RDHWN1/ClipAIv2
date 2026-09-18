// scripts/generate-fixtures.js
/**
 * CLI Fixture Generator for ClipAIv2 Verification Harness
 *
 * Generates synthetic media fixtures and mock transcripts for test runs.
 * Uses native FFmpeg lavfi filters (testsrc, sine, anullsrc, drawbox, concat).
 * Zero external download dependencies.
 *
 * Usage:
 *   node scripts/generate-fixtures.js          # Generate all fixtures
 *   node scripts/generate-fixtures.js --clean  # Remove generated fixtures
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createSyntheticVideo,
  createTwoSpeakerVideo,
  createSyntheticAudioWithSilences,
  probeMedia,
  cleanupFixture,
} from '../tests/fixtures/syntheticMedia.js';
import * as mockTranscripts from '../tests/fixtures/mockTranscripts.js';

const FIXTURES_DIR = path.resolve('tests/fixtures/media');
const TRANSCRIPTS_JSON_PATH = path.resolve('tests/fixtures/mock_transcripts.json');

async function main() {
  const isClean = process.argv.includes('--clean');

  if (isClean) {
    console.log(`🧹 Cleaning test fixtures in ${FIXTURES_DIR}...`);
    cleanupFixture(FIXTURES_DIR);
    if (fs.existsSync(TRANSCRIPTS_JSON_PATH)) {
      fs.unlinkSync(TRANSCRIPTS_JSON_PATH);
    }
    console.log('✅ Fixtures cleaned successfully.');
    return;
  }

  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  console.log('🎬 Generating synthetic media fixtures for ClipAIv2...');

  // 1. Two-speaker dialogue video (1080p, 10s)
  const dialogueVideoPath = path.join(FIXTURES_DIR, 'sample_dialogue_1080p.mp4');
  console.log(`  [1/4] Generating dialogue video: ${dialogueVideoPath}`);
  await createTwoSpeakerVideo({
    outputPath: dialogueVideoPath,
    duration: 10,
    width: 1920,
    height: 1080,
  });
  const videoMeta = await probeMedia(dialogueVideoPath);
  console.log(`        Format: ${videoMeta.width}x${videoMeta.height}, Duration: ${videoMeta.duration}s, Size: ${(fs.statSync(dialogueVideoPath).size / 1024).toFixed(1)} KB`);

  // 2. Standard 16:9 test video (1080p, 6s)
  const standardVideoPath = path.join(FIXTURES_DIR, 'sample_standard_1080p.mp4');
  console.log(`  [2/4] Generating standard video: ${standardVideoPath}`);
  await createSyntheticVideo({
    outputPath: standardVideoPath,
    duration: 6,
    width: 1920,
    height: 1080,
    fps: 30,
    withAudio: true,
  });
  const stdMeta = await probeMedia(standardVideoPath);
  console.log(`        Format: ${stdMeta.width}x${stdMeta.height}, Duration: ${stdMeta.duration}s, Size: ${(fs.statSync(standardVideoPath).size / 1024).toFixed(1)} KB`);

  // 3. Audio with alternating tones and silence gaps
  const silenceAudioPath = path.join(FIXTURES_DIR, 'sample_silence_audio.wav');
  console.log(`  [3/4] Generating silence audio: ${silenceAudioPath}`);
  await createSyntheticAudioWithSilences({
    outputPath: silenceAudioPath,
    toneDuration: 2.0,
    silenceDuration: 1.0,
    cycles: 2, // 2s tone, 1s silence, 2s tone, 1s silence = 6s total
  });
  const audioMeta = await probeMedia(silenceAudioPath);
  console.log(`        Format: audio/wav, Duration: ${audioMeta.duration}s, Size: ${(fs.statSync(silenceAudioPath).size / 1024).toFixed(1)} KB`);

  // 4. Mock transcripts JSON dump
  console.log(`  [4/4] Writing mock transcripts JSON: ${TRANSCRIPTS_JSON_PATH}`);
  const transcriptCatalog = {
    standard: mockTranscripts.standardTranscript,
    empty: mockTranscripts.emptyTranscript,
    singleWord: mockTranscripts.singleWordTranscript,
    continuous: mockTranscripts.continuousTranscript,
    longPause: mockTranscripts.longPauseTranscript,
    overlapping: mockTranscripts.overlappingTranscript,
    abbreviations: mockTranscripts.abbreviationTranscript,
    podcastDialogue: mockTranscripts.podcastDialogueTranscript,
    monologueLecture: mockTranscripts.monologueLectureTranscript,
    noisyAudio: mockTranscripts.noisyAudioTranscript,
  };
  fs.writeFileSync(TRANSCRIPTS_JSON_PATH, JSON.stringify(transcriptCatalog, null, 2), 'utf8');
  console.log(`        Exported ${Object.keys(transcriptCatalog).length} transcript scenarios.`);

  console.log('\n✨ All synthetic fixtures generated successfully!');
}

main().catch((err) => {
  console.error('❌ Fixture generation failed:', err);
  process.exit(1);
});
