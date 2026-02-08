import time
import socketio
import eventlet
import base64
import cv2
import numpy as np
import mediapipe as mp

hand_is_currently_up = False

# Initialize MediaPipe Pose
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(static_image_mode=False, min_detection_confidence=0.5)

sio = socketio.Server(cors_allowed_origins='*')
app = socketio.WSGIApp(sio)

@sio.on('video_frame')
def handle_video_frame(sid, data):
    global hand_is_currently_up
    try:
        # 1. Decode Image
        img_bytes = base64.b64decode(data['image'])
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is not None:
            # 2. Process with MediaPipe
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(rgb_frame)

            if results.pose_landmarks:
                wrist = results.pose_landmarks.landmark[16]
                shoulder = results.pose_landmarks.landmark[12]

                # NEW: Check if the hand is actually visible in the frame
                # If visibility is low (< 0.5), we treat it as "not there"
                is_visible = wrist.visibility > 0.5

                # Original coordinate check
                is_above = wrist.x > (shoulder.x - 0.1)
                # print(f"wrist.y: {wrist.y}, shoulder.y: {shoulder.y}")
                # FINAL LOGIC: Must be visible AND above shoulder
                currently_up = is_visible and is_above

                # Only send a message if the state changed to save bandwidth
                if currently_up != hand_is_currently_up:
                    hand_is_currently_up = currently_up
                    status = "up" if currently_up else "down"
                    sio.emit('game_action', {'action': status})
                    print(f"State Changed: {status}")
            else:
                # If no person is detected at all, force state to down
                if hand_is_currently_up:
                    hand_is_currently_up = False
                    sio.emit('game_action', {'action': 'down'})
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    print("🚀 Pose Server Running...")
    eventlet.wsgi.server(eventlet.listen(('0.0.0.0', 5000)), app)