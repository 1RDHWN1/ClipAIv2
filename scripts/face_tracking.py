import json
import os
import statistics
import sys

import cv2
import mediapipe as mp
import numpy as np


FRAME_SAMPLE_FPS = 5.0          # 5 FPS temporal resolution (0.2s step)
MIN_FACE_RATIO = 0.03           # Minimum face size relative to frame (3% to catch wide shots)
BOX_EXPAND_RATIO = 0.12         # Bounding box padding
FACE_ASPECT_RATIO_MAX = 2.0     # Max w/h or h/w ratio for valid human face
FACE_Y_BAND_RATIO = 0.72        # Faces should be in top 72% of frame (not floor/desk)
MIN_HOLD_SAME_SHOT = 0.8        # 0.8s responsive hold time between speaker shifts in wide shot


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
    if yunet_detector is None and hasattr(mp, "solutions") and hasattr(mp.solutions, "face_detection"):
        try:
            mp_face_detection = mp.solutions.face_detection.FaceDetection(
                model_selection=1,
                min_detection_confidence=0.50,
            )
        except Exception:
            mp_face_detection = None

    sample_step = max(1.0 / FRAME_SAMPLE_FPS, 0.20)
    min_face_size = max(20, int(min(width, height) * MIN_FACE_RATIO))
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frames_per_step = max(1, int(round(video_fps * sample_step)))

    cap.set(cv2.CAP_PROP_POS_MSEC, max(0, clip_start * 1000.0))

    frame_records = []
    prev_gray = None

    t = clip_start
    while t < clip_end:
        ok, frame = cap.read()
        if not ok:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # 1. Camera scene cut detection:
        # High diff_mean combined with low histogram correlation marks true camera cuts.
        is_scene_cut = False
        if prev_gray is not None:
            diff = cv2.absdiff(prev_gray, gray)
            diff_mean = float(diff.mean())
            if diff_mean > 45.0:
                h1 = cv2.calcHist([prev_gray], [0], None, [32], [0, 256])
                h2 = cv2.calcHist([gray], [0], None, [32], [0, 256])
                corr = cv2.compareHist(h1, h2, cv2.HISTCMP_CORREL)
                if corr < 0.70:
                    is_scene_cut = True
        prev_gray = gray.copy()

        # 2. Robust face detection (YuNet with landmark-derived mouth patches)
        faces = detect_faces(frame, gray, yunet_detector, mp_face_detection, min_face_size, width, height)
        active_speaker = get_active_speaker(speaker_turns, t - clip_start)

        frame_records.append({
            "time": round(t - clip_start, 2),
            "is_cut": is_scene_cut,
            "speaker": active_speaker,
            "faces": faces,
        })

        for _ in range(frames_per_step - 1):
            if not cap.grab():
                break
        t += sample_step

    cap.release()
    if mp_face_detection is not None:
        try:
            mp_face_detection.close()
        except Exception:
            pass

    if not frame_records:
        json.dump({"plan": [], "debug": {"tracks": 0, "samples": 0, "detector": "none"}}, sys.stdout)
        return

    total_detections = sum(len(fr["faces"]) for fr in frame_records)
    if total_detections == 0:
        json.dump({"plan": [], "debug": {"tracks": 0, "samples": len(frame_records), "detector": "none"}}, sys.stdout)
        return

    # 3. Build intelligent shot-aware plan
    plan = build_shot_aware_plan(frame_records, width, height, speaker_turns)

    json.dump(
        {
            "plan": plan,
            "debug": {
                "tracks": len(plan),
                "samples": len(frame_records),
                "detector": "yunet" if yunet_detector is not None else ("mediapipe" if mp_face_detection is not None else "none"),
            },
        },
        sys.stdout,
    )


def read_frame_at(cap, time_seconds):
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0, time_seconds * 1000.0))
    ok, frame = cap.read()
    return frame if ok else None


