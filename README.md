# 🎬 ClipAI — AI Video Clipper

Web app untuk otomatis memotong video YouTube panjang menjadi short clips viral,
mirip seperti 2short.ai.

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express (ES Modules) |
| Job Queue | BullMQ + Redis |
| Download | yt-dlp |
| Transkripsi | Groq Whisper API (gratis) |
| AI Analisis | DeepSeek via OpenRouter |
| Video Processing | FFmpeg |
| Frontend | HTML/CSS/JS vanilla |

## 📋 Prasyarat

Pastikan sudah terinstall:

```bash
# 1. Node.js v18+
node --version

# 2. Redis / Memurai
redis-server --version

# 3. FFmpeg
ffmpeg -version

# 4. yt-dlp
yt-dlp --version
```

### Install yt-dlp (jika belum ada)
```bash
# Windows
winget install yt-dlp

# Linux/Mac
pip install yt-dlp
# atau
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
```

### Install FFmpeg
```bash
# Windows (via Chocolatey)
choco install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Mac
brew install ffmpeg
```

## 🚀 Setup & Menjalankan

### 1. Install dependencies
```bash
npm install
```

### 2. Setup environment variables
```bash
# Copy file env
cp .env.example .env

# Edit .env dan isi API keys:
# - GROQ_API_KEY    → https://console.groq.com (gratis)
# - OPENROUTER_API_KEY → https://openrouter.ai
```

Untuk video panjang seperti podcast, app ini akan otomatis:
- mengecilkan audio ke format yang lebih ringan untuk speech
- membagi audio ke beberapa chunk aman
- menggabungkan kembali hasil transkrip beserta timestamp

### 3. Jalankan Redis
```bash
# Windows (Memurai)
Get-Service Memurai
"C:\Program Files\Memurai\memurai-cli.exe" PING

# Linux/Mac
redis-server --daemonize yes
```

### 4. Jalankan aplikasi

**Paling simpel - server + worker sekaligus:**
```bash
npm start
```

**Kalau mau dijalankan terpisah untuk debugging:**
```bash
npm run server
npm run worker
```

### 5. Buka browser
```
http://localhost:3000
```

## 🔄 Flow Proses

```
User paste YouTube URL
         ↓
POST /api/process → job masuk ke Redis Queue → return jobId
         ↓
Frontend polling GET /api/job/:jobId (setiap 2.5 detik)
         ↓
Worker (videoWorker.js) proses:
  Step 1: yt-dlp download video + audio
  Step 2: Groq Whisper transkripsi audio → teks + timestamp
  Step 3: DeepSeek AI analisis → pilih N momen terbaik
  Step 4: FFmpeg clip + reframe sesuai aspect ratio
         ↓
Frontend tampilkan hasil + link download
```

## 📁 Struktur Project

```
video-clipper/
├── server.js              # Express server utama
├── .env.example           # Template environment variables
├── package.json
│
├── routes/
│   └── api.js             # API endpoints
│
├── queues/
│   └── videoQueue.js      # BullMQ queue setup
│
├── workers/
│   └── videoWorker.js     # Job processor
│
├── utils/
│   ├── downloader.js      # yt-dlp wrapper
│   ├── transcriber.js     # Groq Whisper API
│   ├── analyzer.js        # DeepSeek AI analisis
│   └── clipper.js         # FFmpeg video processing
│
├── public/
│   └── index.html         # Frontend UI
│
├── uploads/               # File sementara (auto cleanup)
└── outputs/               # Hasil clip (bisa didownload)
```

## 🔌 API Endpoints

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/api/process` | Mulai proses video |
| `GET` | `/api/job/:jobId` | Cek status job |
| `GET` | `/api/queue/stats` | Statistik queue |
| `GET` | `/api/health` | Health check |

### POST /api/process
```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "aspectRatio": "9:16",
  "clipCount": 3
}
```

### GET /api/job/:jobId
```json
{
  "jobId": "uuid",
  "state": "completed",
  "result": {
    "videoTitle": "...",
    "clips": [
      {
        "title": "Momen Terbaik",
        "score": 92,
        "duration": 45,
        "downloadUrl": "http://localhost:3000/outputs/xxx.mp4"
      }
    ]
  }
}
```

## ⚙️ Konfigurasi

Semua konfigurasi ada di `.env`:

```env
PORT=3000
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
AI_MODEL=deepseek/deepseek-chat-v3-0324
AI_ANALYSIS_MAX_SEGMENTS=400
AI_ANALYSIS_WINDOW_SECONDS=30
BASE_URL=http://localhost:3000
TRANSCRIBE_CHUNK_TARGET_MB=22
TRANSCRIBE_AUDIO_BITRATE=32k
TRANSCRIBE_AUDIO_SAMPLE_RATE=16000
TRANSCRIBE_LANGUAGE=id
```

## 💡 Tips

- Video yang bekerja paling baik: podcast, educational, commentary, interview
- Video harus punya captions/dialog (bukan musik doang)
- Video panjang sekarang akan dikecilkan dan dipecah otomatis sebelum dikirim ke Groq
- Transcript yang sangat panjang juga akan diringkas ke window analisis yang lebih hemat token
- Jika transkripsi terasa terlalu lambat, kecilkan `TRANSCRIBE_CHUNK_TARGET_MB` atau naikkan `TRANSCRIBE_AUDIO_BITRATE` seperlunya

## 🔧 Troubleshooting

**Redis connection error:**
```bash
# Windows (Memurai)
Get-Service Memurai
"C:\Program Files\Memurai\memurai-cli.exe" PING

# Linux/Mac
redis-server
```

**yt-dlp not found:**
```bash
pip install yt-dlp --upgrade
```

**FFmpeg error:**
```bash
ffmpeg -version  # pastikan FFmpeg di PATH
```
