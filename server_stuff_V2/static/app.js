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

    // --- 0. HIDE QR CODE ---
    // Hide the connection overlay as soon as we get the first camera frame
    const connOverlay = document.getElementById('connection-overlay');
    if (connOverlay) {
        connOverlay.style.display = 'none';
    }

    // --- 1. UNIVERSAL SORTING (Mirror Fix) ---
    let sortedData = { ...data };
    if (isMultiplayer && data.p1 && data.p2) {
        // If P1 is physically to the right (higher X), swap them to fix mirroring
        if (data.p1.x < data.p2.x) {
            sortedData.p1 = data.p2;
            sortedData.p2 = data.p1;
        }
    }

    // --- 2. UI UPDATES ---
    const feed = document.getElementById('video-feed');
    if (feed && sortedData.image) {
        feed.src = 'data:image/jpeg;base64,' + sortedData.image;
    }

    // --- 3. READY CONDITION & RESTART LOGIC ---
    const p1Ready = !!(sortedData.p1 && sortedData.p1.handRaised);
    const p2Ready = isMultiplayer ? !!(sortedData.p2 && sortedData.p2.handRaised) : true;

    const readyOverlay = document.getElementById('ready-overlay');
    const bar = document.getElementById('countdown-progress');

    // Accessing racing.js global variables
    const p1Finished = (typeof p1 !== 'undefined') && p1.isFinished;
    const p2Finished = isMultiplayer ? ((typeof p2 !== 'undefined') && p2.isFinished) : true;
    const raceOver = p1Finished && p2Finished;

    // --- 4. OVERLAY VISIBILITY ---
    if (readyOverlay) {
        // Only show the HTML overlay for the VERY FIRST start.
        // Once gameStarted is true, we rely on your racing.js UI.
        if (!gameStarted) {
            readyOverlay.style.display = 'flex';
        } else {
            readyOverlay.style.display = 'none';
        }
    }

    // --- 5. TIMER LOGIC (First Start & Subsequent Restarts) ---
    if (!gameStarted || raceOver) {
        if (p1Ready && p2Ready) {
            startTimer += 50; 
        } else {
            if (startTimer > 0) startTimer -= 100; 
            if (startTimer < 0) startTimer = 0;
        }
        
        // Update the HTML bar (only visible during the first start)
        if (bar && !gameStarted) {
            bar.style.width = Math.min((startTimer / REQUIRED_TIME) * 100, 100) + '%';
        }

        if (startTimer >= REQUIRED_TIME) {
            console.log("🏁 GAME INITIALIZED/RESTARTED");
            gameStarted = true;
            startTimer = 0;
            if (typeof initCurrentGame === 'function') {
                initCurrentGame(isMultiplayer);
            }
        }
    }

    // --- 6. THE BRIDGE (Physics) ---
    if (gameStarted && typeof updateCurrentGame === 'function') {
        // Send the sorted data and the current startTimer value
        // You can use (startTimer/REQUIRED_TIME) inside racing.js to animate your finish bar
        updateCurrentGame(sortedData, isMultiplayer, startTimer / REQUIRED_TIME);
    }
});

window.addEventListener('resize', () => {
    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
});