// --- 1. CONFIG & GLOBALS ---
const baseRoadWidth = 350, SEGMENT_LENGTH = 110, SPEED_BOOST = 3, CALIBRATION_LIMIT = 50;
let canvas, ctx, track = [], trackLength = 0, trees = [], lastTime = 0, isMultiMode = false;
let mapPath = []; 
const carSprite1 = new Image();
carSprite1.src = '/static/images/car_red.png';

const carSprite2 = new Image();
carSprite2.src = '/static/images/car_yellow.png';

class Player {
    constructor(id, color) {
        this.id = id; this.color = color;
        this.x = 0; this.dist = 0; this.speed = 0;
        this.steer = 0; this.smoothSteer = 0;
        this.isFinished = false; this.finishTime = 0;
        this.penalty = 0; this.particles = []; this.neutralWidth = 0;
        this.calibFrames = 0; this.startTime = 0; this.isRacing = false;
    }
    reset() {
        this.x = 0; this.dist = 0; this.speed = 0; 
        this.isFinished = false; // CRITICAL FIX
        this.finishTime = 0; this.penalty = 0; 
        this.calibFrames = 0; this.particles = []; 
        this.isRacing = false; this.startTime = 0;
    }
}

const p1 = new Player(1, "#e74c3c"), p2 = new Player(2, "#3498db");

// --- 2. INITIALIZATION ---
function initCurrentGame(isMulti) {
    canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    isMultiMode = isMulti;
    
    // Clear old state immediately
    p1.reset(); 
    p2.reset();

    // 1,200 Segment Pro Endurance Track
    track = [];
    const addS = (len, curve) => { for(let i=0; i<len; i++) track.push({curve}); };
    addS(150, 0);    addS(100, 0.6);  addS(80, 0);     addS(120, 1.4);  
    addS(100, -0.8); addS(60, 0);     addS(80, 1.8);   addS(100, -0.4); 
    addS(120, 0);    addS(40, 1.5);   addS(40, -1.5);  addS(60, 0);     
    addS(40, -1.5);  addS(40, 1.5);   addS(150, 0.8);  addS(50, 0);     
    
    trackLength = track.length * SEGMENT_LENGTH;

    let mx = 0, my = 0, angle = -Math.PI / 2;
    let rawPoints = [];
    for (let i = 0; i < track.length; i++) {
        angle += track[i].curve * 0.025; 
        mx += Math.cos(angle) * 4; my += Math.sin(angle) * 4;
        rawPoints.push({x: mx, y: my});
    }
    const lastP = rawPoints[rawPoints.length - 1];
    mapPath = rawPoints.map((p, i) => {
        const r = i / rawPoints.length;
        return { x: p.x - (lastP.x * r), y: p.y - (lastP.y * r) };
    });

    trees = [];
    for (let i = 0; i < track.length; i += 5) {
        if (Math.random() > 0.25) {
            let side = Math.random() > 0.5 ? 1 : -1;
            trees.push({ x: side * (baseRoadWidth + 1800 + Math.random() * 1200), pos: i });
        }
    }

    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

// --- 3. PHYSICS ---
function updatePhysics(p, pData, dt) {
    if (!pData || !pData.active) return;
    if (p.isFinished) { p.speed *= (1 - 0.05 * dt); return; }

    const { left, right, ear } = pData;
    let targetSteer = (Math.atan2(right.wrist.y - left.wrist.y, 0.20));
    p.steer += (targetSteer - p.steer) * 0.15 * dt;

    let rawW = Math.abs(right.shoulder.x - left.shoulder.x);
    if (rawW < 0.05 && ear) rawW = Math.abs(ear.x - left.shoulder.x) * 1.5;
    let currW = rawW * (1 / Math.cos(p.steer * 0.6));

    if (p.calibFrames < CALIBRATION_LIMIT) {
        p.neutralWidth += currW;
        if (++p.calibFrames === CALIBRATION_LIMIT) p.neutralWidth /= CALIBRATION_LIMIT;
        return;
    }

    let visualRoad = (baseRoadWidth + 800);
    let grassInt = Math.min(Math.max(0, Math.abs(p.x) - visualRoad) / 1000, 1.0);
    let targetMax = 65 - (25 * grassInt);

    if (!p.isRacing && p.speed > 2) { p.startTime = Date.now(); p.isRacing = true; }

    let throttle = Math.min(Math.max(0, (currW - p.neutralWidth - 0.002) / 0.045), 1.2);
    
    if (throttle > 0.08) { 
        // Accelerated gas
        p.speed += throttle * (2.1 - (1.2 * grassInt)) * dt;
    } else {
        // BRAKING / FRICTION
        // We add a flat subtraction so it actually hits 0
        p.speed -= 0.5 * dt; 
        p.speed *= (1 - ((0.02 + (0.08 * grassInt)) * dt));
    }

    // HARD STOP: If speed is very low, just kill it
    if (p.speed < 1.0) p.speed = 0;

    // TARGET MAX CAP
    if (p.speed > targetMax) p.speed -= (p.speed - targetMax) * 0.1 * dt;
    p.x += (p.steer * (1.1 + grassInt)) * (p.speed * 2.1) * dt;
    p.dist += p.speed * SPEED_BOOST * dt;

    if (grassInt > 0) p.penalty += (15.0 * grassInt * dt);

    let curPos = Math.floor(p.dist / SEGMENT_LENGTH);
    let curveSum = 0;
    for (let i = 0; i < 20; i++) curveSum += track[(curPos + i) % track.length].curve;
    p.x -= (curveSum / 20) * (p.speed * (1.1 - 0.5 * grassInt)) * dt;

    if (p.dist >= trackLength && !p.isFinished) {
        p.isFinished = true;
        p.isRacing = false;
        p.finishTime = (Date.now() - p.startTime + p.penalty) / 1000;
    }

    if (p.speed > 5 && Math.random() < (grassInt > 0 ? 0.8 : 0.1)) {
        p.particles.push({
            x: (Math.random()-0.5)*40 + (p.x>0?50:-50), y: 20,
            vx: (Math.random()-0.5)*4, vy: Math.random()*5+2,
            life: 1.0, color: grassInt > 0.5 ? "#2d5a27" : "#8b7355"
        });
    }
}

function updateCurrentGame(data, isMulti) {
    if (!data) return;
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 16.66, 2.0);
    lastTime = now;
    if (data.p1) updatePhysics(p1, data.p1, dt);
    if (isMulti && data.p2) updatePhysics(p2, data.p2, dt);
}

