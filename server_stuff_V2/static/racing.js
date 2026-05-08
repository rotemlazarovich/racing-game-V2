// --- 1. CONFIG & GLOBALS ---
const baseRoadWidth = 350, SEGMENT_LENGTH = 110, SPEED_BOOST = 3, CALIBRATION_LIMIT = 50, REQUIRED_MS = 5000;
let canvas, ctx, track = [], trackLength = 0, trees = [], isMultiMode = false;
let mapPath = [];
const carSprite1 = new Image();
carSprite1.src = '/static/images/car_red.png';
const carSprite2 = new Image();
carSprite2.src = '/static/images/car_yellow.png';

gameStarted = false; 
let latestSensorData = { p1: null, p2: null };
let animationFrameId = null;
let lastTime = performance.now();
const fpsLimit = 30;
const frameInterval = 1000 / fpsLimit;

class Player {
    constructor(id, color) {
        this.heading = 0; 
        this.id = id; this.color = color;
        this.x = 0; this.dist = 0; this.speed = 0;
        this.steer = 0; 
        this.isFinished = false; this.finishTime = 0;
        this.penalty = 0; this.particles = []; this.neutralWidth = 0;
        this.calibFrames = 0; this.startTime = 0; this.isRacing = false;
        this.readyTime = null;
    }
    reset() {
        this.readyTime = null; this.x = 0; this.dist = 0; this.speed = 0; 
        this.heading = 0; this.isFinished = false; this.finishTime = 0; 
        this.penalty = 0; this.calibFrames = 0; this.particles = []; 
        this.isRacing = false; this.startTime = 0;
    }
}

const p1 = new Player(1, "#e74c3c"), p2 = new Player(2, "#3498db");

// --- 2. INITIALIZATION ---
function initCurrentGame(isMulti) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    isMultiMode = isMulti;
    
    p1.reset(); 
    if (isMultiMode && p2) p2.reset();
    p1.isRacing = true; p1.startTime = Date.now(); 
    if (isMultiMode && p2) { p2.isRacing = true; p2.startTime = Date.now(); }

    track = [];
    const addS = (len, curve) => { for(let i=0; i<len; i++) track.push({curve, absoluteAngle: 0}); };
    addS(150, 0);    addS(100, 0.6);  addS(80, 0);     addS(120, 1.4);  
    addS(100, -0.8); addS(60, 0);     addS(80, 1.8);   addS(100, -0.4); 
    addS(120, 0);    addS(40, 1.5);   addS(40, -1.5);  addS(60, 0);     
    addS(40, -1.5);  addS(40, 1.5);   addS(150, 0.8);  addS(50, 0);     
    
    trackLength = track.length * SEGMENT_LENGTH;

    let totalAngle = 0;
    for (let i = 0; i < track.length; i++) {
        totalAngle += track[i].curve * 0.025; 
        track[i].absoluteAngle = totalAngle;
    }

    let mx = 0, my = 0, mAngle = -Math.PI / 2;
    let rawPoints = [];
    for (let i = 0; i < track.length; i++) {
        mAngle += track[i].curve * 0.025; 
        mx += Math.cos(mAngle) * 4; my += Math.sin(mAngle) * 4;
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
    gameStarted = true;
    gameLoop();
}

