import base64
import os
import sys
import cv2
import numpy as np
from dataclasses import dataclass
from collections import defaultdict
import time

# Note: socketio is usually handled by the main server script
import socketio

_pose = None
_pose_unavailable = False
_is_tasks_api = False 

_L_SHOULDER, _R_SHOULDER = 11, 12
_L_WRIST, _R_WRIST = 15, 16

# --- SPEED & STATE GLOBALS ---
LAST_UPDATE_TIME = {}
FRAME_RATE_LIMIT = 0.033  # Caps server at ~30 FPS
_room_histories = {}

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
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
        
        model_path = get_path('pose_landmarker_lite.task')
        options = vision.PoseLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=model_path),
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1, 
            min_pose_detection_confidence=0.4,
            min_pose_presence_confidence=0.4,
            min_tracking_confidence=0.4
        )
        _pose = vision.PoseLandmarker.create_from_options(options)
        _is_tasks_api = True
        return _pose
    except Exception as e:
        print(f"MediaPipe Setup Error: {e}")
        _pose_unavailable = True
        return None

# --- CRITICAL: RESTORED THIS CLASS FOR main.py ---
@dataclass
class DetectionState:
    p1: dict
    p2: dict

    def to_dict(self):
        return {"p1": self.p1, "p2": self.p2}

def _empty_person():
    pt = {'x': 0.5, 'y': 0.5}
    return {
        "active": False, 
        "handRaised": False, 
        "width": 0.2, # Baseline width
        "x": 0.5,
        "left": {"wrist": pt, "shoulder": pt}, 
        "right": {"wrist": pt, "shoulder": pt}
    }

def _decode_image(image_b64: str) -> np.ndarray | None:
    try:
        data = image_b64.split(",")[1] if "," in image_b64 else image_b64
        img_bytes = base64.b64decode(data)
        img_np = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(img_np, cv2.IMREAD_COLOR)
        if img is None: return None
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    except Exception as e:
        print(f"Decode Error: {e}")
        return None

def _adjust_coords(data, scale_x, offset_x):
    """ Corrects coordinates for split-screen and calculates body width """
    for side in ['left', 'right']:
        data[side]['wrist']['x'] = (data[side]['wrist']['x'] * scale_x) + offset_x
        data[side]['shoulder']['x'] = (data[side]['shoulder']['x'] * scale_x) + offset_x
    
    data['x'] = (data['left']['shoulder']['x'] + data['right']['shoulder']['x']) / 2
    data['width'] = abs(data['left']['shoulder']['x'] - data['right']['shoulder']['x'])
    return data

def format_p(landmarks):
    """ Extracts key points and checks for raised hands """
    lw, ls, rw, rs = landmarks[_L_WRIST], landmarks[_L_SHOULDER], landmarks[_R_WRIST], landmarks[_R_SHOULDER]
    is_raised = (rw.y < rs.y - 0.05) or (lw.y < ls.y - 0.05)
    
    return {
        "active": True,
        "handRaised": is_raised,
        "x": ls.x,
        "left": {"wrist": {'x': lw.x, 'y': lw.y}, "shoulder": {'x': ls.x, 'y': ls.y}},
        "right": {"wrist": {'x': rw.x, 'y': rw.y}, "shoulder": {'x': rs.x, 'y': rs.y}}
    }

def process_frame(image_b64: str, room_id: str) -> DetectionState:
    global LAST_UPDATE_TIME, _room_histories
    
    # 1. FRAME RATE LIMITER
    now = time.time()
    last_time = LAST_UPDATE_TIME.get(room_id, 0)
    if (now - last_time) < FRAME_RATE_LIMIT:
        return _room_histories.get(room_id, DetectionState(_empty_person(), _empty_person()))
    
    LAST_UPDATE_TIME[room_id] = now
    pose = _get_pose()
    img = _decode_image(image_b64)
    
    if img is None or not pose: 
        return DetectionState(_empty_person(), _empty_person())

    # Detect if room is multiplayer
    try:
        # Assuming even room IDs are multi, or you have a specific naming convention
        is_multi = int(room_id) % 2 == 0
    except: 
        is_multi = False

    from mediapipe.tasks.python.vision.core.image import Image, ImageFormat

    if is_multi:
        h, w, _ = img.shape
        mid = w // 2
        img_left = img[:, :mid]
        img_right = img[:, mid:]
        
        # P1
        mp_p1 = Image(image_format=ImageFormat.SRGB, data=img_left)
        res1 = pose.detect(mp_p1)
        p1_data = _empty_person()
        if res1.pose_landmarks:
            p1_raw = format_p(res1.pose_landmarks[0])
            p1_data = _adjust_coords(p1_raw, scale_x=0.5, offset_x=0.0)

        # P2
        mp_p2 = Image(image_format=ImageFormat.SRGB, data=img_right)
        res2 = pose.detect(mp_p2)
        p2_data = _empty_person()
        if res2.pose_landmarks:
            p2_raw = format_p(res2.pose_landmarks[0])
            p2_data = _adjust_coords(p2_raw, scale_x=0.5, offset_x=0.5)
            
        state = DetectionState(p1_data, p2_data)
    else:
        # SINGLE PLAYER FIX: Ensure p1_data is fully populated and adjusted
        mp_img = Image(image_format=ImageFormat.SRGB, data=img)
        res = pose.detect(mp_img)
        if res.pose_landmarks:
            p1_raw = format_p(res.pose_landmarks[0])
            # Call adjust_coords with scale 1.0 to get the 'width' property!
            p1_data = _adjust_coords(p1_raw, scale_x=1.0, offset_x=0.0)
        else:
            p1_data = _empty_person()
            
        state = DetectionState(p1_data, _empty_person())

    _room_histories[room_id] = state
    return state