def detect_faces(frame, gray, yunet_detector, mp_face_detection, min_face_size, frame_width, frame_height):
    detected = []

    # 1. Primary: YuNet Deep Learning (superior for angles, side profiles, tilted faces)
    if yunet_detector is not None:
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

    # Filter out tiny background poster faces when a dominant human speaker is present
    for fr in frame_records:
        raw_faces = fr["faces"]
        if len(raw_faces) > 1:
            raw_faces.sort(key=lambda f: f["w"] * f["h"], reverse=True)
            primary = raw_faces[0]
            valid_faces = [primary]
            for f in raw_faces[1:]:
                # Real co-host in a 2-person wide shot is >= 38% of primary width
                # Posters/pictures on background walls are typically < 25% of subject width
                if f["w"] >= primary["w"] * 0.38 and abs(f["center_y"] - primary["center_y"]) < frame_height * 0.30:
                    valid_faces.append(f)
            fr["faces"] = valid_faces

    # 1. Scan forward for the first confirmed human face.
    # NEVER default to frame_width / 2 (which points at the tripod/equipment in the center of the table!)
    initial_focus_x = None
    initial_focus_bucket = None
    initial_face_w = frame_width * 0.12

    for fr in frame_records:
        if fr["faces"]:
            if len(fr["faces"]) > 1:
                # In wide shot, prefer the speaker with highest confidence/size
                chosen = max(fr["faces"], key=lambda f: f["score"] * f["w"])
            else:
                chosen = fr["faces"][0]
            initial_focus_x = chosen["center_x"]
            initial_focus_bucket = chosen["bucket"]
            initial_face_w = chosen["w"]
            break

    if initial_focus_x is None:
        initial_focus_x = frame_width * 0.5
        initial_focus_bucket = "left"

    current_focus_x = initial_focus_x
    current_focus_bucket = initial_focus_bucket
    current_face_w = initial_face_w
    last_switch_time = 0.0
    MIN_HOLD_SAME_SHOT = 0.8
    MAX_SEGMENTS = 16

    prev_mouth_left = None
    prev_mouth_right = None
    act_left = 0.0
    act_right = 0.0

    targets = []

    for fr in frame_records:
        time = fr["time"]
        faces = fr["faces"]
        is_cut = fr["is_cut"]

        # Reset hold on scene cuts: camera cuts in original video MUST snap instantly!
        if is_cut:
            prev_mouth_left = None
            prev_mouth_right = None
            act_left = 0.0
            act_right = 0.0
            last_switch_time = time

        # Cluster into left and right faces for wide-shot tracking
        left_face = None
        right_face = None
        for f in faces:
            if f["bucket"] == "left" and (left_face is None or f["score"] > left_face["score"]):
                left_face = f
            elif f["bucket"] == "right" and (right_face is None or f["score"] > right_face["score"]):
                right_face = f

        # Track mouth motion via landmark-anchored patches, rolling activity act = act * 0.6 + motion * 0.4
        if left_face is not None:
            if prev_mouth_left is not None and left_face["mouth_patch"] is not None:
                diff_l = float(cv2.absdiff(prev_mouth_left, left_face["mouth_patch"]).mean())
            else:
                diff_l = 0.0
            if left_face["mouth_patch"] is not None:
                prev_mouth_left = left_face["mouth_patch"]
            act_left = act_left * 0.6 + diff_l * 0.4
            left_face["motion"] = diff_l
            left_face["activity"] = act_left
        else:
            act_left *= 0.6

        if right_face is not None:
            if prev_mouth_right is not None and right_face["mouth_patch"] is not None:
                diff_r = float(cv2.absdiff(prev_mouth_right, right_face["mouth_patch"]).mean())
            else:
                diff_r = 0.0
            if right_face["mouth_patch"] is not None:
                prev_mouth_right = right_face["mouth_patch"]
            act_right = act_right * 0.6 + diff_r * 0.4
            right_face["motion"] = diff_r
            right_face["activity"] = act_right
        else:
            act_right *= 0.6

        if not faces:
            # Maintain current speaker focus during pauses/silences (never snap to center equipment)
            targets.append({
                "time": time,
                "center_x": current_focus_x,
                "face_width": current_face_w,
                "is_cut": is_cut,
            })
            continue

        if len(faces) == 1:
            # Single face visible (close-up of speaker) -> lock on immediately with 100% precision!
            chosen_face = faces[0]
            if is_cut:
                current_focus_x = chosen_face["center_x"]
                current_focus_bucket = chosen_face["bucket"]
                current_face_w = chosen_face["w"]
                last_switch_time = time
            elif chosen_face["bucket"] == current_focus_bucket:
                current_focus_x = chosen_face["center_x"]
                current_face_w = chosen_face["w"]
            else:
                can_switch = (time - last_switch_time) >= MIN_HOLD_SAME_SHOT
                if can_switch:
                    current_focus_x = chosen_face["center_x"]
                    current_focus_bucket = chosen_face["bucket"]
                    current_face_w = chosen_face["w"]
                    last_switch_time = time

            targets.append({
                "time": time,
                "center_x": current_focus_x,
                "face_width": current_face_w,
                "is_cut": is_cut,
            })
            continue

        # Multi-person shot (e.g. 2-person wide):
        desired_face = None
        can_switch = (time - last_switch_time) >= MIN_HOLD_SAME_SHOT or is_cut

        if left_face and right_face:
            # Responsive switching: switch when competing speaker has active mouth motion (> 1.0)
            # exceeding current speaker by at least 0.4 margin (fast, eliminates delay!)
            if current_focus_bucket == "left":
                if right_face["activity"] > left_face["activity"] + 0.4 and right_face["activity"] > 1.0 and can_switch:
                    desired_face = right_face
                else:
                    desired_face = left_face
            elif current_focus_bucket == "right":
                if left_face["activity"] > right_face["activity"] + 0.4 and left_face["activity"] > 1.0 and can_switch:
                    desired_face = left_face
                else:
                    desired_face = right_face
            else:
                desired_face = left_face if left_face["activity"] >= right_face["activity"] else right_face
        elif left_face:
            desired_face = left_face
        elif right_face:
            desired_face = right_face
        else:
            desired_face = faces[0]

        if desired_face:
            if desired_face["bucket"] != current_focus_bucket:
                last_switch_time = time
                current_focus_bucket = desired_face["bucket"]
            current_focus_x = desired_face["center_x"]
            current_face_w = desired_face["w"]

        targets.append({
            "time": time,
            "center_x": current_focus_x,
            "face_width": current_face_w,
            "is_cut": is_cut,
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


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.exit(1)
