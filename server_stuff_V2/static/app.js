// Initialize Socket connection
const socket = io();

// Ensure the room ID is loaded
const roomId = window.ROOM_ID || "0000";

socket.on('connect', () => {
    console.log("✅ Socket Connected! Joining Room:", roomId);
    // Tell the server we are a browser in this specific room
    socket.emit('join_room', { room_id: roomId, type: 'browser' });
});

socket.on('detection_state', function(data) {
    if (!data) return;

    // --- A. AUTO-HIDE QR CODE ---
    // If we get any data at all, the phone is connected. Hide the overlay.
    const overlay = document.getElementById('connection-overlay');
    if (overlay && overlay.style.display !== 'none') {
        overlay.style.display = 'none';
        console.log("📱 Controller connected! Hiding QR.");
    }

    // --- B. UPDATE INDICATOR LIGHTS ---
    const p1Light = document.getElementById('p1-indicator');
    const p2Light = document.getElementById('p2-indicator');

    // Update Player 1 (Left Half)
    if (p1Light) {
        if (data.left.handRaised) {
            p1Light.style.backgroundColor = '#00ff64';
            p1Light.style.boxShadow = '0 0 15px #00ff64';
        } else {
            p1Light.style.backgroundColor = data.left.person ? '#ffbb00' : '#444';
            p1Light.style.boxShadow = 'none';
        }
    }

    // Update Player 2 (Right Half)
    if (p2Light) {
        if (data.right.handRaised) {
            p2Light.style.backgroundColor = '#00ff64';
            p2Light.style.boxShadow = '0 0 15px #00ff64';
        } else {
            p2Light.style.backgroundColor = data.right.person ? '#ffbb00' : '#444';
            p2Light.style.boxShadow = 'none';
        }
    }

    // --- C. OPTIONAL VIDEO FEED ---
    const videoFeed = document.getElementById('video-feed');
    if (videoFeed && data.image) {
        videoFeed.src = 'data:image/jpeg;base64,' + data.image;
    }
});

// Log any connection errors to help debug
socket.on('connect_error', (err) => {
    console.error("❌ Socket Connection Error:", err.message);
});