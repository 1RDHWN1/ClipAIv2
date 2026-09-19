"""
Regression suite (Python) for wide-shot detection in scripts/face_tracking.py.

Run directly:
    python tests/stress/wide_shot_python_logic.py

Exit code 0 = all cases behaved correctly, 1 = at least one regression.

These cases mirror real defects observed in production renders:
  - YOLOv8-Pose emitting two boxes for a SINGLE person (body + head)
  - momentary "wide" blips shorter than the minimum duration
  - two faces too close together to be a genuine two-shot
  - a correct two-person wide shot still being detected (must not over-reject)
"""

import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FACE_TRACKING_PATH = os.path.join(ROOT, "scripts", "face_tracking.py")

spec = importlib.util.spec_from_file_location("face_tracking", FACE_TRACKING_PATH)
face_tracking = importlib.util.module_from_spec(spec)
spec.loader.exec_module(face_tracking)

FRAME_W = 1280
FRAME_H = 720
MIN_WIDE_DURATION = 1.6


def make_face(center_x, center_y, w, h, visible=True):
    """Build a face record shaped like detect_faces() output."""
    return {
        "center_x": center_x,
        "center_y": center_y,
        "w": w,
        "h": h,
        "bucket": "left" if center_x < FRAME_W * 0.5 else "right",
        "has_visible_face": visible,
    }


def make_record(t, faces):
    return {"time": t, "is_cut": False, "speaker": None, "faces": faces}


def series(times, faces_per_time):
    """Build frame records from a callable returning a face list per timestamp."""
    return [make_record(t, faces_per_time(t)) for t in times]


def detect(records):
    return face_tracking.extract_wide_intervals(
        records, min_duration=MIN_WIDE_DURATION, frame_width=FRAME_W
    )


TWO_SHOT = [make_face(300, 300, 200, 250), make_face(980, 310, 210, 260)]

CASES = []

# 1. Genuine two-person wide shot: far apart, stable, long enough.
CASES.append((
    "genuine two-shot (2 people, 680px apart, stable 3s)",
    series([0, 0.5, 1, 1.5, 2, 2.5, 3], lambda t: TWO_SHOT),
    True,
))

# 2. ONE person detected twice (body + head boxes, stable distance).
CASES.append((
    "single person detected twice (400px apart, stable)",
    series([0, 0.5, 1, 1.5, 2, 2.5, 3],
           lambda t: [make_face(350, 300, 120, 150), make_face(750, 320, 180, 220)]),
    False,
))

# 3. Nested duplicate: small head box inside a large body box.
CASES.append((
    "nested duplicate (head box inside body box)",
    series([0, 0.5, 1, 1.5, 2, 2.5, 3],
           lambda t: [make_face(400, 300, 300, 400), make_face(410, 290, 100, 120)]),
    False,
))

# 4. Multi-camera: only ever ONE face per sampled frame (alternating sides).
CASES.append((
    "multi-cam single face per frame (alternating sides)",
    [
        make_record(t, [make_face(300 if i % 2 == 0 else 980, 300, 200, 250)])
        for i, t in enumerate([0, 0.5, 1, 1.5, 2, 2.5, 3])
    ],
    False,
))

# 5. Wide shot shorter than the minimum duration (a blip).
CASES.append((
    "wide shot shorter than min duration (1s < 1.6s)",
    series([0, 0.5, 1], lambda t: TWO_SHOT),
    False,
))

# 6. Two faces closer than the separation ratio demands (< 34% of width).
CASES.append((
    "two faces only 300px apart (23% of width)",
    series([0, 0.5, 1, 1.5, 2, 2.5, 3],
           lambda t: [make_face(500, 300, 200, 250), make_face(800, 310, 210, 260)]),
    False,
))

# 7. Resolution independence: same relative layout at 1080p must also be wide.
CASES.append((
    "resolution independence (same ratio at 1920x1080)",
    [
        make_record(t, [
            {"center_x": 450, "center_y": 450, "w": 300, "h": 380,
             "bucket": "left", "has_visible_face": True},
            {"center_x": 1470, "center_y": 465, "w": 315, "h": 390,
             "bucket": "right", "has_visible_face": True},
        ])
        for t in [0, 0.5, 1, 1.5, 2, 2.5, 3]
    ],
    True,
))


def main():
    failures = 0
    print("=" * 70)
    print("Wide-shot detection regression suite")
    print("=" * 70)

    for name, records, expect_wide in CASES:
        # Case 7 is authored for 1920px; use its own frame width.
        width = 1920 if "1920x1080" in name else FRAME_W
        found = face_tracking.extract_wide_intervals(
            records, min_duration=MIN_WIDE_DURATION, frame_width=width
        )
        got_wide = len(found) > 0
        ok = got_wide == expect_wide
        if not ok:
            failures += 1
        status = "PASS" if ok else "FAIL"
        expect_label = "wide" if expect_wide else "no-wide"
        print(f"  [{status}] expect {expect_label:7s} got wide={len(found)}  {name}")

    print("-" * 70)
    if failures:
        print(f"  {failures} case(s) FAILED")
        return 1
    print(f"  all {len(CASES)} cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
