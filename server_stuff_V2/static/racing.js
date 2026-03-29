// --- 1. GLOBAL STATE & CONFIG ---
const baseRoadWidth = 350; 
const SEGMENT_LENGTH = 110; 
const SPEED_BOOST = 2.2;
const CALIBRATION_LIMIT = 25;

let canvas, ctx;
let steerAngle = 0, speed = 0, leanStatus = "IDLE";
let smoothSteer = 0, playerX = 0, playerDistance = 0;
let hasInitialized = false, isFinished = false, finishTime = 0;
let totalPenaltyTime = 0, lastValidWidth = 0, lastTime = 0;

let track = [], trackLength = 0;
let trees = [], particles = []; 
let startTime = 0, personalBest = parseFloat(localStorage.getItem('racePB')) || Infinity, isRacing = false;
let driftNeutralWidth = 0, calibrationFrames = 0;

// --- 2. INITIALIZATION ---
function initCurrentGame(isMulti) {
    canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    track = [];
    addSection(250, 0);    
    addSection(100, 0.4);  
    addSection(60, 1.2);   
    addSection(40, 0);     
    addSection(60, -1.2);  
    addSection(40, 0);
    addSection(200, 0);    
    addSection(120, 2.2);  
    addSection(100, 0);    
    addSection(50, -1.0);  
    addSection(50, 1.0);   
    addSection(150, 0);    
    
    trackLength = track.length * SEGMENT_LENGTH;
    
    trees = [];
    for (let i = 0; i < track.length; i += 8) { 
        if (Math.random() > 0.4) {
            let side = Math.random() > 0.5 ? 1 : -1;
            trees.push({ x: side * (baseRoadWidth + 1500 + Math.random() * 1000), pos: i });
        }
    }

    playerDistance = 0; playerX = 0; speed = 0;
    particles = [];
    isRacing = false; isFinished = false; totalPenaltyTime = 0;
    calibrationFrames = 0; lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function addSection(len, curve) {
    for (let i = 0; i < len; i++) track.push({ curve: curve });
}

// --- 3. PHYSICS ---
function updateCurrentGame(data, isMulti) {
    const { left, right } = data;
    if (((left.shoulder.x !== 0 && right.shoulder.x !== 0) || (left.ear && left.ear.x !== 0)) && left.shoulder.x !== 0.5) {
        hasInitialized = true;
        if (isFinished) {
            if (right.wrist.y < right.shoulder.y - 0.2) initCurrentGame(isMulti);
            return;
        }

        const now = performance.now();
        const dt = Math.min((now - lastTime) / 16.66, 2.0);
        lastTime = now;

        smoothSteer = smoothSteer * 0.7 + (Math.atan2(right.wrist.y - left.wrist.y, 0.20)) * 0.3;
        steerAngle = smoothSteer;

        let rawWidth = Math.abs(right.shoulder.x - left.shoulder.x);
        if (rawWidth < 0.1 && data.left.ear) rawWidth = Math.abs(data.right.ear.x - data.left.ear.x) * 3.1;
        let currentWidth = rawWidth * (1 / Math.cos(steerAngle * 0.6));

        if (calibrationFrames < CALIBRATION_LIMIT) {
            driftNeutralWidth += currentWidth;
            if (++calibrationFrames === CALIBRATION_LIMIT) driftNeutralWidth /= CALIBRATION_LIMIT;
            return;
        }

        let visualRoadAtCar = (baseRoadWidth + 800);
        let grassIntensity = Math.min(Math.max(0, Math.abs(playerX) - visualRoadAtCar) / 1000, 1.0);
        let isOnGrass = grassIntensity > 0;
        let targetMaxSpeed = 55 - (25 * grassIntensity); 

        if (!isRacing && speed > 2) { startTime = Date.now(); isRacing = true; }

        let throttle = Math.min(Math.max(0, (currentWidth - driftNeutralWidth - 0.005) / 0.045), 1.2);
        if (throttle > 0) speed += throttle * (1.8 - (1.2 * grassIntensity)) * dt;
        else speed *= (1 - ((0.03 + (0.08 * grassIntensity)) * dt));

        if (speed > targetMaxSpeed) speed -= (speed - targetMaxSpeed) * 0.1 * dt;

        playerX += (steerAngle * (1.0 + (1.2 * grassIntensity))) * (speed * 2.1) * dt; 
        playerDistance += speed * SPEED_BOOST * dt;

        if (isOnGrass) {
            if ((playerX > 0 && steerAngle < -0.05) || (playerX < 0 && steerAngle > 0.05)) {
                playerX -= Math.sign(playerX) * (Math.abs(steerAngle) * 10 * grassIntensity * dt * (speed / 18));
            }
            totalPenaltyTime += (15.0 * grassIntensity * dt); 
            leanStatus = grassIntensity < 0.4 ? "RUMBLE" : "OFF-ROAD!";
        } else { leanStatus = speed > 1 ? "DRIVING" : "IDLE"; }

        let currentPos = Math.floor(playerDistance / SEGMENT_LENGTH);
        let curveSum = 0;
        for (let i = 0; i < 20; i++) curveSum += track[(currentPos + i) % track.length].curve;
        playerX -= (curveSum / 20) * (speed * (1.1 - (0.5 * grassIntensity))) * dt; 

        if (Math.abs(playerX) > 4000) playerX = Math.sign(playerX) * 4000;

        if (playerDistance >= trackLength && isRacing) {
            isFinished = true; isRacing = false;
            finishTime = (Date.now() - startTime + totalPenaltyTime) / 1000;
            if (finishTime < personalBest) localStorage.setItem('racePB', (personalBest = finishTime));
        }

        if (speed > 5 && Math.random() < (isOnGrass ? 0.8 : 0.1)) {
            particles.push({
                x: (canvas.width/2 + (steerAngle * 50)) + (Math.random()-0.5)*80,
                y: canvas.height - 110,
                vx: (Math.random()-0.5)*6, vy: -Math.random()*8,
                life: 1.0, color: grassIntensity > 0.5 ? "#2d5a27" : "#8b7355"
            });
        }
    }
}

// --- 4. RENDER LOOP ---
function gameLoop() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2, horizonY = canvas.height / 2;

    // Sky/Grass
    ctx.fillStyle = "#72d3fe"; ctx.fillRect(0, 0, canvas.width, horizonY); 
    ctx.fillStyle = "#105d10"; ctx.fillRect(0, horizonY, canvas.width, horizonY); 

    let currentPos = Math.floor(playerDistance / SEGMENT_LENGTH);
    let x = 0, dx = 0;

    for (let n = 0; n < 85; n++) {
        let seg = track[(currentPos + n) % track.length];
        let scale = 1 / (1 + (n * 0.055));
        dx += seg.curve; x += dx;
        let sY = canvas.height - (n * (canvas.height / 150)); 
        if (sY < horizonY) continue;

        let pW = (baseRoadWidth + 800) * scale; 
        let sX = centerX + (x - playerX) * scale;
        let nScale = 1 / (1 + ((n+1) * 0.055));
        let nX = centerX + (x + dx + track[(currentPos+n+1)%track.length].curve - playerX) * nScale;
        let nY = canvas.height - ((n+1) * (canvas.height / 150));

        let colorStep = Math.floor((playerDistance / 120) + n) % 2;
        ctx.fillStyle = (colorStep === 0) ? "#333" : "#3b3b3b";
        ctx.beginPath(); ctx.moveTo(sX-pW, sY); ctx.lineTo(sX+pW, sY); ctx.lineTo(nX+(nW=(baseRoadWidth+800)*nScale), nY); ctx.lineTo(nX-nW, nY); ctx.fill();

        // Finish Line (Restore)
        if ((currentPos + n) % track.length === 0) {
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.fillRect(sX - pW, sY - (20 * scale), pW * 2, 40 * scale);
        }

        // Rumble Strips
        ctx.fillStyle = (colorStep === 0) ? "#cc0000" : "white";
        ctx.fillRect(sX-pW-(40*scale), sY, 40*scale, 15); ctx.fillRect(sX+pW, sY, 40*scale, 15);

        // Trees
        trees.forEach(t => {
            if (t.pos === (currentPos + n) % track.length) {
                let tx = sX + t.x * scale; ctx.globalAlpha = 0.6;
                ctx.fillStyle = "#4a2c2a"; ctx.fillRect(tx-(10*scale), sY-(150*scale), 20*scale, 150*scale);
                ctx.fillStyle = "#0a3d0a"; ctx.beginPath(); ctx.arc(tx, sY-(150*scale), 60*scale, 0, Math.PI*2); ctx.fill();
                ctx.globalAlpha = 1.0;
            }
        });
    }

    // Particles
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.life -= 0.03;
        ctx.fillStyle = p.color; ctx.globalAlpha = p.life; ctx.fillRect(p.x, p.y, 8, 8);
    });
    ctx.globalAlpha = 1.0;

    // Car Shadow (New)
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(centerX + (steerAngle * 45), canvas.height - 85, 80, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    // Car
    drawSteeringWheel();
    ctx.save();
    ctx.translate(centerX + (steerAngle * 45), canvas.height - 110);
    ctx.rotate(steerAngle * 0.12);
    ctx.fillStyle = "#e74c3c"; ctx.fillRect(-70, -25, 140, 45); 
    ctx.fillStyle = "#2c3e50"; ctx.fillRect(-55, -45, 110, 25);
    ctx.restore();

    drawHUD();
    if (isFinished) drawFinishScreen();
    if (calibrationFrames < CALIBRATION_LIMIT) {
        ctx.fillStyle = "black"; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle="white"; ctx.textAlign="center"; ctx.font="25px Arial"; ctx.fillText("CALIBRATING...", centerX, canvas.height/2);
    }
    requestAnimationFrame(gameLoop);
}

