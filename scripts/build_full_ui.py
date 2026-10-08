#!/usr/bin/env python3
"""
build_full_ui.py
Generates the complete CSS specification for ClipAIv2.
"""

CSS_CONTENT = """
    :root {
      /* Obsidian Palette - UdinCloud Systems Lab Spec */
      --bg-base: #06080d;
      --bg-deep: #090d15;
      --bg-surface: #0f1420;
      --bg-surface-elevated: #141a29;
      --bg-surface-hover: #192134;
      --bg-glass: rgba(15, 20, 32, 0.72);

      --border-subtle: rgba(255, 255, 255, 0.05);
      --border: rgba(255, 255, 255, 0.08);
      --border-glow: rgba(79, 142, 255, 0.28);
      --border-active: rgba(79, 142, 255, 0.55);

      --accent: #4f8eff;
      --accent-hover: #6ea1ff;
      --accent2: #7c5cfc;
      --accent-glow: rgba(79, 142, 255, 0.16);
      --accent-gradient: linear-gradient(135deg, #4f8eff 0%, #7c5cfc 100%);
      --accent-gradient-hover: linear-gradient(135deg, #649bff 0%, #8c6fff 100%);

      --success: #00e599;
      --success-glow: rgba(0, 229, 153, 0.18);
      --warning: #f59e0b;
      --warning-glow: rgba(245, 158, 11, 0.15);
      --danger: #ef4444;
      --danger-glow: rgba(239, 68, 68, 0.15);

      --text: #f1f5f9;
      --text2: #94a3b8;
      --text3: #64748b;
      --text-muted: #475569;

      /* Typography */
      --font-display: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

      /* Legacy compatibility mappings */
      --bg: var(--bg-base);
      --bg2: var(--bg-deep);
      --surface: var(--bg-surface);
      --surface2: var(--bg-surface-elevated);
      --font-head: var(--font-display);
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      scroll-behavior: smooth;
      background-color: var(--bg-base);
      overflow-x: hidden;
      width: 100%;
    }

    body {
      background-color: var(--bg-base);
      color: var(--text);
      font-family: var(--font-body);
      min-height: 100vh;
      overflow-x: hidden;
      width: 100%;
      position: relative;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      line-height: 1.5;
    }

    /* Ambient Spotlight & Engineering Micro-Grid */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 36px 36px;
      pointer-events: none;
      z-index: 0;
    }

    body::after {
      content: '';
      position: fixed;
      top: -160px;
      left: 50%;
      transform: translateX(-50%);
      width: 900px;
      max-width: 100vw;
      height: 480px;
      background: radial-gradient(ellipse 65% 50% at 50% 30%, rgba(79, 142, 255, 0.13), transparent 70%);
      pointer-events: none;
      z-index: 0;
    }

    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .container {
      max-width: 1060px;
      width: 100%;
      margin: 0 auto;
      padding: 0 20px 64px;
      position: relative;
      z-index: 1;
      overflow-x: hidden;
    }

    /* ── APPLICATION HEADER ────────────────────────── */
    header {
      padding: 20px 0 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 28px;
      flex-wrap: wrap;
      width: 100%;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      max-width: 100%;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      cursor: pointer;
    }

    .logo-icon {
      width: 36px;
      height: 36px;
      background: var(--accent-gradient);
      border-radius: 9px;
      display: grid;
      place-items: center;
      color: #ffffff;
      box-shadow: 0 4px 16px rgba(79, 142, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.3);
      flex-shrink: 0;
    }

    .logo-text {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 21px;
      color: #ffffff;
      letter-spacing: -0.03em;
    }

    .logo-text span {
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .enterprise-badge {
      font-family: var(--font-mono);
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      padding: 3px 7px;
      border-radius: 5px;
      background: rgba(79, 142, 255, 0.1);
      border: 1px solid rgba(79, 142, 255, 0.25);
      color: var(--accent);
      text-transform: uppercase;
      white-space: nowrap;
    }

    /* Main Navigation Sliding Tabs */
    .app-nav {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      padding: 4px;
      border-radius: 12px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      max-width: 100%;
    }

    .nav-tab {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text2);
      font-family: var(--font-display);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      white-space: nowrap;
      user-select: none;
    }

    .nav-tab:hover {
      color: var(--text);
      background: var(--bg-surface-elevated);
    }

    .nav-tab.active {
      background: var(--accent);
      color: #ffffff;
      box-shadow: 0 2px 12px rgba(79, 142, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .nav-tab-icon {
      display: inline-flex;
      align-items: center;
    }

    .nav-tab-badge {
      background: rgba(255, 255, 255, 0.22);
      color: #fff;
      font-family: var(--font-mono);
      font-size: 10.5px;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 10px;
      min-width: 18px;
      text-align: center;
    }

    .nav-tab:not(.active) .nav-tab-badge {
      background: rgba(79, 142, 255, 0.12);
      color: var(--accent);
      border: 1px solid rgba(79, 142, 255, 0.25);
    }

    /* Telemetry Pill Cluster */
    .telemetry-cluster {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      max-width: 100%;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 20px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      color: var(--text2);
      white-space: nowrap;
      transition: all 0.2s;
    }

    .status-pill.active {
      background: rgba(0, 229, 153, 0.08);
      border-color: rgba(0, 229, 153, 0.25);
      color: var(--success);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 6px currentColor;
    }

    .status-dot.pulsing {
      animation: dotPulse 2s infinite ease-in-out;
    }

    @keyframes dotPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .btn-stop-all {
      display: none;
      align-items: center;
      gap: 6px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #ef4444;
      border-radius: 8px;
      font-family: var(--font-body);
      font-size: 11.5px;
      font-weight: 600;
      padding: 6px 12px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-stop-all:hover {
      background: rgba(239, 68, 68, 0.2);
      border-color: #ef4444;
    }

    /* ── HERO BANNER ────────────────────────────────── */
    .hero {
      text-align: center;
      padding: 20px 0 32px;
      width: 100%;
    }

    .hero-eyebrow {
      font-family: var(--font-mono);
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 12px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      border-radius: 20px;
      background: rgba(79, 142, 255, 0.08);
      border: 1px solid rgba(79, 142, 255, 0.18);
      max-width: 100%;
      word-break: break-word;
    }

    .hero-title {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: clamp(28px, 5vw, 50px);
      line-height: 1.15;
      letter-spacing: -0.03em;
      margin-bottom: 14px;
      color: #ffffff;
      word-break: break-word;
    }

    .hero-title .highlight {
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-sub {
      color: var(--text2);
      font-size: 14.5px;
      line-height: 1.65;
      max-width: 620px;
      margin: 0 auto;
    }

    /* Technical Pipeline Features (Row of 3) */
    .features {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 30px;
      width: 100%;
    }

    .feature {
      padding: 16px 18px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.2s;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      min-width: 0;
    }

    .feature:hover {
      border-color: var(--border-glow);
      background: var(--bg-surface-elevated);
      transform: translateY(-2px);
    }

    .feature-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .feature-icon-box {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(79, 142, 255, 0.1);
      border: 1px solid rgba(79, 142, 255, 0.2);
      display: grid;
      place-items: center;
      color: var(--accent);
      flex-shrink: 0;
    }

    .feature-title {
      font-family: var(--font-display);
      font-size: 13.5px;
      font-weight: 700;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .feature-sub {
      font-size: 11.5px;
      color: var(--text2);
      line-height: 1.5;
    }

    /* ── BENTO CARD & CONSOLE SYSTEM ───────────────── */
    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 26px;
      margin-bottom: 24px;
      position: relative;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      width: 100%;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(79, 142, 255, 0.35), transparent);
    }

    .card-title {
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 12px;
      margin-bottom: 16px;
      color: var(--text2);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* URL Input Wrap with Paste & Clear */
    .url-group {
      margin-bottom: 16px;
      width: 100%;
    }

    .input-wrap {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
    }

    .input-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text3);
      pointer-events: none;
      display: flex;
      align-items: center;
    }

    input[type="text"], input[type="url"] {
      width: 100%;
      background: var(--bg-deep);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 13px;
      padding: 13px 86px 13px 40px;
      outline: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
      min-width: 0;
    }

    input[type="text"]:focus, input[type="url"]:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow), inset 0 1px 2px rgba(0, 0, 0, 0.3);
      background: #0b0f18;
    }

    input[type="text"]::placeholder, input[type="url"]::placeholder {
      color: var(--text-muted);
    }

    .input-actions-cluster {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .btn-input-action {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      color: var(--text2);
      border-radius: 7px;
      font-family: var(--font-body);
      font-size: 11px;
      font-weight: 600;
      padding: 5px 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .btn-input-action:hover {
      background: var(--bg-surface-hover);
      color: #ffffff;
      border-color: var(--accent);
    }

    /* Live YouTube Thumbnail Preview Box */
    .url-preview-box {
      display: none;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background: var(--bg-deep);
      border: 1px solid rgba(79, 142, 255, 0.2);
      border-radius: 12px;
      margin-bottom: 18px;
      width: 100%;
      overflow: hidden;
    }

    .url-preview-thumb {
      width: 76px;
      height: 46px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: #000;
      flex-shrink: 0;
    }

    .url-preview-info {
      flex: 1;
      min-width: 0;
    }

    .url-preview-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 9.5px;
      font-family: var(--font-mono);
      color: var(--accent);
      background: rgba(79, 142, 255, 0.12);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      margin-bottom: 3px;
    }

    .url-preview-id {
      font-size: 11.5px;
      color: var(--text);
      font-family: var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Transcript Drawer (Tanya Gemini / Fast Path) */
    .transcript-box-wrap {
      margin-bottom: 22px;
      width: 100%;
    }

    .transcript-header-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 12px 14px;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: 12px;
      transition: all 0.2s;
      gap: 10px;
    }

    .transcript-header-btn:hover {
      border-color: var(--border-glow);
      background: var(--bg-surface-hover);
    }

    /* Options Bento Matrix */
    .options-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-bottom: 22px;
      width: 100%;
    }

    .option-group {
      min-width: 0;
    }

    .option-group label {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text2);
      font-weight: 600;
      margin-bottom: 8px;
    }

    .ar-buttons {
      display: flex;
      gap: 8px;
      width: 100%;
    }

    .ar-btn {
      flex: 1;
      min-width: 0;
      padding: 9px 6px;
      background: var(--bg-deep);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text2);
      font-family: var(--font-mono);
      font-size: 11.5px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
    }

    .ar-btn:hover {
      border-color: var(--border-glow);
      color: var(--text);
      background: var(--bg-surface-elevated);
    }

    .ar-btn.active {
      background: rgba(79, 142, 255, 0.12);
      border-color: var(--accent);
      color: var(--accent);
      box-shadow: 0 0 12px rgba(79, 142, 255, 0.15);
    }

    .ar-icon {
      display: block;
      border: 2px solid currentColor;
      border-radius: 3px;
    }

    .ar-btn[data-ar="9:16"] .ar-icon { width: 13px; height: 23px; }
    .ar-btn[data-ar="1:1"] .ar-icon { width: 18px; height: 18px; }
    .ar-btn[data-ar="16:9"] .ar-icon { width: 25px; height: 15px; }

    /* Custom Form Select Styling */
    select {
      width: 100%;
      background: var(--bg-deep);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-family: var(--font-body);
      font-size: 12.5px;
      padding: 10px 12px;
      outline: none;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 0;
    }

    select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    /* Clip Count Stepper */
    .clip-count-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--bg-deep);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 4px 8px;
      width: fit-content;
      max-width: 100%;
    }

    .clip-count-wrap button {
      width: 32px;
      height: 32px;
      border-radius: 7px;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      color: var(--text);
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      display: grid;
      place-items: center;
      transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .clip-count-wrap button:hover {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--bg-surface-hover);
      transform: scale(1.05);
    }

    .clip-count-wrap button:active {
      transform: scale(0.95);
    }

    #clipCountDisplay {
      font-family: var(--font-display);
      font-size: 19px;
      font-weight: 800;
      color: #ffffff;
      min-width: 24px;
      text-align: center;
    }

    .clip-count-wrap span.label {
      font-size: 12px;
      color: var(--text2);
      font-family: var(--font-mono);
    }

    /* Linear / iOS Style Modern Switch Toggle */
    .switch-toggle {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
      flex-shrink: 0;
    }

    .switch-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .switch-toggle .slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: rgba(255, 255, 255, 0.12);
      transition: 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      border-radius: 24px;
      border: 1px solid var(--border);
    }

    .switch-toggle .slider::before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: #ffffff;
      transition: 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }

    .switch-toggle input:checked + .slider {
      background: var(--accent) !important;
      border-color: var(--accent);
    }

    .switch-toggle input:checked + .slider::before {
      transform: translateX(20px);
    }

    /* Primary Generate Process Button */
    .btn-process {
      width: 100%;
      padding: 15px;
      background: var(--accent-gradient);
      border: none;
      border-radius: 12px;
      color: #ffffff;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 14.5px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      letter-spacing: 0.02em;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      box-shadow: 0 4px 20px rgba(79, 142, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .btn-process::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), transparent);
      pointer-events: none;
    }

    .btn-process:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(79, 142, 255, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.35);
      background: var(--accent-gradient-hover);
    }

    .btn-process:active {
      transform: translateY(0);
    }

    .btn-process:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    /* ── PROGRESS SECTION & PIPELINE TELEMETRY ──────── */
    #progressSection { display: none; }

    .progress-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
      width: 100%;
    }

    .progress-steps {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-bottom: 22px;
    }

    .step {
      display: flex;
      align-items: center;
      gap: 14px;
      opacity: 0.35;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      min-width: 0;
    }

    .step.active {
      opacity: 1;
    }

    .step.done {
      opacity: 0.75;
    }

    .step-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      display: grid;
      place-items: center;
      color: var(--text3);
      flex-shrink: 0;
      transition: all 0.3s;
    }

    .step.active .step-icon {
      background: rgba(79, 142, 255, 0.15);
      border-color: var(--accent);
      color: var(--accent);
      box-shadow: 0 0 16px rgba(79, 142, 255, 0.4);
      animation: pulseStep 1.8s infinite ease-in-out;
    }

    .step.done .step-icon {
      background: rgba(0, 229, 153, 0.12);
      border-color: var(--success);
      color: var(--success);
    }

    @keyframes pulseStep {
      0%, 100% { transform: scale(1); box-shadow: 0 0 8px rgba(79, 142, 255, 0.3); }
      50% { transform: scale(1.06); box-shadow: 0 0 20px rgba(79, 142, 255, 0.6); }
    }

    .step-text {
      flex: 1;
      min-width: 0;
    }

    .step-label {
      font-family: var(--font-display);
      font-size: 13.5px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 2px;
      word-break: break-word;
    }

    .step-sub {
      font-size: 11.5px;
      color: var(--text3);
      font-family: var(--font-mono);
      word-break: break-word;
    }

    /* Progress bar */
    .progress-bar-wrap {
      background: var(--bg-deep);
      border: 1px solid var(--border);
      border-radius: 100px;
      height: 8px;
      overflow: hidden;
      margin-bottom: 12px;
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
      width: 100%;
    }

    .progress-bar-fill {
      height: 100%;
      background: var(--accent-gradient);
      border-radius: 100px;
      transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    }

    .progress-bar-fill::after {
      content: '';
      position: absolute;
      right: 0; top: 0; bottom: 0;
      width: 40px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5));
      animation: shimmer 1.5s infinite linear;
    }

    @keyframes shimmer {
      0% { opacity: 0; }
      50% { opacity: 1; }
      100% { opacity: 0; }
    }

    .progress-text {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text2);
      font-family: var(--font-mono);
    }

    /* Terminal Telemetry Log Console */
    .terminal-console {
      background: #040508;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      margin-top: 18px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: #94a3b8;
      max-height: 140px;
      overflow-y: auto;
      width: 100%;
    }

    .terminal-header {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--accent);
      font-weight: 700;
      margin-bottom: 6px;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .terminal-line {
      display: flex;
      gap: 8px;
      line-height: 1.6;
      word-break: break-word;
    }

    .terminal-time {
      color: var(--text3);
      user-select: none;
      flex-shrink: 0;
    }

    /* ── ERROR SECTION ──────────────────────────────── */
    #errorSection { display: none; }

    .error-card {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 14px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 16px;
      color: #fca5a5;
      width: 100%;
    }

    .error-card .icon {
      color: #ef4444;
      display: flex;
      flex-shrink: 0;
    }

    .btn-reset {
      width: 100%;
      padding: 12px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text2);
      font-family: var(--font-display);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .btn-reset:hover {
      border-color: var(--text2);
      color: var(--text);
      background: var(--bg-surface-elevated);
    }

    /* ── RESULTS SECTION ────────────────────────────── */
    #resultsSection { display: none; }

    .results-header {
      margin-bottom: 24px;
    }

    .results-title {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 6px;
    }

    .results-sub {
      color: var(--text2);
      font-size: 13px;
    }

    /* ── OPUS CLIP INSPIRED 9:16 GRID & CARDS ────────── */
    .opus-clips-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 18px;
      margin-top: 16px;
      width: 100%;
    }

    .opus-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      cursor: pointer;
      position: relative;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.04);
      min-width: 0;
    }

    .opus-card:hover {
      transform: translateY(-5px);
      border-color: rgba(79, 142, 255, 0.45);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6), 0 0 20px rgba(79, 142, 255, 0.15);
    }

    .opus-thumb-wrap {
      aspect-ratio: 9 / 16;
      width: 100%;
      background: #06080e;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
    }

    .opus-thumb-video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      pointer-events: none;
    }

    .opus-thumb-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.85) 100%);
      pointer-events: none;
    }

    .opus-thumb-bottom {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      pointer-events: none;
    }

    .opus-badge-autozoom {
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(6px);
      color: #f1f5f9;
      font-size: 10px;
      font-family: var(--font-mono);
      font-weight: 600;
      padding: 3px 7px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      gap: 4px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .opus-duration-pill {
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(6px);
      color: #ffffff;
      font-family: var(--font-mono);
      font-size: 10.5px;
      padding: 3px 7px;
      border-radius: 5px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .opus-play-hover {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      background: rgba(0, 0, 0, 0.35);
      opacity: 0;
      transition: all 0.2s ease;
      z-index: 3;
    }

    .opus-card:hover .opus-play-hover {
      opacity: 1;
    }

    .opus-play-btn-circle {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #ffffff;
      color: #06080e;
      display: grid;
      place-items: center;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .opus-card:hover .opus-play-btn-circle {
      transform: scale(1.12);
    }

    .opus-card-meta {
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .opus-score-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .opus-virality-score {
      font-family: var(--font-display);
      font-size: 26px;
      font-weight: 800;
      color: var(--success);
      text-shadow: 0 0 16px var(--success-glow);
      line-height: 1;
    }

    .opus-action-icons {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .opus-icon-btn {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      color: var(--text2);
      border-radius: 7px;
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      cursor: pointer;
      transition: all 0.15s;
      text-decoration: none;
      flex-shrink: 0;
    }

    .opus-icon-btn:hover {
      border-color: var(--accent);
      color: #ffffff;
      background: var(--bg-surface-hover);
    }

    .opus-card-title {
      font-family: var(--font-display);
      font-size: 13px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 36px;
    }

    /* ── HISTORY PAGE STYLES ────────────────────────── */
    .filter-chip {
      background: var(--bg-deep);
      border: 1px solid var(--border);
      color: var(--text2);
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-family: var(--font-body);
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .filter-chip:hover {
      border-color: var(--accent);
      color: var(--text);
    }

    .filter-chip.active {
      background: rgba(79, 142, 255, 0.15);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 700;
    }

    .chip-count {
      background: var(--bg-surface);
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 11px;
      font-family: var(--font-mono);
    }

    .filter-chip.active .chip-count {
      background: rgba(79, 142, 255, 0.25);
      color: #fff;
    }

    .history-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 20px 22px;
      transition: all 0.25s;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      width: 100%;
    }

    .history-card:hover {
      border-color: var(--border-glow);
    }

    /* ── OPUS CLIP PRO DETAIL MODAL ─────────────────── */
    .opus-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 6, 10, 0.88);
      backdrop-filter: blur(14px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .opus-modal-container {
      background: #0d111a;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      width: 100%;
      max-width: 1160px;
      max-height: 92vh;
      overflow-y: auto;
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      display: flex;
      flex-direction: column;
    }

    .opus-modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    .opus-modal-body {
      display: grid;
      grid-template-columns: 340px 1fr 220px;
      gap: 20px;
      padding: 20px;
      overflow-y: auto;
    }

    @media (max-width: 980px) {
      .opus-modal-body {
        grid-template-columns: 1fr;
      }
    }

    /* ── RESPONSIVENESS (320px - 1920px) ────────────── */
    @media (max-width: 768px) {
      .features { grid-template-columns: 1fr; }
      .options-row { grid-template-columns: 1fr; }
      header { flex-direction: column; align-items: stretch; gap: 14px; }
      .header-left { justify-content: space-between; width: 100%; }
      .telemetry-cluster { justify-content: flex-start; width: 100%; }
      .app-nav { width: 100%; }
      .nav-tab { flex: 1; justify-content: center; }
      #metadataSettings { grid-template-columns: 1fr !important; }
      #brandingSettings > div { grid-template-columns: 1fr !important; }
      #headlineOptions { grid-template-columns: 1fr !important; }
      .card { padding: 18px 14px; }
      .container { padding: 0 14px 44px; }
    }

    @media (max-width: 480px) {
      .container { padding: 0 10px 40px; }
      .card { padding: 16px 12px; }
      .header-left { gap: 6px; }
      .enterprise-badge { font-size: 8.5px; padding: 2px 5px; }
      .telemetry-cluster { gap: 5px; }
      .status-pill { font-size: 9.5px; padding: 3px 7px; }
      .hero-title { font-size: 26px; }
      .hero-eyebrow { font-size: 9.5px; }
      .input-actions-cluster { position: static; transform: none; margin-top: 8px; justify-content: flex-end; }
      input[type="text"], input[type="url"] { padding-right: 14px; }
      .ar-buttons { flex-direction: column; }
      .ar-btn { flex-direction: row; justify-content: center; padding: 8px; gap: 8px; }
      .opus-modal-header { padding: 12px 14px; }
      .opus-modal-body { padding: 14px; gap: 14px; }
    }

    @media (max-width: 360px) {
      .header-left { flex-direction: column; align-items: flex-start; }
      #viewHistory > div:first-child > div:last-child {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #viewHistory > div:first-child > div:last-child button {
        width: 100%;
        justify-content: center;
      }
    }
"""

print("build_full_ui.py updated with mobile-first CSS.")
