import json
import os
import re
import sys
import time


def extract_transcript(url, options=None):
    if options is None:
        options = {}

    timeout_sec = int(options.get("timeout", 45))
    headless = options.get("headless", True)
    prompt_query = options.get("prompt", "buatkan aku transkrip detail kalimat nya")

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        return {
            "success": False,
            "error": "Camoufox tidak terinstall di lingkungan Python."
        }

    print(f"[Otomasi] Membuka YouTube untuk ekstraksi transkrip: {url}", file=sys.stderr)

    try:
        with Camoufox(headless=headless, locale="id-ID") as browser:
            page = browser.new_page()
            page.set_default_timeout(timeout_sec * 1000)

            # Navigasi ke video YouTube
            page.goto(url, timeout=35000)
            page.wait_for_timeout(3000)

            # 1. Tutup / terima dialog cookies jika ada
            try:
                page.evaluate("""() => {
                    const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button'));
                    const consent = buttons.find(b => {
                        const t = (b.innerText || '').toLowerCase();
                        return t.includes('setuju') || t.includes('accept') || t.includes('agree') || t.includes('i agree');
                    });
                    if (consent) consent.click();
                }""")
            except Exception:
                pass

            page.wait_for_timeout(1500)

            # 2. Coba Strategi 1: Fitur "✨ Tanya" (Ask Gemini on YouTube)
            tanya_transcript = try_extract_tanya(page, prompt_query)
            if tanya_transcript:
                return {
                    "success": True,
                    "source": "youtube_tanya",
                    "transcript": tanya_transcript
                }

            # 3. Coba Strategi 2: Panel Transkrip YouTube Native di Deskripsi
            panel_transcript = try_extract_native_panel(page)
            if panel_transcript:
                return {
                    "success": True,
                    "source": "youtube_transcript_panel",
                    "transcript": panel_transcript
                }

            return {
                "success": False,
                "error": "Fitur Tanya maupun Panel Transkrip tidak ditemukan pada video ini."
            }

    except Exception as exc:
        return {
            "success": False,
            "error": f"Error otomasi browser: {str(exc)}"
        }


def try_extract_tanya(page, prompt_query):
    """
    Mencari tombol 'Tanya' / 'Ask', mengetik permintaan transkrip detail, dan mengambil respon ber-timestamp.
    """
    try:
        # Cari tombol Tanya / Ask pada video page
        clicked_tanya = page.evaluate("""() => {
            const candidateElements = Array.from(document.querySelectorAll(
                'button, ytd-button-renderer, yt-button-shape, div[role="button"]'
            ));
            for (const el of candidateElements) {
                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                const text = (el.innerText || '').trim().toLowerCase();
                if (text === 'tanya' || text.includes('tanya') || text === 'ask' || text.includes('ask') || label.includes('tanya') || label.includes('ask')) {
                    el.click();
                    return true;
                }
            }
            return false;
        }""")

        if not clicked_tanya:
            return None

        print("[Otomasi] Berhasil mengklik tombol Tanya / Ask!", file=sys.stderr)
        page.wait_for_timeout(2500)

        # Cari input chat di engagement panel Tanya
        input_found = page.evaluate("""(query) => {
            const inputs = Array.from(document.querySelectorAll(
                'textarea, input[type="text"], div[contenteditable="true"]'
            ));
            for (const inp of inputs) {
                const placeholder = (inp.getAttribute('placeholder') || '').toLowerCase();
                const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
                if (placeholder.includes('tanya') || placeholder.includes('ask') || aria.includes('tanya') || aria.includes('ask') || inp.tagName === 'TEXTAREA' || inp.getAttribute('contenteditable') === 'true') {
                    if (inp.getAttribute('contenteditable') === 'true') {
                        inp.innerText = query;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        inp.value = query;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    return true;
                }
            }
            return false;
        }""", prompt_query)

        if not input_found:
            return None

        print(f"[Otomasi] Mengirim prompt ke Tanya: '{prompt_query}'", file=sys.stderr)
        page.keyboard.press("Enter")
        page.wait_for_timeout(1000)

        # Klik tombol send jika ada
        try:
            page.evaluate("""() => {
                const btns = Array.from(document.querySelectorAll('button, yt-icon-button'));
                const sendBtn = btns.find(b => {
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    return aria.includes('kirim') || aria.includes('send');
                });
                if (sendBtn) sendBtn.click();
            }""")
        except Exception:
            pass

        # Tunggu respon dari Tanya Gemini (maksimal 25 detik)
        print("[Otomasi] Menunggu jawaban transkrip dari Tanya Gemini...", file=sys.stderr)
        last_length = 0
        stable_count = 0
        timestamp_regex = re.compile(r'\[\d{1,2}:\d{2}\]|\(\[\d{1,2}:\d{2}\]\)')

        for _ in range(25):
            page.wait_for_timeout(1000)
            raw_text = page.evaluate("""() => {
                const messages = Array.from(document.querySelectorAll(
                    'ytd-engagement-panel-section-list-renderer, yt-formatted-string, div[class*="message"], div[class*="response"]'
                ));
                return messages.map(m => m.innerText || '').join('\\n');
            }""")

            if timestamp_regex.search(raw_text):
                current_length = len(raw_text)
                if current_length == last_length and current_length > 100:
                    stable_count += 1
                    if stable_count >= 2:
                        print(f"[Otomasi] Berhasil mendapatkan transkrip dari Tanya ({current_length} karakter)!", file=sys.stderr)
                        return raw_text
                else:
                    stable_count = 0
                    last_length = current_length

        if last_length > 100:
            return raw_text

    except Exception as e:
        print(f"[Otomasi] Notice saat ekstraksi Tanya: {e}", file=sys.stderr)

    return None


