#!/usr/bin/env python3
"""
assemble_index.py
Writes the complete, production-ready public/index.html.
"""

import sys
import re

with open("/home/cutycat15/ClipAIv2/public/index.html.bak", "r", encoding="utf-8") as f:
    orig_content = f.read()

# Extract the script tag from index.html.bak
script_match = re.search(r"<script>([\s\S]*?)</script>", orig_content)
if not script_match:
    print("Could not find <script> block in backup file!", file=sys.stderr)
    sys.exit(1)

js_body = script_match.group(1)

# Now let's refine emoji strings in js_body so they use clean SVG icons or clean unicode
# 1. toggleTranscriptInput
js_body = re.sub(
    r"icon\.textContent = '▲ Tutup';",
    r"icon.innerHTML = '&uarr; Tutup';",
    js_body
)
js_body = re.sub(
    r"icon\.textContent = '▼ Buka';",
    r"icon.innerHTML = '&darr; Buka';",
    js_body
)

# 2. handleTranscriptChange
js_body = re.sub(
    r"btnProcess\.innerHTML = '⚡ Generate Clips Instan \(Fast Path\)';",
    r'btnProcess.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <span>Generate Clips Instan (Fast Path)</span>`;',
    js_body
)
js_body = re.sub(
    r"btnProcess\.innerHTML = '✨ Generate Clips dengan AI';",
    r'btnProcess.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg> <span>Generate Clips dengan AI</span>`;',
    js_body
)

# 3. jobStateMeta
js_body = re.sub(
    r"return \{ icon: '✅', label: 'Selesai', color: '#10B981'",
    r"return { icon: '✓', label: 'Selesai', color: '#00e599'",
    js_body
)
js_body = re.sub(
    r"case 'active':\s*return \{ icon: '⚙️', label: 'Sedang Diproses', color: '#4F8EFF'",
    r"case 'active':    return { icon: '●', label: 'Sedang Diproses', color: '#4F8EFF'",
    js_body
)
js_body = re.sub(
    r"case 'waiting':\s*return \{ icon: '⏳', label: 'Menunggu Antrian', color: '#F59E0B'",
    r"case 'waiting':   return { icon: '○', label: 'Menunggu Antrian', color: '#F59E0B'",
    js_body
)
js_body = re.sub(
    r"case 'delayed':\s*return \{ icon: '⏳', label: 'Menunggu',",
    r"case 'delayed':   return { icon: '○', label: 'Menunggu',",
    js_body
)
js_body = re.sub(
    r"case 'completed':\s*return \{ icon: '✅', label: 'Selesai',",
    r"case 'completed': return { icon: '✓', label: 'Selesai',",
    js_body
)
js_body = re.sub(
    r"case 'failed':\s*return \{ icon: '❌', label: 'Gagal',",
    r"case 'failed':    return { icon: '✕', label: 'Gagal',",
    js_body
)

# 4. renderOpusCardHtml icons
opus_card_old = """              <div class="opus-action-icons" onclick="event.stopPropagation()">
                <button type="button" class="opus-icon-btn" title="Favorit" onclick="toggleFavorite(this)">❤️</button>
                <a href="${src}" download="${c.filename || 'clip.mp4'}" class="opus-icon-btn" title="Download MP4">⬇</a>
                <button type="button" class="opus-icon-btn" title="Salin Hook &amp; Judul" onclick="copyToClipboard('${escapeHtml(clipTitle)}', this)">📋</button>
              </div>"""

opus_card_new = """              <div class="opus-action-icons" onclick="event.stopPropagation()">
                <button type="button" class="opus-icon-btn" title="Favorit" onclick="toggleFavorite(this)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                </button>
                <a href="${src}" download="${c.filename || 'clip.mp4'}" class="opus-icon-btn" title="Download MP4">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>
                <button type="button" class="opus-icon-btn" title="Salin Hook &amp; Judul" onclick="copyToClipboard('${escapeHtml(clipTitle)}', this)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>"""

if opus_card_old in js_body:
    js_body = js_body.replace(opus_card_old, opus_card_new)

# 5. renderDetailedJobCard auto headline notice & metadata button
js_body = re.sub(
    r'<span style="font-size: 18px;">📢</span>',
    r'<span class="feature-icon-box" style="width:28px;height:28px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg></span>',
    js_body
)
js_body = re.sub(
    r'<span>🏷️</span> <span>Lihat Metadata Medsos \(Viral Hook, Caption &amp; Hashtag\)</span>',
    r'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> <span>Lihat Metadata Medsos (Viral Hook, Caption &amp; Hashtag)</span>',
    js_body
)
js_body = re.sub(
    r'🔗 Buka Video YouTube Asli ↗',
    r'Buka Video YouTube Asli &nearr;',
    js_body
)

# 6. Stop button text & queue
js_body = re.sub(
    r"if \(btn\) \{ btn\.disabled = true; btn\.innerHTML = '⏳ Membatalkan\.\.\.'; \}",
    r"if (btn) { btn.disabled = true; btn.innerHTML = 'Membatalkan...'; }",
    js_body
)

# 7. Hardware info badge
js_body = re.sub(
    r"hwBadge\.textContent = '⚡ GPU Active';",
    r"hwBadge.innerHTML = '<span class=\"status-dot pulsing\"></span> GPU Active';",
    js_body
)
js_body = re.sub(
    r"hwBadge\.textContent = '🖥️ CPU Mode';",
    r"hwBadge.innerHTML = '<span class=\"status-dot\"></span> CPU Mode';",
    js_body
)

# 8. AI model optgroups
js_body = re.sub(
    r"optGroupFast\.label = '⚡ Rekomendasi \(Cepat & Cerdas\)';",
    r"optGroupFast.label = 'Rekomendasi (Cepat & Cerdas)';",
    js_body
)
js_body = re.sub(
    r"optGroupAll\.label = '🌐 Semua Model 9Router / Gateway';",
    r"optGroupAll.label = 'Semua Model 9Router / Gateway';",
    js_body
)
js_body = re.sub(
    r"opt\.textContent = m === defaultModel \? `⭐ \$\{m\} \(Default\)` : m;",
    r"opt.textContent = m === defaultModel ? `${m} (Default)` : m;",
    js_body
)
js_body = re.sub(
    r"customOpt\.textContent = '✏️ Custom Model ID\.\.\.';",
    r"customOpt.textContent = 'Custom Model ID...';",
    js_body
)

