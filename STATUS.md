# ClipAIv2 — Status & Known Issues

Catatan hidup untuk kerja lanjutan. Semua klaim di bawah berasal dari
**verifikasi render nyata**, bukan asumsi atau unit test sintetis.

---

## ✅ FIXED & VERIFIED

### 1. Subtitle tidak ter-render sama sekali  [PALING KRITIS]
**Gejala:** video hasil clip hampir tanpa subtitle.

**Akar:** nama font preset `cyber` berisi koma:
`'Montserrat, Trebuchet MS, Arial'`. Baris style ASS dipisah koma, jadi koma
itu menggeser seluruh field → libass **gagal render tanpa error**.

**Bukti:** burn-in `.ass` ke video hitam = **0 piksel** dengan koma,
**8.568 piksel** setelah dibersihkan.

**Fix:** `sanitizeAssFontName()` + preset `cyber` → `'Montserrat'`.

**Verifikasi:** coverage 0–2/12 titik → **16/16 (100%)**. Uji ulang: `.ass`
323 event, **0 gap**, 111.4s penuh.

### 2. Subtitle rompal (gap kosong panjang)
**Akar:** caption berakhir persis di akhir kata; jeda 1–2s khas auto-sub
YouTube membuat layar kosong.

**Fix:** caption "hold" menembus jeda pendek (≤3s); tetap kosong saat hening
panjang (>3s).

### 3. Distorsi panel split-screen (1.78×)
**Akar:** crop `607×1080` (AR 0.56) dipaksa ke output `1080×960` (AR 1.125)
→ stretch horizontal; `cropY=0` memotong kepala.

**Fix:** crop mengikuti AR output (`1215×1080` @1080p, `810×720` @720p) +
crop-Y dipusatkan pada band wajah.

**Bukti:** kotak uji lonjong (2:1) → **kuadrat**.

### 4. Split-screen ganda dari 1 orang
**Akar:** YOLOv8-Pose sering mengeluarkan 2 bbox untuk 1 orang (badan +
kepala). NMS tidak menyatukannya.

**Fix:** `faces_are_same_person()` — tolak bila bbox overlap
(IoU ≥0.30 / containment ≥0.60) atau pusat berdekatan.

### 5. Split-screen pada wide ROOM shot
**Gejala:** split aktif di video single-speaker; panel menampilkan meja/kursi,
bukan wajah.

**Akar:** detektor BENAR — video memang punya momen 2 orang. Tapi keduanya
duduk berjauhan (wajah hanya **7–9% lebar frame**), jadi crop per panel
menghasilkan perabot.

**Fix:** GUARD 4 — split hanya bila **KEDUA wajah ≥12% lebar frame**.

**Verifikasi render nyata (video Jensen, 319s):**
| Metrik | Nilai |
|---|---|
| Frame dengan 2 orang | **19** |
| Lebar wajah | **7.3–9.2%** (semua < 12%) |
| wideIntervals hasil | **0** ✓ (dari 4) |

Kontrol: close two-shot sintetis (wajah 23%) → tetap terdeteksi ✓

---

## 🔴 SISA (minor, bukan blocker)

- **Crop solo kadang memotong kepala.** Belum diselidiki sistematis.
- **`fontSize` default 76–83 kegedean** untuk kanvas 1080×1920.
- **Render pipeline sering keputus** saat dijalankan lewat background process
  (server ke-SIGTERM). Bukan bug kode; perlu jalur start yang tahan lama.

---

## 🧪 Catatan Metodologi (penting)

- **Jangan verifikasi dari unit test sintetis saja.** Wajib render nyata.
- **Selalu cek timestamp file vs waktu commit.** Pernah hampir salah klaim
  sukses karena menganalisis file yang dirender *sebelum* fix.
- **`ffmpeg -ss` tidak akurat** untuk ekstraksi frame — frame yang dianalisis
  bisa beda dari yang dilihat. Gunakan pemeriksaan visual.
- **Analisis piksel buta** tidak bisa membedakan "orang" vs "meja" (varians
  mirip). Pakai vision.
- **Video sumber dihapus** setelah job (`cleanup`) → face tracking tidak bisa
  diulang pasca-render. Pertimbangkan `DEBUG_KEEP_ARTIFACTS=true`.

---

## 📊 Status Test

```
npm test                          → 491 pass, 0 fail
npm run verify                    → 6/6 acceptance criteria
tests/stress/wide_shot_python_logic.py → 9/9 pass
tests/stress/*.test.js            → (dijalankan terpisah; tidak termasuk `npm test`)
```

---

## 🔐 Audit Keamanan & Robustness (Sprint 1-3)

Audit menyeluruh atas seluruh repo, tiap temuan diverifikasi dengan eksekusi
nyata (bukan hanya membaca kode).

### Selesai & terverifikasi

| ID | Temuan | Bukti verifikasi |
|---|---|---|
| C1 | RCE: URL YouTube mentah disisipkan ke shell yt-dlp | payload `$(touch …)` dulu **jalan**, kini ditolak; `exec`→`execFile` |
| C2 | `/api/process` tanpa auth & rate limit | 401 tanpa key, 429 setelah limit (uji HTTP) |
| C3 | Tanpa batas body & panjang transkrip | `express.json({limit})` + `MAX_TRANSCRIPT_CHARS` |
| L7 | `.env.backup.*` menyimpan kredensial | dihapus |
| H1 | `-crf 23` menimpa `-preset`/`-b:v` | bitrate nyata **5.47 → 9.11 Mbps** |
| H2 | `setsar=1` hilang + `enable=` bisa overflow | 128 interval **exit 244 → exit 0**; SAR **1:1** |
| M2 | char cap subtitle tidak skala ke fontSize | caption **1080px → 860px** |
| H3 | STAGE 5 melemahkan invariant no-mid-word-cut | collision **3/3 → 0/6** |
| H7 | output tanpa lifecycle (501 MB) | reaper + `DELETE /api/job/:id`; **501→453 MB** |
| H4 | `acquireLock` non-atomik (check-then-write) | 12 starter paralel: **2 → 1** pemenang |
| H6 | mp3 bocor + cleanup tak di `finally` | cleanup di semua jalur exit |
| M1 | `getVideoInfo(url)` mengarang 1280×720 | crop **405px → 607px** (33% terlalu zoom) |

### Sisa (belum dikerjakan)

- **ioredis retry storm** (`maxRetriesPerRequest: null`) — tanpa backoff saat
  Redis mati, log spam tak terbatas.
- **M4** face tracking 5 FPS × YOLOv8-Pose di CPU = bottleneck wall-clock.
- **M6/L3** dependency tak terpakai: `youtubei.js`, `groq-sdk`, `multer`.
- **M5/L5** dead code: jalur speaker-anchor (±150 baris) + duplikasi escaping ASS.
- **L2** `PROJECT.md` menyebut preset `cyberpunk`, kode pakai `cyber`.
