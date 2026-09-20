// utils/metadataGenerator.js
//
// Generates viral-ready publishing metadata for each clip: a scroll-stopping
// title, an SEO/social description, hashtags, a platform-tuned caption, and a
// pinned-comment CTA.
//
// Design constraints (deliberate):
//  * ONE extra LLM call per JOB (not per clip) — every clip's transcript slice is
//    labelled and batched into a single request, so the cost stays flat and the
//    model can see the whole set and keep the hooks differentiated.
//  * NULL means "use the in-prompt title" — the caller keeps the analyzer title.
//    We never let a metadata failure take down an otherwise good render.
//  * `metadataMode: 'off'` skips the call entirely for air-gapped / no-budget runs.

import axios from 'axios';
import {
  resolveModelConfiguration,
  buildGatewayCandidates,
} from './analyzer.js';

export const VALID_METADATA_MODES = ['off', 'simple', 'viral', 'seo'];
export const DEFAULT_METADATA_MODE = 'viral';

// Bounds from the platforms we target — exceeding them gets content truncated
// silently by the uploader, or rejected outright.
//
// TITLE_MAX_CHARS is the HARD cap (what we truncate at). The prompt's TARGET is
// much shorter (28-40) because a Shorts title is read in a fraction of a second:
// long titles get cut off in-feed and bury the hook. This cap exists only to
// stop a runaway model, not as a goal to reach.
export const TITLE_MAX_CHARS = 60;
export const TITLE_TARGET_MIN_CHARS = 28;
export const TITLE_TARGET_MAX_CHARS = 40;
export const TIKTOK_CAPTION_MAX_CHARS = 2200;
export const REELS_CAPTION_MAX_CHARS = 2200;
export const HASHTAG_MAX_COUNT = 30;

const METADATA_MAX_COMPLETION_TOKENS = parseInt(
  process.env.AI_METADATA_MAX_COMPLETION_TOKENS || '2000',
  10
);
const METADATA_TIMEOUT_MS = parseInt(process.env.AI_METADATA_TIMEOUT_MS || '90000', 10);
const METADATA_MAX_RETRIES = parseInt(process.env.AI_METADATA_MAX_RETRIES || '2', 10);

/**
 * Normalise a requested metadata mode. Unknown/blank falls back to the default
 * so a stray form value can never disable metadata generation silently.
 * @param {string} [mode]
 * @returns {'off'|'simple'|'viral'|'seo'}
 */
export function normalizeMetadataMode(mode) {
  if (typeof mode !== 'string') return DEFAULT_METADATA_MODE;
  const clean = mode.trim().toLowerCase();
  return VALID_METADATA_MODES.includes(clean) ? clean : DEFAULT_METADATA_MODE;
}

/**
 * Proven viral title/headline patterns, derived from real high-view Shorts.
 *
 * Every rule below is backed by a specific video we measured, and the view
 * counts are quoted so the model can weigh them. These are DATA, not opinion:
 * the low-view example (20K) is included precisely because it shows the
 * failure mode — a thumbnail that just repeats the title.
 *
 * @param {boolean} isEn
 * @returns {string[]}
 */
export function viralPatterns(isEn) {
  if (isEn) {
    return [
      `PROVEN PATTERNS — reverse-engineered from real Shorts and their view counts:`,
      ``,
      `  ✓ SPECIFIC NUMBER (5.4M views): "HOW MUCH YOUTUBE PAID ME FOR 1 BILLION VIEWS"`,
      `    A real figure beats an adjective. "a billion" not "so many". Never invent a number.`,
      ``,
      `  ✓ PERSONAL STAKE (5.4M views): "...PAID ME..." — first person, a real consequence.`,
      `    "I", "me", "my" makes it a story. Impersonal titles read like a press release.`,
      ``,
      `  ✓ DIRECT INSTRUCTION + NAMED TARGET (16M views): "How To Get A Picture With iShowSpeed"`,
      `    Name the specific person/thing. "a celebrity" is vague; a name is a hook.`,
      ``,
      `  ✓ OPEN LOOP (612K views): "Material Penghasil Dingin Terbaik..." — the ellipsis`,
      `    withholds the answer. Use it sparingly (once), never as a crutch.`,
      ``,
      `  ✓ EMOJI AS TONE, NOT DECORATION (16M views): "😂😭" adds emotion without eating`,
      `    character budget. One or two at the END, never in the middle of the hook.`,
      ``,
      `  ✗ THUMBNAIL REPEATS TITLE (20K views — the failure): thumbnail read exactly`,
      `    "PENYEBAB VIDEO SHORTS MAKIN SEPI PENONTON" and the title said the same thing.`,
      `    Both slots said the same words, so the packaging wasted half its surface area.`,
      `    RULE: the headline banner and the title must say DIFFERENT things —`,
      `    title = the promise/stake, headline = the sharpest 3-5 word angle of it.`,
      ``,
      `TITLE vs HEADLINE — they are TWO different jobs:`,
      `  • title    = the click promise (28-40 chars, carries the number/stake)`,
      `  • headline = the on-screen hook banner (3-7 words, the boldest claim in the clip)`,
      `  They must NOT repeat each other's words. Together they cover two angles of one idea.`,
      `  Example pairing for the same clip:`,
      `    title:    "Obama: They Want You Scared. Stay Anyway."`,
      `    headline: "Crime Isn't Insurrection"`,
      ``,
      `  ✗ THE HEADLINE MUST STATE THE ACTUAL TOPIC — NEVER A GREETING.`,
      `    The clip's first spoken words are often a streamer's greeting. Copying it`,
      `    produces a headline that is technically unique but says NOTHING about the`,
      `    video. These are ALL WRONG:`,
      `      "Hello Ladies and Gentlemen"   ← greeting, no topic`,
      `      "What's Up Guys"               ← greeting, no topic`,
      `      "Welcome Back To The Stream"   ← greeting, no topic`,
      `      "Alright So Today"             ← filler, no topic`,
      `    If the opening line is a greeting or filler, IGNORE it and write the`,
      `    headline from what the clip is ACTUALLY about (the subject, the object,`,
      `    the claim, the twist). Example:`,
      `      clip = unboxing a mystery Apple package`,
      `      ✗ headline: "Hello Ladies and Gentlemen"`,
      `      ✓ headline: "Mystery Apple Box Just Landed"`,
      ``,
    ];
  }

  return [
    `POLA TERBUKTI — hasil reverse-engineering dari Shorts nyata beserta jumlah views:`,
    ``,
    `  ✓ ANGKA SPESIFIK (5,4jt views): "HOW MUCH YOUTUBE PAID ME FOR 1 BILLION VIEWS"`,
    `    Angka nyata mengalahkan kata sifat. "1 miliar" bukan "banyak banget". Jangan mengarang angka.`,
    ``,
    `  ✓ STAKE PERSONAL (5,4jt views): "...PAID ME..." — orang pertama, ada konsekuensi nyata.`,
    `    "aku", "gue", "saya" membuatnya jadi cerita. Judul impersonal terbaca seperti siaran pers.`,
    ``,
    `  ✓ KATA REVELATION (154rb views): "TERNYATA segini gaji Youtube Shorts 8000 tayangan!"`,
    `    "Ternyata", "segini", "kok bisa" memicu rasa penasaran khas Indonesia. Pakai di depan.`,
    ``,
    `  ✓ INSTRUKSI LANGSUNG + TARGET SPESIFIK (16jt views): "How To Get A Picture With iShowSpeed"`,
    `    Sebut nama orang/benda spesifiknya. "seorang artis" itu kabur; nama itu hook.`,
    ``,
    `  ✓ OPEN LOOP (612rb views): "Material Penghasil Dingin Terbaik..." — elipsis menahan jawaban.`,
    `    Pakai secukupnya (sekali), jangan jadi tongkat penyangga.`,
    ``,
    `  ✓ EMOJI SEBAGAI NADA, BUKAN HIASAN (16jt views): "😂😭" menambah emosi tanpa makan`,
    `    jatah karakter. Satu-dua saja di AKHIR, jangan di tengah hook.`,
    ``,
    `  ✗ THUMBNAIL MENGULANG JUDUL (20rb views — contoh kegagalan): thumbnail tertulis persis`,
    `    "PENYEBAB VIDEO SHORTS MAKIN SEPI PENONTON" dan judulnya bilang hal yang sama.`,
    `    Kedua slot memakai kata yang sama, jadi separuh ruang packaging terbuang sia-sia.`,
    `    ATURAN: banner headline dan judul HARUS bilang hal BERBEDA —`,
    `    judul = janji/stake, headline = sudut paling tajam 3-5 kata dari janji itu.`,
    ``,
    `JUDUL vs HEADLINE — dua pekerjaan berbeda:`,
    `  • judul    = janji klik (28-40 karakter, membawa angka/stake)`,
    `  • headline = banner hook di layar (3-7 kata, klaim paling berani di klip)`,
    `  Keduanya TIDAK BOLEH mengulang kata satu sama lain. Bersama-sama mereka menutup dua sudut.`,
    `  Contoh pasangan untuk klip yang sama:`,
    `    judul:    "Obama: Mereka Mau Kamu Takut. Tetap Bertahan."`,
    `    headline: "Kejahatan Bukan Makar"`,
    ``,
    `  ✗ HEADLINE WAJIB MENYEBUT TOPIKNYA — JANGAN PERNAH SAPAAN.`,
    `    Kata-kata pertama di klip sering berupa sapaan streamer. Menyalinnya`,
    `    menghasilkan headline yang unik tapi TIDAK bilang apa pun soal videonya.`,
    `    Semua ini SALAH:`,
    `      "Hello Ladies and Gentlemen"   ← sapaan, tanpa topik`,
    `      "Halo Semuanya"                ← sapaan, tanpa topik`,
    `      "Welcome Back"                 ← sapaan, tanpa topik`,
    `      "Oke Jadi Hari Ini"            ← filler, tanpa topik`,
    `    Kalau kalimat pembuka cuma sapaan/basa-basi, ABAIKAN dan tulis headline`,
    `    dari ISI klip yang sebenarnya (subjek, objek, klaim, atau twisnya). Contoh:`,
    `      klip = unboxing paket misterius dari Apple`,
    `      ✗ headline: "Hello Ladies and Gentlemen"`,
    `      ✓ headline: "Kotak Misterius Apple Tiba"`,
    ``,
  ];
}

