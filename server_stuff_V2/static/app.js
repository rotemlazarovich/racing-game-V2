const socket = io();
const roomId = window.ROOM_ID || "";
const isMultiplayer = parseInt(roomId) % 2 === 0;

let gameStarted = false;
let startTimer = 0;
const REQUIRED_TIME = 2000; 

socket.on('connect', () => {
    if (roomId) {
        console.log("✅ Socket Connected. Joining Room:", roomId);
        socket.emit('join_room', { room_id: roomId, type: 'browser' });
    }
});

socket.on('detection_state', function(data) {
    if (!data) return;

    // --- 0. UNIVERSAL SORTING (The "Mirror" Fix) ---
    // We create 'sortedData' immediately so the Timer and Physics see the same orientation.
    let sortedData = { ...data };
    if (isMultiplayer && data.p1 && data.p2) {
        // Person physically on the LEFT (lower X) should be P1.
        // If p1.x is greater than p2.x, they are swapped, so we fix it.
        if (data.p1.x > data.p2.x) {
            sortedData.p1 = data.p2;
            sortedData.p2 = data.p1;
        }
    }

    /* // Connection Debug - Only uncomment if actively troubleshooting
    if (startTimer > 0 || (sortedData.p1 && sortedData.p1.handRaised)) {
        console.log("P1 Ready:", !!(sortedData.p1 && sortedData.p1.handRaised), "P2 Ready:", !!(sortedData.p2 && sortedData.p2.handRaised));
    }
    */

    // --- 1. UI OVERLAYS ---
    const noRoom = document.getElementById('no-room');
    const roomView = document.getElementById('room-view');
    const menu = document.getElementById('game-menu');
    const wait = document.getElementById('waiting-msg');
    const conn = document.getElementById('connection-overlay');

    if (noRoom) noRoom.style.display = 'none';
    if (roomView) roomView.style.display = 'block';
    if (menu) menu.style.display = 'block';
    if (wait) wait.style.display = 'none';
    if (conn) conn.style.display = 'none';

    // Update Video Feed (using sorted data for consistency)
    const feed = document.getElementById('video-feed');
    if (feed && sortedData.image) {
        feed.src = 'data:image/jpeg;base64,' + sortedData.image;
    }

    // --- 2. READY CONDITION ---
    // Now using sortedData so the bar reacts to the correct physical person
    const p1Ready = !!(sortedData.p1 && sortedData.p1.handRaised);
    const p2Ready = isMultiplayer ? !!(sortedData.p2 && sortedData.p2.handRaised) : true;

    const readyOverlay = document.getElementById('ready-overlay');
    const bar = document.getElementById('countdown-progress');

    const p1Finished = (typeof p1 !== 'undefined') && p1.isFinished;
    const p2Finished = isMultiplayer ? ((typeof p2 !== 'undefined') && p2.isFinished) : true;
    const raceOver = p1Finished && p2Finished;

    if (readyOverlay) {
        readyOverlay.style.display = (!gameStarted || raceOver) ? 'flex' : 'none';
    }

    // --- 3. TIMER LOGIC (Start & Restart) ---
    if (!gameStarted || raceOver) {
        if (p1Ready && p2Ready) {
            startTimer += 50; 
        } else {
            if (startTimer > 0) startTimer -= 100; 
            if (startTimer < 0) startTimer = 0;
        }
        
        const progress = (startTimer / REQUIRED_TIME) * 100;
        if (bar) bar.style.width = Math.min(progress, 100) + '%';

        if (startTimer >= REQUIRED_TIME) {
            console.log("🏁 STARTING GAME");
            gameStarted = true;
            startTimer = 0;
            if (typeof initCurrentGame === 'function') {
                initCurrentGame(isMultiplayer);
            }
        }
    }

    // --- 4. THE BRIDGE (Physics) ---
    if (gameStarted && typeof updateCurrentGame === 'function') {
        // We pass the already-sorted data to the game engine
        updateCurrentGame(sortedData, isMultiplayer);
    }
});

window.addEventListener('resize', () => {
    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
});