import json
import statistics
import sys

import cv2
import mediapipe as mp
import numpy as np


FRAME_SAMPLE_FPS = 4.0
MIN_TRACK_HITS = 3
MIN_FACE_RATIO = 0.08
MAX_TRACK_DISTANCE_RATIO = 0.18
MEDIAPIPE_MIN_CONFIDENCE = 0.45
BOX_EXPAND_RATIO = 0.18


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

    frontal = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    profile = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    mp_face_detection = mp.solutions.face_detection.FaceDetection(
        model_selection=1,
        min_detection_confidence=MEDIAPIPE_MIN_CONFIDENCE,
    )

    sample_step = max(1.0 / FRAME_SAMPLE_FPS, 0.25)
    min_face_size = max(48, int(min(width, height) * MIN_FACE_RATIO))
    max_track_distance = width * MAX_TRACK_DISTANCE_RATIO

    tracks = []
    samples = []
    next_track_id = 1

    t = clip_start
    while t < clip_end:
        frame = read_frame_at(cap, t)
        if frame is None:
            t += sample_step
            continue

        detections = detect_faces(frame, frontal, profile, mp_face_detection, min_face_size)
        active_speaker = get_active_speaker(speaker_turns, t - clip_start)
        assignments, next_track_id = assign_detections_to_tracks(
            frame,
            detections,
            tracks,
            next_track_id,
            max_track_distance,
        )

        sample_visible = []
        for track, det, motion in assignments:
            sample_visible.append(
                {
                    "track_id": track["id"],
                    "speaker": active_speaker,
                    "center_x": det["center_x"],
                    "size": det["w"] * det["h"],
                    "motion": motion,
                    "x": det["x"],
                    "w": det["w"],
                }
            )

        samples.append(
            {
                "time": round(t - clip_start, 2),
                "speaker": active_speaker,
                "visible": sample_visible,
            }
        )
        t += sample_step

    cap.release()
    mp_face_detection.close()

    stable_tracks = [track for track in tracks if len(track["centers"]) >= MIN_TRACK_HITS]
    if not stable_tracks:
        json.dump({"plan": [], "debug": {"tracks": 0, "samples": len(samples), "detector": "none"}}, sys.stdout)
        return

    speaker_map = map_speakers_to_tracks(speaker_turns, stable_tracks, samples)
    plan = build_focus_plan(samples, stable_tracks, speaker_map, width)

    json.dump(
        {
            "plan": plan,
            "debug": {
                "tracks": len(stable_tracks),
                "samples": len(samples),
                "speakerMap": speaker_map,
                "detector": "mediapipe+haar",
            },
        },
        sys.stdout,
    )


def read_frame_at(cap, time_seconds):
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0, time_seconds * 1000.0))
    ok, frame = cap.read()
    return frame if ok else None


def detect_faces(frame, frontal, profile, mp_face_detection, min_face_size):
    height, width = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_result = mp_face_detection.process(rgb)

    detected = []
    if mp_result.detections:
        for detection in mp_result.detections:
            relative = detection.location_data.relative_bounding_box
            x = int(relative.xmin * width)
            y = int(relative.ymin * height)
            w = int(relative.width * width)
            h = int(relative.height * height)
            expanded = expand_box(x, y, w, h, width, height, BOX_EXPAND_RATIO)
            if expanded[2] >= min_face_size and expanded[3] >= min_face_size:
                detected.append(expanded)

    if not detected:
        detected.extend(detect_faces_with_haar(frame, frontal, profile, min_face_size))

    suppressed = non_max_suppression(detected)
    faces = []
    for x, y, w, h in suppressed:
        faces.append(
            {
                "x": int(x),
                "y": int(y),
                "w": int(w),
                "h": int(h),
                "center_x": float(x + (w / 2.0)),
            }
        )

    faces.sort(key=lambda face: face["w"] * face["h"], reverse=True)
    return faces[:3]


