import sys, os, base64, cv2, socketio, uvicorn, webbrowser, socket, asyncio, time
import numpy as np
import mediapipe as mp
from collections import deque

# --- VERSION-PROOF IMPORTS ---
try:
    BaseOptions = mp.tasks.BaseOptions
    PoseLandmarker = mp.tasks.vision.PoseLandmarker
    PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
    VisionRunningMode = mp.tasks.vision.RunningMode
except AttributeError:
    from mediapipe.tasks.python import vision
    PoseLandmarker = vision.PoseLandmarker
    PoseLandmarkerOptions = vision.PoseLandmarkerOptions
    VisionRunningMode = vision.RunningMode
    BaseOptions = mp.tasks.BaseOptions

from fastapi import FastAPI
from fastapi.responses import FileResponse

# --- BUFFER CLASS ---
class LandmarkBuffer:
    def __init__(self, buffer_size=3):
        self.wrist_y = deque(maxlen=buffer_size)
        self.shoulder_y = deque(maxlen=buffer_size)

    def add(self, wrist, shoulder):
        self.wrist_y.append(wrist)
        self.shoulder_y.append(shoulder)

    def is_up(self):
        if len(self.wrist_y) < 2: return False
        avg_wrist = sum(self.wrist_y) / len(self.wrist_y)
        avg_shoulder = sum(self.shoulder_y) / len(self.shoulder_y)
        
        # Threshold: wrist is 5% above shoulder
        threshold = 0.05 
        return avg_wrist < (avg_shoulder - threshold)

def resource_path(relative_path):
    try: base_path = sys._MEIPASS
    except Exception: base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()
app.mount("/socket.io", socketio.ASGIApp(sio))

# --- SETUP LANDMARKER ---
model_path = resource_path('pose_landmarker_lite.task')
if not os.path.exists(model_path):
    print(f"❌ ERROR: Model file not found at {model_path}")
    sys.exit(1)

options = PoseLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=model_path),
    running_mode=VisionRunningMode.VIDEO,
    num_poses=1, # ROI Split means only 1 person per side
    min_pose_detection_confidence=0.7,
    min_pose_presence_confidence=0.5,
    min_tracking_confidence=0.5
)
landmarker = PoseLandmarker.create_from_options(options)

rooms = {}
client_buffers = {}
# Counter to guarantee monotonically increasing timestamps
frame_counter = 0

@app.get("/")
async def get_index(): return FileResponse(resource_path("index.html"))

@sio.on("join_room")
async def handle_join(sid, data):
    room_id = data.get("room_id")
    rooms[sid] = room_id
    await sio.enter_room(sid, room_id)
    client_buffers[room_id] = {"p1": LandmarkBuffer(), "p2": LandmarkBuffer()}
    print(f"Device joined room: {room_id}")

@sio.on("video_frame")
async def handle_video(sid, data):
    global frame_counter
    room_id = rooms.get(sid)
    if not room_id or not data.get("image"): return
    if room_id not in client_buffers: return

    try:
        nparr = np.frombuffer(base64.b64decode(data.get("image")), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None: return

        # Mirror the image
        frame = cv2.flip(frame, 1)
        h, w, _ = frame.shape
        
        # --- ROI SEGMENTATION ---
        # Split the image in half vertically
        left_half = frame[:, :w//2]
        right_half = frame[:, w//2:]

        p1_buf = client_buffers[room_id]["p1"]
        p2_buf = client_buffers[room_id]["p2"]
        p1_found, p2_found = False, False
        
        # Increment counter to prevent timestamp error
        frame_counter += 1
        
        # --- PROCESS LEFT SIDE (P1) ---
        mp_image_l = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(left_half, cv2.COLOR_BGR2RGB))
        timestamp_l = frame_counter * 2 
        results_l = landmarker.detect_for_video(mp_image_l, timestamp_l)
        
        if results_l.pose_landmarks:
            for landmarks in results_l.pose_landmarks:
                wrist = landmarks[15] # Left Wrist
                shoulder = landmarks[11] # Left Shoulder
                p1_buf.add(wrist.y, shoulder.y)
                p1_found = True

        # --- PROCESS RIGHT SIDE (P2) ---
        mp_image_r = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(right_half, cv2.COLOR_BGR2RGB))
        timestamp_r = (frame_counter * 2) + 1 
        results_r = landmarker.detect_for_video(mp_image_r, timestamp_r)
        
        if results_r.pose_landmarks:
            for landmarks in results_r.pose_landmarks:
                wrist = landmarks[15] # Left Wrist
                shoulder = landmarks[11] # Left Shoulder
                p2_buf.add(wrist.y, shoulder.y)
                p2_found = True

        # Determine status
        final_p1 = "up" if p1_buf.is_up() else "down"
        final_p2 = "up" if p2_buf.is_up() else "down"
        
        # Reset buffers if person not found
        if not p1_found: p1_buf.wrist_y.clear()
        if not p2_found: p2_buf.wrist_y.clear()

        await sio.emit("game_action", {"p1": final_p1, "p2": final_p2}, room=room_id)

    except Exception as e:
        print(f"Error: {e}")

@sio.on("disconnect")
async def handle_disconnect(sid):
    if sid in rooms:
        room_id = rooms[sid]
        del rooms[sid]
        if room_id in client_buffers: del client_buffers[room_id]
        if len(rooms) == 0:
            await asyncio.sleep(2)
            if len(rooms) == 0: os._exit(0)

def get_network_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

if __name__ == "__main__":
    host_ip = get_network_ip()
    port = 5000
    url = f"http://{host_ip}:{port}"
    
    print(f"🚀 Server running at {url}")
    print(f"Make sure 'pose_landmarker_lite.task' is in this folder!")
    
    webbrowser.open(url)
    
    uvicorn.run(app, host="0.0.0.0", port=port)