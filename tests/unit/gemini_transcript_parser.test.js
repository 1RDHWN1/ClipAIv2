import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimestampToSeconds, parseGeminiTranscript } from '../../utils/geminiTranscriptParser.js';
import { buildSentenceMap } from '../../utils/sentenceSegmenter.js';

describe('geminiTranscriptParser', () => {
  describe('parseTimestampToSeconds', () => {
    it('converts MM:SS to seconds correctly', () => {
      assert.equal(parseTimestampToSeconds('0:00'), 0);
      assert.equal(parseTimestampToSeconds('0:03'), 3);
      assert.equal(parseTimestampToSeconds('0:04'), 4);
      assert.equal(parseTimestampToSeconds('08:53'), 533);
    });

    it('converts HH:MM:SS to seconds correctly', () => {
      assert.equal(parseTimestampToSeconds('01:02:15'), 3735);
      assert.equal(parseTimestampToSeconds('0:01:30'), 90);
    });

    it('cleans brackets and parentheses', () => {
      assert.equal(parseTimestampToSeconds('(0:15)'), 15);
      assert.equal(parseTimestampToSeconds('[01:20]'), 80);
    });
  });

  describe('parseGeminiTranscript', () => {
    it('parses user YouTube Tanya markdown link transcript accurately', () => {
      const sampleText = `
Berikut adalah transkrip mendetail dari video tersebut hingga titik waktu saat ini ([08:53](https://www.youtube.com/watch?t=533s)):
([0:00](https://www.youtube.com/watch?t=0s)) Katanya manusia itu kan diciptakan dari tanah ya, Bib.
([0:03](https://www.youtube.com/watch?t=3s)) Heeh.
([0:04](https://www.youtube.com/watch?t=4s)) Berarti kita saudara sama brokoli. Kok bisa, Pak?
([0:07](https://www.youtube.com/watch?t=7s)) Saya jalan ke ujung dunia.
([0:10](https://www.youtube.com/watch?t=10s)) Hm.
      `;

      const result = parseGeminiTranscript(sampleText, { totalDuration: 533 });

      assert.equal(result.sentences.length, 5);
      assert.equal(result.sentences[0].id, 's1');
      assert.equal(result.sentences[0].start, 0);
      assert.equal(result.sentences[0].end, 3);
      assert.match(result.sentences[0].text, /Katanya manusia/);

      assert.equal(result.sentences[1].id, 's2');
      assert.equal(result.sentences[1].start, 3);
      assert.equal(result.sentences[1].end, 4);
      assert.equal(result.sentences[1].text, 'Heeh.');

      assert.equal(result.sentences[2].id, 's3');
      assert.equal(result.sentences[2].start, 4);
      assert.equal(result.sentences[2].end, 7);
      assert.match(result.sentences[2].text, /brokoli/);

      // Verify words synthesized
      assert.ok(result.words.length > 15);
      assert.equal(result.words[0].word, 'Katanya');
      assert.equal(result.words[0].start, 0);

      // Verify compatible with buildSentenceMap
      const map = buildSentenceMap(result.sentences);
      assert.ok(map.has('s1'));
      assert.ok(map.has('s2'));
      assert.ok(map.has('s3'));
      assert.equal(map.get('s1').text, result.sentences[0].text);
    });

    it('parses bullet point list format from Gemini YouTube', () => {
      const sampleText = `
• (0:00) Halo semuanya selamat datang
• (0:05) Hari ini kita bahas topik seru
- (0:12) Jangan lupa like dan subscribe
      `;

      const result = parseGeminiTranscript(sampleText);
      assert.equal(result.sentences.length, 3);
      assert.equal(result.sentences[0].start, 0);
      assert.equal(result.sentences[0].end, 5);
      assert.equal(result.sentences[1].start, 5);
      assert.equal(result.sentences[1].end, 12);
      assert.equal(result.sentences[2].start, 12);
      assert.ok(result.sentences[2].end > 12);
    });

    it('handles speaker prefixes if present', () => {
      const sampleText = `
[0:00] [Habib]: Katanya manusia itu dari tanah ya.
[0:04] [Frimawan]: Heeh bener Bib.
      `;

      const result = parseGeminiTranscript(sampleText);
      assert.equal(result.sentences.length, 2);
      assert.equal(result.sentences[0].speaker, 'Habib');
      assert.equal(result.sentences[0].text, 'Katanya manusia itu dari tanah ya.');
      assert.equal(result.sentences[1].speaker, 'Frimawan');
      assert.equal(result.sentences[1].text, 'Heeh bener Bib.');
    });

    it('throws meaningful error if text is empty or invalid', () => {
      assert.throws(() => parseGeminiTranscript(''), /tidak boleh kosong/);
      assert.throws(() => parseGeminiTranscript('Halo ini teks tanpa waktu sama sekali'), /tidak ditemukan format timestamp/i);
    });
  });
});
