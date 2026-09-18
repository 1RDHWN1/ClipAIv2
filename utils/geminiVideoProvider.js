// utils/geminiVideoProvider.js
import axios from 'axios';
import 'dotenv/config';
import { parseGeminiTranscript } from './geminiTranscriptParser.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-2.5-flash';

/**
 * Mencoba mengambil transkrip ber-timestamp langsung dari YouTube URL menggunakan Gemini API (Video Understanding).
 * Tidak memerlukan unduhan audio lokal sama sekali.
 *
 * @param {string} youtubeUrl
 * @param {Object} [options={}]
 * @param {number} [options.duration]
 * @returns {Promise<Object|null>} UnifiedTranscript atau null jika gagal/tidak tersedia
 */
export async function fetchGeminiApiTranscript(youtubeUrl, options = {}) {
  const apiKey = options.apiKey || GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  console.log(`🤖 Mencoba transkripsi instan via Gemini API (${GEMINI_MODEL}) untuk URL: ${youtubeUrl}...`);

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const isEn = String(options.language || '').toLowerCase().startsWith('en');
  const prompt = isEn
    ? [
        'Generate a complete and detailed verbatim transcript from this video sentence by sentence with timestamps.',
        'MANDATORY format per line:',
        '([MM:SS]) Sentence dialogue.',
        'Example:',
        '([0:00]) Hello everyone.',
        '([0:03]) Today we are going to discuss an exciting topic.',
        'Do not include any introductory or concluding text other than the timestamped transcript lines.'
      ].join('\n')
    : [
        'Buatkan transkrip lengkap dan detail dari video ini per kalimat dengan urutan waktu.',
        'Format WAJIB per baris:',
        '([MM:SS]) Kalimat dialog lengkap.',
        'Contoh:',
        '([0:00]) Halo teman-teman semua.',
        '([0:03]) Hari ini kita akan membahas topik menarik.',
        'Jangan sertakan teks pengantar atau penutup selain baris-baris transkrip berformat di atas.'
      ].join('\n');

  const requestBody = {
    contents: [
      {
        parts: [
          {
            file_data: {
              file_uri: youtubeUrl,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

  try {
    const res = await axios.post(endpoint, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    });

    const candidate = res.data?.candidates?.[0];
    const rawText = candidate?.content?.parts?.map((p) => p.text).join('\n') || '';

    if (!rawText || rawText.trim().length < 20) {
      console.warn('⚠️ Respon Gemini API kosong atau terlalu pendek');
      return null;
    }

    const unified = parseGeminiTranscript(rawText, {
      totalDuration: options.duration,
      language: options.language || 'auto',
    });

    if (unified && unified.sentences.length > 0) {
      console.log(`⚡ Berhasil mendapatkan transkrip dari Gemini API (${unified.sentences.length} kalimat, ${unified.words.length} kata)!`);
      return unified;
    }
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.warn(`⚠️ Gemini API Video Understanding notice: ${errorMsg}`);
  }

  return null;
}