/**
 * Build the publishing-metadata prompt for a batch of clips.
 *
 * @param {Array<{index:number, title?:string, hookText?:string, viralityRationale?:string, clipText?:string, duration?:number}>} clipInputs
 * @param {Object} [options]
 * @param {string} [options.language='id']
 * @param {string} [options.metadataMode='viral']
 * @param {string} [options.videoTitle]  Original source video title (trend context)
 * @param {string} [options.targetPlatform='all']
 * @returns {string}
 */
export function buildMetadataPrompt(clipInputs, options = {}) {
  if (!Array.isArray(clipInputs) || clipInputs.length === 0) {
    throw new Error('clipInputs must be a non-empty array');
  }

  const {
    language = 'id',
    metadataMode = DEFAULT_METADATA_MODE,
    videoTitle = '',
    targetPlatform = 'all',
  } = options;

  const isEn = String(language).toLowerCase().startsWith('en');
  const mode = normalizeMetadataMode(metadataMode);

  const clipBlocks = clipInputs.map((c) => {
    const lines = [
      `--- CLIP ${c.index} ---`,
      c.title ? `Working title: ${c.title}` : null,
      c.duration ? `Duration: ${Math.round(c.duration)} seconds` : null,
      c.hookText ? `Opening hook (first 0-3s): ${c.hookText}` : null,
      c.viralityRationale ? `Why it works: ${c.viralityRationale}` : null,
      c.clipText ? `Spoken content:\n${c.clipText}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  });

  const modeDirectives = {
    simple: isEn
      ? [
          `STYLE = SIMPLE: clear and informative. No clickbait, no exaggeration.`,
          `- title: descriptive and accurate, max 70 characters. State the concrete value plainly.`,
          `- description: 2-3 plain sentences summarising what is said.`,
          `- hashtags: 3-5 broad topical tags only.`,
          `- caption: one short neutral line.`,
        ]
      : [
          `GAYA = SEDERHANA: jelas dan informatif. Tanpa clickbait, tanpa berlebihan.`,
          `- title: deskriptif dan akurat, maks 70 karakter. Sebutkan nilai konkretnya secara lugas.`,
          `- description: 2-3 kalimat lugas yang merangkum isi.`,
          `- hashtags: 3-5 tag topik umum saja.`,
          `- caption: satu baris netral yang singkat.`,
        ],
    seo: isEn
      ? [
          `STYLE = SEO-FIRST: optimised for search discovery more than browse-feed impulse.`,
          `- title: lead with the primary search keyword/phrase people would actually type, max 70 characters. Keep it readable, not keyword-stuffed.`,
          `- description: keyword-aware, 3-5 sentences, front-load the main topic in the first sentence.`,
          `- hashtags: 10-15 tags mixing high-volume and niche terms.`,
          `- caption: search-friendly one-liner containing the primary phrase.`,
        ]
      : [
          `GAYA = SEO-FIRST: dioptimalkan untuk penemuan lewat pencarian, bukan sekadar impulse feed.`,
          `- title: awali dengan kata kunci/frasa utama yang benar-benar orang ketik di pencarian, maks 70 karakter. Tetap enak dibaca, jangan tumpuk kata kunci.`,
          `- description: sadar kata kunci, 3-5 kalimat, taruh topik utama di kalimat pertama.`,
          `- hashtags: 10-15 tag campuran volume tinggi dan niche.`,
          `- caption: satu baris ramah pencarian yang memuat frasa utama.`,
        ],
    viral: isEn
      ? [
          `STYLE = VIRAL: engineered for maximum scroll-stop and share impulse while staying fully honest about the content.`,
          `- title: HARD LIMIT 45 characters, TARGET 28-40. Short beats clever — every word must earn its place.`,
          `  Front-load the hook in the first 25 characters. Cut articles, filler and context ("Obama discusses...").`,
          `  If you can drop a word and keep the meaning, drop it. A punchy 30-char title beats a rambling 45-char one.`,
          `  Use a curiosity gap, a stake, a number, or a bold claim that the clip genuinely delivers on.`,
          `- description: 3-5 sentences. Open with a curiosity-driven first line (this is what shows in-feed), then give real substance, then a soft CTA.`,
          `- hashtags: 12-20 tags mixing broad reach and specific niche.`,
          `- caption: a punchy 1-2 line version tuned per target platform.`,
        ]
      : [
          `GAYA = VIRAL: dirancang untuk menghentikan scroll dan memicu share, tapi tetap jujur dengan isi klipnya.`,
          `- title: BATAS KERAS 45 karakter, TARGET 28-40. Pendek lebih baik daripada pintar — setiap kata harus berguna.`,
          `  Taruh hook di 25 karakter pertama. Buang kata sambung, basa-basi, dan konteks ("Obama membahas...").`,
          `  Kalau satu kata bisa dibuang tanpa mengubah makna, buang. Judul 30 karakter yang padat mengalahkan 45 karakter yang bertele-tele.`,
          `  Pakai curiosity gap, taruhan/stakes, angka, atau klaim berani yang memang dipenuhi isi klip.`,
          `- description: 3-5 kalimat. Buka dengan kalimat pertama yang memicu rasa penasaran (ini yang tampil di feed), lalu beri substansi nyata, lalu CTA halus.`,
          `- hashtags: 12-20 tag campuran jangkauan luas dan niche spesifik.`,
          `- caption: versi 1-2 baris yang punchy, disesuaikan per platform target.`,
        ],
  };

  // ---------------------------------------------------------------------------
  // Anti-FLAT rules. This is the difference between output that reads like a
  // press release and output that reads like a creator wrote it.
  //
  // Every rule below exists because the OLD prompt produced measurably flat
  // output: "Mari simak poin penting ini: <title>", "#viral #shorts #reels",
  // "Bagaimana menurut kalian?". That is a TEMPLATE, not copy. It gives the
  // viewer no reason to stop, and it makes the creator look automated.
  // ---------------------------------------------------------------------------
  const antiFlatRules = isEn
    ? [
        `WRITING RULES — these separate a scroll-stopper from a flat, templated post:`,
        ``,
        `1. NEVER open with a meta phrase. BANNED openers (and anything like them):`,
        `   "In this video...", "Let's look at...", "Here's a clip about...", "Check out this...",`,
        `   "Mari simak...", "Berikut adalah...". Start with the IDEA ITSELF, not an announcement of it.`,
        `2. LEAD WITH THE STRONGEST LINE, not a summary. Take the boldest sentence the speaker`,
        `   actually says and open with it (lightly polished for grammar). The first 40 characters`,
        `   are all a viewer sees before the title truncates — spend them on tension, not context.`,
        `3. USE CONCRETE HOOK MECHANICS (pick whichever the clip genuinely supports):`,
        `   • Curiosity gap — name the thing but withhold the payoff ("Nobody talks about why...")`,
        `   • Bold/contrarian claim — state the surprising position directly ("You're not tired. You're bored.")`,
        `   • Specific number — real figures only, never invented ("one in every six")`,
        `   • Stakes / warning — what the viewer loses by ignoring this ("This is costing you respect.")`,
        `   • Direct address — speak to the viewer as "you", not "people"`,
        `4. WRITE LIKE A HUMAN CREATOR, NOT A BRAND. Contractions (don't, you're, it's), short`,
        `   punchy sentences, one clear idea per sentence. No corporate hedging.`,
        `5. THE CAPTION IS NOT A LABEL. It must be a standalone hook that works with ZERO context`,
        `   from the video — someone scrolling past should feel the pull from the caption alone.`,
        `   Never write "<generic intro>: <the title>" — that is the flat pattern to avoid.`,
        `6. THE PINNED COMMENT MUST BE SPECIFIC TO THIS CLIP. Reference the actual tension,`,
        `   claim or question in the content. Banned: generic bait like "What do you think?"`,
        `   or "Comment below!" with no connection to what was just said.`,
        `7. HASHTAGS MUST EARN THEIR PLACE. Mix 3-5 broad (#shorts #podcast) with 6-10 SPECIFIC`,
        `   topical tags pulled from the actual subject (#leadership #obama #selfrespect).`,
        `   Never ship only the generic set — that is a tell that no one tuned them.`,
        `8. DESCRIPTIONS MUST ADD INFORMATION, not restate the title. Give the specific insight,`,
        `   then one genuine reason to keep watching, then a soft CTA tied to the topic.`,
      ]
    : [
        `ATURAN PENULISAN — ini pembeda antara konten yang menghentikan scroll dan konten flat:`,
        ``,
        `1. JANGAN pernah buka dengan frasa meta. TERLARANG (dan yang mirip):`,
        `   "Mari simak...", "Berikut adalah...", "Dalam video ini...", "Yuk bahas...".`,
        `   Mulai langsung dari IDENYA, bukan pengumuman tentang idenya.`,
        `2. AWALI DENGAN KALIMAT TERKUAT, bukan ringkasan. Ambil kalimat paling berani yang`,
        `   benar-benar diucapkan pembicara (dirapikan tata bahasanya) dan buka dengan itu.`,
        `   40 karakter pertama itu satu-satunya yang terlihat sebelum judul terpotong — pakai`,
        `   untuk membangun ketegangan, bukan konteks.`,
        `3. PAKAI MEKANIKA HOOK KONKRET (pilih yang memang didukung isi klip):`,
        `   • Curiosity gap — sebut halnya tapi tahan jawabannya ("Nggak ada yang bahas kenapa...")`,
        `   • Klaim berani/kontrarian — nyatakan posisi mengejutkannya langsung ("Kamu bukan capek. Kamu bosan.")`,
        `   • Angka spesifik — hanya angka nyata, jangan mengarang ("satu dari enam orang")`,
        `   • Stakes/peringatan — apa yang hilang kalau diabaikan ("Ini yang bikin kamu nggak dihormati.")`,
        `   • Sapaan langsung — bicara ke "kamu", bukan "orang-orang"`,
        `4. TULIS SEPERTI KREATOR MANUSIA, BUKAN BRAND. Pakai kata sehari-hari, kalimat pendek`,
        `   dan punchy, satu ide per kalimat. Jangan bertele-tele ala korporat.`,
        `5. CAPTION BUKAN LABEL. Harus jadi hook mandiri yang tetap menarik TANPA konteks video —`,
        `   orang yang scroll harus merasa tertarik hanya dari caption-nya.`,
        `   Jangan pernah menulis "<pembuka generik>: <judul>" — itu justru pola flat yang dilarang.`,
        `6. PINNED COMMENT HARUS SPESIFIK ke klip ini. Rujuk ketegangan, klaim, atau pertanyaan`,
        `   nyata di isinya. Terlarang: bait generik seperti "Bagaimana menurut kalian?" tanpa`,
        `   kaitan dengan apa yang baru saja dibahas.`,
        `7. HASHTAG HARUS BERGUNA. Campur 3-5 tag luas (#shorts #podcast) dengan 6-10 tag`,
        `   SPESIFIK sesuai topik nyata (#kepemimpinan #obama #kepercayaan diri).`,
        `   Jangan cuma tag generik — itu tanda nggak ada yang menyesuaikan.`,
        `8. DESKRIPSI HARUS MENAMBAH INFORMASI, bukan mengulang judul. Beri insight spesifiknya,`,
        `   lalu satu alasan nyata untuk terus menonton, lalu CTA halus yang nyambung dengan topik.`,
      ];

  const languageBlock = isEn
    ? [
        `LANGUAGE REQUIREMENTS (CRITICAL):`,
        `- The clip dialogue is in ENGLISH.`,
        `- EVERYTHING you write (title, description, hashtags, caption, pinnedComment, trendKeywords, headline) MUST be in natural, native English.`,
        `- Do NOT translate or transliterate. Do NOT mix in Indonesian or any other language.`,
        `- Write like a native English short-form creator — the phrasing, slang and rhythm must sound native, not translated.`,
      ]
    : [
        `PETUNJUK BAHASA (PENTING):`,
        `- Dialog klip dalam bahasa INDONESIA.`,
        `- SEMUA yang kamu tulis (title, description, hashtags, caption, pinnedComment, trendKeywords, headline) HARUS dalam bahasa Indonesia yang natural.`,
        `- JANGAN menerjemahkan ke bahasa lain. JANGAN campur bahasa Inggris kecuali istilah yang memang lazim dipakai apa adanya.`,
        `- Tulis seperti kreator short-form Indonesia asli — ritme dan pilihan katanya harus terasa natural, bukan hasil terjemahan.`,
      ];

  const platformHint = targetPlatform && targetPlatform !== 'all'
    ? (isEn
        ? [`Optimise the "caption" field primarily for: ${targetPlatform}.`]
        : [`Optimalkan field "caption" terutama untuk platform: ${targetPlatform}.`])
    : (isEn
        ? [`Optimise "caption" for TikTok / YouTube Shorts / Instagram Reels alike (keep it platform-neutral enough to work on all three).`]
        : [`Optimalkan "caption" agar cocok untuk TikTok / YouTube Shorts / Instagram Reels sekaligus (cukup netral untuk ketiganya).`]);

  return [
    `You are an elite short-form publishing strategist who has grown multiple faceless channels past 1M followers. You write titles, descriptions and captions that get clicked, watched to the end, and shared.`,
    ``,
    videoTitle ? `Source video: "${videoTitle}"` : null,
    `You are given ${clipInputs.length} clip(s) that were cut from ONE longer video.`,
    `Generate publishing metadata for EACH clip.`,
    ``,
    ...modeDirectives[mode],
    ...languageBlock,
    ``,
    ...antiFlatRules,
    ``,
    `- headline: a punchy 3-7 word high-impact visual hook headline for the top on-screen text banner (e.g. "Dehumanisasi: Ancaman Nyata di Balik Prasangka", "Stop Overexplaining: Rahasia Dihormati").`,
    `- viralityScore: integer 80-99 evaluating the 4 pillars (hook impact, pacing, retention potential, payoff).`,
    `- scoreBreakdown: object with 4 pillar grades, e.g. { "hook": "A", "flow": "A", "value": "A", "trend": "A-" }.`,
    `- trendKeywords: 3-6 topical keywords/topic-clusters this clip sits in (used for trend relevance), written in the same language as the rest.`,
    `- pinnedComment: a short engagement-bait comment the creator can pin to drive replies (ask a genuine question the clip makes people want to answer).`,
    ``,
    ...viralPatterns(isEn),
    ``,
    `FLAT vs SCROLL-STOPPING — study these pairs. The left column is what to NEVER produce:`,
    `  FLAT title:    "Obama Discusses the Importance of Convictions" (50 chars)`,
    `  HOOK title:    "They Want You Scared. Stay Anyway." (35 chars)`,
    `  FLAT title:    "Why You Should Never Give Up On Your Beliefs" (48 chars)`,
    `  HOOK title:    "Your Beliefs Cost Nothing. That's the Problem." (44 chars)`,
    `  FLAT headline: "Convictions And Why They Matter" (repeats the title idea)`,
    `  HOOK headline: "Crime Isn't Insurrection" (a DIFFERENT angle, 3-5 words)`,
    `  FLAT caption:  "Mari simak poin penting ini: Obama: Your Convictions Are Being Tested Right Now"`,
    `  HOOK caption:  "Obama just said the quiet part out loud: most people never get tested, so their beliefs stay untested."`,
    `  FLAT comment:  "Bagaimana menurut kalian tentang pembahasan ini?"`,
    `  HOOK comment:  "Obama bilang kita semua punya kapasitas ini — tapi kapan terakhir kali kamu benar-benar diuji?"`,
    `  FLAT hashtags: "#viral #shorts #reels #podcast"`,
    `  HOOK hashtags: "#obama #convictions #leadership #selfrespect #podcastclips #motivation #shortsvideo"`,
    ``,
    `The FLAT versions are summaries. The HOOK versions create a reason to stop scrolling.`,
    `Every field you output must read like the right column.`,
    `Remember the title rule: 28-40 characters, hard limit 45. Count before you answer.`,
    `Remember the headline rule: 3-7 words, and it must NOT repeat the title's words.`,
    ``,
    ...platformHint,
    ``,
    `HARD RULES:`,
    `- NEVER invent facts, numbers, names, or claims that are not present in the clip content. Honesty over hype.`,
    `- Make every clip's title DISTINCT — no two titles may share the same opening structure or phrasing.`,
    `- Do NOT use markdown, emoji-only titles, or ALL-CAPS shouting beyond one deliberate word.`,
    `- title MUST respect the character limit stated for the chosen style.`,
    `- If a clip has too little spoken content to judge, still produce honest metadata from what IS there.`,
    ``,
    `=== CLIPS ===`,
    ...clipBlocks,
    `=== END CLIPS ===`,
    ``,
    `Respond ONLY with a valid JSON object, no markdown, exactly this shape:`,
    `{`,
    `  "clips": [`,
    `    {`,
    `      "index": 1,`,
    `      "headline": "3-7 word on-screen hook headline",`,
    `      "title": "the publishing title",`,
    `      "viralityScore": 98,`,
    `      "scoreBreakdown": { "hook": "A", "flow": "A", "value": "A", "trend": "A-" },`,
    `      "description": "the full description / scene analysis",`,
    `      "hashtags": ["#tag1", "#tag2"],`,
    `      "caption": "short platform caption",`,
    `      "pinnedComment": "engagement question to pin",`,
    `      "trendKeywords": ["keyword1", "keyword2"]`,
    `    }`,
    `  ]`,
    `}`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Trim a too-long title down to the target length WITHOUT gutting its hook.
 *
 * Naive truncation ("slice + ellipsis") is the worst option: it usually keeps a
 * rambling lead-in and cuts off the payoff. Instead we:
 *   1. drop trailing subordinate clauses (" — because ...", ", which ...")
 *   2. drop a weak leading label ("Obama: ...", "Video: ...") if a strong hook follows
 *   3. cut on a word boundary, never mid-word
 *   4. strip dangling stop-words the cut leaves behind ("and", "the", "of")
 *
 * Returns null when nothing sensible can be done (caller keeps the original).
 *
 * @param {string} title
 * @returns {string|null}
 */
export function trimTitleToTarget(title) {
  if (typeof title !== 'string') return null;
  let t = title.trim();
  if (t.length <= TITLE_TARGET_MAX_CHARS) return t;

  // 1. Drop trailing subordinate clauses — the hook is almost always up front.
  const clauseCuts = [
    /\s*[—–-]\s*(because|since|which|who|that|so|as)\b.*$/i,
    /,\s*(because|since|which|who|that|so|as|and then)\b.*$/i,
    /\s+(because|since|which)\b.*$/i,
  ];
  for (const re of clauseCuts) {
    const cut = t.replace(re, '').trim();
    if (cut.length >= TITLE_TARGET_MIN_CHARS && cut.length < t.length) {
      t = cut;
      break;
    }
  }

  // 2. Drop a weak leading label ("Obama: ...", "Video: ...") when a hook follows.
  const labelMatch = t.match(/^([A-Z][\w'’.]{1,14}):\s+(.+)$/);
  if (labelMatch && labelMatch[2].length >= TITLE_TARGET_MIN_CHARS) {
    t = labelMatch[2].trim();
  }

  if (t.length <= TITLE_TARGET_MAX_CHARS) return t;

  // 3. Prefer a COMPLETE first sentence over a mid-thought word cut.
  //    "They Want You Scared. Stay Anyway. Here Is The Full..." -> "They Want You Scared."
  //    A whole thought beats a dangling fragment every time.
  const firstSentence = t.match(/^(.{15,}?[.!?])(?:\s|$)/);
  if (firstSentence) {
    const s = firstSentence[1].trim();
    if (s.length >= 15 && s.length <= TITLE_TARGET_MAX_CHARS) {
      return s;
    }
  }

  // 4. Cut at a CLAUSE boundary (comma / conjunction) in the ORIGINAL string.
  //
  //    Splitting and re-joining mangles the text ("The One Habit, Separates
  //    People, Succeed"), so we instead find separator POSITIONS and slice the
  //    original — the kept prefix is always verbatim.
  //
  //    "The One Habit That Separates People Who Succeed From Those Who Talk"
  //      -> "The One Habit That Separates People"   (a whole phrase, 39 chars)
  //    Accept up to the HARD cap: a complete 45-char phrase reads far better
  //    than a broken 30-char fragment, and 45 is still legal.
  const separators = /(?:,\s+|\s+(?:and|but|because|so|which|that|while|when|who|from|as)\s+)/gi;
  let bestCut = null;
  let m;
  while ((m = separators.exec(t)) !== null) {
    const prefix = t.slice(0, m.index).trim().replace(/[.,;:—–-]+$/, '').trim();
    if (prefix.length < TITLE_TARGET_MIN_CHARS || prefix.length > TITLE_MAX_CHARS) continue;
    // Prefer the prefix CLOSEST to the target length — the longest one can
    // overshoot well past the target even while staying under the hard cap.
    if (!bestCut || Math.abs(prefix.length - TITLE_TARGET_MAX_CHARS) < Math.abs(bestCut.length - TITLE_TARGET_MAX_CHARS)) {
      bestCut = prefix;
    }
  }
  if (bestCut) return bestCut;

  // 5. Last resort: word-boundary cut at the TARGET length, then the HARD cap.
  //    (Cutting at TARGET keeps it short; the hard cap below is a safety net.)
  const cutAt = (text, limit) => {
    const words = text.split(/\s+/);
    const kept = [];
    let len = 0;
    for (const w of words) {
      const add = kept.length === 0 ? w.length : w.length + 1;
      if (len + add > limit) break;
      kept.push(w);
      len += add;
    }
    return kept.join(' ').trim();
  };

  let out = cutAt(t, TITLE_TARGET_MAX_CHARS);
  // If that produced nothing usable, take the hard cap worth of words.
  if (out.length < TITLE_TARGET_MIN_CHARS) out = cutAt(t, TITLE_MAX_CHARS);

  // 6. Strip dangling stop-words AND possessive pronouns the cut left behind —
  //    "Give Up On Your" is a broken fragment, not a title.
  const DANGLING = /[\s,;:]+(and|or|but|the|a|an|of|to|in|on|for|with|that|which|is|are|was|were|be|as|at|by|from|so|then|your|our|their|his|her|my|its|this|these|those)$/i;
  let prev;
  do {
    prev = out;
    out = out.replace(DANGLING, '').trim();
  } while (out !== prev);
  out = out.replace(/[\s,;:—–-]+$/, '').trim();

  // A fragment that still ends mid-thought is worse than the original title.
  if (out.length < TITLE_TARGET_MIN_CHARS) return null;
  return out;
}

/**
 * Sanitize and polish an Auto Headline.
 *
 * Prevents raw spoken dialogue from reaching the video burned-in headline.
 * Strips stuttering ('you you', 'if if', 'oon if'), filler openings
 * ('you know', 'like', 'uh', 'um'), lowercase trailing dialogue, and caps length.
 *
 * @param {string} rawHeadline
 * @param {string} [fallbackTitle]
 * @param {string} [hookText]
 * @returns {string}
 */
export function sanitizeHeadline(rawHeadline, fallbackTitle = '', hookText = '') {
  let text = typeof rawHeadline === 'string' && rawHeadline.trim() ? rawHeadline.trim() : '';

  if (!text) {
    text = fallbackTitle || hookText || 'Viral Topic';
  }

  // 1. Remove quotes around the headline if model added them
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

  // 2. Remove filler openings like "You know,", "You know if", "Uh,", "Um,", "Like,"
  let prev;
  do {
    prev = text;
    text = text.replace(/^(you know,?|well,?|so,?|like,?|uh,?|um,?|look,?|actually,?|i mean,?|i think\s*(that)?|i believe\s*(that)?|there is no doubt\s*(that)?|it seems to me\s*(that)?)\s+/i, '');
  } while (text !== prev);

  // 3. Remove stutter repetitions (e.g. "you you" -> "you", "if if" -> "if", "the the" -> "the")
  text = text.replace(/\b([a-zA-Z]+)\s+\1\b/gi, '$1');
  text = text.replace(/\b([a-zA-Z]+)\s+\1\b/gi, '$1');

  // 4. Remove hallucinated stutter garbage like "oon if", "oon"
  text = text.replace(/\boon\s+/gi, '');

  // 5. If it starts with conversational lowercase pattern, polish it:
  if (/^you can't just be/i.test(text)) {
    text = text.replace(/^you can't just be/i, 'Stop Being');
  }

  // Strip trailing dangling conjunctions/prepositions:
  text = text.replace(/(^|\s+)(that|and|so|because|to|of|in|with|for|as|is|are|was|were)$/i, '');

  if (!text || text.trim().length < 5) {
    text = fallbackTitle || hookText || 'Viral Topic';
  }

  // 6. Convert to clean Title Case for headline impact
  const minorWords = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 'of', 'in']);
  text = text
    .split(/\s+/)
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && minorWords.has(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');

  // 7. Strip trailing periods/ellipses so it looks like a clean headline
  text = text.replace(/[.…]+$/, '').trim();

  // 8. If text is too long (> 8 words) or too wordy, prefer fallbackTitle if cleaner
  const words = text.split(/\s+/);
  if (words.length > 8 && fallbackTitle && fallbackTitle.split(/\s+/).length <= 8) {
    text = fallbackTitle.replace(/[.…]+$/, '').trim();
  } else if (words.length > 8) {
    text = words.slice(0, 7).join(' ');
  }

  // Cap at 60 characters for on-screen box
  if (text.length > 60) {
    text = text.slice(0, 58).trim() + '…';
  }

  return text;
}

/**
 * Sanitise + normalise one raw metadata object from the model.
 * Never throws; unknown shapes degrade to null fields.
 *
 * @param {Object} raw
 * @returns {Object|null}
 */
export function normalizeClipMetadata(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  const rawHl = str(raw.headline);
  const title = str(raw.title);
  const headline = rawHl ? sanitizeHeadline(rawHl, title, str(raw.hookText)) : (title ? sanitizeHeadline(title) : null);
  const description = str(raw.description);
  const caption = str(raw.caption);
  const pinnedComment = str(raw.pinnedComment);

  let viralityScore = null;
  if (typeof raw.viralityScore === 'number' && Number.isFinite(raw.viralityScore)) {
    viralityScore = Math.min(100, Math.max(0, Math.round(raw.viralityScore)));
  } else if (typeof raw.score === 'number' && Number.isFinite(raw.score)) {
    viralityScore = Math.min(100, Math.max(0, Math.round(raw.score)));
  }

  let scoreBreakdown = null;
  if (raw.scoreBreakdown && typeof raw.scoreBreakdown === 'object') {
    scoreBreakdown = {
      hook: str(raw.scoreBreakdown.hook) || 'A',
      flow: str(raw.scoreBreakdown.flow) || 'A',
      value: str(raw.scoreBreakdown.value) || 'A',
      trend: str(raw.scoreBreakdown.trend) || 'A-',
    };
  }

  let hashtags = [];
  if (Array.isArray(raw.hashtags)) {
    hashtags = raw.hashtags
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      // Keep the leading '#' plus letters/digits/underscore only. A tag that is
      // nothing but punctuation ("##", "#!!!") collapses to '#' and is dropped
      // by the length check below.
      .map((t) => '#' + t.slice(1).replace(/[^\p{L}\p{N}_]/gu, ''))
      .filter((t) => t.length > 2);
  }
  // De-dupe case-insensitively, then cap.
  const seen = new Set();
  hashtags = hashtags.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, HASHTAG_MAX_COUNT);

  let trendKeywords = [];
  if (Array.isArray(raw.trendKeywords)) {
    trendKeywords = raw.trendKeywords
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter(Boolean)
      .slice(0, 8);
  }

  // Title: hard-cap it, but ALSO trim a title that merely runs long.
  //
  // A Shorts title is read in a fraction of a second and gets cut off in-feed,
  // so a 55-character title buries its own hook. We trim on a WORD boundary
  // (never mid-word) once it passes TITLE_TARGET_MAX_CHARS, and only fall back
  // to an ellipsis if a single unbreakable word overflows the hard cap.
  let safeTitle = title;
  if (safeTitle && safeTitle.length > TITLE_TARGET_MAX_CHARS) {
    const trimmed = trimTitleToTarget(safeTitle);
    if (trimmed) safeTitle = trimmed;
  }
  if (safeTitle && safeTitle.length > TITLE_MAX_CHARS) {
    safeTitle = safeTitle.slice(0, TITLE_MAX_CHARS - 1).trimEnd() + '…';
  }

  if (!safeTitle && !description && !caption && !headline && hashtags.length === 0) return null;

  return {
    headline,
    title: safeTitle,
    viralityScore,
    scoreBreakdown,
    description,
    hashtags,
    caption,
    pinnedComment,
    trendKeywords,
  };
}

/**
 * Generate publishing metadata for the clips of one job.
 *
 * Returns a Map keyed by clip index. Returns an EMPTY Map — never throws — when
 * metadata is off, the gateway is unreachable, or the model returns junk: a
 * metadata failure must never fail the render.
 *
 * @param {Array<Object>} clipInputs
 * @param {Object} [options]
 * @param {string} [options.aiModel]
 * @param {string} [options.language='id']
 * @param {string} [options.metadataMode]
 * @param {string} [options.videoTitle]
 * @param {string} [options.targetPlatform='all']
 * @param {Function} [options.requestFn]  Injection seam for tests.
 * @returns {Promise<Map<number, Object>>}
 */
export async function generateClipMetadata(clipInputs, options = {}) {
  const {
    aiModel = null,
    language = 'id',
    metadataMode = DEFAULT_METADATA_MODE,
    videoTitle = '',
    targetPlatform = 'all',
    requestFn = null,
  } = options;

  const mode = normalizeMetadataMode(metadataMode);
  const result = new Map();

  if (mode === 'off') {
    console.log('🏷️ [metadata] Mode OFF — melewati generate judul & deskripsi.');
    return result;
  }
  if (!Array.isArray(clipInputs) || clipInputs.length === 0) return result;

  const config = resolveModelConfiguration(aiModel);
  const candidates = buildGatewayCandidates(config);
  if (candidates.length === 0) {
    console.warn('🏷️ [metadata] Tidak ada gateway AI yang terkonfigurasi — metadata dilewati.');
    return result;
  }

  const prompt = buildMetadataPrompt(clipInputs, {
    language,
    metadataMode: mode,
    videoTitle,
    targetPlatform,
  });

  console.log(
    `🏷️ [metadata] Generate ${clipInputs.length} set metadata (gaya: ${mode}) via ${config.model}...`
  );

  const send = requestFn || defaultRequest;

  let lastError = null;

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const candidate = candidates[cIdx];
    console.log(
      `🏷️ [metadata] Candidate ${cIdx + 1}/${candidates.length}: ${candidate.model} via ${candidate.baseUrl} (${candidate.label})...`
    );

    for (let attempt = 1; attempt <= METADATA_MAX_RETRIES; attempt++) {
      const useJsonMode = attempt === 1;
      try {
        const parsed = await send({
          apiKey: candidate.apiKey,
          model: candidate.model,
          baseUrl: candidate.baseUrl,
          prompt,
          useJsonMode,
          language,
        });

        const clips = Array.isArray(parsed) ? parsed : parsed?.clips;
        if (!Array.isArray(clips) || clips.length === 0) {
          console.warn(`🏷️ [metadata] Kandidat ${candidate.label} tidak mengembalikan clip metadata.`);
          continue;
        }

        for (const rawClip of clips) {
          const idx = Number(rawClip?.index);
          if (!Number.isFinite(idx)) continue;
          const clean = normalizeClipMetadata(rawClip);
          if (clean) result.set(idx, clean);
        }

        if (result.size > 0) {
          console.log(`✅ [metadata] Metadata siap untuk ${result.size} clip.`);
          return result;
        }
      } catch (err) {
        lastError = err;
        const msg = err?.response?.data?.error?.message || err?.message || String(err);
        console.warn(`🏷️ [metadata] Kandidat ${candidate.label} attempt ${attempt} gagal: ${msg}`);
      }
    }
  }

  console.warn(
    `⚠️ [metadata] Gagal generate metadata (${lastError?.message || 'model tidak mengembalikan data valid'}). ` +
      `Render tetap dilanjutkan tanpa metadata tambahan.`
  );
  return result;
}

async function defaultRequest({ apiKey, model, baseUrl, prompt, useJsonMode, language = 'id' }) {
  const isEn = String(language).toLowerCase().startsWith('en');
  const systemContent = isEn
    ? 'You are an elite short-form publishing strategist. Respond ONLY with the valid JSON object matching the requested schema. No markdown, no commentary, no text outside the JSON. Everything you write MUST be in natural English.'
    : 'Kamu adalah ahli strategi publikasi konten short-form. Jawab HANYA dengan objek JSON valid sesuai skema yang diminta. Tanpa markdown, tanpa komentar, tanpa teks selain JSON. Semua tulisan HARUS dalam bahasa Indonesia yang natural.';

  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');

  const payload = {
    model,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    top_p: 0.9,
    max_completion_tokens: METADATA_MAX_COMPLETION_TOKENS,
    stream: false,
  };

  if (useJsonMode) {
    payload.response_format = { type: 'json_object' };
    if (cleanBase.includes('openrouter.ai')) {
      payload.provider = { require_parameters: true, allow_fallbacks: true };
    }
  }

  const response = await axios.post(`${cleanBase}/chat/completions`, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://video-clipper.local',
      'X-Title': 'Video Clipper AI',
    },
    timeout: METADATA_TIMEOUT_MS,
  });

  const content = extractContent(response.data);
  if (!content) throw new Error('respons metadata kosong');
  return parseMetadataPayload(content);
}

/** Pull assistant text out of the various shapes gateways return. */
export function extractContent(data) {
  const message = data?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        if (typeof item?.content === 'string') return item.content;
        return '';
      })
      .join('\n')
      .trim();
  }
  if (typeof message?.reasoning === 'string' && message.reasoning.trim()) {
    return message.reasoning.trim();
  }
  return '';
}

/** Tolerant JSON extraction: fenced blocks, prose wrappers, bare objects. */
export function parseMetadataPayload(rawContent) {
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('payload metadata kosong');
  }

  const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : rawContent.trim();

  const tryParse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const sliced = tryParse(candidate.slice(firstBrace, lastBrace + 1));
    if (sliced) return sliced;
  }

  throw new Error('gagal mem-parsing JSON metadata dari respons AI');
}