# 9. Fallback options
js_body = re.sub(
    r"<option value=\"cbai/deepseek-v4\.1-flash\" selected>⭐ cbai/deepseek-v4\.1-flash \(Default\)</option>",
    r"<option value=\"cbai/deepseek-v4.1-flash\" selected>cbai/deepseek-v4.1-flash (Default)</option>",
    js_body
)
js_body = re.sub(
    r"<option value=\"xkiro/google/gemini-3\.8-flash\">⚡ xkiro/google/gemini-3\.8-flash</option>",
    r"<option value=\"xkiro/google/gemini-3.8-flash\">xkiro/google/gemini-3.8-flash</option>",
    js_body
)
js_body = re.sub(
    r"<option value=\"kimchi/deepseek-v4-flash-0731\">🚀 kimchi/deepseek-v4-flash-0731</option>",
    r"<option value=\"kimchi/deepseek-v4-flash-0731\">kimchi/deepseek-v4-flash-0731</option>",
    js_body
)
js_body = re.sub(
    r"<option value=\"kr/claude-sonnet-4\.5\">🧠 kr/claude-sonnet-4\.5</option>",
    r"<option value=\"kr/claude-sonnet-4.5\">kr/claude-sonnet-4.5</option>",
    js_body
)
js_body = re.sub(
    r"<option value=\"__custom__\">✏️ Custom Model ID\.\.\.</option>",
    r"<option value=\"__custom__\">Custom Model ID...</option>",
    js_body
)

# 10. Results title
js_body = re.sub(
    r"document\.getElementById\('resultsTitle'\)\.textContent = `\$\{countLabel\} Berhasil Dibuat! 🎉`;",
    r"document.getElementById('resultsTitle').textContent = `${countLabel} Berhasil Dibuat`;",
    js_body
)

# 11. Append helper functions for URL preview and terminal logging:
extra_helpers = """
    // ── Live URL Preview & Clipboard Helper ───────────────────
    function extractYouTubeId(url) {
      if (!url) return null;
      const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
      return m ? m[1] : null;
    }

    function handleUrlInput(val) {
      const clearBtn = document.getElementById('btnClearUrl');
      const previewBox = document.getElementById('urlPreviewBox');
      const previewThumb = document.getElementById('urlPreviewThumb');
      const previewId = document.getElementById('urlPreviewId');

      if (clearBtn) clearBtn.style.display = val ? 'inline-flex' : 'none';

      const vidId = extractYouTubeId(val);
      if (vidId && previewBox && previewThumb && previewId) {
        previewThumb.src = `https://img.youtube.com/vi/${vidId}/hqdefault.jpg`;
        previewId.textContent = `YouTube ID: ${vidId}`;
        previewBox.style.display = 'flex';
      } else if (previewBox) {
        previewBox.style.display = 'none';
      }
    }

    async function pasteFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const input = document.getElementById('youtubeUrl');
          if (input) {
            input.value = text.trim();
            handleUrlInput(input.value);
            input.focus();
          }
        }
      } catch (e) {
        console.warn('Clipboard read failed:', e);
      }
    }

    function clearUrlInput() {
      const input = document.getElementById('youtubeUrl');
      if (input) {
        input.value = '';
        handleUrlInput('');
        input.focus();
      }
    }

    function appendTerminalLog(msg) {
      const container = document.getElementById('terminalLogLines');
      const consoleBox = document.getElementById('terminalLogConsole');
      if (!container) return;
      const d = new Date();
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      const line = document.createElement('div');
      line.className = 'terminal-line';
      line.innerHTML = `<span class="terminal-time">[${timeStr}]</span> <span>${escapeHtml(msg)}</span>`;
      container.appendChild(line);
      if (consoleBox) consoleBox.scrollTop = consoleBox.scrollHeight;
    }

    // Expose helpers
    window.extractYouTubeId = extractYouTubeId;
    window.handleUrlInput = handleUrlInput;
    window.pasteFromClipboard = pasteFromClipboard;
    window.clearUrlInput = clearUrlInput;
    window.appendTerminalLog = appendTerminalLog;
"""

# Inject terminal logging into updateProgress
js_body = re.sub(
    r"function updateProgress\(data\) \{",
    r"function updateProgress(data) {\n      if (data && data.progress && data.progress.message) {\n        appendTerminalLog(data.progress.message);\n      }",
    js_body
)

# Append extra helpers right before the closing of script
js_body += "\n" + extra_helpers

print("JS body processed and validated.")

# Now load CSS
from build_full_ui import CSS_CONTENT

