import json
import os
import statistics
import sys

import cv2
import numpy as np

# Try importing scenedetect (PySceneDetect) for professional-grade scene cut detection.
# Falls back to legacy heuristic (absdiff + histogram correlation) if unavailable.
try:
    from scenedetect import open_video, SceneManager, ContentDetector
    HAS_SCENEDETECT = True
except ImportError:
    HAS_SCENEDETECT = False

# YOLOv8-Pose ONNX for cinematic body-aware framing (Milestone 2)
try:
    import onnxruntime as ort
    HAS_ONNXRUNTIME = True
except ImportError:
    ort = None
    HAS_ONNXRUNTIME = False

# MediaPipe is optional secondary face detector (fallback if YuNet fails)
try:
    import mediapipe as mp
    HAS_MEDIAPIPE = True
except ImportError:
    mp = None
    HAS_MEDIAPIPE = False


FRAME_SAMPLE_FPS = 5.0          # 5 FPS temporal resolution (0.2s step)
MIN_FACE_RATIO = 0.03           # Minimum face size relative to frame (3% to catch wide shots)
BOX_EXPAND_RATIO = 0.12         # Bounding box padding
FACE_ASPECT_RATIO_MAX = 2.0     # Max w/h or h/w ratio for valid human face
FACE_Y_BAND_RATIO = 0.95        # Faces should be in top 95% of frame (allows corner stream webcams)
MIN_HOLD_SAME_SHOT = 0.8        # 0.8s responsive hold time between speaker shifts in wide shot

# YOLOv8-Pose keypoint indices (COCO 17-keypoint format)
KP_NOSE = 0
KP_LEFT_EYE = 1
KP_RIGHT_EYE = 2
KP_LEFT_EAR = 3
KP_RIGHT_EAR = 4
KP_LEFT_SHOULDER = 5
KP_RIGHT_SHOULDER = 6

# Cinematic framing constants
HEADROOM_RATIO = 0.13           # 13% of crop height above top of head
EYE_LINE_TARGET = 0.33          # Rule of Thirds: eyes at 1/3 from top
POSE_CONF_THRESHOLD = 0.35      # Minimum keypoint confidence
PERSON_CONF_THRESHOLD = 0.40    # Minimum person detection confidence


# ═══════════════════════════════════════════════════════════════════════════════
# Scene Cut Detection (Milestone 1 upgrade)
# ═══════════════════════════════════════════════════════════════════════════════

def detect_scene_cuts_pyscenedetect(video_path, clip_start, clip_end):
    """
    Pre-scan the clip range with PySceneDetect ContentDetector.
    Returns a sorted list of scene-cut timestamps (in clip-relative seconds).

    ContentDetector uses HSV-based frame differencing with adaptive thresholding,
    which is far more robust than simple grayscale absdiff + histogram correlation.
    It handles gradual lighting changes, camera motion, and color grading shifts
    that would cause false positives with the legacy heuristic.
    """
    try:
        video = open_video(video_path)
        scene_manager = SceneManager()
        # threshold=27 is well-tuned for talking-head / podcast / IRL content.
        # Lower values catch subtle cuts but risk false positives on fast motion.
        scene_manager.add_detector(ContentDetector(threshold=27.0, min_scene_len=8))

        # Seek to clip start and only scan the relevant range
        video_fps = video.frame_rate
        start_frame = int(clip_start * video_fps)
        end_frame = int(clip_end * video_fps)
        duration_frames = max(1, end_frame - start_frame)

        video.seek(start_frame)
        scene_manager.detect_scenes(video, end_time=duration_frames)

        scene_list = scene_manager.get_scene_list()
        cut_times = []
        for i, (start_sc, end_sc) in enumerate(scene_list):
            if i == 0:
                continue  # First scene boundary is the start of the clip, not a cut
            # Convert scene start to clip-relative seconds
            cut_sec = round(start_sc.get_seconds() - clip_start, 3)
            if 0 < cut_sec < (clip_end - clip_start):
                cut_times.append(cut_sec)

        return sorted(set(cut_times))
    except Exception as exc:
        print(f"[face_tracking] PySceneDetect warning: {exc}", file=sys.stderr)
        return None  # Signal to use legacy fallback


def detect_scene_cuts_legacy(prev_gray, gray):
    """
    Legacy heuristic scene cut detection using grayscale absdiff + histogram correlation.
    Used as fallback when PySceneDetect is not available.
    """
    if prev_gray is None:
        return False
    diff = cv2.absdiff(prev_gray, gray)
    diff_mean = float(diff.mean())
    if diff_mean > 45.0:
        h1 = cv2.calcHist([prev_gray], [0], None, [32], [0, 256])
        h2 = cv2.calcHist([gray], [0], None, [32], [0, 256])
        corr = cv2.compareHist(h1, h2, cv2.HISTCMP_CORREL)
        if corr < 0.70:
            return True
    return False