// --- 3. PHYSICS ---
function updatePhysics(p, pData, dt) {
    // 1. Basic Checks (Current variable structure)
    if (!pData || !pData.left || !pData.right) return;
    if (p.isFinished) { p.speed *= (1 - 0.05 * dt); return; }

    const { left, right, ear } = pData;

    // 2. STEERING (Your original Atan2 math)
    let targetSteer = (Math.atan2(right.wrist.y - left.wrist.y, 0.20));
    p.steer += (targetSteer - p.steer) * 0.1 * dt;

    // 3. THROTTLE & CALIBRATION (Restored original logic)
    let rawW = Math.abs(right.shoulder.x - left.shoulder.x);
    if (rawW < 0.05 && ear) rawW = Math.abs(ear.x - left.shoulder.x) * 1.5;
    let currW = rawW * (1 / Math.cos(p.steer * 0.6));

    if (p.calibFrames < CALIBRATION_LIMIT) {
        p.neutralWidth += currW;
        if (++p.calibFrames === CALIBRATION_LIMIT) p.neutralWidth /= CALIBRATION_LIMIT;
        return;
    }

    // 4. SPEED & GRASS (Restored original targetMax and Multipliers)
    let visualRoad = (baseRoadWidth + 800);
    let grassInt = Math.min(Math.max(0, Math.abs(p.x) - visualRoad) / 1000, 1.0);
    let targetMax = 80 - (30 * grassInt);

    if (!p.isRacing && p.speed > 2) { p.startTime = Date.now(); p.isRacing = true; }

    let throttle = Math.min(Math.max(0, (currW - p.neutralWidth - 0.002) / 0.045), 1.2);
    
    if (throttle > 0.08) { 
        // Accelerated gas (Restored 2.1 multiplier)
        p.speed += throttle * (2.1 - (1.2 * grassInt)) * dt;
    } else {
        p.speed -= 0.5 * dt; 
        p.speed *= (1 - ((0.02 + (0.08 * grassInt)) * dt));
    }

    if (p.speed < 1.0) p.speed = 0;
    if (p.speed > targetMax) p.speed = targetMax;

    // 5. MOVEMENT (Restored original formulas)
    // Lateral movement
    p.x += (p.steer * (1.1 + grassInt)) * (p.speed * 2.1) * dt;
    // Straight line progression (No alignment math)
    p.dist += p.speed * SPEED_BOOST * dt;

    // 6. CURVE PULL (Fixed the "Snap")
    let pos = p.dist / SEGMENT_LENGTH;
    let curPos = Math.floor(pos);
    let percent = pos % 1; // How far we are into the current segment
    
    let curveSum = 0;
    for (let i = 0; i < 20; i++) {
        // We LERP between the current segment and the next one to smooth the transition
        let c1 = track[(curPos + i) % track.length].curve;
        let c2 = track[(curPos + i + 1) % track.length].curve;
        curveSum += c1 + (c2 - c1) * percent; 
    }
    // Pull the car based on the track curve
    p.x -= (curveSum / 20) * (p.speed * (1.1 - 0.5 * grassInt)) * dt;

    // 7. CAMERA HEADING (Only for the renderer, does not affect physics)
    let currentRoadAngle = track[curPos % track.length].absoluteAngle;
    let nextRoadAngle = track[(curPos + 1) % track.length].absoluteAngle;
    let smoothRoadAngle = currentRoadAngle + (nextRoadAngle - currentRoadAngle) * percent;
    p.heading = smoothRoadAngle + (p.steer * 0.5); 

    // Penalty & Finish
    if (grassInt > 0) p.penalty += (15.0 * grassInt * dt);
    if (p.dist >= trackLength && !p.isFinished) {
        p.isFinished = true;
        p.isRacing = false;
        p.finishTime = (Date.now() - p.startTime + p.penalty) / 1000;
    }

    // Particles
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
    latestSensorData.p1 = data.p1;
    latestSensorData.p2 = isMulti ? data.p2 : null;
}

function gameLoop() {
    if (!gameStarted) return;
    const currentTime = performance.now();
    const elapsed = currentTime - lastTime;
    if (elapsed < frameInterval) {
        animationFrameId = requestAnimationFrame(gameLoop);
        return;
    }
    let dt = elapsed / frameInterval;
    if (dt > 2.0) dt = 2.0; 
    lastTime = currentTime - (elapsed % frameInterval);

    if (latestSensorData.p1) updatePhysics(p1, latestSensorData.p1, dt);
    if (isMultiMode && latestSensorData.p2) updatePhysics(p2, latestSensorData.p2, dt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isMultiMode) {
        renderViewport(p1, 0, canvas.width / 2);
        renderViewport(p2, canvas.width / 2, canvas.width / 2);
    } else {
        renderViewport(p1, 0, canvas.width);
    }
    animationFrameId = requestAnimationFrame(gameLoop);
}

