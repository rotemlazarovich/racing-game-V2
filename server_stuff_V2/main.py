import base64
import io
import socket
import random
from collections import defaultdict

try:
    import qrcode
    HAS_QRCODE = True
except ImportError:
    HAS_QRCODE = False

from flask import Flask, render_template, request, redirect, url_for
from flask_socketio import SocketIO, join_room

from detection import process_frame, DetectionState

GAMES = [
    {"id": "racing", "name": "Racing Game", "image": "racing.jpg"},
    {"id": "skiing", "name": "Skiing Game", "image": "skiing.jpg"}
]

def get_local_ip() -> str:
    """Get this machine's LAN IP so the phone can connect."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def qr_image_data_url(url: str, size: int = 320) -> str | None:
    """Return a data URL for a QR code PNG."""
    if not HAS_QRCODE:
        return None
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    img = img.resize((size, size))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("ascii")
    return f"data:image/png;base64,{b64}"

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SECRET_KEY"] = "rotem-secret"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

rooms = defaultdict(set)
room_state = {}
_frame_log_count = defaultdict(int)

@app.route("/")
def gallery_page():
    return render_template("gallery.html", games=GAMES)

@app.route("/setup/<game_id>")
def setup_page(game_id):
    return render_template("setup.html", game_id=game_id)

@app.route("/play/<game_id>/<mode>")
def play_redirect(game_id, mode):
    base_id = random.randint(1000, 9998)
    if mode == "single":
        room_id = base_id if base_id % 2 != 0 else base_id + 1
    else:   
        room_id = base_id if base_id % 2 == 0 else base_id + 1
    return redirect(url_for(f"game_{game_id}", room_id=room_id))

@app.route("/game/racing")
def game_racing():
    room_id = request.args.get("room_id", "0000")
    host = get_local_ip()
    url = f"http://{host}:5000?room={room_id}"
    qr_data = qr_image_data_url(url)
    return render_template("racing.html", room_id=room_id, qr_data_url=qr_data, url=url)

@app.route("/game/skiing")
def game_skiing():
    room_id = request.args.get("room_id")
    return render_template("skiing.html", room_id=room_id)

@app.route("/qr")
def qr_page():
    room = request.args.get("room", "").strip() or "default"
    host = get_local_ip()
    url = f"http://{host}:5000?room={room}"
    qr_data = qr_image_data_url(url)
    return render_template("qr.html", room_id=room, url=url, qr_data_url=qr_data)

@socketio.on("join_room")
def on_join_room(data):
    room_id = data.get("room_id") or data.get("room")
    if not room_id:
        return
    join_room(room_id)
    rooms[room_id].add(request.sid)

_processing_rooms = {}
@socketio.on("video_frame")
def on_video_frame(data):
    global _processing_rooms
    room_id = data.get("room_id") or data.get("room")
    image_b64 = data.get("image")
    
    if not room_id or not image_b64:
        return

    # 1. LAG PREVENTION: If this room is already processing a frame, 
    # ignore this incoming one to prevent a "traffic jam."
    if _processing_rooms.get(room_id, False):
        return 

    try:
        # Mark room as busy
        _processing_rooms[room_id] = True 
        
        # This processes the frame and identifies P1/P2
        state = process_frame(image_b64, room_id)
        
        # Save the result to your global room state
        room_state[room_id] = state
        
        # Send the detection results back to the game
        socketio.emit("detection_state", state.to_dict(), room=room_id)

    except Exception as e:
        print(f"Detection failed for room {room_id}: {e}")
        # Send empty state so the game doesn't crash on null data
        empty = {"active": False, "handRaised": False, "left": {'x':0.5,'y':0.5}, "right": {'x':0.5,'y':0.5}}
        socketio.emit("detection_state", {"p1": empty, "p2": empty}, room=room_id)

    finally:
        # 3. RELEASE: Room is now ready for a new frame
        _processing_rooms[room_id] = False

if __name__ == "__main__":
    print(f"Server starting on http://{get_local_ip()}:5000")
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)