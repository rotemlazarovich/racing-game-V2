import base64
import os
import cv2
import numpy as np
from dataclasses import dataclass
from collections import defaultdict

# --- GLOBAL INITIALIZATION ---
_pose = None
_pose_unavailable = False
_is_tasks_api = False 

# Landmark Indices
_L_SHOULDER = 11
_R_SHOULDER = 12
_L_WRIST = 15
_R_WRIST = 16

# Room tracking
_room_histories = {}
_room_counters = defaultdict(int)
_DETECT_EVERY_N = 1  # Set to 1 for maximum responsiveness during testing

def _get_pose():
    """Detects and initializes whichever MediaPipe version is installed."""
    global _pose, _pose_unavailable, _is_tasks_api
    if _pose_unavailable: return None
    if _pose is not None: return _pose
    
    try:
        import mediapipe as mp
        # 1. Try New Tasks API (MediaPipe 0.10.0+)
        if hasattr(mp, "tasks"):
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
            
            model_path = os.path.join(os.path.dirname(__file__), 'pose_landmarker_lite.task')
            if not os.path.exists(model_path):
                print("[detection] Downloading Pose Task model...")
                import urllib.request
                url = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
                urllib.request.urlretrieve(url, model_path)

            options = vision.PoseLandmarkerOptions(
                base_options=python.BaseOptions(model_asset_path=model_path),
                running_mode=vision.RunningMode.IMAGE
            )
            _pose = vision.PoseLandmarker.create_from_options(options)
            _is_tasks_api = True
            print("[detection] SUCCESS: Initialized MediaPipe Tasks API.")
            return _pose
            
        # 2. Try Legacy API (MediaPipe 0.9.x)
        _pose = mp.solutions.pose.Pose(
            static_image_mode=False, 
            model_complexity=0,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        _is_tasks_api = False
        print("[detection] SUCCESS: Initialized MediaPipe Legacy API.")
        return _pose

    except Exception as e:
        print(f"[detection] ERROR: All MediaPipe init methods failed: {e}")
        _pose_unavailable = True
    return None

@dataclass
class DetectionState:
    left_person: bool
    left_hand_raised: bool
    left_wrist: dict
    left_shoulder: dict
    right_person: bool
    right_hand_raised: bool
    right_wrist: dict
    right_shoulder: dict

    def to_dict(self):
        return {
            "left": {
                "person": self.left_person, 
                "handRaised": self.left_hand_raised,
                "wrist": self.left_wrist,
                "shoulder": self.left_shoulder
            },
            "right": {
                "person": self.right_person, 
                "handRaised": self.right_hand_raised,
                "wrist": self.right_wrist,
                "shoulder": self.right_shoulder
            }
        }

def _default_state():
    pt = {'x': 0.5, 'y': 0.5}
    return DetectionState(False, False, pt, pt, False, False, pt, pt)

def _decode_image(image_b64: str) -> np.ndarray | None:
    try:
        data = image_b64.split(",")[1] if "," in image_b64 else image_b64
        img_bytes = base64.b64decode(data)
        img_np = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(img_np, cv2.IMREAD_COLOR)
        if img is None: return None
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    except: return None

def process_frame(image_b64: str, room_id: str) -> DetectionState:
    global _room_histories, _room_counters
    
    pose = _get_pose()
    if not pose: return _default_state()

    _room_counters[room_id] += 1
    if _room_counters[room_id] % _DETECT_EVERY_N != 0:
        return _room_histories.get(room_id, _default_state())

    img = _decode_image(image_b64)
    if img is None: return _room_histories.get(room_id, _default_state())

    # --- DETECTION LOGIC ---
    landmarks = None
    if _is_tasks_api:
        from mediapipe.tasks.python.vision.core.image import Image, ImageFormat
        mp_image = Image(image_format=ImageFormat.SRGB, data=img)
        result = pose.detect(mp_image)
        if result.pose_landmarks and len(result.pose_landmarks) > 0:
            landmarks = result.pose_landmarks[0]
    else:
        result = pose.process(img)
        if result.pose_landmarks:
            landmarks = result.pose_landmarks.landmark

    if not landmarks:
        return _default_state()

    # --- LANDMARK MAPPING (Single Player Logic) ---
    # We treat the person in the frame as a single entity with two arms.
    # Note: For Tasks API, landmarks are objects; for Legacy, they have .x/.y
    try:
        lw = landmarks[_L_WRIST]
        ls = landmarks[_L_SHOULDER]
        rw = landmarks[_R_WRIST]
        rs = landmarks[_R_SHOULDER]

        state = DetectionState(
            left_person=True,
            left_hand_raised=(lw.y < ls.y),
            left_wrist={'x': lw.x, 'y': lw.y},
            left_shoulder={'x': ls.x, 'y': ls.y},
            right_person=True,
            right_hand_raised=(rw.y < rs.y),
            right_wrist={'x': rw.x, 'y': rw.y},
            right_shoulder={'x': rs.x, 'y': rs.y}
        )
        _room_histories[room_id] = state
        return state
    except Exception as e:
        print(f"[detection] Landmark extraction error: {e}")
        return _default_state()