function renderViewport(p, xOff, width) {
    ctx.save();
    ctx.beginPath(); ctx.rect(xOff, 0, width, canvas.height); ctx.clip();
    const centerX = xOff + width / 2;
    const horizonY = canvas.height / 2;

    let pos = p.dist / SEGMENT_LENGTH;
    let idx = Math.floor(pos) % track.length;
    let nextIdx = (idx + 1) % track.length;
    let percent = pos % 1;
    let smoothRoadAngle = track[idx].absoluteAngle + (track[nextIdx].absoluteAngle - track[idx].absoluteAngle) * percent;

    let relativeHeading = p.heading - smoothRoadAngle;
    const lookOffset = relativeHeading * -1200; // Lowered to prevent camera jumping
    const vanishingPointX = centerX + lookOffset;

    ctx.fillStyle = "#72d3fe"; ctx.fillRect(xOff, 0, width, horizonY);
    ctx.fillStyle = "#105d10"; ctx.fillRect(xOff, horizonY, width, horizonY);

    let currentPos = Math.floor(p.dist / SEGMENT_LENGTH);
    let x = 0, dx = 0;
    for (let n = 0; n < 85; n++) {
        let segIdx = (currentPos + n) % track.length;
        let scale = 1 / (1 + (n * 0.055));
        dx += track[segIdx].curve; x += dx;
        let sY = canvas.height - (n * (canvas.height / 150));
        if (sY < horizonY) continue;

        let pW = (baseRoadWidth + 800) * scale;
        let sX = vanishingPointX + (x - p.x) * scale;
        
        let nScale = 1 / (1 + ((n+1) * 0.055));
        let nW = (baseRoadWidth + 800) * nScale;
        let nX = vanishingPointX + (x + dx + track[(currentPos+n+1)%track.length].curve - p.x) * nScale;
        let nY = canvas.height - ((n+1) * (canvas.height / 150));

        let colorStep = Math.floor((p.dist / 120) + n) % 2;
        ctx.fillStyle = (colorStep === 0) ? "#333" : "#3b3b3b";
        ctx.beginPath(); ctx.moveTo(sX-pW, sY); ctx.lineTo(sX+pW, sY); 
        ctx.lineTo(nX+nW, nY); ctx.lineTo(nX-nW, nY); ctx.fill();

        if (segIdx === track.length - 1) { 
            ctx.fillStyle = "white";
            for(let j=-5; j<5; j++) if(j%2===0) ctx.fillRect(sX + (j * pW/5), sY, pW/5, 20);
        }
        ctx.fillStyle = (colorStep === 0) ? "#cc0000" : "white";
        ctx.fillRect(sX-pW-(40*scale), sY, 40*scale, 15); ctx.fillRect(sX+pW, sY, 40*scale, 15);

        trees.forEach(t => {
            if (t.pos === segIdx) {
                let tx = sX + t.x * scale;
                ctx.fillStyle = "#4a2c2a"; ctx.fillRect(tx-(10*scale), sY-(140*scale), 20*scale, 140*scale);
                ctx.fillStyle = "#0a3d0a"; ctx.beginPath(); ctx.arc(tx, sY-(140*scale), 60*scale, 0, Math.PI*2); ctx.fill();
            }
        });
    }

    const cX = centerX + (p.steer * 45), cY = canvas.height - 110;
    const currentSprite = (p.id === 1) ? carSprite1 : carSprite2;
    ctx.save(); 
    ctx.translate(cX, cY); 
    ctx.rotate(p.steer * 0.15);
    if (currentSprite.complete) ctx.drawImage(currentSprite, -187, -125, 375, 250);
    else { ctx.fillStyle = p.color; ctx.fillRect(-70, -25, 140, 45); }
    ctx.restore();

    if (p.calibFrames < CALIBRATION_LIMIT) {
        ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(xOff, 0, width, canvas.height);
        ctx.fillStyle = "#00ff64"; ctx.font = "bold 60px Arial"; ctx.textAlign = "center";
        ctx.fillText("CALIBRATING...", centerX, horizonY - 40);
        ctx.fillStyle = "white"; ctx.font = "bold 80px Arial";
        ctx.fillText(Math.ceil((CALIBRATION_LIMIT-p.calibFrames)/10), centerX, horizonY + 110);
    }
    drawTimer(p, centerX);
    drawTopLeftHUD(p, xOff);
    drawSpeedo(p, xOff);
    drawMiniMap(p, xOff, width);
    if (p.isFinished) {
        ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(xOff, 0, width, canvas.height);
        ctx.fillStyle = "#00ff64"; ctx.font = "bold 80px Arial"; ctx.textAlign = "center";
        ctx.fillText("FINISH!", centerX, horizonY - 60);
        ctx.fillStyle = "white"; ctx.font = "bold 45px Arial";
        ctx.fillText(`TIME: ${p.finishTime.toFixed(2)}s`, centerX, horizonY + 10);
        let progress = p.readyTime ? Math.min((Date.now() - p.readyTime) / REQUIRED_MS, 1.0) : 0;
        ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.fillRect(centerX-150, horizonY+100, 300, 15);
        ctx.fillStyle = "#00ff64"; ctx.fillRect(centerX-150, horizonY+100, 300 * progress, 15);
    }
    ctx.restore();
}

function drawTimer(p, centerX) {
    ctx.fillStyle = "white"; ctx.font = "bold 75px Arial"; ctx.textAlign = "center";
    let disp = p.isFinished ? p.finishTime.toFixed(2) : ((Date.now() - p.startTime) / 1000).toFixed(2);
    ctx.fillText(disp, centerX, 100);
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
    ctx.beginPath(); ctx.arc(sX, sY, 70, Math.PI, 0); ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth=10; ctx.stroke();
    ctx.beginPath(); ctx.arc(sX, sY, 70, Math.PI, Math.PI + (Math.PI * Math.min(p.speed/145, 1)));
    ctx.strokeStyle = "#00ff64"; ctx.stroke();
    ctx.fillStyle = "white"; ctx.font = "bold 25px Arial"; ctx.textAlign = "center";
    ctx.fillText(Math.round(p.speed), sX, sY - 15);
}
function drawMiniMap(p, xOff, width) {
    const mS = 180, mX = xOff + width - mS - 30, mY = canvas.height - mS - 30;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(mX, mY, mS, mS);
    const xs = mapPath.map(p => p.x), ys = mapPath.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sc = (mS - 40) / Math.max(maxX - minX, maxY - minY);
    ctx.save(); ctx.translate(mX + mS/2, mY + mS/2);
    ctx.beginPath(); ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 4;
    mapPath.forEach((pt, i) => {
        const tx = (pt.x - (minX + maxX)/2) * sc, ty = (pt.y - (minY + maxY)/2) * sc;
        if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
    });
    ctx.stroke();
    let idx = Math.floor((p.dist / trackLength) * track.length) % track.length;
    let d = mapPath[idx];
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc((d.x - (minX+maxX)/2)*sc, (d.y - (minY+maxY)/2)*sc, 7, 0, Math.PI*2); ctx.fill();
    ctx.restore();
}