def detect_faces_with_haar(frame, frontal, profile, min_face_size):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)

    detected = []
    for x, y, w, h in frontal.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(min_face_size, min_face_size),
    ):
        detected.append((x, y, w, h))

    for x, y, w, h in profile.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=4,
        minSize=(min_face_size, min_face_size),
    ):
        detected.append((x, y, w, h))

    mirrored = cv2.flip(gray, 1)
    for x, y, w, h in profile.detectMultiScale(
        mirrored,
        scaleFactor=1.1,
        minNeighbors=4,
        minSize=(min_face_size, min_face_size),
    ):
        real_x = gray.shape[1] - x - w
        detected.append((real_x, y, w, h))

    return detected


def expand_box(x, y, w, h, frame_width, frame_height, ratio):
    expand_x = int(w * ratio)
    expand_y = int(h * ratio)
    new_x = max(0, x - expand_x)
    new_y = max(0, y - expand_y)
    new_w = min(frame_width - new_x, w + (expand_x * 2))
    new_h = min(frame_height - new_y, h + (expand_y * 2))
    return (new_x, new_y, new_w, new_h)


def non_max_suppression(boxes, iou_threshold=0.35):
    if not boxes:
        return []

    boxes_np = np.array(boxes, dtype=np.float32)
    x1 = boxes_np[:, 0]
    y1 = boxes_np[:, 1]
    x2 = x1 + boxes_np[:, 2]
    y2 = y1 + boxes_np[:, 3]
    areas = boxes_np[:, 2] * boxes_np[:, 3]
    order = areas.argsort()[::-1]

    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(tuple(map(int, boxes_np[i])))

        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])

        inter_w = np.maximum(0.0, xx2 - xx1)
        inter_h = np.maximum(0.0, yy2 - yy1)
        intersection = inter_w * inter_h
        union = areas[i] + areas[order[1:]] - intersection
        iou = np.divide(intersection, union, out=np.zeros_like(intersection), where=union > 0)

        remaining = np.where(iou <= iou_threshold)[0]
        order = order[remaining + 1]

    return keep


def assign_detections_to_tracks(frame, detections, tracks, next_track_id, max_track_distance):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    assignments = []
    used_track_ids = set()

    for detection in sorted(detections, key=lambda item: item["center_x"]):
        best_track = None
        best_distance = None

        for track in tracks:
            if track["id"] in used_track_ids:
                continue
            if track["misses"] > 4:
                continue

            distance = abs(track["last_center_x"] - detection["center_x"])
            if distance > max_track_distance:
                continue

            if best_distance is None or distance < best_distance:
                best_track = track
                best_distance = distance

        if best_track is None:
            best_track = {
                "id": next_track_id,
                "centers": [],
                "sizes": [],
                "last_center_x": detection["center_x"],
                "misses": 0,
                "prev_patch": None,
            }
            tracks.append(best_track)
            next_track_id += 1

        patch = extract_patch(gray, detection)
        motion = compare_motion(best_track.get("prev_patch"), patch)

        best_track["centers"].append(detection["center_x"])
        best_track["sizes"].append(detection["w"] * detection["h"])
        best_track["last_center_x"] = detection["center_x"]
        best_track["misses"] = 0
        best_track["prev_patch"] = patch
        used_track_ids.add(best_track["id"])
        assignments.append((best_track, detection, motion))

    for track in tracks:
        if track["id"] not in used_track_ids:
            track["misses"] += 1

    return assignments, next_track_id


def extract_patch(gray, detection):
    x, y, w, h = detection["x"], detection["y"], detection["w"], detection["h"]
    roi = gray[y:y + h, x:x + w]
    if roi.size == 0:
        return None
    return cv2.resize(roi, (48, 48), interpolation=cv2.INTER_AREA)


def compare_motion(prev_patch, patch):
    if prev_patch is None or patch is None:
        return 0.0
    diff = cv2.absdiff(prev_patch, patch)
    return float(diff.mean())


def get_active_speaker(speaker_turns, clip_relative_time):
    best_turn = None
    for turn in speaker_turns:
        if turn["start"] <= clip_relative_time < turn["end"]:
            if best_turn is None or (turn["end"] - turn["start"]) > (best_turn["end"] - best_turn["start"]):
                best_turn = turn
    return best_turn["speaker"] if best_turn else None