// --- 4. RENDER ---
function gameLoop() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isMultiMode) {
        renderViewport(p1, 0, canvas.width / 2);
        renderViewport(p2, canvas.width / 2, canvas.width / 2);
        ctx.fillStyle = "white"; ctx.fillRect(canvas.width/2 - 2, 0, 4, canvas.height);
    } else {
        renderViewport(p1, 0, canvas.width);
    }
    requestAnimationFrame(gameLoop);
}

function renderViewport(p, xOff, width) {
    ctx.save();
    // 1. Setup Viewport Clipping
    ctx.beginPath(); 
    ctx.rect(xOff, 0, width, canvas.height); 
    ctx.clip();
    
    const centerX = xOff + width / 2;
    const horizonY = canvas.height / 2;

    // --- CAMERA SHAKE LOGIC ---
    // Only shake if the car is going fast (e.g., over 80 mph)
    if (p.speed > 80) {
        // Higher speed = more violent shake
        const shakeIntensity = (p.speed / 200) * 3; 
        const shakeX = (Math.random() - 0.5) * shakeIntensity;
        const shakeY = (Math.random() - 0.5) * shakeIntensity;
        
        ctx.translate(shakeX, shakeY);
    }

    // 2. Render Environment (Sky & Grass)
    ctx.fillStyle = "#72d3fe"; 
    ctx.fillRect(xOff, 0, width, horizonY);
    ctx.fillStyle = "#105d10"; 
    ctx.fillRect(xOff, horizonY, width, horizonY);

    // 3. Render Track & Trees
    let currentPos = Math.floor(p.dist / SEGMENT_LENGTH);
    let x = 0, dx = 0;

    for (let n = 0; n < 85; n++) {
        let segIdx = (currentPos + n) % track.length;
        let scale = 1 / (1 + (n * 0.055));
        dx += track[segIdx].curve; 
        x += dx;
        
        let sY = canvas.height - (n * (canvas.height / 150));
        if (sY < horizonY) continue;

        let pW = (baseRoadWidth + 800) * scale;
        let sX = centerX + (x - p.x) * scale;
        let nScale = 1 / (1 + ((n+1) * 0.055));
        let nW = (baseRoadWidth + 800) * nScale;
        let nX = centerX + (x + dx + track[(currentPos+n+1)%track.length].curve - p.x) * nScale;
        let nY = canvas.height - ((n+1) * (canvas.height / 150));

        let colorStep = Math.floor((p.dist / 120) + n) % 2;
        
        // Road surface
        ctx.fillStyle = (colorStep === 0) ? "#333" : "#3b3b3b";
        ctx.beginPath(); 
        ctx.moveTo(sX-pW, sY); ctx.lineTo(sX+pW, sY); 
        ctx.lineTo(nX+nW, nY); ctx.lineTo(nX-nW, nY); 
        ctx.fill();

        // Finish Line
        if (segIdx === track.length - 1) {
            ctx.fillStyle = "white";
            for(let j=-5; j<5; j++) {
                if(j%2===0) ctx.fillRect(sX + (j * pW/5), sY, pW/5, 20);
            }
        }

        // Rumble strips
        ctx.fillStyle = (colorStep === 0) ? "#cc0000" : "white";
        ctx.fillRect(sX-pW-(40*scale), sY, 40*scale, 15); 
        ctx.fillRect(sX+pW, sY, 40*scale, 15);

        // Render Trees
        trees.forEach(t => {
            if (t.pos === segIdx) {
                let tx = sX + t.x * scale;
                ctx.fillStyle = "#4a2c2a"; 
                ctx.fillRect(tx-(10*scale), sY-(140*scale), 20*scale, 140*scale);
                ctx.fillStyle = "#0a3d0a"; 
                ctx.beginPath(); 
                ctx.arc(tx, sY-(140*scale), 60*scale, 0, Math.PI*2); 
                ctx.fill();
            }
        });
    }

    // --- 4. Render Particles ---
    const cX = centerX + (p.steer * 45), cY = canvas.height - 110;
    p.particles = p.particles.filter(pt => pt.life > 0);
    p.particles.forEach(pt => {
        pt.x += pt.vx; pt.y += pt.vy; pt.life -= 0.02;
        ctx.fillStyle = pt.color; ctx.globalAlpha = pt.life;
        ctx.fillRect(cX + pt.x, cY + pt.y, 10, 10);
    });
    ctx.globalAlpha = 1.0;

    // --- Render Player Car Sprite ---
    // 1. Determine which texture to use based on player side/index
    // If your racing.js doesn't have p.index, use p.color or another unique property
    const currentSprite = (p.id === 1 || p.side === 'left') ? carSprite1 : carSprite2;

    ctx.save(); 
    ctx.translate(cX, cY); 
    ctx.rotate(p.steer * 0.12);

    if (currentSprite.complete && currentSprite.naturalWidth !== 0) {
        // Draw the PNG (Adjust -75, -50, 150, 100 to change the size/position)
        const imgW = 375; 
        const imgH = 250;
        ctx.drawImage(currentSprite, -imgW/2, -imgH/2, imgW, imgH);
    } else {
        // FALLBACK: If image isn't loaded yet, draw the original geometric car
        ctx.fillStyle = p.color; 
        ctx.fillRect(-70, -25, 140, 45); // Car body
        ctx.fillStyle = "#2c3e50"; 
        ctx.fillRect(-55, -45, 110, 25); // Windshield
    }
    
    ctx.restore();

    // 5. Calibration Overlay (Top Layer)
    if (p.calibFrames < CALIBRATION_LIMIT) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
        ctx.fillRect(xOff, 0, width, canvas.height);

        const remaining = Math.ceil((CALIBRATION_LIMIT - p.calibFrames) / 10); 

        ctx.fillStyle = "#00ff64";
        ctx.font = "bold 60px Arial";
        ctx.textAlign = "center";
        ctx.fillText("CALIBRATING...", centerX, horizonY - 40);

        ctx.fillStyle = "white";
        ctx.font = "24px Arial";
        ctx.fillText("STAND STILL TO INITIALIZE SENSORS", centerX, horizonY + 20);
        
        ctx.font = "bold 80px Arial";
        ctx.fillText(remaining > 0 ? remaining : "GO!", centerX, horizonY + 110);
    }

    // 6. HUD Elements
    drawTimer(p, centerX);
    drawTopLeftHUD(p, xOff);
    drawSpeedo(p, xOff);
    drawMiniMap(p, xOff, width);

    // 7. Finish Screen Overlay
    if (p.isFinished) {
        ctx.fillStyle = "rgba(0,0,0,0.85)"; 
        ctx.fillRect(xOff, 0, width, canvas.height);
        
        ctx.fillStyle = "#00ff64"; 
        ctx.font = "bold 80px Arial"; 
        ctx.textAlign = "center";
        ctx.fillText("FINISH!", centerX, horizonY - 60);
        
        ctx.fillStyle = "white"; 
        ctx.font = "bold 45px Arial";
        ctx.fillText(`TIME: ${p.finishTime.toFixed(2)}s`, centerX, horizonY + 10);
        
        ctx.font = "24px Arial";
        ctx.fillText("RAISE HANDS TO RESTART", centerX, horizonY + 70);

        // --- Restart Progress Bar ---
        const barWidth = 300;
        const barHeight = 15;
        const progress = (startTimer / REQUIRED_TIME); 
        
        // Bar Background
        ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
        ctx.fillRect(centerX - barWidth/2, horizonY + 100, barWidth, barHeight);
        
        // Bar Fill
        ctx.fillStyle = "#00ff64";
        ctx.fillRect(centerX - barWidth/2, horizonY + 100, barWidth * progress, barHeight);
    }
    
    ctx.restore();
}