def build_cut_lookup(cut_times, sample_step):
    """
    Build a set of rounded cut times for O(1) lookup during frame iteration.
    Each cut time is rounded to the nearest sample_step boundary.
    """
    lookup = set()
    for ct in cut_times:
        # Round to nearest sample step to match frame_records time values
        rounded = round(round(ct / sample_step) * sample_step, 2)
        lookup.add(rounded)
    return lookup


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    payload = json.load(sys.stdin)

    video_path = payload["videoPath"]
    clip_start = float(payload["clipStart"])
    clip_end = float(payload["clipEnd"])
    speaker_turns = payload.get("speakerTurns", [])

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Tidak bisa membuka video untuk face tracking")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError("Dimensi video tidak valid untuk face tracking")

    # ── Scene Cut Pre-Scan (PySceneDetect or legacy fallback) ──────────────
    sample_step = max(1.0 / FRAME_SAMPLE_FPS, 0.20)
    use_pyscenedetect = False
    cut_lookup = set()

    if HAS_SCENEDETECT:
        cut_times = detect_scene_cuts_pyscenedetect(video_path, clip_start, clip_end)
        if cut_times is not None:
            cut_lookup = build_cut_lookup(cut_times, sample_step)
            use_pyscenedetect = True
            if cut_times:
                print(f"[face_tracking] PySceneDetect found {len(cut_times)} scene cut(s): "
                      f"{[round(t, 2) for t in cut_times[:10]]}", file=sys.stderr)

    # ── Face Detector Setup ────────────────────────────────────────────────
    # Milestone 2: YOLOv8-Pose ONNX (primary), YuNet (secondary), MediaPipe (tertiary)
    yolo_pose_session = None
    yolo_pose_model = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "yolov8n-pose.onnx")
    if HAS_ONNXRUNTIME and os.path.exists(yolo_pose_model):
        try:
            yolo_pose_session = ort.InferenceSession(yolo_pose_model, providers=["CPUExecutionProvider"])
            print(f"[face_tracking] YOLOv8-Pose ONNX loaded ({os.path.getsize(yolo_pose_model) / 1024 / 1024:.1f} MB)", file=sys.stderr)
        except Exception as exc:
            print(f"[face_tracking] YOLOv8-Pose ONNX load failed: {exc}", file=sys.stderr)
            yolo_pose_session = None

    yunet_model = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "face_detection_yunet_2023mar.onnx")
    yunet_detector = None
    if os.path.exists(yunet_model) and hasattr(cv2, "FaceDetectorYN"):
        try:
            yunet_detector = cv2.FaceDetectorYN.create(
                yunet_model,
                "",
                (width, height),
                score_threshold=0.50,
                nms_threshold=0.35,
                top_k=20,
            )
        except Exception:
            yunet_detector = None

    mp_face_detection = None
    if yunet_detector is None and HAS_MEDIAPIPE and hasattr(mp, "solutions") and hasattr(mp.solutions, "face_detection"):
        try:
            mp_face_detection = mp.solutions.face_detection.FaceDetection(
                model_selection=1,
                min_detection_confidence=0.50,
            )
        except Exception:
            mp_face_detection = None

    min_face_size = max(20, int(min(width, height) * MIN_FACE_RATIO))
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frames_per_step = max(1, int(round(video_fps * sample_step)))

    start_frame = int(round(clip_start * video_fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    current_frame = start_frame

    frame_records = []
    prev_gray = None

    while True:
        real_t = current_frame / video_fps
        if real_t >= clip_end:
            break
        ok, frame = cap.read()
        if not ok:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # ── Scene Cut Detection ────────────────────────────────────────────
        clip_relative_time = round(real_t - clip_start, 2)

        if use_pyscenedetect:
            # O(1) lookup against pre-computed scene cuts
            is_scene_cut = clip_relative_time in cut_lookup
        else:
            # Legacy fallback: heuristic absdiff + histogram
            is_scene_cut = detect_scene_cuts_legacy(prev_gray, gray)
        prev_gray = gray.copy()

        # ── Face Detection ─────────────────────────────────────────────────
        faces = detect_faces(frame, gray, yunet_detector, mp_face_detection, min_face_size, width, height,
                             yolo_pose_session=yolo_pose_session)
        active_speaker = get_active_speaker(speaker_turns, clip_relative_time)

        frame_records.append({
            "time": clip_relative_time,
            "is_cut": is_scene_cut,
            "speaker": active_speaker,
            "faces": faces,
        })

        grabbed = 0
        for _ in range(frames_per_step - 1):
            if not cap.grab():
                break
            grabbed += 1
        current_frame += 1 + grabbed

    cap.release()
    if mp_face_detection is not None:
        try:
            mp_face_detection.close()
        except Exception:
            pass

    if not frame_records:
        json.dump({"plan": [], "debug": {"tracks": 0, "samples": 0, "detector": "none", "scene_detector": "none"}}, sys.stdout)
        return

    total_detections = sum(len(fr["faces"]) for fr in frame_records)
    if total_detections == 0:
        json.dump({"plan": [], "debug": {"tracks": 0, "samples": len(frame_records), "detector": "none", "scene_detector": "pyscenedetect" if use_pyscenedetect else "legacy"}}, sys.stdout)
        return

    # 3. Build intelligent shot-aware plan
    plan = build_shot_aware_plan(frame_records, width, height, speaker_turns)
    wide_intervals = extract_wide_intervals(frame_records, min_duration=1.6, frame_width=width)
    webcam_box = detect_streamer_webcam(frame_records, width, height)

    scene_detector_name = "pyscenedetect" if use_pyscenedetect else "legacy"
    total_cuts = sum(1 for fr in frame_records if fr["is_cut"])

    json.dump(
        {
            "plan": plan,
            "wideIntervals": wide_intervals,
            "webcamBox": webcam_box,
            "debug": {
                "tracks": len(plan),
                "samples": len(frame_records),
                "wideIntervalsCount": len(wide_intervals),
                "detector": "yolo_pose" if yolo_pose_session is not None else ("yunet" if yunet_detector is not None else ("mediapipe" if mp_face_detection is not None else "none")),
                "scene_detector": scene_detector_name,
                "scene_cuts_found": total_cuts,
                "webcam_detected": webcam_box is not None,
            },
        },
        sys.stdout,
    )


def detect_streamer_webcam(frame_records, frame_width, frame_height):
    """
    Detects persistent webcam overlay in gaming/screen-recording videos.
    Uses radius-based spatial clustering and variance analysis to reliably isolate
    the streamer's static corner camera from moving in-game NPC characters or cutscenes.
    Returns bounding box {x, y, width, height, center_x, center_y, quadrant, score} or None.

    SIZE GUARD (why it exists):
    A real corner webcam overlay is SMALL — roughly 12-22% of the frame width and
    15-30% of the height. A detection much larger than that is not a webcam at
    all; it is the video's main content (a fullscreen streamer cam, an animation
    panel, or a screen region) and cropping to it produces the wrong framing.
    Measured failure: a reaction video's streamer overlay spanned 34% of the
    width, was accepted as a "webcam", and the clip was cropped onto the content
    instead of the person.
    """
    if not frame_records:
        return None

    face_pts = []
    for fr in frame_records:
        for f in fr.get("faces", []):
            if f.get("has_visible_face", True):
                fw = f.get("w", 0)
                # Exclude full-screen cinematic faces (>40% width) or tiny noise (<3% width)
                if 0.03 * frame_width <= fw <= 0.40 * frame_width:
                    face_pts.append((f["center_x"], f["center_y"], fw, f.get("h", 0)))

    if len(face_pts) < 3:
        return None

    import numpy as np

    # 1. Radius-based spatial clustering (radius = 12% of frame width)
    radius_px = max(60.0, float(frame_width) * 0.12)
    clusters = []

    for p in face_pts:
        matched = False
        for c in clusters:
            dist = float(np.hypot(p[0] - c["center_x"], p[1] - c["center_y"]))
            if dist <= radius_px:
                c["points"].append(p)
                c["center_x"] = float(np.mean([pt[0] for pt in c["points"]]))
                c["center_y"] = float(np.mean([pt[1] for pt in c["points"]]))
                matched = True
                break
        if not matched:
            clusters.append({
                "center_x": float(p[0]),
                "center_y": float(p[1]),
                "points": [p]
            })

    if not clusters:
        return None

    # 2. Score clusters: a webcam overlay hugs a BORDER and persists.
    #
    # Size is deliberately NOT part of the score. Measured on real footage, a
    # genuine corner webcam face spanned 14% of the frame width while a false
    # positive spanned 15.5% — the two are indistinguishable by size. Position
    # is what separates them: a webcam sits against an edge, a video's main
    # subject sits near the centre.
    def score_cluster(c):
        pts = c["points"]
        count = len(pts)
        if count < 3:
            return -1.0

        cx = c["center_x"]
        cy = c["center_y"]

        edge_dist_x = min(cx, frame_width - cx) / float(frame_width)
        edge_dist_y = min(cy, frame_height - cy) / float(frame_height)
        nearest_edge = min(edge_dist_x, edge_dist_y)

        # 1.0 against a border, 0.0 at the centre.
        edge_score = max(0.0, 1.0 - nearest_edge / 0.5)
        persistence = count / max(1.0, float(len(frame_records)))

        return float(count * persistence * edge_score)

    scored_clusters = [(c, score_cluster(c)) for c in clusters]
    scored_clusters.sort(key=lambda item: item[1], reverse=True)
    best_cluster, best_score = scored_clusters[0]

    pts = best_cluster["points"]
    total_frames = max(1.0, float(len(frame_records)))
    persistence = float(len(pts)) / total_frames

    # Guard: Persistence ratio.
    # In a genuine gaming stream, the streamer's webcam overlay persists continuously
    # across at least 50% of all sampled frames throughout the clip.
    # This reliably rejects cutaway speakers in podcasts/interviews who only appear in
    # intermittent reaction shots (e.g. Jay Shetty appearing for only ~36% of the clip).
    if persistence < 0.50:
        return None

    med_x = float(np.median([pt[0] for pt in pts]))
    med_y = float(np.median([pt[1] for pt in pts]))

    # Guard: the face must actually hug an edge.
    #
    # Position — not size — is what separates a webcam overlay from a video's
    # subject. Measured on real footage, a genuine corner webcam face spanned 14%
    # of the frame width and a false positive spanned 15.5%: indistinguishable by
    # size. But a webcam sits against a border while the main subject sits near
    # the centre. Measured face centres: a real corner webcam at 22% from the
    # edge, a two-person podcast speaker at 33%. Requiring the face centre to be
    # within the outer 28% band keeps the webcam and rejects the podcast.
    edge_dist_x = min(med_x, frame_width - med_x) / float(frame_width)
    edge_dist_y = min(med_y, frame_height - med_y) / float(frame_height)
    nearest_edge = min(edge_dist_x, edge_dist_y)
    if nearest_edge > 0.28:
        return None

    # Threshold, expressed PER FRAME so it does not drift with clip length.
    # With the border-weighted score this is (persistence x edge_score), so a
    # centred subject scores ~0 and is rejected, while a persistent edge overlay
    # scores ~0.5-0.8.
    per_frame_score = best_score / total_frames
    if per_frame_score < 0.35:
        return None

    # Target 1080:800 (1.35 : 1) aspect ratio for distortion-free top panel
    cam_h = int(min(frame_height, round(frame_height * 0.45)))
    cam_w = int(min(frame_width, round(cam_h * (1080.0 / 800.0))))

    cam_x = int(max(0, min(frame_width - cam_w, round(med_x - cam_w / 2.0))))
    cam_y = int(max(0, min(frame_height - cam_h, round(med_y - cam_h / 2.0))))

    quad_x = "right" if med_x >= frame_width * 0.5 else "left"
    quad_y = "bottom" if med_y >= frame_height * 0.5 else "top"

    return {
        "x": cam_x,
        "y": cam_y,
        "width": cam_w,
        "height": cam_h,
        "center_x": round(med_x, 1),
        "center_y": round(med_y, 1),
        "quadrant": f"{quad_y}_{quad_x}",
        "score": round(best_score, 2),
        "per_frame_score": round(per_frame_score, 3),
        "detections": len(pts)
    }


def read_frame_at(cap, time_seconds):
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0, time_seconds * 1000.0))
    ok, frame = cap.read()
    return frame if ok else None


