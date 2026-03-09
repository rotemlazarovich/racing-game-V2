// --- 1. GLOBAL STATE ---
let canvas, ctx;
let steerAngle = 0, speed = 0, leanStatus = "IDLE";
let smoothSteer = 0, playerX = 0, playerDistance = 0;
let hasInitialized = false, isFinished = false, finishTime = 0;
let totalPenaltyTime = 0, steerLerp = 1.0;
let lastValidWidth = 0, lastTime = 0;

let track = [], trackLength = 0;
const SEGMENT_LENGTH = 100, SPEED_BOOST = 2.0;

let startTime = 0, personalBest = parseFloat(localStorage.getItem('racePB')) || Infinity, isRacing = false;
let driftNeutralWidth = 0, calibrationFrames = 0;
const CALIBRATION_LIMIT = 25; 

// --- 2. INITIALIZATION ---
function initCurrentGame(isMulti) {
    canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    track = [];
    // SMOOTH LONG TRACK
    addSection(150, 0);    
    addSection(100, 0.7);  
    addSection(150, 0);    
    addSection(120, 1.3);  
    addSection(200, 0);    
    addSection(150, 0.5);  
    
    trackLength = track.length * SEGMENT_LENGTH;
    playerDistance = 0; playerX = 0; speed = 0;
    isRacing = false; isFinished = false; totalPenaltyTime = 0;
    calibrationFrames = 0; lastValidWidth = 0;
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function addSection(len, curve) {
    for (let i = 0; i < len; i++) track.push({ curve: curve });
}

// --- 3. PHYSICS ---
function updateCurrentGame(data, isMulti) {
    const { left, right } = data;
    const scale = isMulti ? 2.0 : 1.0;

    if (((left.shoulder.x !== 0 && right.shoulder.x !== 0) || (left.ear && left.ear.x !== 0)) && left.shoulder.x !== 0.5) {
        hasInitialized = true;
        if (isFinished) {
            if (right.wrist.y < right.shoulder.y - 0.15) initCurrentGame(isMulti);
            else if (left.wrist.y < left.shoulder.y - 0.15) location.reload();
            return;
        }

        const now = performance.now();
        const dt = Math.min((now - lastTime) / 16.66, 2.0);
        lastTime = now;

        smoothSteer = smoothSteer * 0.4 + (Math.atan2(right.wrist.y - left.wrist.y, 0.20)) * 0.6;
        steerAngle = smoothSteer;

        let rawWidth = Math.abs(right.shoulder.x - left.shoulder.x);
        if (rawWidth < 0.1 && data.left.ear) rawWidth = Math.abs(data.right.ear.x - data.left.ear.x) * 3.1;
        rawWidth *= scale;
        let currentWidth = (rawWidth || lastValidWidth || driftNeutralWidth) * (1 / Math.cos(steerAngle * 0.6));
        lastValidWidth = currentWidth;

        if (calibrationFrames < CALIBRATION_LIMIT) {
            driftNeutralWidth += currentWidth;
            if (++calibrationFrames === CALIBRATION_LIMIT) driftNeutralWidth /= CALIBRATION_LIMIT;
            return;
        }

        let currentPos = Math.floor(playerDistance / SEGMENT_LENGTH);
        let roadWidth = 320 + (Math.abs(track[currentPos % track.length].curve) * 80);
        let isOnGrass = Math.abs(playerX) > roadWidth;
        let targetMaxSpeed = isOnGrass ? 20 : 48; 

        if (!isRacing && speed > 2) { startTime = Date.now(); isRacing = true; }

        let throttle = Math.min(Math.max(0, (currentWidth - driftNeutralWidth - 0.005) / 0.045), 1.2);
        if (throttle > 0) {
            speed += throttle * (isOnGrass ? 0.6 : 1.6) * dt;
            leanStatus = "GAS";
        } else if (currentWidth - driftNeutralWidth < -0.04) {
            speed *= (1 - (0.2 * dt));
            leanStatus = "BRAKE";
        } else {
            speed *= (1 - (0.02 * dt));
            leanStatus = "IDLE";
        }

        if (speed > targetMaxSpeed) speed -= (speed - targetMaxSpeed) * 0.1 * dt;
        playerX += (steerAngle * (isOnGrass ? 2.5 : 1.0)) * (speed * 2.1) * dt; 
        playerDistance += speed * SPEED_BOOST * dt;
        
        let curveSum = 0;
        for (let i = 0; i < 15; i++) curveSum += track[(currentPos + i) % track.length].curve;
        playerX -= (curveSum / 15) * (speed * 0.8) * dt; 

        if (Math.abs(playerX) > 2000) playerX = Math.sign(playerX) * 2000;
        if (isOnGrass) { totalPenaltyTime += (8.3 * dt); leanStatus = "OFF-ROAD!"; }

        if (playerDistance >= trackLength && isRacing) {
            isFinished = true; isRacing = false;
            finishTime = (Date.now() - startTime + totalPenaltyTime) / 1000;
            if (finishTime < personalBest) localStorage.setItem('racePB', (personalBest = finishTime));
        }
    }
}

// --- 4. RENDERING ---
function gameLoop() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let currentPos = Math.floor(playerDistance / SEGMENT_LENGTH);
    let roadWidth = 320 + (Math.abs(track[currentPos % track.length].curve) * 80);
    let isOnGrass = Math.abs(playerX) > roadWidth;
    
    if (isOnGrass && speed > 5) ctx.translate((Math.random()-0.5)*8, (Math.random()-0.5)*8);

    ctx.fillStyle = "#72d3fe"; ctx.fillRect(0, 0, canvas.width, canvas.height); 
    ctx.fillStyle = "#105d10"; ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2); 

    const centerX = canvas.width / 2;
    if (track.length > 0) {
        let x = 0, dx = 0;
        // Draw 60 segments for smoothness
        for (let n = 0; n < 60; n++) { 
            let seg = track[(currentPos + n) % track.length];
            let pW = Math.pow(n, 1.4) * 3.5 + (320 + Math.abs(seg.curve) * 60); 
            
            dx += seg.curve; 
            x += dx; 
            let rX = centerX + x - playerX; 
            let y = canvas.height - (n * 12);

            ctx.fillStyle = (n % 2 === 0) ? "#333" : "#444";
            ctx.beginPath();
            ctx.moveTo(rX - pW, y); ctx.lineTo(rX + pW, y);
            
            let nSeg = track[(currentPos + n + 1) % track.length];
            let nW = Math.pow(n + 1, 1.4) * 3.5 + (320 + Math.abs(nSeg.curve) * 60);
            ctx.lineTo(centerX + (x + dx + nSeg.curve) - playerX + nW, y - 12);
            ctx.lineTo(centerX + (x + dx + nSeg.curve) - playerX - nW, y - 12);
            ctx.fill();
            
            // Rumble Strips
            ctx.fillStyle = (n % 2 === 0) ? "#cc0000" : "white";
            ctx.fillRect(rX - pW - 25, y, 25, 12); 
            ctx.fillRect(rX + pW, y, 25, 12);

            // Finish Line
            if ((currentPos + n) % track.length === 0) {
                ctx.fillStyle = "white"; ctx.fillRect(rX - pW, y, pW * 2, 12);
            }
        }
    }

    // CAR
    const carV = centerX + (steerAngle * 40); 
    ctx.setTransform(1, 0, 0, 1, 0, 0); 
    ctx.save();
    ctx.translate(carV, canvas.height - 100);
    ctx.rotate(steerAngle * 0.1);
    if (speed > 1) ctx.translate(0, (Math.random() - 0.5) * (speed/6));
    ctx.fillStyle = "#e74c3c"; ctx.fillRect(-60, -20, 120, 35); 
    ctx.fillStyle = "#2c3e50"; ctx.fillRect(-45, -35, 90, 20);  
    ctx.restore();

    // RESTORED SPEEDOMETER
    const dialX = 150, dialY = canvas.height - 80;
    ctx.beginPath(); ctx.arc(dialX, dialY, 70, Math.PI, 0);
    ctx.lineWidth = 12; ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.stroke();
    let sP = speed / 48; 
    ctx.beginPath(); ctx.arc(dialX, dialY, 70, Math.PI, Math.PI + (Math.PI * Math.min(sP, 1)));
    ctx.strokeStyle = sP > 0.8 ? "#ff4757" : "#00ff64"; ctx.stroke();
    ctx.fillStyle = "white"; ctx.font = "bold 20px Arial"; ctx.textAlign = "center";
    ctx.fillText(`${Math.round(speed)} MPH`, dialX, dialY - 10);

    // TIME & STATUS
    if (!isFinished) {
        let elapsed = isRacing ? (Date.now() - startTime + totalPenaltyTime) : 0;
        ctx.font = "bold 50px Arial"; ctx.fillText((elapsed/1000).toFixed(2), centerX, 60);
        ctx.font = "20px Arial"; ctx.fillStyle = (leanStatus === "GAS") ? "#00ff64" : "#ffa502";
        ctx.fillText(leanStatus, centerX, 100);
    } else {
        ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = "#00ff64"; ctx.font = "bold 80px Arial"; ctx.fillText("FINISH!", centerX, canvas.height/2);
        ctx.fillStyle = "white"; ctx.font = "30px Arial"; ctx.fillText(`FINAL TIME: ${finishTime.toFixed(2)}s`, centerX, canvas.height/2 + 60);
    }

    if (calibrationFrames < CALIBRATION_LIMIT) {
        ctx.fillStyle = "black"; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = "white"; ctx.font = "25px Arial"; ctx.fillText("CALIBRATING...", centerX, canvas.height/2);
    }
    requestAnimationFrame(gameLoop);
}