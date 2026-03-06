
Python server: receives camera frames from the Flutter app via Socket.IO, runs pose detection (MediaPipe), and serves the HTML UI on localhost.

## Setup

```bash
cd server
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

## Run

```bash
python main.py
```

Server listens on `http://0.0.0.0:5000` (all interfaces so the phone can connect on your LAN).

## Usage

1. **Open the server in your browser**  
   Go to `http://localhost:5000/` (or `http://<YOUR_PC_IP>:5000/` from another device).

2. **Show the QR code**  
   Click **“Show QR code”**. The page shows a QR code for a room (default room name is `default`). You can change the room name and click “Show QR” to refresh.

3. **Phone (Flutter app)**  
   Open the Rotem app and scan the QR code. The app will connect and stream the camera to that room.

4. **Display on the big screen**  
   On the same QR page, click **“Open display for this room”**, or go to `http://localhost:5000/room/myroom` (use the same room name). You’ll see the live feed, vertical split, and green frame/tint when someone is detected or raises their right hand.

## Troubleshooting

- **Video not showing in browser** – Restart the server after code changes. The server sends the video stream before running detection, so the feed should appear even if pose detection fails.
- **`mediapipe` has no attribute `solutions`** – Detection now supports MediaPipe 0.10.30+ (Tasks API). Reinstall: `pip install mediapipe`. On first run with the new API, the pose model is downloaded once to `server/.cache/`.
