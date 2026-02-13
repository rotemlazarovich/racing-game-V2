import os
import sys
import cv2
import base64
import numpy as np
import socket
import webbrowser
import mediapipe as mp
import socketio
import uvicorn
from threading import Timer
from fastapi import FastAPI
from fastapi.responses import FileResponse

# --- PYINSTALLER PATH FIX ---
def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# --- AI INITIALIZATION ---
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(static_image_mode=False, min_detection_confidence=0.5)

# --- GLOBAL STATE ---
hand_is_currently_up = False
first_frame_received = False

# --- NETWORK HELPERS ---
def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

# --- SERVER SETUP ---
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()
socket_app = socketio.ASGIApp(sio, app)

@app.get("/")
async def get_index():
    return FileResponse(resource_path('index.html'))

@sio.on('get_ip')
async def handle_get_ip(sid):
    ip_addr = f"http://{get_local_ip()}:5000"
    await sio.emit('server_ip', {'ip': ip_addr}, to=sid)

@sio.on('video_frame')
async def handle_video(sid, data):
    global hand_is_currently_up, first_frame_received
    
    if not first_frame_received:
        await sio.emit('video_frame_received')
        first_frame_received = True
        print("🎉 First frame received! QR hidden.")

    try:
        encoded_data = data['image']
        # 1. Check if data is actually there
        if not encoded_data or len(encoded_data) < 100:
            print("⚠️ Received empty or tiny image string")
            return

        nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            print("❌ OpenCV failed to decode the image")
            return

        # 2. Process AI
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose.process(rgb_frame)

        if results.pose_landmarks:
            wrist = results.pose_landmarks.landmark[16]
            shoulder = results.pose_landmarks.landmark[12]
            
            # This will print EVERY frame. It will be fast, but we need to see it.
            print(f"Tracking: Wrist Y={wrist.y:.2f} Shoulder Y={shoulder.y:.2f} Vis={wrist.visibility:.2f}")

            # Switch back to Y logic for a second just to test vertical movement
            is_triggered = (wrist.x > (shoulder.x - 0.1)) and (wrist.visibility > 0.5)

            if is_triggered != hand_is_currently_up:
                hand_is_currently_up = is_triggered
                action = "up" if is_triggered else "down"
                await sio.emit('game_action', {'action': action})
                print(f"🚀 ACTION SENT: {action.upper()}")
        else:
            # This prints if the AI is working but doesn't see a human body
            print("👤 No person detected in frame")

    except Exception as e:
        # VERY IMPORTANT: Stop hiding errors!
        print(f"🔥 Processing Error: {e}")

def open_browser():
    webbrowser.open_new("http://localhost:5000")

@sio.on('connect')
async def on_connect(sid, environ):
    print(f"✅ Device Connected: {sid}")

if __name__ == '__main__':
    print(f"🚀 Starting Server on {get_local_ip()}...")
    Timer(2.0, open_browser).start()
    uvicorn.run(socket_app, host="0.0.0.0", port=5000, log_level="error")
