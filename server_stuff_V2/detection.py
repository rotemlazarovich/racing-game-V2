import base64
import os
import sys
import cv2
import numpy as np
from dataclasses import dataclass
from collections import defaultdict

_pose = None
_pose_unavailable = False
_is_tasks_api = False 

_L_SHOULDER, _R_SHOULDER = 11, 12
_L_WRIST, _R_WRIST = 15, 16

_room_histories = {}
_room_counters = defaultdict(int)
_DETECT_EVERY_N = 1 

def get_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)

def _get_pose():
    global _pose, _pose_unavailable, _is_tasks_api
    if _pose_unavailable: return None
    if _pose is not None: return _pose
    try:
        import mediapipe as mp
        if hasattr(mp, "tasks"):
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
            model_path = get_path('pose_landmarker_lite.task')
            options = vision.PoseLandmarkerOptions(
                base_options=python.BaseOptions(model_asset_path=model_path),
                running_mode=vision.RunningMode.IMAGE,
                num_poses=2,
                min_pose_detection_confidence=0.3, # Add this: helps find people
                min_pose_presence_confidence=0.3    # Add this: helps keep them tracked
            )
            _pose = vision.PoseLandmarker.create_from_options(options)
            _is_tasks_api = True
            return _pose
        _pose = mp.solutions.pose.Pose(static_image_mode=False, model_complexity=0)
        _is_tasks_api = False
        return _pose
    except Exception as e:
        _pose_unavailable = True
        return None

@dataclass
class DetectionState:
    p1: dict
    p2: dict

    def to_dict(self):
        return {"p1": self.p1, "p2": self.p2}

def _empty_person():
    pt = {'x': 0.5, 'y': 0.5}
    return {"active": False, "handRaised": False, "left": {"wrist": pt, "shoulder": pt}, "right": {"wrist": pt, "shoulder": pt}}

def _decode_image(image_b64: str) -> np.ndarray | None:
    try:
        data = image_b64.split(",")[1] if "," in image_b64 else image_b64
        img_bytes = base64.b64decode(data)
        img_np = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(img_np, cv2.IMREAD_COLOR)
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB) if img is not None else None
    except: return None

def process_frame(image_b64: str, room_id: str) -> DetectionState:
    global _room_histories, _room_counters
    pose = _get_pose()
    if not pose: return DetectionState(_empty_person(), _empty_person())

    img = _decode_image(image_b64)
    if img is None: return _room_histories.get(room_id, DetectionState(_empty_person(), _empty_person()))

    # Determine mode BEFORE processing
    try:
        is_multi = int(room_id) % 2 == 0
    except: is_multi = False

    all_poses = []
    if _is_tasks_api:
        from mediapipe.tasks.python.vision.core.image import Image, ImageFormat
        mp_image = Image(image_format=ImageFormat.SRGB, data=img)
        result = pose.detect(mp_image)
        if result.pose_landmarks: all_poses = result.pose_landmarks
    else:
        result = pose.process(img)
        if result.pose_landmarks: all_poses = [result.pose_landmarks.landmark]

    if not all_poses:
        return DetectionState(_empty_person(), _empty_person())

    # Format helper - RESTORED TO YOUR ORIGINAL LOGIC
    def format_p(landmarks):
        lw, ls, rw, rs = landmarks[_L_WRIST], landmarks[_L_SHOULDER], landmarks[_R_WRIST], landmarks[_R_SHOULDER]
        is_raised = (rw.y < rs.y) or (lw.y < ls.y)
        return {
            "active": True,
            "handRaised": is_raised,
            "x": ls.x,
            "left": {"wrist": {'x': lw.x, 'y': lw.y}, "shoulder": {'x': ls.x, 'y': ls.y}},
            "right": {"wrist": {'x': rw.x, 'y': rw.y}, "shoulder": {'x': rs.x, 'y': rs.y}}
        }

    # SINGLE PLAYER LOGIC: If odd room, only look at the first person detected.
    if not is_multi:
        p1_data = format_p(all_poses[0])
        state = DetectionState(p1_data, _empty_person())
    else:
        # MULTIPLAYER LOGIC: Sort by X to assign P1 (Left) and P2 (Right)
        all_poses.sort(key=lambda p: p[_L_SHOULDER].x)
        p1_data = format_p(all_poses[0])
        p2_data = format_p(all_poses[1]) if len(all_poses) > 1 else _empty_person()
        state = DetectionState(p1_data, p2_data)

    _room_histories[room_id] = state
    return state