/**
 * Does the headline just repeat the title?
 *
 * The 20K-view video in our dataset failed exactly here: the thumbnail read
 * "PENYEBAB VIDEO SHORTS MAKIN SEPI PENONTON" and the title said the same
 * thing, so the two slots wasted each other. Measured against the 5.4M-view
 * video, whose thumbnail ("A BILLION VIEWS") said something the title didn't.
 *
 * Returns true when the headline shares most of its meaningful words with the
 * title — the caller then prefers a different source (the hook line) instead.
 *
 * @param {string} headline
 * @param {string} title
 * @returns {boolean}
 */
export function headlineRepeatsTitle(headline, title) {
  if (typeof headline !== 'string' || typeof title !== 'string') return false;
  const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
    'is', 'are', 'was', 'were', 'be', 'as', 'at', 'by', 'from', 'that', 'this',
    'it', 'its', 'you', 'your', 'they', 'their', 'we', 'our',
    'yang', 'dan', 'di', 'ke', 'dari', 'itu', 'ini', 'untuk', 'dengan', 'kamu',
    'aku', 'kita', 'adalah', 'akan', 'tidak', 'tak',
  ]);
  const words = (s) => s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

  const hw = words(headline);
  const tw = new Set(words(title));
  if (hw.length === 0 || tw.size === 0) return false;

  const overlap = hw.filter((w) => tw.has(w)).length;
  const ratio = overlap / hw.length;

  // A SHORT headline reusing the title's key noun is a legitimate technique,
  // not a repeat. "A Billion Views" under "How Much YouTube Paid Me For 1
  // Billion Views" shares the noun on purpose — the short banner distils the
  // title. That pairing is the 5.4M-view winner.
  //
  // What IS a repeat: the headline is a PREFIX of the title, i.e. the same
  // words in the same order with the title merely continuing. "Obama: They
  // Want You Scared" under "Obama: They Want You Scared. Stay Anyway." is the
  // failure case — the banner and title say the identical thing.
  if (hw.length <= 3) {
    const norm = (s) => words(s).join(' ');
    const h = norm(headline);
    const t = norm(title);
    return h.length > 0 && t.startsWith(h);
  }

  return ratio >= 0.6;
}