def try_extract_native_panel(page):
    """
    Mencoba membuka panel transkrip native YouTube dari deskripsi dan mengekstrak segmen waktu & teks.
    """
    try:
        # Buka ekspansi deskripsi terlebih dahulu
        page.evaluate("""() => {
            const expander = document.querySelector('#expand, tp-yt-paper-button#expand, ytd-text-inline-expander #expand');
            if (expander) expander.click();
        }""")
        page.wait_for_timeout(1000)

        # Klik tombol Tampilkan Transkrip / Show transcript
        clicked_transcript = page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button, ytd-button-renderer, yt-button-shape'));
            for (const b of btns) {
                const text = (b.innerText || '').toLowerCase().trim();
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                if (text.includes('transkrip') || text.includes('transcript') || aria.includes('transkrip') || aria.includes('transcript')) {
                    b.click();
                    return true;
                }
            }
            return false;
        }""")

        if not clicked_transcript:
            return None

        print("[Otomasi] Mengklik tombol transkrip native YouTube...", file=sys.stderr)

        # Tunggu sampai segmen muncul (hingga 10 detik)
        for _ in range(10):
            page.wait_for_timeout(1000)
            segments = page.evaluate("""() => {
                const segElements = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
                if (segElements.length === 0) return null;
                return segElements.map(el => {
                    const timeEl = el.querySelector('.segment-timestamp, [class*="timestamp"]');
                    const textEl = el.querySelector('.segment-text, [class*="text"]');
                    const timestamp = timeEl ? timeEl.innerText.trim() : '';
                    const text = textEl ? textEl.innerText.trim() : '';
                    return { timestamp, text };
                }).filter(s => s.timestamp && s.text);
            }""")

            if segments and len(segments) >= 5:
                print(f"[Otomasi] Berhasil mengekstrak {len(segments)} segmen dari panel transkrip native!", file=sys.stderr)
                # Format ke format standar Gemini Transcript Parser: ([MM:SS]) Text
                lines = []
                for s in segments:
                    ts = s['timestamp'].replace('[', '').replace(']', '').replace('(', '').replace(')', '').strip()
                    lines.append(f"([{ts}]) {s['text']}")
                return "\n".join(lines)

    except Exception as e:
        print(f"[Otomasi] Notice saat ekstraksi panel native: {e}", file=sys.stderr)

    return None


def main():
    # Mendukung input via stdin (JSON pipe dari Node.js) atau via CLI argument
    if not sys.stdin.isatty():
        try:
            raw_input = sys.stdin.read()
            if raw_input.strip():
                data = json.loads(raw_input)
                url = data.get("url")
                result = extract_transcript(url, data)
                print(json.dumps(result))
                return
        except Exception as err:
            print(json.dumps({"success": False, "error": f"Invalid JSON stdin: {str(err)}"}))
            return

    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Penggunaan: python extract_youtube_transcript.py <youtube_url>"}))
        return

    url = sys.argv[1]
    result = extract_transcript(url)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