def detect_yolo_pose(frame, gray, session, min_face_size, frame_width, frame_height):
    """
    Milestone 2: YOLOv8-Pose ONNX Body & Keypoint Detector.
    Detects humans and 17 COCO keypoints (eyes, nose, ears, shoulders, etc.).
    Computes body-aware center_x combining head and torso positions to ensure
    smooth, cinematic bust-shot framing without drifting on head rotations.
    """
    if session is None:
        return []

    try:
        # Preprocess: 640x640 resize, BGR -> RGB, CHW, normalized [0, 1]
        input_img = cv2.resize(frame, (640, 640))
        blob = input_img[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
        blob = np.expand_dims(blob, axis=0)

        outs = session.run(None, {"images": blob})[0]
        preds = outs[0].T  # (8400, 56)

        # Filter by person confidence threshold
        conf_mask = preds[:, 4] >= PERSON_CONF_THRESHOLD
        candidates = preds[conf_mask]
        if len(candidates) == 0:
            return []

        scale_x = frame_width / 640.0
        scale_y = frame_height / 640.0

        boxes = []
        scores = []
        for c in candidates:
            cx = float(c[0]) * scale_x
            cy = float(c[1]) * scale_y
            bw = float(c[2]) * scale_x
            bh = float(c[3]) * scale_y
            bx = cx - bw / 2.0
            by = cy - bh / 2.0
            boxes.append([int(bx), int(by), int(bw), int(bh)])
            scores.append(float(c[4]))

        indices = cv2.dnn.NMSBoxes(boxes, scores, score_threshold=PERSON_CONF_THRESHOLD, nms_threshold=0.45)
        if len(indices) == 0:
            return []

        results = []
        for idx in indices.flatten():
            c = candidates[idx]
            score = float(c[4])
            kps = c[5:]  # 17 keypoints * 3 (x, y, conf)

            # Keypoints:
            # 0: nose, 1: left_eye, 2: right_eye, 3: left_ear, 4: right_ear
            # 5: left_shoulder, 6: right_shoulder
            nose = (float(kps[0]) * scale_x, float(kps[1]) * scale_y, float(kps[2]))
            left_eye = (float(kps[3]) * scale_x, float(kps[4]) * scale_y, float(kps[5]))
            right_eye = (float(kps[6]) * scale_x, float(kps[7]) * scale_y, float(kps[8]))
            left_ear = (float(kps[9]) * scale_x, float(kps[10]) * scale_y, float(kps[11]))
            right_ear = (float(kps[12]) * scale_x, float(kps[13]) * scale_y, float(kps[14]))
            left_shoulder = (float(kps[15]) * scale_x, float(kps[16]) * scale_y, float(kps[17]))
            right_shoulder = (float(kps[18]) * scale_x, float(kps[19]) * scale_y, float(kps[20]))

            # Collect valid head keypoints
            head_pts_x = []
            head_pts_y = []
            for kp in [nose, left_eye, right_eye, left_ear, right_ear]:
                if kp[2] >= POSE_CONF_THRESHOLD:
                    head_pts_x.append(kp[0])
                    head_pts_y.append(kp[1])

            has_shoulders = (left_shoulder[2] >= POSE_CONF_THRESHOLD and right_shoulder[2] >= POSE_CONF_THRESHOLD)
            shoulder_cx = (left_shoulder[0] + right_shoulder[0]) / 2.0 if has_shoulders else None
            shoulder_w = abs(right_shoulder[0] - left_shoulder[0]) if has_shoulders else 0

            # Crucial: verify that the person is facing the camera (eyes or nose visible).
            # People seen from behind (e.g. over-the-shoulder foreground silhouettes) have no visible facial keypoints.
            has_visible_face = bool(
                nose[2] >= POSE_CONF_THRESHOLD or
                left_eye[2] >= POSE_CONF_THRESHOLD or
                right_eye[2] >= POSE_CONF_THRESHOLD
            )

            if head_pts_x:
                head_cx = sum(head_pts_x) / len(head_pts_x)
                head_cy = sum(head_pts_y) / len(head_pts_y)
            elif shoulder_cx is not None:
                head_cx = shoulder_cx
                head_cy = (left_shoulder[1] + right_shoulder[1]) / 2.0 - max(50.0, shoulder_w * 0.5)
            else:
                bx, by, bw, bh = boxes[idx]
                head_cx = bx + bw / 2.0
                head_cy = by + bh * 0.2

            # Y-position filter: faces/heads must be in top 72% of frame
            if head_cy > frame_height * FACE_Y_BAND_RATIO:
                continue

            # Weighted subject center X: combines head (65%) and torso (35%)
            if shoulder_cx is not None:
                subject_cx = float(0.65 * head_cx + 0.35 * shoulder_cx)
            else:
                subject_cx = float(head_cx)

            # Estimate face bounding box from keypoints/shoulders
            if shoulder_w > 0:
                fw = max(min_face_size, int(shoulder_w * 0.55))
            elif head_pts_x and len(head_pts_x) >= 2:
                spread_x = max(head_pts_x) - min(head_pts_x)
                fw = max(min_face_size, int(spread_x * 2.2))
            else:
                fw = max(min_face_size, int(boxes[idx][2] * 0.40))

            fh = int(fw * 1.25)
            fx = int(subject_cx - fw / 2.0)
            fy = int(head_cy - fh / 2.0)

            expanded = expand_box(fx, fy, fw, fh, frame_width, frame_height, BOX_EXPAND_RATIO)

            # Extract mouth patch for voice activity tracking
            mouth_cx = float(head_cx if head_pts_x else subject_cx)
            if nose[2] >= POSE_CONF_THRESHOLD and has_shoulders:
                mouth_cy = nose[1] + 0.30 * (((left_shoulder[1] + right_shoulder[1]) / 2.0) - nose[1])
            elif nose[2] >= POSE_CONF_THRESHOLD:
                mouth_cy = nose[1] + fh * 0.22
            else:
                mouth_cy = head_cy + fh * 0.25

            mouth_w = max(18, int(fw * 0.45))
            mouth_h = max(14, int(mouth_w * 0.75))
            mx1 = max(0, int(mouth_cx - mouth_w / 2.0))
            my1 = max(0, int(mouth_cy - mouth_h / 2.0))
            mx2 = min(frame_width, mx1 + mouth_w)
            my2 = min(frame_height, my1 + mouth_h)

            mouth_roi = gray[my1:my2, mx1:mx2]
            mouth_patch = cv2.resize(mouth_roi, (24, 18)) if mouth_roi.size > 0 else None

            results.append({
                "box": expanded,
                "score": score,
                "center_x": float(subject_cx),
                "center_y": float(head_cy),
                "w": expanded[2],
                "h": expanded[3],
                "mouth_patch": mouth_patch,
                "bucket": "left" if subject_cx < frame_width * 0.5 else "right",
                "has_visible_face": has_visible_face,
            })

        results.sort(key=lambda item: item["score"], reverse=True)
        return results[:3]
    except Exception as exc:
        print(f"[face_tracking] YOLOv8-Pose warning: {exc}", file=sys.stderr)
        return []


def detect_faces(frame, gray, yunet_detector, mp_face_detection, min_face_size, frame_width, frame_height,
                 yolo_pose_session=None):
    detected = []

    # 1. Primary (Milestone 2): YOLOv8-Pose Body & Keypoint Estimation
    if yolo_pose_session is not None:
        detected = detect_yolo_pose(frame, gray, yolo_pose_session, min_face_size, frame_width, frame_height)

    # 2. Secondary: YuNet Deep Learning (superior for angles, side profiles, tilted faces)
    if not detected and yunet_detector is not None:
        try:
            yunet_detector.setInputSize((frame_width, frame_height))
            res = yunet_detector.detect(frame)[1]
            if res is not None:
                for f in res:
                    score = float(f[14])
                    if score < 0.50:
                        continue

                    x, y, fw, fh = int(f[0]), int(f[1]), int(f[2]), int(f[3])
                    if fw <= 0 or fh <= 0:
                        continue

                    # Aspect ratio filter: human faces are roughly 1:1.3, never > 2.0
                    aspect = max(fw / fh, fh / fw)
                    if aspect > FACE_ASPECT_RATIO_MAX:
                        continue

                    # Y-position filter: faces must be in top 72% of frame
                    face_center_y = y + fh / 2.0
                    if face_center_y > frame_height * FACE_Y_BAND_RATIO:
                        continue

                    if min(fw, fh) < min_face_size:
                        continue

                    # Landmark extraction for mouth: f[10:12] right mouth, f[12:14] left mouth
                    rm_x, rm_y = float(f[10]), float(f[11])
                    lm_x, lm_y = float(f[12]), float(f[13])
                    mouth_cx = (rm_x + lm_x) / 2.0
                    mouth_cy = (rm_y + lm_y) / 2.0
                    mouth_dist = float(np.hypot(lm_x - rm_x, lm_y - rm_y))
                    mouth_w = max(12, int(mouth_dist * 1.5))
                    mouth_h = max(10, int(mouth_w * 0.8))

                    mx1 = max(0, int(mouth_cx - mouth_w / 2.0))
                    my1 = max(0, int(mouth_cy - mouth_h / 2.0))
                    mx2 = min(frame_width, mx1 + mouth_w)
                    my2 = min(frame_height, my1 + mouth_h)
                    mouth_roi = gray[my1:my2, mx1:mx2]
                    mouth_patch = cv2.resize(mouth_roi, (24, 18)) if mouth_roi.size > 0 else None

                    expanded = expand_box(x, y, fw, fh, frame_width, frame_height, BOX_EXPAND_RATIO)
                    center_x = float(expanded[0] + expanded[2] / 2.0)
                    detected.append({
                        "box": expanded,
                        "score": score,
                        "center_x": center_x,
                        "center_y": float(expanded[1] + expanded[3] / 2.0),
                        "w": expanded[2],
                        "h": expanded[3],
                        "mouth_patch": mouth_patch,
                        "bucket": "left" if center_x < frame_width * 0.5 else "right",
                    })
        except Exception:
            pass

    # 2. Secondary: MediaPipe (only if YuNet failed to detect anything)
    if not detected and mp_face_detection is not None:
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_result = mp_face_detection.process(rgb)
            if mp_result and mp_result.detections:
                for detection in mp_result.detections:
                    score = float(detection.score[0]) if detection.score else 0.5
                    relative = detection.location_data.relative_bounding_box
                    x = int(relative.xmin * frame_width)
                    y = int(relative.ymin * frame_height)
                    fw = int(relative.width * frame_width)
                    fh = int(relative.height * frame_height)

                    if (y + fh / 2.0) > frame_height * FACE_Y_BAND_RATIO:
                        continue

                    expanded = expand_box(x, y, fw, fh, frame_width, frame_height, BOX_EXPAND_RATIO)
                    if expanded[2] >= min_face_size and expanded[3] >= min_face_size:
                        my = expanded[1] + int(expanded[3] * 0.55)
                        mh = int(expanded[3] * 0.45)
                        mroi = gray[my:my + mh, expanded[0]:expanded[0] + expanded[2]]
                        mpatch = cv2.resize(mroi, (24, 18)) if mroi.size > 0 else None
                        center_x = float(expanded[0] + expanded[2] / 2.0)

                        detected.append({
                            "box": expanded,
                            "score": score,
                            "center_x": center_x,
                            "center_y": float(expanded[1] + expanded[3] / 2.0),
                            "w": expanded[2],
                            "h": expanded[3],
                            "mouth_patch": mpatch,
                            "bucket": "left" if center_x < frame_width * 0.5 else "right",
                        })
        except Exception:
            pass

    if not detected:
        return []

    # Apply Non-Maximum Suppression to eliminate duplicate bounding boxes on the same face
    boxes = [d["box"] for d in detected]
    scores = [d["score"] for d in detected]
    indices = cv2.dnn.NMSBoxes(
        [list(b) for b in boxes],
        scores,
        score_threshold=0.45,
        nms_threshold=0.35,
    )

    kept_faces = []
    if len(indices) > 0:
        for idx in indices.flatten():
            d = detected[idx]
            # Ignore silhouettes seen from behind (over-the-shoulder foreground figures)
            if not d.get("has_visible_face", True):
                continue
            # Ignore tiny background noise detections (< 5% frame width)
            if d.get("w", 0) < frame_width * 0.05:
                continue
            kept_faces.append({
                "x": d["box"][0],
                "y": d["box"][1],
                "w": d["w"],
                "h": d["h"],
                "center_x": d["center_x"],
                "center_y": d["center_y"],
                "score": d["score"],
                "mouth_patch": d["mouth_patch"],
                "bucket": d["bucket"],
                "has_visible_face": d.get("has_visible_face", True),
            })

    kept_faces.sort(key=lambda item: item["score"], reverse=True)
    return kept_faces[:3]


def expand_box(x, y, w, h, frame_width, frame_height, ratio):
    expand_x = int(w * ratio)
    expand_y = int(h * ratio)
    new_x = max(0, x - expand_x)
    new_y = max(0, y - expand_y)
    new_w = min(frame_width - new_x, w + (expand_x * 2))
    new_h = min(frame_height - new_y, h + (expand_y * 2))
    return (new_x, new_y, new_w, new_h)


def get_active_speaker(speaker_turns, clip_relative_time):
    best_turn = None
    for turn in speaker_turns:
        if turn["start"] <= clip_relative_time < turn["end"]:
            if best_turn is None or (turn["end"] - turn["start"]) > (best_turn["end"] - best_turn["start"]):
                best_turn = turn
    return best_turn["speaker"] if best_turn else None



def build_shot_aware_plan(frame_records, frame_width, frame_height, speaker_turns):
    if not frame_records:
        return []

    # 1. Filter out tiny background poster faces when a dominant human speaker is present
    for fr in frame_records:
        raw_faces = fr["faces"]
        if len(raw_faces) > 1:
            raw_faces.sort(key=lambda f: f["w"] * f["h"], reverse=True)
            primary = raw_faces[0]
            valid_faces = [primary]
            for f in raw_faces[1:]:
                # Real co-host in a 2-person wide shot is >= 35% of primary width
                if f["w"] >= primary["w"] * 0.35 and abs(f["center_y"] - primary["center_y"]) < frame_height * 0.35:
                    valid_faces.append(f)
            fr["faces"] = valid_faces

    # 2. Pre-compute mouth activity across all frames to establish dominant speaker
    prev_mouth_l = None
    prev_mouth_r = None
    total_speech_l = 0.0
    total_speech_r = 0.0
    opening_speech_l = 0.0
    opening_speech_r = 0.0

    SPEECH_NOISE_FLOOR = 1.8  # ignore video compression macroblock noise below 1.8

    for idx, fr in enumerate(frame_records):
        fl = next((f for f in fr["faces"] if f["bucket"] == "left"), None)
        fr_face = next((f for f in fr["faces"] if f["bucket"] == "right"), None)

        if fl and fl.get("mouth_patch") is not None:
            if prev_mouth_l is not None:
                d = float(cv2.absdiff(prev_mouth_l, fl["mouth_patch"]).mean())
                fl["motion"] = max(0.0, d - SPEECH_NOISE_FLOOR)
            else:
                fl["motion"] = 0.0
            prev_mouth_l = fl["mouth_patch"]
            total_speech_l += fl["motion"]
            if idx < 15:
                opening_speech_l += fl["motion"]
        else:
            prev_mouth_l = None

        if fr_face and fr_face.get("mouth_patch") is not None:
            if prev_mouth_r is not None:
                d = float(cv2.absdiff(prev_mouth_r, fr_face["mouth_patch"]).mean())
                fr_face["motion"] = max(0.0, d - SPEECH_NOISE_FLOOR)
            else:
                fr_face["motion"] = 0.0
            prev_mouth_r = fr_face["mouth_patch"]
            total_speech_r += fr_face["motion"]
            if idx < 15:
                opening_speech_r += fr_face["motion"]
        else:
            prev_mouth_r = None

    dominant_bucket = "left" if total_speech_l >= total_speech_r else "right"
    opening_bucket = "left" if opening_speech_l >= opening_speech_r else "right"

    # 3. Determine initial focus: look for the active opening speaker
    initial_focus_x = None
    initial_focus_bucket = opening_bucket
    initial_face_w = frame_width * 0.14

    for fr in frame_records:
        if fr["faces"]:
            matched = next((f for f in fr["faces"] if f["bucket"] == opening_bucket), None)
            chosen = matched or fr["faces"][0]
            initial_focus_x = chosen["center_x"]
            initial_focus_bucket = chosen["bucket"]
            initial_face_w = chosen["w"]
            break

    if initial_focus_x is None:
        initial_focus_x = frame_width * 0.5
        initial_focus_bucket = dominant_bucket

    current_focus_x = initial_focus_x
    current_focus_bucket = initial_focus_bucket
    current_face_w = initial_face_w
    last_switch_time = 0.0
    MIN_HOLD_SAME_SHOT = 2.4  # 2.4s natural television hold time between cuts
    MAX_SEGMENTS = 40

    act_l = 0.0
    act_r = 0.0
    consecutive_competing_speech = 0
    targets = []

    for fr in frame_records:
        time = fr["time"]
        faces = fr["faces"]
        is_cut = fr["is_cut"]

        if is_cut:
            act_l = 0.0
            act_r = 0.0
            consecutive_competing_speech = 0
            last_switch_time = time

        left_face = next((f for f in faces if f["bucket"] == "left"), None)
        right_face = next((f for f in faces if f["bucket"] == "right"), None)

        mot_l = left_face.get("motion", 0.0) if left_face else 0.0
        mot_r = right_face.get("motion", 0.0) if right_face else 0.0
        act_l = act_l * 0.7 + mot_l * 0.3
        act_r = act_r * 0.7 + mot_r * 0.3

        if not faces:
            # During camera cuts to B-roll or slides with no human faces,
            # default framing to center of frame rather than lingering on old speaker.
            if is_cut:
                current_focus_x = frame_width * 0.5
                current_focus_bucket = "left" if current_focus_x < frame_width * 0.5 else "right"
            targets.append({
                "time": time,
                "center_x": current_focus_x,
                "face_width": current_face_w,
                "is_cut": is_cut,
            })
            continue

        if len(faces) == 1:
            # Single close-up face -> lock on directly
            chosen = faces[0]
            current_focus_x = chosen["center_x"]
            current_focus_bucket = chosen["bucket"]
            current_face_w = chosen["w"]
            targets.append({
                "time": time,
                "center_x": current_focus_x,
                "face_width": current_face_w,
                "is_cut": is_cut,
            })
            continue

        # Two-person wide shot:
        can_switch = (time - last_switch_time) >= MIN_HOLD_SAME_SHOT or is_cut
        speaker_switch_occurred = False

        if current_focus_bucket == "left":
            # Right speaker must exhibit sustained speech (active mouth energy)
            if act_r > 1.0 and act_r > act_l * 1.2:
                consecutive_competing_speech += 1
            else:
                consecutive_competing_speech = max(0, consecutive_competing_speech - 1)

            if consecutive_competing_speech >= 2 and can_switch and right_face:
                current_focus_bucket = "right"
                current_focus_x = right_face["center_x"]
                current_face_w = right_face["w"]
                last_switch_time = time
                consecutive_competing_speech = 0
                speaker_switch_occurred = True
            elif left_face:
                current_focus_x = left_face["center_x"]
                current_face_w = left_face["w"]
        else:
            # Left speaker must exhibit sustained speech
            if act_l > 1.0 and act_l > act_r * 1.2:
                consecutive_competing_speech += 1
            else:
                consecutive_competing_speech = max(0, consecutive_competing_speech - 1)

            if consecutive_competing_speech >= 2 and can_switch and left_face:
                current_focus_bucket = "left"
                current_focus_x = left_face["center_x"]
                current_face_w = left_face["w"]
                last_switch_time = time
                consecutive_competing_speech = 0
                speaker_switch_occurred = True
            elif right_face:
                current_focus_x = right_face["center_x"]
                current_face_w = right_face["w"]

        targets.append({
            "time": time,
            "center_x": current_focus_x,
            "face_width": current_face_w,
            "is_cut": is_cut or speaker_switch_occurred,
        })

    # Group timeline targets into segments
    segments = []
    for tgt in targets:
        if not segments:
            segments.append({
                "start": tgt["time"],
                "end": tgt["time"],
                "center_x": tgt["center_x"],
                "face_width": tgt["face_width"],
                "is_cut": tgt["is_cut"],
            })
            continue

        prev = segments[-1]
        pos_diff = abs(prev["center_x"] - tgt["center_x"])
        # Trigger new segment on camera cut or significant position shift (> 8% frame width)
        if tgt["is_cut"] or pos_diff > frame_width * 0.08:
            prev["end"] = tgt["time"]
            segments.append({
                "start": tgt["time"],
                "end": tgt["time"],
                "center_x": tgt["center_x"],
                "face_width": tgt["face_width"],
                "is_cut": tgt["is_cut"],
            })
        else:
            prev["end"] = tgt["time"]
            # Smooth coordinate slightly within same continuous segment
            prev["center_x"] = round((prev["center_x"] * 0.8) + (tgt["center_x"] * 0.2), 1)

    if segments:
        segments[-1]["end"] = round(targets[-1]["time"] + 0.20, 2)

    # Filter out micro-jitter (< 0.5s) unless it is an explicit scene cut
    filtered = []
    for s in segments:
        dur = s["end"] - s["start"]
        if filtered and dur < 0.5 and not s["is_cut"]:
            filtered[-1]["end"] = s["end"]
        else:
            filtered.append(s)

    # Cap maximum segments to 16 for FFmpeg eval depth
    while len(filtered) > MAX_SEGMENTS:
        min_diff = float("inf")
        merge_idx = 0
        for i in range(len(filtered) - 1):
            diff = abs(filtered[i]["center_x"] - filtered[i + 1]["center_x"])
            if diff < min_diff:
                min_diff = diff
                merge_idx = i
        dur1 = filtered[merge_idx]["end"] - filtered[merge_idx]["start"]
        dur2 = filtered[merge_idx + 1]["end"] - filtered[merge_idx + 1]["start"]
        filtered[merge_idx]["end"] = filtered[merge_idx + 1]["end"]
        filtered[merge_idx]["center_x"] = filtered[merge_idx]["center_x"] if dur1 >= dur2 else filtered[merge_idx + 1]["center_x"]
        filtered[merge_idx]["face_width"] = max(filtered[merge_idx]["face_width"], filtered[merge_idx + 1]["face_width"])
        filtered.pop(merge_idx + 1)

    return filtered


def faces_are_same_person(face_a, face_b, frame_width):
    """
    Decide whether two detections almost certainly describe the SAME person.

    YOLOv8-Pose frequently emits two boxes for one human (full body + head, or
    a duplicate at a different scale). Those duplicates pass the horizontal
    separation test and were the main cause of false two-person wide shots.

    Two detections are treated as the same person when either:
      a) their boxes overlap significantly (IoU or containment), or
      b) their centres are close relative to the size of the boxes — i.e. two
         boxes that sit on top of each other cannot be two seated subjects.

    @param {{center_x:number, center_y:number, w:number, h:number}} face_a
    @param {{center_x:number, center_y:number, w:number, h:number}} face_b
    @param {number} frame_width
    @returns {boolean}
    """
    try:
        ax1 = face_a["center_x"] - face_a.get("w", 0) / 2.0
        ax2 = face_a["center_x"] + face_a.get("w", 0) / 2.0
        ay1 = face_a["center_y"] - face_a.get("h", 0) / 2.0
        ay2 = face_a["center_y"] + face_a.get("h", 0) / 2.0

        bx1 = face_b["center_x"] - face_b.get("w", 0) / 2.0
        bx2 = face_b["center_x"] + face_b.get("w", 0) / 2.0
        by1 = face_b["center_y"] - face_b.get("h", 0) / 2.0
        by2 = face_b["center_y"] + face_b.get("h", 0) / 2.0

        iw = max(0.0, min(ax2, bx2) - max(ax1, bx1))
        ih = max(0.0, min(ay2, by2) - max(ay1, by1))
        inter = iw * ih

        if inter > 0:
            area_a = max(1.0, (ax2 - ax1) * (ay2 - ay1))
            area_b = max(1.0, (bx2 - bx1) * (by2 - by1))
            union = area_a + area_b - inter
            iou = inter / union if union > 0 else 0.0
            # Containment: one box mostly inside the other (head inside body).
            containment = inter / min(area_a, area_b)

            if iou >= 0.30 or containment >= 0.60:
                return True

        # Centre distance relative to the smaller box width. Two boxes sitting
        # essentially on the same spot are the same subject.
        min_box_w = max(1.0, min(face_a.get("w", 1), face_b.get("w", 1)))
        centre_dist = abs(face_a["center_x"] - face_b["center_x"])
        if centre_dist < min_box_w * 0.75:
            return True

        return False
    except Exception:
        return False


def extract_wide_intervals(frame_records, min_duration=1.6, frame_width=None):
    """
    Extract continuous intervals where 2 or more people are present in a wide shot.
    Returns: list of { start, end, x1, x2 }

    A genuine two-person wide shot must show BOTH people present, facing the
    camera, at a resolution-independent separation, with a stable pairing over
    consecutive samples.

    False positives this guards against:
      - ONE person detected twice (body + head, or duplicate boxes)
      - multi-camera cuts, where consecutive samples show different singles
      - two faces whose separation collapses between samples (unstable pair)
      - momentary blips shorter than `min_duration`

    @param {Array} frame_records
    @param {number} min_duration minimum seconds a wide shot must persist
    """
    if not frame_records:
        return []

    # ---------------------------------------------------------------------
    # Thresholds.
    #
    # Separation is expressed as a RATIO of frame width, never as an absolute
    # pixel count. The previous hard-coded 350px meant a different real-world
    # distance at every resolution (27% of a 720p frame but only 18% of 1080p),
    # which is why the same video behaved differently after a resolution change.
    # ---------------------------------------------------------------------
    MIN_SEPARATION_RATIO = 0.34      # subjects must sit at least 34% of width apart
    MAX_SEPARATION_JITTER_RATIO = 0.14  # allowed swing between consecutive samples
    MAX_VERTICAL_OFFSET_RATIO = 0.28    # both faces in the same vertical band
    MIN_FACES_PER_FRAME = 2             # a wide shot needs two people at once

    # A genuine two-SHOT (the kind worth a stacked split-screen) frames both
    # people close enough to read their faces. A wide ROOM shot also contains
    # two people, but they are far from the camera — cropping each side then
    # yields furniture and empty space rather than faces. Require BOTH faces to
    # occupy a meaningful share of the frame width.
    MIN_FACE_WIDTH_RATIO = 0.12

    # Resolve a frame width for ratio maths. Prefer the explicit parameter
    # (passed from main() where the real video dimensions are known); fall back
    # to any width recorded per frame, then to a sane default.
    if not (isinstance(frame_width, (int, float)) and frame_width > 0):
        widths = [fr["width"] for fr in frame_records if isinstance(fr.get("width"), (int, float)) and fr["width"] > 0]
        frame_width = float(np.median(widths)) if widths else 1280.0
    frame_width = float(frame_width)

    raw_intervals = []
    current_start = None
    last_t = 0.0
    accum_x1 = []
    accum_x2 = []
    last_sep_ratio = None
    last_center_y = None

    def close_interval(end_time):
        """Finalise the in-progress interval if it lasted long enough."""
        nonlocal current_start, accum_x1, accum_x2, last_sep_ratio, last_center_y
        if current_start is None:
            return
        duration = end_time - current_start
        if duration >= min_duration and accum_x1 and accum_x2:
            raw_intervals.append({
                "start": round(current_start, 2),
                "end": round(end_time + 0.20, 2),
                "x1": round(float(np.median(accum_x1)), 1),
                "x2": round(float(np.median(accum_x2)), 1),
            })
        current_start = None
        accum_x1 = []
        accum_x2 = []
        last_sep_ratio = None
        last_center_y = None

    for fr in frame_records:
        t = fr["time"]
        # Only consider people with a visible face (facing the camera)
        # Filters out over-the-shoulder foreground silhouettes seen from behind!
        faces = [f for f in fr["faces"] if f.get("has_visible_face", True)]
        left_face = next((f for f in faces if f["bucket"] == "left"), None)
        right_face = next((f for f in faces if f["bucket"] == "right"), None)

        is_wide = False
        separation = None
        separation_ratio = None

        if left_face is not None and right_face is not None and len(faces) >= MIN_FACES_PER_FRAME:
            separation = abs(right_face["center_x"] - left_face["center_x"])
            separation_ratio = separation / frame_width

            # ── GUARD 1: are these two detections actually the same person? ──
            # YOLOv8-Pose commonly emits a body box and a head box for one
            # seated human. Such duplicates are the single biggest source of
            # false wide shots, so reject them before anything else.
            same_person = faces_are_same_person(left_face, right_face, frame_width)

            # ── GUARD 2: vertical coherence ──
            # Both subjects should occupy roughly the same horizontal band.
            # A large mismatch means two different shots glued into one sample.
            cy_left = left_face.get("center_y")
            cy_right = right_face.get("center_y")
            vertical_ok = True
            if cy_left is not None and cy_right is not None:
                frame_h = fr.get("height") or fr.get("frame_height") or 1080
                v_offset = abs(cy_right - cy_left) / float(frame_h)
                vertical_ok = v_offset <= MAX_VERTICAL_OFFSET_RATIO

            # ── GUARD 3: separation stability ──
            # A real two-shot keeps a similar distance across samples; a cut or
            # a wandering duplicate does not.
            jitter_ok = True
            if last_sep_ratio is not None:
                jitter_ok = abs(separation_ratio - last_sep_ratio) <= MAX_SEPARATION_JITTER_RATIO

            # ── GUARD 4: both faces must be large enough to be worth framing ──
            # Rejects wide ROOM shots, where two people are technically visible
            # but sit far from the camera. Cropping such a shot produces panels
            # of tables and chairs instead of faces.
            left_face_ratio = float(left_face.get("w", 0)) / frame_width
            right_face_ratio = float(right_face.get("w", 0)) / frame_width
            faces_big_enough = (
                left_face_ratio >= MIN_FACE_WIDTH_RATIO
                and right_face_ratio >= MIN_FACE_WIDTH_RATIO
            )

            is_wide = (
                not same_person
                and separation_ratio >= MIN_SEPARATION_RATIO
                and faces_big_enough
                and vertical_ok
                and jitter_ok
            )

        if is_wide and left_face is not None and right_face is not None:
            if current_start is None:
                current_start = t
                accum_x1 = [left_face["center_x"]]
                accum_x2 = [right_face["center_x"]]
            else:
                accum_x1.append(left_face["center_x"])
                accum_x2.append(right_face["center_x"])
            last_t = t
            last_sep_ratio = separation_ratio
            if left_face.get("center_y") is not None and right_face.get("center_y") is not None:
                last_center_y = (left_face["center_y"] + right_face["center_y"]) / 2.0
        else:
            close_interval(last_t)

    # Flush a trailing interval that reached the end of the recording.
    close_interval(last_t)

    # Merge nearby intervals separated by tiny gaps (< 0.6s)
    merged = []
    for interval in raw_intervals:
        if not merged:
            merged.append(interval)
            continue
        prev = merged[-1]
        if interval["start"] <= prev["end"] + 0.6:
            prev["end"] = max(prev["end"], interval["end"])
            if interval["x1"] and prev["x1"]:
                prev["x1"] = round((prev["x1"] + interval["x1"]) / 2, 1)
            if interval["x2"] and prev["x2"]:
                prev["x2"] = round((prev["x2"] + interval["x2"]) / 2, 1)
        else:
            merged.append(interval)

    return merged


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.exit(1)
