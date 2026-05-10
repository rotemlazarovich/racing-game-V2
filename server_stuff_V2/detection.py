import base64
import os
import sys
import cv2
import numpy as np
from dataclasses import dataclass
from collections import defaultdict
import math

_pose = None
_pose_unavailable = False
_is_tasks_api = False 

_L_SHOULDER, _R_SHOULDER = 11, 12
_L_WRIST, _R_WRIST = 15, 16
_NOSE = 0
_L_HIP, _R_HIP = 23, 24
_hand_history = defaultdict(lambda: [False, False]) # To track [P1_Raised, P2_Raised]
_persistence_counters = defaultdict(lambda: [0, 0])
SMOOTHING_THRESHOLD = 3

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
            num_poses=2,  # CRITICAL: Allow 2 people in one frame
            min_pose_detection_confidence=0.4,
            min_pose_presence_confidence=0.4,
            min_tracking_confidence=0.4
        )
        _pose = vision.PoseLandmarker.create_from_options(options)
        _is_tasks_api = True
        return _pose
    except Exception as e:
        print(f"MediaPipe Error: {e}")
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
        "scale": 1.0,
        "handRaised": False, 
        "width": 0.2,
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

def format_p(landmarks):
    # 1. RACING DATA (Wrists & Shoulders)
    lw, ls = landmarks[_L_WRIST], landmarks[_L_SHOULDER]
    rw, rs = landmarks[_R_WRIST], landmarks[_R_SHOULDER]
    
    # Racing Hand Raise (Lenient +0.1)
    hand_raised = (rw.y < rs.y + 0.1) or (lw.y < ls.y + 0.1)
    # Racing Width (Shoulder to Shoulder)
    shoulder_width = abs(ls.x - rs.x)

    # 2. SKIING DATA (Nose & Hips)
    nose = landmarks[_NOSE]
    l_hip, r_hip = landmarks[_L_HIP], landmarks[_R_HIP]
    mid_hip_x = (l_hip.x + r_hip.x) / 2
    mid_hip_y = (l_hip.y + r_hip.y) / 2
    
    # Calculate Lean Angle
    # atan2(x_diff, y_diff). We use -dy because Y increases downwards.
    dx = nose.x - mid_hip_x
    dy = nose.y - mid_hip_y
    lean_angle = dx

    return {
        "active": True,
        "x": mid_hip_x, # Center of gravity
        "handRaised": hand_raised,
        "width": shoulder_width,
        "leanAngle": lean_angle,
        "left": {"wrist": {'x': lw.x, 'y': lw.y}, "shoulder": {'x': ls.x, 'y': ls.y}},
        "right": {"wrist": {'x': rw.x, 'y': rw.y}, "shoulder": {'x': rs.x, 'y': rs.y}},
        "nose": {'x': nose.x, 'y': nose.y},
        "hips": {'x': mid_hip_x, 'y': mid_hip_y}
    }

_presence_counters = defaultdict(lambda: [0, 0]) # [P1_frames, P2_frames]
PRESENCE_GRACE_PERIOD = 5 # How many frames to "remember" a missing player

def process_frame(image_b64: str, room_id: str) -> DetectionState:
    global LAST_UPDATE_TIME, _room_histories, _presence_counters
    
    pose = _get_pose()
    img = _decode_image(image_b64)
    if img is None or not pose: 
        return _room_histories.get(room_id, DetectionState(_empty_person(), _empty_person()))

    from mediapipe.tasks.python.vision.core.image import Image, ImageFormat
    mp_img = Image(image_format=ImageFormat.SRGB, data=img)
    result = pose.detect(mp_img)

    # Get last known state to compare
    last_state = _room_histories.get(room_id, DetectionState(_empty_person(), _empty_person()))
    
    raw_detected = []
    if result.pose_landmarks:
        for landmarks in result.pose_landmarks:
            p = format_p(landmarks)
            p['real_width'] = abs(p['left']['shoulder']['x'] - p['right']['shoulder']['x'])
            raw_detected.append(p)

    # Sort candidates by Camera-X (Left to Right)
    raw_detected.sort(key=lambda p: p['x'])

    # Temporary holders for this frame
    current_p1 = _empty_person()
    current_p2 = _empty_person()

    # --- INTELLIGENT ASSIGNMENT ---
    if len(raw_detected) >= 2:
            # MULTI-PLAYER: Split the camera 50/50
            current_p2 = _prepare_player(raw_detected[0], scale_x=0.5, offset_x=0.5)
            current_p2['scale'] = 0.5
            current_p1 = _prepare_player(raw_detected[1], scale_x=0.5, offset_x=0.0)
            current_p1['scale'] = 0.5
            _presence_counters[room_id] = [PRESENCE_GRACE_PERIOD, PRESENCE_GRACE_PERIOD]

    elif len(raw_detected) == 1:
        # SINGLE-PLAYER: Assign the solo player to P1 with the FULL coordinate range
        # This allows you to stand anywhere and move across the whole screen.
        lone_person = raw_detected[0]
        current_p1 = _prepare_player(lone_person, scale_x=1.0, offset_x=0.0)
        current_p1['scale'] = 1.0
        _presence_counters[room_id][0] = PRESENCE_GRACE_PERIOD
        
        # P2 stays empty
        current_p2 = _empty_person()
        current_p2['scale'] = 1.0

    # --- APPLY GRACE PERIOD ---
    # If the counter for a player hits 0, they finally become "inactive"
    for i, p_data in enumerate([current_p1, current_p2]):
        if _presence_counters[room_id][i] > 0:
            _presence_counters[room_id][i] -= 1
            p_data['active'] = True # Force active during grace period
        else:
            p_data['active'] = False

    # Apply the hand-raised smoothing we built earlier
    final_p1 = _apply_smoothing(current_p1, room_id, 0)
    final_p2 = _apply_smoothing(current_p2, room_id, 1)

    state = DetectionState(final_p1, final_p2)
    _room_histories[room_id] = state
    return state

def _prepare_player(person, scale_x, offset_x):
    """ Scales X for split-screen compatibility across ALL points """
    for side in ['left', 'right']:
        person[side]['wrist']['x'] = (person[side]['wrist']['x'] * scale_x) + offset_x
        person[side]['shoulder']['x'] = (person[side]['shoulder']['x'] * scale_x) + offset_x
    
    # CRITICAL FIX 1: Scale the nose so Skiing lean math works properly
    person['nose']['x'] = (person['nose']['x'] * scale_x) + offset_x
    
    # CRITICAL FIX 2: Scale the waist (hips) center for proper steering 
    person['x'] = (person['hips']['x'] * scale_x) + offset_x
    
    person['width'] = person.get('real_width', 0.2) 
    return person



def _apply_smoothing(p_data, room_id, p_idx):
    """ Prevents the loading bar from flickering if a frame is dropped """
    global _persistence_counters
    
    current_raised = p_data.get('handRaised', False)
    
    if current_raised:
        _persistence_counters[room_id][p_idx] = SMOOTHING_THRESHOLD
        p_data['handRaised'] = True
    else:
        if _persistence_counters[room_id][p_idx] > 0:
            _persistence_counters[room_id][p_idx] -= 1
            p_data['handRaised'] = True # Keep it raised during grace period
        else:
            p_data['handRaised'] = False
            
    return p_data