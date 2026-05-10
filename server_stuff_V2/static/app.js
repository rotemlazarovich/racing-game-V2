const socket = io();
const roomId = window.ROOM_ID || "";
const isMultiplayer = parseInt(roomId) % 2 === 0;

let p1Data = { active: false, x: 0.5, width: 0.2, left: {shoulder:{x:0.5, y:0.5}, wrist:{x:0.5, y:0.5}}, right: {shoulder:{x:0.5, y:0.5}, wrist:{x:0.5, y:0.5}} };
let p2Data = { active: false, x: 0.5, width: 0.2, left: {shoulder:{x:0.5, y:0.5}, wrist:{x:0.5, y:0.5}}, right: {shoulder:{x:0.5, y:0.5}, wrist:{x:0.5, y:0.5}} };
let lastFrameTime = Date.now();
let fps = 0;
let firstReadyTime = 0; 
let lastReadyTime = 0;
let gameStarted = false;
let startTimer = 0;
const REQUIRED_TIME = 5000; 

socket.on('connect', () => {
    if (roomId) {
        console.log("✅ Socket Connected. Joining Room:", roomId);
        socket.emit('join_room', { room_id: roomId, type: 'browser' });
    }
});


socket.on('detection_state', function(data) {
    if (!data) return;
    const now = Date.now();

    const connOverlay = document.getElementById('connection-overlay');
    const readyOverlay = document.getElementById('ready-overlay');
    const progressBar = document.getElementById('countdown-progress');
    const statusText = document.getElementById('ready-status');

    // 1. Transition from QR to Lobby
    if (connOverlay) connOverlay.style.display = 'none';
    if (readyOverlay && !gameStarted) {
        readyOverlay.style.setProperty('display', 'flex', 'important');
    }

    // 2. Identify Players (Based on your console logs)
    const p1Ready = !!(data.p1 && data.p1.handRaised === true);
    const p2Ready = isMultiplayer ? !!(data.p2 && data.p2.handRaised === true) : true;
    
    p1Data = data.p1;
    p2Data = data.p2;

    if (!gameStarted) {
        if (p1Ready && p2Ready) {
            if (firstReadyTime === 0) firstReadyTime = now - startTimer;
            startTimer = now - firstReadyTime;
        } else {
            startTimer = Math.max(0, startTimer - 50); 
            firstReadyTime = now - startTimer;
        }

        // 3. Update Visuals
        if (progressBar) {
            const progress = (startTimer / 5000) * 100;
            progressBar.style.width = Math.min(progress, 100) + "%";
        }

        if (statusText) {
            const seconds = Math.ceil((5000 - startTimer) / 1000);
            statusText.innerText = startTimer > 0 ? `STARTING IN ${seconds}...` : "RAISE HANDS TO START";
        }

        if (startTimer >= 5000) {
            gameStarted = true;
            if (readyOverlay) readyOverlay.style.display = 'none';
            initCurrentGame(isMultiplayer);
        }
    }

    if (gameStarted && typeof updateCurrentGame === "function") {
    updateCurrentGame(data, isMultiplayer);
    }
});

window.addEventListener('resize', () => {
    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
});