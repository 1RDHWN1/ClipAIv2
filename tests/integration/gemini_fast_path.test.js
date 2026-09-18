import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiTranscript } from '../../utils/geminiTranscriptParser.js';
import { fetchGeminiApiTranscript } from '../../utils/geminiVideoProvider.js';
import { buildSentenceMap } from '../../utils/sentenceSegmenter.js';

describe('Gemini Fast Path Integration', () => {
  it('processes YouTube Tanya transcript with zero audio download requirements', async () => {
    // Exact sample transcript from user
    const sampleTranscript = `
Berikut adalah transkrip mendetail dari video tersebut hingga titik waktu saat ini ([08:53](https://www.youtube.com/watch?t=533s)):
([0:00](https://www.youtube.com/watch?t=0s)) Katanya manusia itu kan diciptakan dari tanah ya, Bib.
([0:03](https://www.youtube.com/watch?t=3s)) Heeh.
([0:04](https://www.youtube.com/watch?t=4s)) Berarti kita saudara sama brokoli. Kok bisa, Pak?
([0:07](https://www.youtube.com/watch?t=7s)) Saya jalan ke ujung dunia.
([0:10](https://www.youtube.com/watch?t=10s)) Hm.
([0:12](https://www.youtube.com/watch?t=12s)) Ketemu brokoli, saya panggil abang.
([0:15](https://www.youtube.com/watch?t=15s)) Karena dia kan dari tanah juga.
([0:18](https://www.youtube.com/watch?t=18s)) Berarti brokoli itu paman kita?
([0:22](https://www.youtube.com/watch?t=22s)) Ya bisa jadi kalau menurut silsilah tanah.
([0:26](https://www.youtube.com/watch?t=26s)) Tapi kan tanahnya beda kebun, Bib.
([0:30](https://www.youtube.com/watch?t=30s)) Tetap aja satu bumi, bos.
    `;

    const parsed = parseGeminiTranscript(sampleTranscript, { totalDuration: 533 });

    // Validate structure matches UnifiedTranscript requirements
    assert.ok(parsed.sentences.length >= 10);
    assert.ok(parsed.words.length > 30);
    assert.equal(parsed.sentences[0].id, 's1');
    assert.equal(parsed.sentences[0].start, 0);
    assert.equal(parsed.sentences[0].end, 3);
    assert.equal(parsed.duration, 533);

    // Validate sentence mapping for analyzer
    const map = buildSentenceMap(parsed.sentences);
    assert.equal(map.size, parsed.sentences.length);
    assert.ok(map.has('s1'));
    assert.ok(map.has('s10'));

    // Check sentence boundaries are continuous
    for (let i = 0; i < parsed.sentences.length - 1; i++) {
      const curr = parsed.sentences[i];
      const next = parsed.sentences[i + 1];
      assert.ok(curr.end <= next.start + 0.001, `Sentence ${curr.id} end (${curr.end}) must not exceed next start (${next.start})`);
    }

    // Check words exist and have valid boundaries
    for (const w of parsed.words) {
      assert.ok(typeof w.word === 'string' && w.word.length > 0);
      assert.ok(w.start <= w.end);
    }
  });

  it('handles missing Gemini API key gracefully without throwing', async () => {
    const result = await fetchGeminiApiTranscript('https://www.youtube.com/watch?v=dummy123', {
      apiKey: null,
    });
    assert.equal(result, null);
  });

  it('correctly processes instant YouTube subtitles when audioPath is null', async () => {
    const { transcribeAudio } = await import('../../utils/transcriber.js');
    const mockSubs = {
      language: 'id',
      words: [
        { word: 'Halo', start: 0.1, end: 0.5 },
        { word: 'teman-teman', start: 0.6, end: 1.2 },
        { word: 'semua', start: 1.3, end: 1.8 },
        { word: 'selamat', start: 2.0, end: 2.4 },
        { word: 'datang', start: 2.5, end: 2.9 },
        { word: 'kembali', start: 3.0, end: 3.5 },
        { word: 'di', start: 3.6, end: 3.8 },
        { word: 'channel', start: 3.9, end: 4.4 },
        { word: 'kami', start: 4.5, end: 4.9 },
        { word: 'hari', start: 5.0, end: 5.3 },
        { word: 'ini', start: 5.4, end: 5.8 },
      ],
    };

    const transcript = await transcribeAudio(null, {
      mockTranscript: mockSubs,
    });

    assert.ok(transcript);
    assert.ok(transcript.words.length >= 10);
    assert.ok(transcript.sentences.length >= 1);
    assert.equal(transcript.language, 'id');
  });

  it('throws descriptive error if audioPath is null without mockTranscript', async () => {
    const { transcribeAudio } = await import('../../utils/transcriber.js');
    await assert.rejects(
      async () => {
        await transcribeAudio(null);
      },
      /File audio tidak ditemukan: null/
    );
  });
});