def map_speakers_to_tracks(speaker_turns, stable_tracks, samples):
    speakers = []
    for turn in speaker_turns:
        speaker = turn.get("speaker")
        if speaker and speaker not in speakers:
            speakers.append(speaker)

    tracks_by_id = {track["id"]: track for track in stable_tracks}
    scores = {speaker: {track["id"]: 0.0 for track in stable_tracks} for speaker in speakers}

    for sample in samples:
        speaker = sample.get("speaker")
        if speaker not in scores:
            continue

        for visible in sample.get("visible", []):
            track_id = visible["track_id"]
            if track_id not in tracks_by_id:
                continue
            base_score = visible["motion"] + 0.5
            scores[speaker][track_id] += base_score

    assigned_tracks = set()
    mapping = {}

    ranked_pairs = []
    for speaker, track_scores in scores.items():
        for track_id, score in track_scores.items():
            ranked_pairs.append((score, speaker, track_id))

    ranked_pairs.sort(reverse=True)
    for score, speaker, track_id in ranked_pairs:
        if score <= 0:
            continue
        if speaker in mapping or track_id in assigned_tracks:
            continue
        mapping[speaker] = track_id
        assigned_tracks.add(track_id)

    remaining_tracks = sorted(
        (track for track in stable_tracks if track["id"] not in assigned_tracks),
        key=lambda track: statistics.median(track["centers"]),
    )

    for speaker in speakers:
        if speaker in mapping or not remaining_tracks:
            continue
        mapping[speaker] = remaining_tracks.pop(0)["id"]

    return mapping


def build_focus_plan(samples, stable_tracks, speaker_map, frame_width):
    track_centers = {
        track["id"]: statistics.median(track["centers"])
        for track in stable_tracks
    }

    plan_points = []
    previous_center = frame_width / 2.0

    for sample in samples:
        visible = sample.get("visible", [])
        active_speaker = sample.get("speaker")
        target_center = None
        target_width = 0.0

        if active_speaker in speaker_map:
            desired_track = speaker_map[active_speaker]
            for item in visible:
                if item["track_id"] == desired_track:
                    target_center = item["center_x"]
                    target_width = item["w"]
                    break
            if target_center is None and desired_track in track_centers:
                target_center = track_centers[desired_track]

        if target_center is None and visible:
            largest = max(visible, key=lambda item: item["size"])
            target_center = largest["center_x"]
            target_width = largest["w"]

        if target_center is None:
            target_center = previous_center

        target_center = (previous_center * 0.30) + (target_center * 0.70)
        previous_center = target_center
        plan_points.append(
            {
                "time": sample["time"],
                "center_x": round(target_center, 2),
                "face_width": round(float(target_width), 2),
            }
        )

    if not plan_points:
        return []

    segments = []
    current = {
        "start": 0.0,
        "end": plan_points[0]["time"],
        "centers": [plan_points[0]["center_x"]],
        "widths": [plan_points[0]["face_width"]],
    }

    for i in range(1, len(plan_points)):
        point = plan_points[i]
        previous_point = plan_points[i - 1]
        movement = abs(point["center_x"] - previous_point["center_x"])

        if movement > frame_width * 0.045:
            segments.append(finalize_segment(current, point["time"]))
            current = {
                "start": previous_point["time"],
                "end": point["time"],
                "centers": [point["center_x"]],
                "widths": [point["face_width"]],
            }
        else:
            current["end"] = point["time"]
            current["centers"].append(point["center_x"])
            current["widths"].append(point["face_width"])

    segments.append(finalize_segment(current, plan_points[-1]["time"] + 0.35))
    return segments


def finalize_segment(segment, fallback_end):
    end_value = max(segment["start"] + 0.2, segment["end"], fallback_end)
    return {
        "start": round(segment["start"], 2),
        "end": round(end_value, 2),
        "center_x": round(statistics.mean(segment["centers"]), 2),
        "face_width": round(max(segment["widths"]) if segment["widths"] else 0, 2),
    }


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.exit(1)
