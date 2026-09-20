#!/usr/bin/env python3
"""
make_headline_card.py — render an Auto Headline as a PNG card with SOFT
ROUNDED CORNERS, then let FFmpeg overlay it on the video.

Why a PNG and not drawtext: FFmpeg's drawtext draws a hard-edged rectangle
(`box=1`). There is no radius option, so a "kaku" box is all it can produce.
Drawing the card ourselves gives rounded corners, a soft drop shadow and
proper padding — and because it is a single overlay, the filter chain stays
simple.

The card is transparent outside the rounded rectangle, so it drops onto any
footage without a visible bounding box.

Usage:
  python3 make_headline_card.py --text "..." --out /tmp/card.png \
      --width 1080 --font-size 34 --radius 18
"""
import argparse
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print('ERROR: Pillow (PIL) is required for rounded headline cards.', file=sys.stderr)
    sys.exit(2)


FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
]


def pick_font(path=None):
    if path and os.path.exists(path):
        return path
    for candidate in FONT_CANDIDATES:
        if os.path.exists(candidate):
            return candidate
    return None


def hex_to_rgba(value, alpha=255):
    value = (value or '#FFFFFF').lstrip('#')
    if len(value) != 6:
        value = 'FFFFFF'
    r, g, b = (int(value[i:i+2], 16) for i in (0, 2, 4))
    return (r, g, b, alpha)


def wrap_text(draw, text, font, max_text_width):
    """Greedy word wrap so a long headline becomes at most 2-3 lines."""
    words = text.split()
    lines, current = [], ''
    for word in words:
        trial = f'{current} {word}'.strip()
        if draw.textlength(trial, font=font) <= max_text_width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def build_card(text, out_path, video_width=1080, font_size=34, radius=18,
               bg='#FFFFFF', fg='#000000', padding_x=34, padding_y=18,
               max_lines=3, font_file=None, shadow=True):
    font_path = pick_font(font_file)
    if not font_path:
        print('ERROR: no usable TTF font found.', file=sys.stderr)
        return 2

    font = ImageFont.truetype(font_path, font_size)

    # Measure with a throwaway canvas so we can size the real card.
    probe = Image.new('RGBA', (10, 10))
    probe_draw = ImageDraw.Draw(probe)

    max_card_width = int(video_width * 0.92)
    max_text_width = max_card_width - padding_x * 2
    lines = wrap_text(probe_draw, text, font, max_text_width)[:max_lines]

    text_width = max(int(probe_draw.textlength(line, font=font)) for line in lines)
    # getbbox gives the true ink height (ascent+descent), unlike font.size.
    sample_bbox = font.getbbox('Ag')
    line_height = sample_bbox[3] - sample_bbox[1]
    line_gap = int(font_size * 0.28)
    block_height = line_height * len(lines) + line_gap * (len(lines) - 1)

    card_width = int(text_width + padding_x * 2)
    card_height = int(block_height + padding_y * 2)

    # A shadow needs a margin around the card so it is not clipped.
    margin = 14 if shadow else 0
    canvas = Image.new('RGBA', (card_width + margin * 2, card_height + margin * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    card_box = (margin, margin, margin + card_width, margin + card_height)

    if shadow:
        # A few translucent rounded rects approximate a soft shadow.
        for i in range(margin, 0, -1):
            alpha = int(38 * (i / margin))
            draw.rounded_rectangle(
                (card_box[0] - i, card_box[1] - i + 2, card_box[2] + i, card_box[3] + i + 2),
                radius=radius + i, fill=(0, 0, 0, alpha),
            )

    draw.rounded_rectangle(card_box, radius=radius, fill=hex_to_rgba(bg, 255))

    # Draw each line centred.
    y = margin + padding_y
    for line in lines:
        line_w = probe_draw.textlength(line, font=font)
        x = margin + (card_width - line_w) / 2
        # textbbox anchors at the top-left of the em box; offset by the ink top.
        draw.text((x, y - sample_bbox[1]), line, font=font, fill=hex_to_rgba(fg, 255))
        y += line_height + line_gap

    canvas.save(out_path, 'PNG')
    # Emit geometry so the caller can centre it without re-measuring.
    print(f'{canvas.width} {canvas.height} {margin}')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--text', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=1080)
    ap.add_argument('--font-size', type=int, default=34)
    ap.add_argument('--radius', type=int, default=18)
    ap.add_argument('--bg', default='#FFFFFF')
    ap.add_argument('--fg', default='#000000')
    ap.add_argument('--font-file', default=None)
    ap.add_argument('--no-shadow', action='store_true')
    args = ap.parse_args()

    sys.exit(build_card(
        args.text, args.out,
        video_width=args.width,
        font_size=args.font_size,
        radius=args.radius,
        bg=args.bg,
        fg=args.fg,
        font_file=args.font_file,
        shadow=not args.no_shadow,
    ))


if __name__ == '__main__':
    main()