/**
 * Frasa pembuka yang tidak membawa topik apa pun. Kalau kalimat pertama hanya
 * berisi ini, headline-nya jadi sampah seperti "Hello Ladies and Gentlemen" —
 * sapaan yang tidak nyambung dengan isi video.
 *
 * Dipakai oleh `stripEmptyOpeners()`.
 */
const EMPTY_OPENER_PATTERNS = [
  // Sapaan (Inggris)
  /^(hello|hi|hey|yo|sup|what'?s up|wassup|howdy|greetings)\b[,\s]*/i,
  /^(good\s+(morning|evening|afternoon|night))\b[,\s]*/i,
  /^(ladies and gentlemen|guys and girls|boys and girls|everyone|everybody|folks|fam|team)\b[,\s]*/i,
  // Sapaan (Indonesia)
  /^(halo|hallo|hai|hei|woi|oy|selamat\s+(pagi|siang|sore|malam))\b[,\s]*/i,
  /^(semuanya|semua|teman-?teman|kawan-?kawan|guys|bro|bos)\b[,\s]*/i,
  // Basa-basi pembuka stream
  /^welcome\s+back\b[,\s]*/i,
  /^welcome\b[,\s]*/i,
  /^(thank(s| you)\s+(for\s+)?(watching|joining|coming))\b[,\s]*/i,
  /^(terima\s+kasih\s+(sudah|udah|telah)?\s*(menonton|nonton|datang|hadir))\b[,\s]*/i,
  /^(let'?s\s+(get\s+(started|into it)|go|dive in|jump in))\b[,\s]*/i,
  /^(as\s+(always|usual|you\s+know))\b[,\s]*/i,
  /^(alright|all right|okay|ok|so|now|well|look|listen)\b[,\s]*/i,
  /^(oke|ok|jadi|nah|baik|baiklah|jadi\s+gini)\b[,\s]*/i,
  /^(i\s+(just\s+)?(want|wanna|gotta)\s+to\s+(say|tell))\b[,\s]*/i,
  /^(before\s+we\s+(start|begin|get))\b[,\s]*/i,
  /^(sebelum\s+(kita\s+)?(mulai|lanjut))\b[,\s]*/i,
  /^(real\s+quick|quick\s+(one|note|thing))\b[,\s]*/i,
  /^(guys|yo|bro|bruh|dude|man)\b[,\s]*/i,
  // Ekor sapaan yang sering tertinggal ("Welcome back TO THE STREAM")
  /^(to\s+the\s+(stream|channel|video|show|podcast))\b[,\s]*/i,
  /^(ke\s+(stream|channel|video|acara))\b[,\s]*/i,
  /^(back\s+to\s+the\s+(stream|channel|video|show))\b[,\s]*/i,
];

/**
 * Buang sapaan & basa-basi pembuka dari sebuah kalimat, berulang sampai tidak
 * ada lagi yang cocok. Contoh:
 *   "Hello ladies and gentlemen. Today we unbox..."
 *   -> "Today we unbox..."
 *
 * @param {string} text
 * @returns {string}
 */
export function stripEmptyOpeners(text) {
  if (typeof text !== 'string') return '';
  let s = text.trim();
  let prev;
  let guard = 0;
  do {
    prev = s;
    for (const re of EMPTY_OPENER_PATTERNS) {
      s = s.replace(re, '');
    }
    // Buang sisa tanda baca & spasi di depan, termasuk titik setelah sapaan
    // ("...gentlemen. Today ..." -> "Today ...").
    s = s.replace(/^[\s.,;:!?\-–—]+/, '');
    guard += 1;
  } while (s !== prev && guard < 20);
  return s;
}

/**
 * Cek apakah sebuah kandidat headline benar-benar membawa topik, bukan cuma
 * sapaan/basa-basi yang tersisa.
 *
 * @param {string} candidate
 * @returns {boolean}
 */
export function headlineHasTopic(candidate) {
  if (typeof candidate !== 'string') return false;
  const stripped = stripEmptyOpeners(candidate);
  if (!stripped || stripped.length < 8) return false;
  // Kalau isinya masih 100% frasa pembuka, tidak ada topik.
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return true;
}

/**
 * Ringkas kalimat hook yang diucapkan menjadi headline pendek (3-7 kata).
 *
 * hookText adalah kalimat ASLI yang diucapkan, jadi bisa panjang dan berisi
 * basa-basi. Ambil klausa pertama yang bermakna, buang filler, lalu batasi
 * panjangnya. Mengembalikan null kalau hasilnya tetap mengulang judul.
 *
 * @param {string} hookText
 * @param {string} title
 * @returns {string|null}
 */
export function headlineFromSpokenHook(hookText, title) {
  if (typeof hookText !== 'string' || !hookText.trim()) return null;

  // Buang sapaan/basa-basi pembuka DULU (sebelum memotong), karena filler
  // sering diikuti koma — kalau koma dipotong lebih dulu, yang tersisa hanya
  // "Guys". Ini juga menangani sapaan seperti "Hello ladies and gentlemen"
  // yang dulu lolos dan jadi headline tanpa topik.
  let s = stripEmptyOpeners(hookText);
  // Buang subjek pembicara di awal ("I just saw", "he said")
  s = s.replace(/^(i|he|she|they|we|you)\s+(just\s+)?(saw|said|thinks?|thought|realized?|forgot)\s+/i, '');

  // Baru potong ke klausa pertama.
  s = s.split(/[.!?;]/)[0].split(/,\s*/)[0].trim();
  // Buang lagi kalau klausa pertama ternyata masih sapaan.
  s = stripEmptyOpeners(s);

  if (s.length < 8) return null;

  // Coba beberapa panjang: 7 kata dulu, lalu makin pendek. Ambil yang pertama
  // menghasilkan headline valid — jangan menyerah hanya karena versi terpanjang
  // kebetulan masih mengandung kata judul.
  for (const limit of [7, 6, 5, 4]) {
    const words = s.split(/\s+/);
    if (words.length < 3) break;
    const candidate = words.slice(0, limit).join(' ');
    const trimmed = trimTitleToTarget(candidate) || candidate;
    if (!trimmed || trimmed.length < 8) continue;
    // Headline harus bawa topik — bukan cuma sapaan sisa.
    if (!headlineHasTopic(trimmed)) continue;
    if (title && headlineRepeatsTitle(trimmed, title)) continue;
    return trimmed;
  }
  return null;
}

/**
 * Ambil frasa pendek dari deskripsi AI sebagai headline alternatif.
 *
 * Deskripsi ditulis dengan sudut yang berbeda dari judul, jadi kalimat
 * pertamanya sering jadi hook yang bagus dan tidak mengulang.
 *
 * @param {string} description
 * @param {string} title
 * @returns {string|null}
 */
export function headlineFromDescription(description, title) {
  if (typeof description !== 'string' || !description.trim()) return null;
  let s = description.split(/[.!?\n]/)[0].trim();
  s = s.replace(/^["'“”]+|["'“”]+$/g, '');
  if (s.length < 12) return null;

  const words = s.split(/\s+/);
  let out = words.slice(0, 6).join(' ');
  if (out.length > 48) out = words.slice(0, 4).join(' ');
  out = out.replace(/[,;:—–-]+$/, '').trim();

  if (out.length < 10) return null;
  if (title && headlineRepeatsTitle(out, title)) return null;
  return out;
}

/**
 * Merge generated metadata into the clip list, preserving existing titles when
 * the generator returned nothing for that clip.
 *
 * @param {Array<Object>} clips
 * @param {Map<number, Object>} metadataByIndex
 * @returns {Array<Object>}
 */
export function applyMetadataToClips(clips, metadataByIndex) {
  if (!Array.isArray(clips)) return clips;
  if (!metadataByIndex || metadataByIndex.size === 0) {
    return clips.map((c) => ({ ...c, metadata: null }));
  }

  return clips.map((clip) => {
    const idx = clip.clipIndex ?? clip.index;
    const meta = metadataByIndex.get(Number(idx)) || null;
    if (!meta) {
      return {
        ...clip,
        headline: clip.headline || clip.hookText || clip.title,
        score: clip.score || clip.viralityScore || 95,
        scoreBreakdown: clip.scoreBreakdown || { hook: 'A', flow: 'A', value: 'A', trend: 'A-' },
        metadata: null,
      };
    }

    // Prefer the generated title, but never end up with NO title: fall back to
    // the analyzer's title, then to whatever was already there.
    const title = meta.title || clip.title;

    // Headline harus (a) membawa topik, dan (b) tidak mengulang judul.
    //
    // Kenapa dua-duanya: model kadang mengembalikan sapaan pembuka mentah
    // ("Hello Ladies and Gentlemen") sebagai headline. Itu TIDAK mengulang
    // judul, jadi guard repeat saja meloloskannya — padahal headline-nya sama
    // sekali tidak nyambung dengan isi video (unboxing paket Apple).
    const looksUsable = (h) => Boolean(
      h && String(h).trim().length >= 8
      && headlineHasTopic(h)
      && !headlineRepeatsTitle(h, title),
    );

    let headline = meta.headline || clip.headline || clip.hookText || clip.title;
    if (!looksUsable(headline)) {
      // Cari sudut alternatif, berurutan dari yang paling diinginkan:
      //  1. hookText asli (kalimat yang diucapkan) — diringkas jadi headline
      //  2. headline dari analyzer
      //  3. potongan deskripsi AI (sudut berbeda)
      const candidates = [
        headlineFromSpokenHook(clip.hookText, title),
        clip.headline,
        headlineFromDescription(meta.description, title),
      ];
      for (const cand of candidates) {
        if (looksUsable(cand)) {
          headline = cand;
          break;
        }
      }
      // Kalau tetap tidak ada yang layak, pakai judul sebagai jaring terakhir —
      // judul selalu bertopik, jadi lebih baik daripada sapaan kosong.
      if (!looksUsable(headline)) {
        headline = clip.headline && looksUsable(clip.headline) ? clip.headline : title;
      }
    }

    const score = meta.viralityScore ?? clip.score ?? clip.viralityScore ?? 96;
    const scoreBreakdown = meta.scoreBreakdown || clip.scoreBreakdown || { hook: 'A', flow: 'A', value: 'A', trend: 'A-' };

    return { ...clip, title, headline, score, scoreBreakdown, metadata: meta };
  });
}