function drawTimer(p, centerX) {
    ctx.fillStyle = "white"; ctx.font = "bold 75px Arial"; ctx.textAlign = "center";
    ctx.shadowColor = "black"; ctx.shadowBlur = 10;
    let disp = "0.00";
    if (p.isFinished) disp = p.finishTime.toFixed(2);
    else if (p.startTime > 0) disp = ((Date.now() - p.startTime + p.penalty) / 1000).toFixed(2);
    ctx.fillText(disp, centerX, 100);
    ctx.shadowBlur = 0;
}

function drawTopLeftHUD(p, xOff) {
    ctx.save(); ctx.translate(xOff + 80, 80); ctx.rotate(p.steer * 2);
    ctx.strokeStyle = "white"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 35, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-35, 0); ctx.lineTo(35, 0); ctx.stroke();
    ctx.restore();
}

function drawSpeedo(p, xOff) {
    const sX = xOff + 100, sY = canvas.height - 100;
    ctx.beginPath(); ctx.arc(sX, sY, 70, Math.PI, 0); ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(sX, sY, 70, Math.PI, Math.PI + (Math.PI * Math.min(p.speed/85, 1)));
    ctx.strokeStyle = "#00ff64"; ctx.stroke();
    ctx.fillStyle = "white"; ctx.font = "bold 25px Arial"; ctx.textAlign = "center";
    ctx.fillText(Math.round(p.speed), sX, sY - 15);
}

function drawMiniMap(p, xOff, width) {
    const mS = 180, mX = xOff + width - mS - 30, mY = canvas.height - mS - 30;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(mX, mY, mS, mS);
    ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.strokeRect(mX, mY, mS, mS);
    const xs = mapPath.map(p => p.x), ys = mapPath.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sc = (mS - 40) / Math.max(maxX - minX, maxY - minY);
    ctx.save(); ctx.translate(mX + mS/2, mY + mS/2);
    ctx.beginPath(); ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 4;
    mapPath.forEach((pt, i) => {
        const tx = (pt.x - (minX + maxX)/2) * sc, ty = (pt.y - (minY + maxY)/2) * sc;
        if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
    });
    ctx.closePath(); ctx.stroke();
    let idx = Math.floor((p.dist / trackLength) * track.length) % track.length;
    let d = mapPath[idx];
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc((d.x - (minX + maxX)/2) * sc, (d.y - (minY + maxY)/2) * sc, 7, 0, Math.PI*2); ctx.fill();
    ctx.restore();
}