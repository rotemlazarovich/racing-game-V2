import socketio
import eventlet
import base64
import cv2
import numpy as np
import mediapipe as mp

# Initialize MediaPipe Pose
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(static_image_mode=False, min_detection_confidence=0.5)

sio = socketio.Server(cors_allowed_origins='*')
app = socketio.WSGIApp(sio)

@sio.on('video_frame')
def handle_video_frame(sid, data):
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
                r_shoulder_y = results.pose_landmarks.landmark[12].y
                r_wrist_y = results.pose_landmarks.landmark[16].y
                
                # Debugging output
                print(f"Wrist: {r_wrist_y:.2f} | Shoulder: {r_shoulder_y:.2f}")

                if r_wrist_y > (r_shoulder_y - 0.1): # Added a "Buffer" of 0.1
                    print("🙌 ACTION: Right Hand Raised!")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    print("🚀 Pose Server Running...")
    eventlet.wsgi.server(eventlet.listen(('0.0.0.0', 5000)), app)