function drawSteeringWheel() {
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 5;
    ctx.save(); ctx.translate(100, 100); ctx.rotate(steerAngle);
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(40, 0); ctx.moveTo(0, 0); ctx.lineTo(0, 40); ctx.stroke();
    ctx.restore();
}

function drawHUD() {
    const dX = 160, dY = canvas.height - 100;
    // Speedometer
    ctx.beginPath(); ctx.arc(dX, dY, 80, Math.PI, 0);
    ctx.lineWidth = 15; ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(dX, dY, 80, Math.PI, Math.PI + (Math.PI * Math.min(speed/55, 1)));
    ctx.strokeStyle = "#00ff64"; ctx.stroke();
    ctx.fillStyle = "white"; ctx.textAlign="center"; ctx.font="bold 25px Arial";
    ctx.fillText(Math.round(speed), dX, dY - 10);
    
    // BIG TIMER (Request: Bigger)
    if (isRacing) {
        ctx.font = "bold 80px Arial"; 
        ctx.fillStyle = "white";
        ctx.shadowBlur = 10; ctx.shadowColor = "black";
        ctx.fillText(((Date.now()-startTime+totalPenaltyTime)/1000).toFixed(2), canvas.width/2, 90);
        ctx.shadowBlur = 0;
    }
    ctx.font="20px Arial"; ctx.fillText(leanStatus, canvas.width/2, 140);
}

function drawFinishScreen() {
    ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#00ff64"; ctx.font = "bold 100px Arial"; ctx.textAlign="center";
    ctx.fillText("FINISH!", canvas.width/2, canvas.height/2);
    ctx.fillStyle = "white"; ctx.font = "40px Arial";
    ctx.fillText(`FINAL TIME: ${finishTime.toFixed(2)}s`, canvas.width/2, canvas.height/2+80);
}