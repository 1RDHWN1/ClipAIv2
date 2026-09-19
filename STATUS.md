# ClipAIv2 — Status & Known Issues

Catatan hidup untuk kerja lanjutan. Diperbarui dari verifikasi render nyata,
bukan asumsi.

---

## ✅ FIXED & VERIFIED (render nyata)

### 1. Subtitle tidak ter-render sama sekali
**Gejala:** video hasil clip hampir tidak punya subtitle; di beberapa video
benar-benar kosong.

**Akar masalah:** nama font di preset `cyber` berisi koma:
`'Montserrat, Trebuchet MS, Arial'`. Baris style ASS dipisah dengan koma, jadi
koma tersebut menggeser seluruh field → libass **gagal render tanpa error**.

**Bukti:** burn-in `.ass` ke video hitam = **0 piksel terang** dengan koma,
**8.568 piksel** setelah dibersihkan.

**Perbaikan:** `sanitizeAssFontName()` (ambil family pertama, buang karakter
berbahaya) + preset `cyber` → `'Montserrat'`.

**Verifikasi render nyata:** coverage subtitle 0–2/12 titik → **16/16 (100%)**.

### 2. Subtitle rompal (gap kosong panjang)
**Akar:** caption lama berakhir persis di akhir kata, sehingga jeda 1–2 detik
khas auto-subtitle YouTube membuat layar kosong.

**Perbaikan:** caption "hold" menembus jeda pendek (≤3s), tetap kosong pada
hening panjang (>3s) — mempertahankan semantik gap bersih.

### 3. Distorsi panel split-screen (1.78×)
**Akar:** crop panel `607×1080` (AR 0.56) dipaksa ke output `1080×960`
(AR 1.125) → stretch horizontal; plus `cropY=0` memotong kepala.

**Perbaikan:** crop mengikuti AR output (`1215×1080` di 1080p, `810×720` di
720p) + crop-Y dipusatkan pada band wajah.

**Bukti:** kotak uji yang tadinya lonjong (2:1) menjadi **kuadrat**.

---

## 🔴 BELUM SELESAI / MASIH BUG

### A. Split-screen masih false-positive pada shot single-speaker
**Status:** SEBAGIAN — unit test sintetis lolos 5/5, tapi **render nyata masih
bocor**.

**Bukti render nyata (clip Jensen Huang, 1 speaker):**
| Detik | Seharusnya | Kenyataan |
|---|---|---|
| 20 | single | single ✓ |
| 90 | single | **SPLIT** ✗ |
| 98 | single | **SPLIT** ✗ |
| 104 | single | single ✓ |

Log pipeline: `Face tracking plan ready: 16 segment(s), 16 face track(s), 6 wide interval(s)`
→ 6 wide interval terdeteksi pada video yang hanya punya 1 pembicara aktif.

**Dugaan penyebab (perlu verifikasi):**
- Shot over-the-shoulder (OTS) memperlihatkan wajah pembicara **dan** wajah
  lawan bicara dari sudut lain → keduanya lolos `has_visible_face`, jarak
  horisontal >350px, dan stabil → dianggap two-shot.
- Guard jitter (220px) mungkin terlalu longgar untuk kasus ini.

**Langkah berikutnya:** instrumentasi `extract_wide_intervals()` untuk
men-dump setiap frame-wide beserta jalur mana yang lolos, pada video sumber
yang disimpan (jangan dihapus sebelum analisis selesai).

### B. Crop solo kadang memotong kepala
Terlihat pada frame detik 50 di render lain. Belum diselidiki.

### C. `fontSize` 83 terlalu besar untuk kanvas 1080×1920
Berpotensi membuat teks mepet/overlap. Belum diubah (bukan blocker).

---

## 🧪 Catatan Metodologi

- **Jangan verifikasi hasil fix dari unit test sintetis saja.** Wajib render
  ulang video nyata dan **cek timestamp file vs waktu commit** — pernah
  hampir salah mengklaim sukses karena menganalisis file yang dirender
  *sebelum* fix.
- Deteksi "ada orang atau tidak" dari varians piksel **tidak bisa diandalkan**
  (meja & mikrofon sama detailnya dengan wajah). Gunakan pemeriksaan visual.
- Video sumber dihapus setelah job selesai (`cleanup`), sehingga analisis
  pasca-render tidak bisa mengulang face tracking. Pertimbangkan opsi untuk
  menyimpan artefak debug (`face-plan.json`, `wide-intervals.json`) saat
  `DEBUG_KEEP_ARTIFACTS=true`.

---

## 📊 Status Test

```
npm test       → 398 pass, 0 fail
npm run verify → 6/6 acceptance criteria
```
