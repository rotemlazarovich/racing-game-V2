"""
Pose detection (MediaPipe, CPU): assign people to left/right half,
detect right hand above shoulder per half. Supports legacy mp.solutions.pose
and MediaPipe 0.10.30+ Tasks API (PoseLandmarker).
NOW WITH MULTI-ROOM SUPPORT.
"""
import base64
import os
from dataclasses import dataclass
from io import BytesIO

import cv2
import numpy as np

# Lazy init: either legacy Pose or PoseLandmarker; None if unavailable
_pose = None
_pose_unavailable = False
_use_tasks_api = False  # True = use mp.tasks.vision.PoseLandmarker

# --- NEW: MULTI-ROOM STORAGE ---
_room_counters = {}
_room_histories = {}

_DETECT_EVERY_N = 2

# Landmark indices (same for legacy and tasks API)
_RIGHT_SHOULDER = 12
_RIGHT_WRIST = 16

def _get_pose():
    global _pose, _pose_unavailable, _use_tasks_api
    if _pose_unavailable:
        return None
    if _pose is not None:
        return _pose
    try:
        import mediapipe as mp
        # Prefer legacy API if available (older installs)
        if hasattr(mp, "solutions") and hasattr(mp.solutions, "pose"):
            _pose = mp.solutions.pose.Pose(
                static_image_mode=False,
                model_complexity=0,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            return _pose
        # MediaPipe 0.10.30+ uses tasks API
        if hasattr(mp, "tasks") and hasattr(mp.tasks, "vision"):
            BaseOptions = mp.tasks.BaseOptions
            PoseLandmarker = mp.tasks.vision.PoseLandmarker
            PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
            VisionRunningMode = mp.tasks.vision.RunningMode
            # Download model once to a cache file
            cache_dir = os.path.join(os.path.dirname(__file__), ".cache")
            os.makedirs(cache_dir, exist_ok=True)
            model_path = os.path.join(cache_dir, "pose_landmarker_lite.task")
            if not os.path.isfile(model_path):
                try:
                    import urllib.request
                    url = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
                    urllib.request.urlretrieve(url, model_path)
                except Exception as e:
                    print(f"[detection] Could not download pose model: {e}")
                    _pose_unavailable = True
                    return None
            options = PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=model_path),
                running_mode=VisionRunningMode.IMAGE,
            )
            _pose = PoseLandmarker.create_from_options(options)
            _use_tasks_api = True
            return _pose
        _pose_unavailable = True
        return None
    except (ImportError, AttributeError, Exception) as e:
        print(f"[detection] Pose init failed: {e}")
        _pose_unavailable = True
        return None


@dataclass
class DetectionState:
    left_person: bool
    left_hand_raised: bool
    right_person: bool
    right_hand_raised: bool

    def to_dict(self):
        return {
            "left": {"person": self.left_person, "handRaised": self.left_hand_raised},
            "right": {"person": self.right_person, "handRaised": self.right_hand_raised},
        }


def _decode_image(image_b64: str) -> np.ndarray | None:
    try:
        raw = base64.b64decode(image_b64)
        buf = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img is None:
            return None
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    except Exception:
        return None


def _default_state() -> DetectionState:
    return DetectionState(
        left_person=False, left_hand_raised=False,
        right_person=False, right_hand_raised=False,
    )


def _check_half_legacy(pose, half_img: np.ndarray) -> tuple[bool, bool]:
    res = pose.process(half_img)
    if not res.pose_landmarks:
        return False, False
    lm = res.pose_landmarks.landmark
    try:
        r_shoulder = lm[_RIGHT_SHOULDER]
        r_wrist = lm[_RIGHT_WRIST]
        return True, r_wrist.y < r_shoulder.y
    except (IndexError, AttributeError):
        return True, False


def _check_half_tasks(pose, half_img: np.ndarray) -> tuple[bool, bool]:
    from mediapipe.tasks.python.vision.core.image import Image, ImageFormat
    rgb = np.ascontiguousarray(half_img if half_img.dtype == np.uint8 else half_img.astype(np.uint8))
    mp_image = Image(image_format=ImageFormat.SRGB, data=rgb)
    result = pose.detect(mp_image)
    if not result.pose_landmarks or len(result.pose_landmarks) == 0:
        return False, False
    lm_list = result.pose_landmarks[0]
    try:
        r_shoulder = lm_list[_RIGHT_SHOULDER]
        r_wrist = lm_list[_RIGHT_WRIST]
        return True, r_wrist.y < r_shoulder.y
    except (IndexError, AttributeError):
        return True, False


def process_frame(image_b64: str, room_id: str) -> DetectionState:
    global _room_counters, _room_histories
    
    # Init room memory if new
    if room_id not in _room_counters:
        _room_counters[room_id] = 0
        _room_histories[room_id] = _default_state()

    _room_counters[room_id] += 1
    
    # Only detect every N frames PER ROOM to save CPU
    if _room_counters[room_id] % _DETECT_EVERY_N != 0:
        return _room_histories[room_id]

    img = _decode_image(image_b64)
    pose = _get_pose()
    if img is None or pose is None:
        return _room_histories.get(room_id) or _default_state()

    # --- NEW LOGIC: SINGLE vs MULTIPLAYER ---
    is_multiplayer = int(room_id) % 2 == 0
    check = _check_half_tasks if _use_tasks_api else _check_half_legacy

    if is_multiplayer:
        mid = img.shape[1] // 2
        l_p, l_h = check(pose, img[:, :mid])
        r_p, r_h = check(pose, img[:, mid:])
        new_state = DetectionState(l_p, l_h, r_p, r_h)
    else:
        # Singleplayer: Run on whole image, assign to "left" slot by default
        p_present, h_raised = check(pose, img)
        new_state = DetectionState(p_present, h_raised, False, False)

    _room_histories[room_id] = new_state
    return new_state