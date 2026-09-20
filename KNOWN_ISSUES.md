# Known Issues — Streamer Layout (belum stabil)

Catatan handoff. Ditulis 21 Sep 2026 setelah sesi tuning layout.
Status: **BELUM SELESAI**. Jangan anggap layout streamer sudah stabil.

## 1. Webcam box cuma SATU per klip (masalah utama)

`detect_streamer_webcam()` di `scripts/face_tracking.py` mengembalikan **satu**
`webcamBox` untuk seluruh klip, dipakai sebagai crop tetap dari awal sampai
akhir.

Akibatnya, kalau di tengah klip terjadi **perpindahan scene** — webcam pindah
pojok, atau stream ganti ke fullscreen (webcam hilang), atau balik lagi — box
yang dipakai jadi salah untuk sebagian klip. Yang keliatan: crop nyangkut di
area kosong atau ke konten, bukan ke wajah.

Ini yang dimaksud user: "belum stabil versi streamer layoutnya apalagi ada
perpindahan scene".

Arah perbaikan yang mungkin:
- Deteksi webcam **per segmen**, bukan per klip (pakai `is_cut` / scene cut yang
  sudah dihitung `build_shot_aware_plan`).
- Simpan `webcamBox` per interval waktu, lalu bangun crop **time-varying**
  (mirip `buildTimedCropExpression` yang sudah ada untuk speaker).
- Kalau di segmen tertentu webcam tidak ada, fallback ke crop subjek untuk
  segmen itu saja — jangan pakai box dari segmen lain.

## 2. Ambang deteksi masih hasil tuning sempit

Skor = `persistence x edge_score x smallness`, ambang 0.32 (Python) dan
`GAMING_WEBCAM_MIN_PER_FRAME = 0.32` (clipper). Nilai terukur:
webcam PiP ~0.37, animasi besar tengah ~0.29. Marginnya tipis — klip lain bisa
salah klasifikasi. Belum diuji di banyak sumber.

## 3. Belum diuji lintas sumber

Semua verifikasi sejauh ini dari satu stream (iShowSpeed, `qteIOgjfDIw`).
Belum dites di: gameplay asli (Minecraft/FPS), podcast, PiP kanan atas,
multi-webcam, atau stream dengan overlay chat besar.

## 4. Layout lain belum ditinjau ulang

Perubahan terakhir menyentuh `buildGamingStreamerFilterGraph`. `auto_split` dan
`split_screen` belum diverifikasi ulang setelah semua perubahan ini.

## Setting sekarang

```
GAMING_CAM_PANEL_H=960   # split 50:50, webcam atas / konten bawah
GAMING_SHARP_H           # sudah DIHAPUS (tidak dipakai lagi)
```

Konten di-cover-fit ke panelnya (tanpa blur, tanpa bilah hitam).
Makin besar `GAMING_CAM_PANEL_H` -> panel konten lebih pendek -> crop sisi lebih
sedikit -> konten kurang zoom.
