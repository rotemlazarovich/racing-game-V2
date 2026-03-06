const socket = io();
const roomId = window.ROOM_ID || "";
const isMultiplayer = parseInt(roomId) % 2 === 0;

let gameStarted = false;
let startTimer = 0;
const REQUIRED_TIME = 2000; // 2 seconds to start

socket.on('connect', () => {
    if (roomId) {
        console.log("✅ Socket Connected. Joining Room:", roomId);
        socket.emit('join_room', { room_id: roomId, type: 'browser' });
    }
});

// THIS IS THE MAIN DATA LOOP
socket.on('detection_state', function(data) {
    if (!data) return;

    // 1. Handle Lobby/Overlay Visibility
    const menu = document.getElementById('game-menu');
    const wait = document.getElementById('waiting-msg');
    const conn = document.getElementById('connection-overlay');
    
    if (menu) menu.style.display = 'block';
    if (wait) wait.style.display = 'none';
    if (conn) conn.style.display = 'none';

    // 2. Update Video Feed (if on the lobby page)
    const feed = document.getElementById('video-feed');
    if (feed && data.image) {
        feed.src = 'data:image/jpeg;base64,' + data.image;
    }

    // 3. Handle the "Ready" Countdown
    const readyOverlay = document.getElementById('ready-overlay');
    if (readyOverlay && !gameStarted) {
        readyOverlay.style.display = 'flex';
        
        // Logic: P1 must raise hand. In Multi, both must raise hands.
        const p1Ready = data.left && data.left.handRaised;
        const p2Ready = data.right && data.right.handRaised;
        const readyCondition = isMultiplayer ? (p1Ready && p2Ready) : p1Ready;
        
        if (readyCondition) {
            startTimer += 50; 
            const progress = (startTimer / REQUIRED_TIME) * 100;
            document.getElementById('countdown-progress').style.width = progress + '%';
            
            if (startTimer >= REQUIRED_TIME) {
                console.log("🏁 STARTING GAME!");
                gameStarted = true;
                readyOverlay.style.display = 'none';
                // This calls the start function in racing.js
                if (typeof initCurrentGame === 'function') {
                    initCurrentGame(isMultiplayer);
                }
            }
        } else {
            startTimer = 0;
            const bar = document.getElementById('countdown-progress');
            if (bar) bar.style.width = '0%';
        }
    }

    // 4. THE BRIDGE: Send data to racing.js every single frame
    if (gameStarted && typeof updateCurrentGame === 'function') {
        updateCurrentGame(data);
    }
});