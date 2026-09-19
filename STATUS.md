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

**Verifikasi render nyata:** `.ass` final = 323 event, rentang 0.00–111.42s,
**0 gap > 0.6s** → coverage penuh. Subtitle terkonfirmasi visual di 8/8 frame
yang diperiksa (posisi bawah, karaoke highlight cyan).

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

### 4. Duplikat deteksi 1 orang → wide shot palsu (level detektor)
**Akar:** YOLOv8-Pose sering mengeluarkan 2 bbox untuk SATU orang (badan +
kepala). Duplikat ini lolos uji jarak dan menjadi sumber utama false positive.
Selain itu ambang jarak dulu absolut (350px), sehingga 27% pada 720p tapi hanya
18% pada 1080p — perilaku berubah mengikuti resolusi.

**Perbaikan:** fungsi baru `faces_are_same_person()` (tolak jika IoU ≥ 0.30,
containment ≥ 0.60, atau pusat < 0.75× lebar bbox terkecil); jarak jadi rasio
(34% lebar frame); guard stabilitas ikut rasio; `min_duration` 0.8s → 1.6s.

**Verifikasi:** script `face_tracking.py` pada video Jensen (1 speaker):
`wideIntervals` **6 → 0**. Suite Python baru 7/7 lolos.

---

## 🔴 BELUM SELESAI / MASIH BUG

### A. Split-screen masih muncul di sebagian frame (render nyata)
**Status:** MEMBAIK tapi BELUM BERES.

Script deteksi melaporkan **0 wide interval**, tetapi video hasil render masih
menampilkan split-screen di sebagian frame:

| Detik | Hasil render | Catatan |
|---|---|---|
| 10, 30, 70, 110, 130, 142 | SINGLE ✓ | benar |
| **50** | **SPLIT** ✗ | "AND SO ASKING" |
| **90** | **SPLIT** ✗ | "EVERYBODY" |

**Kontradiksi penting:** detektor bilang 0 wide interval, tapi render tetap
menghasilkan split. Artinya ada **jalur lain** yang mengaktifkan split-screen di
luar `wideIntervals` — kandidat:
1. Fallback `buildStackedSplitFilterGraph()` di `clipper.js` (dipakai ketika
   `wideIntervals` kosong tapi `layoutMode` adalah `split_screen`).
2. Logika `layoutMode === 'auto_split'` di `clipper.js` yang belum ditelusuri
   sepenuhnya.
3. `min_duration` / merge interval di JS yang berbeda dari Python.

**Langkah berikutnya:** telusuri `utils/clipper.js` bagian pemilihan filter
graph untuk `auto_split` ketika `wideIntervals` kosong. Ini yang paling
menentukan: apakah fallback stacked-split memang sengaja aktif.

### B. Crop solo kadang memotong kepala
Terlihat pada beberapa frame. Belum diselidiki.

### C. `fontSize` 83 terlalu besar untuk kanvas 1080×1920
Berpotensi membuat teks mepet/overlap. Belum diubah (bukan blocker).

---

## 🧪 Catatan Metodologi

- **Jangan verifikasi hasil fix dari unit test sintetis saja.** Wajib render
  ulang video nyata dan **cek timestamp file vs waktu commit** — pernah
  hampir salah mengklaim sukses karena menganalisis file yang dirender
  *sebelum* fix.
- **`ffmpeg -ss` untuk ekstraksi frame tidak akurat** pada beberapa file.
  Frame yang diekstrak bisa berbeda dari yang diharapkan di timestamp itu,
  sehingga analisis piksel bisa menyesatkan. Gunakan pemeriksaan visual, atau
  `-ss` setelah `-i` (seek akurat tapi lambat).
- Deteksi "ada orang atau tidak" dari varians piksel **tidak bisa diandalkan**
  (meja & mikrofon sama detailnya dengan wajah).
- Video sumber dihapus setelah job selesai (`cleanup`), sehingga analisis
  pasca-render tidak bisa mengulang face tracking. Pertimbangkan opsi untuk
  menyimpan artefak debug (`face-plan.json`, `wide-intervals.json`) saat
  `DEBUG_KEEP_ARTIFACTS=true`.

---

## 📊 Status Test

```
npm test                              → 398 pass, 0 fail
npm run verify                         → 6/6 acceptance criteria
tests/stress/wide_shot_python_logic.py → 7/7 cases pass
```