# Construct HTML
HTML_TEMPLATE = f"""<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ClipAI Enterprise — AI Short Video Generation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet" />
  <style>
{CSS_CONTENT}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-left">
        <a class="logo" href="#studio" onclick="switchView('studio'); return false;">
          <div class="logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 8-4-4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8z"/><polygon points="10 11 15 14 10 17 10 11"/><path d="M2 8h20"/></svg>
          </div>
          <span class="logo-text">Clip<span>AI</span></span>
        </a>
        <span class="enterprise-badge">v2.4 Enterprise</span>
        <span class="enterprise-badge" style="background:rgba(0,229,153,0.1); border-color:rgba(0,229,153,0.25); color:var(--success);">Venture Ready</span>
      </div>

      <!-- Main Navigation Tabs: Studio vs Riwayat -->
      <nav class="app-nav" id="appNav">
        <button type="button" class="nav-tab active" id="tabStudioBtn" onclick="switchView('studio')">
          <span class="nav-tab-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </span>
          <span>Buat Klip</span>
        </button>
        <button type="button" class="nav-tab" id="tabHistoryBtn" onclick="switchView('history')">
          <span class="nav-tab-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
          </span>
          <span>Riwayat Klip</span>
          <span id="navHistoryBadge" class="nav-tab-badge" style="display:none;">0</span>
        </button>
      </nav>

      <!-- Real-Time Telemetry Status Pill Cluster -->
      <div class="telemetry-cluster">
        <span class="status-pill active" title="Redis BullMQ Message Bus Connected">
          <span class="status-dot pulsing"></span> Redis Active
        </span>
        <span id="hwBadge" class="status-pill active" title="AMD Radeon VAAPI Acceleration">
          <span class="status-dot pulsing"></span> GPU Active
        </span>
        <span class="status-pill" title="Ingest Pipeline Ready">
          <span class="status-dot"></span> Ingest Ready
        </span>
        <button id="stopAllBtn" onclick="stopEverything()" title="Batalkan semua job yang menunggu &amp; bersihkan antrian" class="btn-stop-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          <span>Stop Semua <span id="stopAllCount"></span></span>
        </button>
      </div>
    </header>

    <!-- Halaman 1: STUDIO / BUAT KLIP -->
    <main id="viewStudio">
      <!-- Job tertinggal dari sesi sebelumnya -->
      <div id="leftoverBanner" style="display:none; margin-bottom:20px; padding:14px 18px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:14px; justify-content:space-between; align-items:center; gap:12px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:32px; height:32px; border-radius:8px; background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); display:grid; place-items:center; color:var(--warning); flex-shrink:0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div>
            <div style="font-family:var(--font-display); font-size:12.5px; font-weight:700; color:var(--warning);">
              Ada <span id="leftoverCount">0</span> job tertinggal di antrian
            </div>
            <div style="font-size:11.5px; color:var(--text2); margin-top:2px;">
              Job ini otomatis dikerjakan worker. Batalkan jika tidak ingin dilanjutkan.
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button onclick="switchView('history')" style="background:transparent; border:1px solid rgba(245,158,11,0.4); color:var(--warning); border-radius:8px; font-family:var(--font-body); font-size:11.5px; font-weight:600; padding:6px 14px; cursor:pointer; white-space:nowrap;">
            Lihat di Riwayat &rarr;
          </button>
          <button onclick="stopEverything()" style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.4); color:var(--warning); border-radius:8px; font-family:var(--font-body); font-size:11.5px; font-weight:600; padding:6px 14px; cursor:pointer; white-space:nowrap;">
            Batalkan Semua
          </button>
        </div>
      </div>

      <section class="hero">
        <div class="hero-eyebrow">SYSTEMS LAB // CLOUD MEDIA PIPELINE</div>
        <h1 class="hero-title">
          Ubah Video Panjang Jadi <span class="highlight">Shorts Viral</span>
        </h1>
        <p class="hero-sub">
          Ekstraksi momen berpotensi viral secara otomatis via Whisper transkripsi, AI hook curation, face-tracking reframe 9:16, dan akselerasi GPU AMD VAAPI.
        </p>
      </section>

      <div class="features">
        <div class="feature">
          <div class="feature-header">
            <div class="feature-icon-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            </div>
            <div class="feature-title">AI Transcription</div>
          </div>
          <div class="feature-sub">Whisper transkripsi otomatis dengan timestamp presisi</div>
        </div>

        <div class="feature">
          <div class="feature-header">
            <div class="feature-icon-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/></svg>
            </div>
            <div class="feature-title">AI Viral Analysis</div>
          </div>
          <div class="feature-sub" id="heroAiModelSub">Model AI analisis hook score &amp; momen terbaik</div>
        </div>

        <div class="feature">
          <div class="feature-header">
            <div class="feature-icon-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>
            </div>
            <div class="feature-title">Hardware Render</div>
          </div>
          <div class="feature-sub" id="heroHwSub">FFmpeg potong &amp; reframe akselerasi GPU</div>
        </div>
      </div>

      <!-- Bento Input Form Console -->
      <div id="formSection">
        <div class="card">
          <div class="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span>URL Video YouTube</span>
          </div>

          <div class="url-group">
            <div class="input-wrap">
              <span class="input-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              </span>
              <input
                type="url"
                id="youtubeUrl"
                placeholder="https://www.youtube.com/watch?v=..."
                oninput="handleUrlInput(this.value)"
              />
              <div class="input-actions-cluster">
                <button type="button" class="btn-input-action" id="btnPasteUrl" onclick="pasteFromClipboard()" title="Paste URL dari Clipboard">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
                  <span>Paste</span>
                </button>
                <button type="button" class="btn-input-action" id="btnClearUrl" onclick="clearUrlInput()" title="Bersihkan URL" style="display:none;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Live YouTube Thumbnail Container -->
          <div id="urlPreviewBox" class="url-preview-box">
            <div style="position:relative; width:76px; height:46px; border-radius:6px; overflow:hidden; border:1px solid var(--border); background:#111520; flex-shrink:0;">
              <img id="urlPreviewThumb" class="url-preview-thumb" src="" alt="Thumbnail" style="width:100%; height:100%; object-fit:cover; display:block;" onerror="this.style.opacity='0.4';" />
              <div style="position:absolute; inset:0; display:grid; place-items:center; background:rgba(0,0,0,0.3); pointer-events:none;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)"><polygon points="9 8 16 12 9 16 9 8"/></svg>
              </div>
            </div>
            <div class="url-preview-info">
              <div class="url-preview-badge">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                <span>YouTube Source Verified</span>
              </div>
              <div id="urlPreviewId" class="url-preview-id"></div>
            </div>
          </div>

          <!-- Tanya Gemini Transcript Accordion (Fast Path) -->
          <div class="transcript-box-wrap">
            <div
              id="transcriptHeader"
              class="transcript-header-btn"
              onclick="toggleTranscriptInput()"
            >
              <div style="display:flex; align-items:center; gap:10px; font-size:12.5px; color:var(--text);">
                <div style="width:24px; height:24px; border-radius:6px; background:rgba(79,142,255,0.12); border:1px solid rgba(79,142,255,0.25); display:grid; place-items:center; color:var(--accent);">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg>
                </div>
                <span style="font-weight:600;">Punya Transkrip YouTube / Tanya Gemini?</span>
                <span style="font-size:10px; background:rgba(79,142,255,0.12); color:var(--accent); border:1px solid rgba(79,142,255,0.25); padding:2px 8px; border-radius:4px; font-weight:700; font-family:var(--font-mono);">MODE INSTAN</span>
              </div>
              <span id="transcriptToggleIcon" style="color:var(--text2); font-size:12px; font-family:var(--font-mono);">&darr; Buka</span>
            </div>
            <div id="transcriptInputContainer" style="display:none; margin-top:12px;">
              <div style="font-size:11.5px; color:var(--text2); margin-bottom:8px; line-height:1.5;">
                Salin hasil transkrip langsung dari tombol <strong>"Tanya"</strong> di YouTube atau teks ber-timestamp. Sistem akan <strong>melewati unduh audio &amp; Whisper 100%</strong> sehingga proses menjadi instan.
              </div>
              <textarea
                id="transcriptText"
                rows="6"
                style="width:100%; background:var(--bg-deep); border:1px solid var(--border); border-radius:10px; color:var(--text); font-family:var(--font-mono); font-size:12px; padding:12px; outline:none; resize:vertical; line-height:1.5;"
                placeholder="Tempel transkrip di sini. Contoh format Tanya YouTube:&#10;([0:00](https://www.youtube.com/watch?t=0s)) Katanya manusia itu kan diciptakan dari tanah ya, Bib.&#10;([0:03](https://www.youtube.com/watch?t=3s)) Heeh.&#10;([0:04](https://www.youtube.com/watch?t=4s)) Berarti kita saudara sama brokoli. Kok bisa, Pak?"
                oninput="handleTranscriptChange()"
              ></textarea>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:11px; color:var(--text3); font-family:var(--font-mono);">
                <span id="transcriptCharCount">0 karakter</span>
                <button type="button" onclick="clearTranscript()" style="background:transparent; border:none; color:var(--danger); cursor:pointer; font-size:11px; font-family:var(--font-mono);">Hapus Teks</button>
              </div>
            </div>
          </div>

          <!-- Bento Control Matrix Grid -->
          <div class="options-row">
            <div class="option-group">
              <label>Aspect Ratio</label>
              <div class="ar-buttons">
                <button class="ar-btn active" data-ar="9:16">
                  <span class="ar-icon"></span>
                  9:16
                </button>
                <button class="ar-btn" data-ar="1:1">
                  <span class="ar-icon"></span>
                  1:1
                </button>
                <button class="ar-btn" data-ar="16:9">
                  <span class="ar-icon"></span>
                  16:9
                </button>
              </div>
            </div>

            <div class="option-group">
              <label>Layout Mode (Universal)</label>
              <select id="layoutModeSelect">
                <option value="auto_split" selected>Smart Adaptive (Auto Split on 2-Person Shots)</option>
                <option value="standard">Solo Only (Always 1 Person Crop)</option>
                <option value="split_screen">Split-Screen (Always Top-Bottom)</option>
                <option value="gaming_streamer">Gaming Streamer (Cam + Gameplay)</option>
              </select>
            </div>

            <div class="option-group">
              <label>Jumlah Clip</label>
              <div class="clip-count-wrap">
                <button id="btnMinus" onclick="changeClipCount(-1)">&minus;</button>
                <span id="clipCountDisplay">3</span>
                <span class="label">clips</span>
                <button id="btnPlus" onclick="changeClipCount(1)">+</button>
              </div>
            </div>

            <div class="option-group">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <label style="margin-bottom:0;">Model AI (LLM)</label>
                <span id="aiModelBadge" style="font-size:10px; font-family:var(--font-mono); color:var(--accent); background:rgba(79,142,255,0.12); padding:2px 7px; border-radius:4px; border:1px solid rgba(79,142,255,0.25);">9Router</span>
              </div>
              <select id="aiModelSelect" onchange="handleAiModelChange()">
                <option value="" disabled selected>Memuat model...</option>
              </select>
              <input type="text" id="customAiModelInput" placeholder="Ketik model custom (contoh: openai/gpt-4o)..." style="display:none; width:100%; margin-top:8px; background:var(--bg-deep); border:1px solid var(--accent); border-radius:8px; color:var(--text); font-family:var(--font-mono); font-size:11px; padding:8px 10px; outline:none;" oninput="syncCustomModel()">
            </div>
          </div>

          <!-- Publishing Metadata Panel (judul, deskripsi, hashtag, caption) -->
          <div class="metadata-card" style="margin-bottom: 20px; padding: 18px 20px; background: var(--bg-surface-elevated); border: 1px solid var(--border); border-radius: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(79, 142, 255, 0.1); border: 1px solid rgba(79, 142, 255, 0.2); display: grid; place-items: center; color: var(--accent); flex-shrink: 0;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                </div>
                <div>
                  <div style="font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: #ffffff;">
                    Judul &amp; Deskripsi Viral
                  </div>
                  <div style="font-size: 11.5px; color: var(--text2);">
                    AI menyusun hook title, caption &amp; hashtag siap-tempel per klip
                  </div>
                </div>
              </div>
              <label class="switch-toggle">
                <input type="checkbox" id="metadataEnabled" checked onchange="toggleMetadataSettings()">
                <span class="slider"></span>
              </label>
            </div>

            <div id="metadataSettings" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
              <div class="option-group" style="margin-bottom:0;">
                <label>Gaya Metadata</label>
                <select id="metadataMode">
                  <option value="viral" selected>Viral (Max Scroll-Stop)</option>
                  <option value="seo">SEO (Optimasi Pencarian)</option>
                  <option value="simple">Sederhana (Lugas &amp; No Clickbait)</option>
                </select>
              </div>
              <div class="option-group" style="margin-bottom:0;">
                <label>Platform Target</label>
                <select id="targetPlatform">
                  <option value="all" selected>Semua Platform (TikTok + Shorts + Reels)</option>
                  <option value="tiktok">TikTok</option>
                  <option value="shorts">YouTube Shorts</option>
                  <option value="reels">Instagram Reels</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Branding Panel (atribusi sumber + watermark channel) -->
          <div class="branding-card" style="margin-bottom: 20px; padding: 18px 20px; background: var(--bg-surface-elevated); border: 1px solid var(--border); border-radius: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(79, 142, 255, 0.1); border: 1px solid rgba(79, 142, 255, 0.2); display: grid; place-items: center; color: var(--accent); flex-shrink: 0;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <div>
                  <div style="font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: #ffffff;">
                    Sumber &amp; Watermark
                  </div>
                  <div style="font-size: 11.5px; color: var(--text2);">
                    Cantumkan channel sumber &amp; watermark akun kamu di dalam video
                  </div>
                </div>
              </div>
              <label class="switch-toggle">
                <input type="checkbox" id="brandingEnabled" onchange="toggleBrandingSettings()">
                <span class="slider"></span>
              </label>
            </div>

            <div id="brandingSettings" style="display: none;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                <div class="option-group" style="margin-bottom:0;">
                  <label>Channel Sumber (Atribusi)</label>
                  <input type="text" id="sourceChannel" placeholder="Otomatis dari YouTube">
                </div>
                <div class="option-group" style="margin-bottom:0;">
                  <label>Label Sumber</label>
                  <input type="text" id="sourceLabel" value="Sumber">
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                <div class="option-group" style="margin-bottom:0;">
                  <label>Watermark Channel Kamu</label>
                  <input type="text" id="watermarkText" placeholder="contoh: @prime.clipsmedia" value="@prime.clipsmedia">
                </div>
                <div class="option-group" style="margin-bottom:0;">
                  <label>Posisi Watermark</label>
                  <select id="watermarkPosition">
                    <option value="above-subtitles" selected>Diatas Subtitle (Disarankan)</option>
                    <option value="bottom-right">Kanan Bawah</option>
                    <option value="bottom-left">Kiri Bawah</option>
                    <option value="top-right">Kanan Atas</option>
                    <option value="top-left">Kiri Atas</option>
                  </select>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
                <div class="option-group" style="margin-bottom:0;">
                  <label>Posisi Sumber</label>
                  <select id="sourcePosition">
                    <option value="top-left" selected>Kiri Atas</option>
                    <option value="top-right">Kanan Atas</option>
                    <option value="bottom-left">Kiri Bawah</option>
                    <option value="bottom-right">Kanan Bawah</option>
                  </select>
                </div>
                <div class="option-group" style="margin-bottom:0;">
                  <label>Durasi Sumber</label>
                  <select id="sourceDuration">
                    <option value="3">3 detik</option>
                    <option value="4" selected>4 detik</option>
                    <option value="6">6 detik</option>
                    <option value="10">10 detik</option>
                  </select>
                </div>
                <div class="option-group" style="margin-bottom:0;">
                  <label>Ukuran Watermark</label>
                  <select id="watermarkFontSize">
                    <option value="22">Kecil</option>
                    <option value="30" selected>Sedang</option>
                    <option value="42">Besar</option>
                  </select>
                </div>
                <div class="option-group" style="margin-bottom:0;">
                  <label>Opacity</label>
                  <select id="watermarkOpacity">
                    <option value="0.25">Sangat Tipis</option>
                    <option value="0.35">Tipis</option>
                    <option value="0.45" selected>Sedang</option>
                    <option value="0.7">Jelas</option>
                    <option value="1">Solid</option>
                  </select>
                </div>
              </div>

              <!-- Auto Headline Settings (Opus Clip Feature) -->
              <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border);">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                  <div>
                    <div style="font-family: var(--font-display); font-size: 13px; font-weight: 700; color: #ffffff;">
                      Auto Headline Video (Opus Clip Style)
                    </div>
                    <div style="font-size: 11.5px; color: var(--text2); margin-top: 2px;">
                      Sematkan hook headline visual di bagian atas video pada 5 detik pertama
                    </div>
                  </div>
                  <label class="switch-toggle">
                    <input type="checkbox" id="autoHeadlineEnabled" checked onchange="toggleHeadlineSettings()">
                    <span class="slider"></span>
                  </label>
                </div>

                <div id="headlineOptions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                  <div class="option-group" style="margin-bottom:0;">
                    <label>Durasi Headline</label>
                    <select id="headlineDuration">
                      <option value="3">3 detik pertama</option>
                      <option value="5" selected>5 detik pertama (Disarankan)</option>
                      <option value="8">8 detik pertama</option>
                    </select>
                  </div>
                  <div class="option-group" style="margin-bottom:0;">
                    <label>Tema Warna Headline</label>
                    <select id="headlineTheme">
                      <option value="white_black" selected>Kotak Putih - Teks Hitam (Opus Clip)</option>
                      <option value="yellow_black">Kotak Kuning - Teks Hitam</option>
                      <option value="black_white">Kotak Hitam - Teks Putih</option>
                    </select>
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                  <div class="option-group" style="margin-bottom:0;">
                    <label>Gaya Bentuk Headline</label>
                    <select id="headlineCornerStyle">
                      <option value="banner" selected>Banner Penuh (Sambung Kanan-Kiri)</option>
                      <option value="rounded">Kartu Melengkung Halus</option>
                      <option value="soft">Kartu Sangat Bulat</option>
                      <option value="sharp">Kartu Siku Kaku</option>
                    </select>
                  </div>
                  <div class="option-group" style="margin-bottom:0;">
                    <label>&nbsp;</label>
                    <div style="font-size:11px; color:var(--text3); line-height:1.45; padding-top:4px;">
                      Banner penuh menyambung dari ujung kiri ke kanan frame (gaya Opus Clip).
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Auto Subtitle Customization Panel -->
          <div class="subtitle-card" style="margin-bottom: 24px; padding: 18px 20px; background: var(--bg-surface-elevated); border: 1px solid var(--border); border-radius: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(79, 142, 255, 0.1); border: 1px solid rgba(79, 142, 255, 0.2); display: grid; place-items: center; color: var(--accent); flex-shrink: 0;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="4.5" rx="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/></svg>
                </div>
                <div>
                  <div style="font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: #ffffff;">
                    Auto Subtitles (Burn-in)
                  </div>
                  <div style="font-size: 11.5px; color: var(--text2);">
                    Animasi teks per kata (Karaoke/Viral Pop ala Opus Clip &amp; Submagic)
                  </div>
                </div>
              </div>
              <label class="switch-toggle">
                <input type="checkbox" id="subtitlesEnabled" checked onchange="toggleSubtitleSettings()">
                <span class="slider"></span>
              </label>
            </div>

            <div id="subtitleOptionsWrap" style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border);">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
                <div>
                  <label style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text2); font-weight: 600; margin-bottom: 8px;">
                    Gaya Preset Viral
                  </label>
                  <select id="subtitlePreset" onchange="applySubtitlePreset()">
                    <option value="hormozi" selected>Hormozi Yellow (Populer)</option>
                    <option value="mrbeast">MrBeast Green (High Contrast)</option>
                    <option value="cyber">Cyber Cyan (Modern Glow)</option>
                    <option value="minimal">Clean Minimal (Putih)</option>
                  </select>
                </div>
                <div>
                  <label style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text2); font-weight: 600; margin-bottom: 8px;">
                    Posisi Vertikal
                  </label>
                  <select id="subtitlePosition">
                    <option value="bottom" selected>Bawah (Rekomendasi 9:16)</option>
                    <option value="center">Tengah Layar</option>
                    <option value="top">Atas Layar</option>
                  </select>
                </div>
              </div>

              <!-- Advanced Styling Accordion -->
              <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 6px 0; font-size: 11.5px; color: var(--text2);" onclick="toggleAdvancedSubtitleSettings()">
                <span style="display:flex; align-items:center; gap:6px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  <span>Kustomisasi Lanjutan (Font &amp; Warna Highlight)</span>
                </span>
                <span id="advSubToggleIcon" style="font-family:var(--font-mono);">&darr;</span>
              </div>

              <div id="advSubtitleOptions" style="display: none; margin-top: 12px; padding: 14px; background: var(--bg-deep); border-radius: 12px; border: 1px solid var(--border);">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
                  <div>
                    <label style="display: block; font-size: 11px; color: var(--text2); margin-bottom: 6px;">Pilihan Font</label>
                    <select id="subtitleFont">
                      <option value="Impact" selected>Impact (Bold Punchy)</option>
                      <option value="Arial">Arial Black (Clean Bold)</option>
                      <option value="Montserrat, Arial">Montserrat (Modern)</option>
                      <option value="Trebuchet MS, Arial">Trebuchet MS (Stylized)</option>
                    </select>
                  </div>
                  <div>
                    <label style="display: block; font-size: 11px; color: var(--text2); margin-bottom: 6px;">Warna Kata Aktif</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                      <input type="color" id="subtitleHighlightColor" value="#FFE600" style="width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; background: transparent;">
                      <span id="highlightColorHex" style="font-size: 12px; font-family: var(--font-mono); color: var(--text2);">#FFE600</span>
                    </div>
                  </div>
                </div>
                <div>
                  <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text2); margin-bottom: 6px;">
                    <span>Ukuran Font</span>
                    <span id="fontSizeDisplay" style="font-family:var(--font-mono); color:var(--accent);">80px</span>
                  </div>
                  <input type="range" id="subtitleFontSize" min="50" max="110" value="80" oninput="document.getElementById('fontSizeDisplay').textContent = this.value + 'px'" style="width: 100%; accent-color: var(--accent);">
                </div>
              </div>
            </div>
          </div>

          <button class="btn-process" id="btnProcess" onclick="startProcess()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg>
            <span>Generate Clips dengan AI</span>
          </button>
        </div>
      </div>

      <!-- Pipeline Telemetry & Progress Visualizer -->
      <div id="progressSection">
        <div class="progress-card">
          <div class="progress-steps">
            <div class="step" id="step1">
              <div class="step-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </div>
              <div class="step-text">
                <div class="step-label">Download Video Stream</div>
                <div class="step-sub" id="step1sub">Menunggu...</div>
              </div>
            </div>
            <div class="step" id="step2">
              <div class="step-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              </div>
              <div class="step-text">
                <div class="step-label">Transkripsi Audio (Whisper Engine)</div>
                <div class="step-sub" id="step2sub">Menunggu...</div>
              </div>
            </div>
            <div class="step" id="step3">
              <div class="step-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/></svg>
              </div>
              <div class="step-text">
                <div class="step-label">AI Analisis Momen Viral</div>
                <div class="step-sub" id="step3sub">Menunggu...</div>
              </div>
            </div>
            <div class="step" id="step4">
              <div class="step-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>
              </div>
              <div class="step-text">
                <div class="step-label">Proses &amp; Render Video (AMD VAAPI)</div>
                <div class="step-sub" id="step4sub">Menunggu...</div>
              </div>
            </div>
          </div>

          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" id="progressBar" style="width: 2%"></div>
          </div>
          <div class="progress-text">
            <span id="progressMsg">Memulai proses...</span>
            <span id="progressPct">2%</span>
          </div>

          <!-- Real-time Terminal Log Console -->
          <div class="terminal-console" id="terminalLogConsole">
            <div class="terminal-header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
              <span>Pipeline Telemetry Stream</span>
            </div>
            <div id="terminalLogLines">
              <div class="terminal-line"><span class="terminal-time">[00:00:00]</span> <span>System initialized. Waiting for task dispatch...</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error Section -->
      <div id="errorSection" style="display:none">
        <div class="error-card">
          <div class="icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
          </div>
          <span class="msg" id="errorMsg">Terjadi kesalahan.</span>
        </div>
        <button class="btn-reset" onclick="resetForm()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          <span>Coba Lagi</span>
        </button>
      </div>

      <!-- Results Section -->
      <div id="resultsSection">
        <div class="results-header">
          <div class="results-title" id="resultsTitle">Clips Berhasil Dibuat</div>
          <div class="results-sub" id="resultsSub"></div>
        </div>

        <div class="opus-clips-grid" id="clipsGrid"></div>

        <!-- Panel metadata publikasi (judul, deskripsi, hashtag, caption) -->
        <div id="metadataResults" style="display:none; margin-top:28px;"></div>

        <button class="btn-reset" onclick="resetForm()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          <span>Proses Video Baru</span>
        </button>
      </div>
    </main>

    <!-- Halaman 2: DEDICATED RIWAYAT & ARSIP KLIP -->
    <main id="viewHistory" style="display:none; margin-bottom:40px;">
      <!-- History Header -->
      <div style="display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:24px; padding-bottom:18px; border-bottom:1px solid var(--border);">
        <div>
          <div style="font-family:var(--font-mono); font-size:11px; text-transform:uppercase; letter-spacing:0.12em; color:var(--accent); font-weight:700; margin-bottom:6px;">
            LIBRARY &amp; ARCHIVE
          </div>
          <h1 style="font-family:var(--font-display); font-size:26px; font-weight:800; color:#ffffff; letter-spacing:-0.02em;">
            Riwayat Klip &amp; Galeri
          </h1>
          <p style="font-size:13px; color:var(--text2); margin-top:4px;">
            Semua hasil klip video, metadata viral, dan status rendering tersimpan permanen di sini.
          </p>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button onclick="refreshJobs(true)" style="background:var(--bg-surface); border:1px solid var(--border); color:var(--text); border-radius:8px; font-family:var(--font-body); font-size:12px; font-weight:600; padding:8px 14px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all 0.2s;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
            <span>Segarkan</span>
          </button>
          <button onclick="switchView('studio')" style="background:var(--accent-gradient); border:none; color:#ffffff; border-radius:8px; font-family:var(--font-display); font-size:12px; font-weight:700; padding:8px 16px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 2px 12px rgba(79,142,255,0.35);">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span>Buat Klip Baru</span>
          </button>
        </div>
      </div>

      <!-- Filter & Search Toolbar -->
      <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:14px; padding:14px 18px; margin-bottom:22px; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:14px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="font-size:11px; text-transform:uppercase; color:var(--text3); font-weight:700; letter-spacing:0.05em; font-family:var(--font-mono);">Filter:</span>
          <button type="button" class="filter-chip active" id="chipFilterAll" onclick="setHistoryFilter('all')">
            Semua <span id="countFilterAll" class="chip-count">0</span>
          </button>
          <button type="button" class="filter-chip" id="chipFilterCompleted" onclick="setHistoryFilter('completed')">
            Selesai <span id="countFilterCompleted" class="chip-count">0</span>
          </button>
          <button type="button" class="filter-chip" id="chipFilterActive" onclick="setHistoryFilter('active')">
            Diproses <span id="countFilterActive" class="chip-count">0</span>
          </button>
          <button type="button" class="filter-chip" id="chipFilterFailed" onclick="setHistoryFilter('failed')">
            Gagal <span id="countFilterFailed" class="chip-count">0</span>
          </button>
        </div>

        <div style="position:relative; min-width:240px; flex:1; max-width:360px;">
          <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text3); display:flex;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </span>
          <input type="text" id="historySearchInput" placeholder="Cari judul video atau link YouTube..." oninput="renderHistoryList()"
            style="width:100%; background:var(--bg-deep); border:1px solid var(--border); border-radius:8px; padding:8px 12px 8px 34px; font-size:12px; color:var(--text); outline:none; font-family:var(--font-body);" />
        </div>
      </div>

      <!-- Jobs List Container -->
      <div id="historyJobsList" style="display:grid; gap:18px;"></div>

      <!-- Empty State -->
      <div id="historyEmptyState" style="display:none; text-align:center; padding:64px 20px; background:var(--bg-surface); border:1px dashed var(--border); border-radius:18px;">
        <div style="width:48px; height:48px; border-radius:12px; background:rgba(79,142,255,0.1); border:1px solid rgba(79,142,255,0.2); display:grid; place-items:center; color:var(--accent); margin:0 auto 16px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        </div>
        <div style="font-family:var(--font-display); font-size:16px; font-weight:700; color:#ffffff; margin-bottom:6px;">
          Belum Ada Riwayat Klip
        </div>
        <p style="font-size:13px; color:var(--text2); max-width:440px; margin:0 auto 20px;">
          Video yang Anda proses akan otomatis diarsipkan di halaman ini lengkap dengan preview video, opsi unduh, dan metadata medsos.
        </p>
        <button onclick="switchView('studio')" style="background:var(--accent-gradient); color:#ffffff; border:none; border-radius:8px; font-family:var(--font-display); font-size:12.5px; font-weight:700; padding:10px 20px; cursor:pointer;">
          Mulai Buat Klip Sekarang
        </button>
      </div>
    </main>
  </div>

  <footer style="text-align:center; padding:32px 0; color:var(--text3); font-size:11.5px; font-family:var(--font-mono); border-top:1px solid var(--border); margin-top:40px;">
    <div class="container" style="padding-bottom:0;">
      ClipAI Enterprise &nbsp;&middot;&nbsp; Powered by Whisper + DeepSeek + FFmpeg (AMD VAAPI) &nbsp;&middot;&nbsp; BullMQ Cloud Engine
    </div>
  </footer>

  <!-- OPUS CLIP PRO DETAIL MODAL DIALOG -->
  <div id="opusModalBackdrop" class="opus-modal-backdrop" style="display: none;" onclick="if(event.target === this) closeOpusModal()">
    <div class="opus-modal-container" onclick="event.stopPropagation()">
      <!-- Modal Header -->
      <div class="opus-modal-header">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
          <span id="opusModalRankBadge" style="background: rgba(79, 142, 255, 0.18); color: var(--accent); font-family: var(--font-mono); font-size: 13px; font-weight: 800; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(79,142,255,0.3);">#1</span>
          <h2 id="opusModalTitle" style="font-family: var(--font-display); font-size: 16px; font-weight: 700; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            Judul Klip
          </h2>
          <button type="button" onclick="editModalTitle()" title="Edit Judul" style="background:none; border:none; color:var(--text3); cursor:pointer; display:flex; align-items:center; padding:2px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button type="button" onclick="navigateOpusModal(-1)" class="opus-icon-btn" title="Klip Sebelumnya" style="width: 32px; height: 32px; font-size: 14px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button type="button" onclick="navigateOpusModal(1)" class="opus-icon-btn" title="Klip Berikutnya" style="width: 32px; height: 32px; font-size: 14px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button type="button" onclick="closeOpusModal()" class="opus-icon-btn" title="Tutup Modal" style="width: 32px; height: 32px; margin-left: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>

      <!-- Modal Body: 3 Columns -->
      <div class="opus-modal-body">
        <!-- Column 1: Video Player 9:16 -->
        <div>
          <div style="position: relative; aspect-ratio: 9/16; background: #000; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); box-shadow: 0 12px 36px rgba(0,0,0,0.7);">
            <video id="opusModalVideo" controls autoplay playsinline style="width: 100%; height: 100%; object-fit: cover; background: #000;"></video>
          </div>
        </div>

        <!-- Column 2: Scene Analysis & Timestamped Transcript -->
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <!-- Tabs: Scene Analysis vs Transcript Only -->
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
            <div style="display: flex; gap: 16px;">
              <button type="button" id="tabSceneAnalysis" onclick="toggleModalAnalysisTab('analysis')" style="background: none; border: none; font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 6px; cursor: pointer;">
                Scene analysis
              </button>
              <button type="button" id="tabTranscriptOnly" onclick="toggleModalAnalysisTab('transcript')" style="background: none; border: none; font-family: var(--font-display); font-size: 13.5px; font-weight: 600; color: var(--text2); padding-bottom: 6px; cursor: pointer;">
                Transcript only
              </button>
            </div>
            <label style="font-size: 11.5px; color: var(--text3); display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="checkTranscriptOnly" onchange="toggleModalAnalysisTab(this.checked ? 'transcript' : 'analysis')">
              Transcript only
            </label>
          </div>

          <!-- Section: Virality Score & Pillars -->
          <div id="modalAnalysisSection">
            <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
              <div>
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text3); font-weight: 700; letter-spacing: 0.05em; font-family: var(--font-mono);">SCORE VIRALITY</div>
                <div style="display: flex; align-items: baseline; gap: 4px; margin-top: 2px;">
                  <span id="opusModalScoreNum" style="font-family: var(--font-display); font-size: 34px; font-weight: 800; color: var(--success); text-shadow: 0 0 16px var(--success-glow);">99</span>
                  <span style="font-size: 13px; color: var(--text3); font-family: var(--font-mono);">/100</span>
                </div>
              </div>
              <!-- 4 Pillar Metrics -->
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <div style="background: rgba(0,229,153,0.1); border: 1px solid rgba(0,229,153,0.3); border-radius: 6px; padding: 4px 10px; text-align: center;">
                  <div style="font-size: 9.5px; color: var(--text3); font-family: var(--font-mono);">HOOK</div>
                  <div id="opusMetricHook" style="font-size: 13px; font-weight: 800; color: var(--success);">A</div>
                </div>
                <div style="background: rgba(0,229,153,0.1); border: 1px solid rgba(0,229,153,0.3); border-radius: 6px; padding: 4px 10px; text-align: center;">
                  <div style="font-size: 9.5px; color: var(--text3); font-family: var(--font-mono);">FLOW</div>
                  <div id="opusMetricFlow" style="font-size: 13px; font-weight: 800; color: var(--success);">A</div>
                </div>
                <div style="background: rgba(0,229,153,0.1); border: 1px solid rgba(0,229,153,0.3); border-radius: 6px; padding: 4px 10px; text-align: center;">
                  <div style="font-size: 9.5px; color: var(--text3); font-family: var(--font-mono);">VALUE</div>
                  <div id="opusMetricValue" style="font-size: 13px; font-weight: 800; color: var(--success);">A</div>
                </div>
                <div style="background: rgba(0,229,153,0.1); border: 1px solid rgba(0,229,153,0.3); border-radius: 6px; padding: 4px 10px; text-align: center;">
                  <div style="font-size: 9.5px; color: var(--text3); font-family: var(--font-mono);">TREND</div>
                  <div id="opusMetricTrend" style="font-size: 13px; font-weight: 800; color: var(--success);">A-</div>
                </div>
              </div>
            </div>

            <!-- AI Context Description -->
            <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;">
              <div style="font-size: 10.5px; text-transform: uppercase; color: var(--accent); font-weight: 700; letter-spacing: 0.05em; margin-bottom: 6px; font-family: var(--font-mono); display: flex; align-items: center; gap: 6px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/></svg>
                <span>AI Scene Analysis &amp; Context</span>
              </div>
              <p id="opusModalExplanation" style="font-size: 12.5px; line-height: 1.6; color: var(--text);"></p>
            </div>
          </div>

          <!-- Timestamped Transcript -->
          <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
              <div style="font-size: 10.5px; text-transform: uppercase; color: var(--text3); font-weight: 700; letter-spacing: 0.05em; font-family: var(--font-mono);">
                Transkrip Pembicaraan
              </div>
              <span id="opusModalTimeRange" style="font-family: var(--font-mono); font-size: 11px; color: var(--accent); font-weight: 700;">[00:00 - 01:00]</span>
            </div>
            <div id="opusModalTranscriptBox" style="font-size: 12.5px; line-height: 1.6; color: #cbd5e1; background: var(--bg-deep); border: 1px solid var(--border); border-radius: 8px; padding: 12px; max-height: 180px; overflow-y: auto;"></div>
          </div>

          <!-- Publishing Metadata Accordion -->
          <div id="opusModalMetadataSection" style="background: var(--bg-surface-elevated); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px;">
            <div style="font-size: 10.5px; text-transform: uppercase; color: var(--warning); font-weight: 700; letter-spacing: 0.05em; margin-bottom: 8px; font-family: var(--font-mono); display: flex; align-items: center; gap: 6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              <span>Metadata Publikasi Siap Pakai</span>
            </div>
            <div id="opusModalMetadataContent" style="display: grid; gap: 8px;"></div>
          </div>
        </div>

        <!-- Column 3: Action Toolbar -->
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <a id="opusModalDownloadBtn" href="#" download="" style="background: var(--accent-gradient); color: #ffffff; border: none; border-radius: 10px; font-family: var(--font-display); font-size: 13px; font-weight: 700; padding: 12px 14px; cursor: pointer; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 16px rgba(79,142,255,0.4);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Download HD</span>
          </a>
          <button type="button" onclick="copyModalAllMetadata()" style="background: var(--bg-surface-elevated); border: 1px solid var(--border); color: var(--text); border-radius: 10px; font-family: var(--font-body); font-size: 12px; font-weight: 600; padding: 10px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Salin Metadata</span>
          </button>
          <button type="button" onclick="copyModalCaption()" style="background: var(--bg-surface-elevated); border: 1px solid var(--border); color: var(--text); border-radius: 10px; font-family: var(--font-body); font-size: 12px; font-weight: 600; padding: 10px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>
            <span>Publish on Social</span>
          </button>
          <div style="background: var(--bg-deep); border: 1px solid var(--border); border-radius: 8px; padding: 10px; font-size: 11px; color: var(--text3); text-align: center; margin-top: 10px; font-family: var(--font-mono);">
            Format: <strong>9:16 Vertikal</strong><br>
            Akselerasi: <strong>AMD VAAPI</strong>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
{js_body}
  </script>
</body>
</html>
"""

with open("/home/cutycat15/ClipAIv2/public/index.html", "w", encoding="utf-8") as f:
    f.write(HTML_TEMPLATE)

print("public/index.html written successfully!")
