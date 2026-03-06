import sys, os, base64, cv2, socketio, uvicorn, socket, asyncio
import numpy as np
import mediapipe as mp
from collections import deque
from fastapi import FastAPI
from fastapi.responses import FileResponse

# --- MODEL CONFIG ---
BaseOptions = mp.tasks.BaseOptions
PoseLandmarker = mp.tasks.vision.PoseLandmarker
PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

class LandmarkBuffer:
    def __init__(self): 
        self.wrist_y = deque(maxlen=10)
        self.shoulder_y = deque(maxlen=10)
        self.grace_period = 0
        self.max_grace = 45 # 1.5 seconds of "memory" to stop the searching loop

    def add(self, wrist, shoulder):
        self.wrist_y.append(wrist)
        self.shoulder_y.append(shoulder)
        self.grace_period = self.max_grace

    def is_active(self):
        if self.grace_period > 0:
            self.grace_period -= 1
            return True
        return False

    def is_up(self):
        if len(self.wrist_y) < 3: return False
        return (sum(self.wrist_y)/len(self.wrist_y)) < (sum(self.shoulder_y)/len(self.shoulder_y) - 0.04)

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()
app.mount("/socket.io", socketio.ASGIApp(sio))

# "Full" is generally better for static people than "Heavy" which expects motion
model_path = os.path.abspath('pose_landmarker_full.task') 
options = PoseLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=model_path),
    running_mode=VisionRunningMode.VIDEO,
    num_poses=2, 
    min_pose_detection_confidence=0.1, 
    min_pose_presence_confidence=0.1,
    min_tracking_confidence=0.1
)
landmarker = PoseLandmarker.create_from_options(options)

rooms, client_buffers, frame_counter = {}, {}, 0
processing_lock = asyncio.Lock()

@app.get("/")
async def get_index(): return FileResponse("index.html")

@sio.on("join_room")
async def handle_join(sid, data):
    rid = data.get("room_id")
    rooms[sid] = rid
    await sio.enter_room(sid, rid)
    client_buffers[rid] = {"p1": LandmarkBuffer(), "p2": LandmarkBuffer()}

@sio.on("video_frame")
async def handle_video(sid, data):
    global frame_counter
    if processing_lock.locked(): return 
    async with processing_lock:
        rid = rooms.get(sid)
        if not (rid and data.get("image")): return
        bufs = client_buffers.get(rid)

        try:
            nparr = np.frombuffer(base64.b64decode(data.get("image")), np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            frame = cv2.flip(frame, 1)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            
            frame_counter += 1
            result = landmarker.detect_for_video(mp_img, int(frame_counter * 33))

            out = {
                "p1": {"state": "down", "vis": 0.0, "pres": 0.0, "active": False},
                "p2": {"state": "down", "vis": 0.0, "pres": 0.0, "active": False}
            }

            if result.pose_landmarks:
                for pose in result.pose_landmarks:
                    # REVERT: Only use the Nose and Shoulders for confidence
                    # This is key for half-body detection
                    v_score = pose[0].visibility 
                    p_score = pose[0].presence
                    
                    cx = (pose[11].x + pose[12].x) / 2
                    target = "p1" if cx < 0.5 else "p2"

                    bufs[target].add(pose[15].y, pose[11].y)
                    out[target].update({"vis": round(v_score, 4), "pres": round(p_score, 4)})

            for pid in ["p1", "p2"]:
                out[pid]["active"] = bufs[pid].is_active()
                out[pid]["state"] = "up" if bufs[pid].is_up() else "down"

            await sio.emit("game_action", out, room=rid)
        except Exception as e: print(f"Error: {e}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5000)