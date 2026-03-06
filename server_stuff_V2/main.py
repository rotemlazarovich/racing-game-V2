"""
Python server: receives video from Flutter app via Socket.IO,
runs pose detection, serves HTML UI and pushes state to browsers.
"""
import base64
import io
import socket
from collections import defaultdict
import random

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
    """Return a data URL for a QR code PNG, or None if qrcode is not installed."""
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

# room_id -> set of session ids (all clients in room; mobile + browsers)
rooms: dict[str, set[str]] = defaultdict(set)
# room_id -> last detection state (for new browser joins)
room_state: dict[str, DetectionState] = {}
# throttle log: log every N frames per room
_frame_log_count: dict[str, int] = defaultdict(int)


# 1. The Landing Page (Gallery)
@app.route("/")
def gallery_page():  # Renamed from index
    return render_template("gallery.html", games=GAMES)

# 2. The Mode Selection (Single/Multi)
@app.route("/setup/<game_id>")
def setup_page(game_id):
    return render_template("setup.html", game_id=game_id)

# 3. The Logic that redirects to the actual game
@app.route("/play/<game_id>/<mode>")
def play_redirect(game_id, mode):
    base_id = random.randint(1000, 9998)
    if mode == "single":
        room_id = base_id if base_id % 2 != 0 else base_id + 1
    else:
        room_id = base_id if base_id % 2 == 0 else base_id + 1
    
    # This sends the user to the specific game route
    return redirect(url_for(f"game_{game_id}", room_id=room_id))

# 4. The Specific Game Routes
@app.route("/game/racing")
def game_racing():
    room_id = request.args.get("room_id", "0000") # Default if missing
    host = get_local_ip()
    url = f"http://{host}:5000?room={room_id}"
    qr_data = qr_image_data_url(url)
    
    # IMPORTANT: All variables used in HTML must be listed here
    return render_template("racing.html", 
                           room_id=room_id, 
                           qr_data_url=qr_data,
                           url=url)

@app.route("/game/skiing")
def game_skiing():
    room_id = request.args.get("room_id")
    return render_template("skiing.html", room_id=room_id)

@socketio.on("connect")
def on_connect():
    pass

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    for r in list(rooms.keys()):
        rooms[r].discard(sid)
        if not rooms[r]:
            del rooms[r]
            room_state.pop(r, None)


@socketio.on("join_room")
def on_join_room(data):
    room_id = data.get("room_id") or data.get("room")
    client_type = data.get("type", "browser")
    if not room_id:
        return
    join_room(room_id)
    rooms[room_id].add(request.sid)
    if room_id in room_state:
        socketio.emit("detection_state", room_state[room_id].to_dict(), room=request.sid)


@socketio.on("video_frame")
def on_video_frame(data):
    room_id = data.get("room_id") or data.get("room")
    image_b64 = data.get("image")
    if not room_id or not image_b64:
        return
    # Log occasionally so we can see frames + room size (helps debug "no video in browser")
    _frame_log_count[room_id] += 1
    if _frame_log_count[room_id] == 1 or _frame_log_count[room_id] % 100 == 0:
        n = len(rooms.get(room_id, set()))
        print(f"[video] room={room_id!r} clients={n} frames={_frame_log_count[room_id]}")
    # Emit video to browser first so the stream never blocks on detection
    socketio.emit("video_frame", {"image": image_b64}, room=room_id)
    try:
        state = process_frame(image_b64, room_id)
        room_state[room_id] = state
        socketio.emit("detection_state", state.to_dict(), room=room_id)
    except Exception as e:
        from flask import current_app
        current_app.logger.warning("Detection failed: %s", e)
        default = DetectionState(
            left_person=False, left_hand_raised=False,
            right_person=False, right_hand_raised=False,
        )
        room_state[room_id] = default
        socketio.emit("detection_state", default.to_dict(), room=room_id)


@app.route("/")
def index():
    room = request.args.get("room", "").strip()
    if room:
        return redirect(url_for("room", room_id=room), code=302)
    return render_template("index.html", room_id=None)


@app.route("/qr")
def qr_page():
    """Show a QR code for the server URL so the phone app can scan it."""
    room = request.args.get("room", "").strip() or "default"
    port = 5000
    host = get_local_ip()
    url = f"http://{host}:{port}?room={room}"
    qr_data = qr_image_data_url(url)
    display_url = url_for("room", room_id=room, _external=False)
    return render_template(
        "qr.html",
        room_id=room,
        url=url,
        qr_data_url=qr_data,
        display_url=display_url,
        has_qrcode=HAS_QRCODE,
    )


@app.route("/room/<room_id>")
def room(room_id):
    return render_template("index.html", room_id=room_id)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
