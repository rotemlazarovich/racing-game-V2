// --- 1. CONFIG & GLOBALS ---
const TILE_SIZE = 128;
let canvas, ctx, isMultiMode = false;
let animationFrameId = null;
let lastTime = performance.now();
const fpsLimit = 30;
const frameInterval = 1000 / fpsLimit;

// Skiing specific globals
let baseSpeed = 10;
let currentSpeed = 10;
let maxSpeed = 40;
let steeringSensitivity = 10; 
let totalDistance = 0;
let obstacles = [];
let laneOffset = 0;
let p1HandLastY = 0;
let p2HandLastY = 0;
let globalRowingBoost = 0;

// Load Sprites
const sprites = {};
const spriteNames = ['ski-blue', 'ski-green', 'snow', 'left-edge', 'right-edge', 'tree-small', 'weed-small'];
spriteNames.forEach(name => {
    sprites[name] = new Image();
    sprites[name].src = `/static/images/${name}.png`;
});

class Player {
    constructor(id, spriteName) {
        this.id = id;
        this.spriteName = spriteName;
        this.reset();
    }
    reset() {
        this.x = 0; 
        this.y = 0; 
        this.alive = true;
    }
}

const p1 = new Player(1, 'ski-blue');
const p2 = new Player(2, 'ski-green');

// --- 2. THE BRIDGE (Fixes the ReferenceError) ---
// This function MUST exist because app.js calls it every frame
function updateCurrentGame(data, isMulti) {
    // We don't need to do much here because app.js already updates 
    // the global p1Data and p2Data variables.
    isMultiMode = isMulti;
}

// --- 3. INITIALIZATION ---
function initCurrentGame(isMulti) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth; 
    canvas.height = window.innerHeight;
    isMultiMode = isMulti;

    p1.reset();
    p1.x = isMultiMode ? canvas.width * 0.75 : canvas.width * 0.5;
    p1.y = canvas.height * 0.25;

    if (isMultiMode) {
        p2.reset();
        p2.x = canvas.width * 0.25;
        p2.y = canvas.height * 0.25;
    }

    obstacles = [];
    currentSpeed = baseSpeed;
    gameStarted = true;
    gameLoop();
}

// --- 4. PHYSICS & ACCELERATION ---
function updatePhysics(dt) {
    if (!gameStarted) return;

    const isGameOver = isMultiMode ? (!p1.alive && !p2.alive) : !p1.alive;
    
    if (isGameOver) {
        currentSpeed = 0;
        return;
    }

    totalDistance += (currentSpeed * dt) / 100;

    // Helper function for Rowing
    function applyRowing(pData, lastHandY) {
        if (pData.left?.wrist && pData.right?.wrist) {
            const currentHandY = (pData.left.wrist.y + pData.right.wrist.y) / 2;
            let handDownstroke = currentHandY - lastHandY;
            if (handDownstroke > 0.01) { 
                globalRowingBoost += handDownstroke * 150; 
            }
            return currentHandY;
        }
        return lastHandY;
    }

    // --- PLAYER 1 LOGIC ---
    if (p1Data && p1Data.active) {
        if (p1Data.nose && p1Data.x !== undefined) {
            // Calculation based on head relative to waist center
            let lean = p1Data.x - p1Data.nose.x; 
            if (Math.abs(lean) < 0.01) lean = 0;
            
            const adaptiveMultiplier = 25 / (p1Data.scale || 1.0);
            
            p1.x += lean * (steeringSensitivity * adaptiveMultiplier * dt);
        }
        p1HandLastY = applyRowing(p1Data, p1HandLastY);
    }

    // --- PLAYER 2 LOGIC ---
    if (isMultiMode && p2Data && p2Data.active) {
        if (p2Data.nose && p2Data.x !== undefined) {
            let lean2 = p2Data.x - p2Data.nose.x; 
            if (Math.abs(lean2) < 0.01) lean2 = 0;
            p2.x += lean2 * (steeringSensitivity * 50 * dt);
        }
        p2HandLastY = applyRowing(p2Data, p2HandLastY);
    }

    // --- SPEED DECAY & CONSTRAINTS ---
    globalRowingBoost *= 0.92; 
    let targetSpeed = baseSpeed + globalRowingBoost;

    const friction = (targetSpeed < currentSpeed) ? 0.03 : 0.07;
    currentSpeed += (targetSpeed - currentSpeed) * friction;

    if (currentSpeed > maxSpeed) currentSpeed = maxSpeed;
    if (currentSpeed < baseSpeed) currentSpeed = baseSpeed;

    // --- BOUNDS ---
    if (isMultiMode) {
        // Keep them in their lanes
        p1.x = Math.max(60, Math.min(canvas.width / 2 - 40, p1.x));
        p2.x = Math.max(canvas.width / 2 + 40, Math.min(canvas.width - 60, p2.x));
    } else {
        p1.x = Math.max(60, Math.min(canvas.width - 60, p1.x));
    }

    updateObstacles(dt);
}

// --- 5. OBSTACLES ---
function updateObstacles(dt) {
    if(totalDistance < 30) return; // Delay obstacles until player has skied a bit
    if (Math.random() < 0.05 + (currentSpeed / 200)) {
        obstacles.push({
            x: Math.random() * canvas.width,
            y: canvas.height + 50,
            size: 45,
            type: Math.random() > 0.5 ? 'tree-small' : 'weed-small'
        });
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
        obstacles[i].y -= currentSpeed * dt; 

        // Collision Check
        if (p1.alive && Math.hypot(obstacles[i].x - p1.x, obstacles[i].y - p1.y) < 40) {
            p1.alive = false;
        }
        if (isMultiMode && p2.alive && Math.hypot(obstacles[i].x - p2.x, obstacles[i].y - p2.y) < 40) {
            p2.alive = false;
        }

        if (obstacles[i].y < -100) obstacles.splice(i, 1);
    }
}

// --- 6. RENDERING ---
function drawGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render Background
    laneOffset = (laneOffset - currentSpeed) % TILE_SIZE;
    for (let x = 0; x < canvas.width; x += TILE_SIZE) {
        for (let y = -TILE_SIZE; y < canvas.height + TILE_SIZE; y += TILE_SIZE) {
            ctx.drawImage(sprites['snow'], x, y + laneOffset, TILE_SIZE, TILE_SIZE);
        }
    }

    // Render Obstacles
    obstacles.forEach(obs => {
        ctx.drawImage(sprites[obs.type], obs.x - 32, obs.y - 32, 64, 64);
    });

    // --- HUD ---
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(20, 20, 320, 120); 
    ctx.fillStyle = "white";
    ctx.textAlign = "left";
    ctx.font = "bold 40px Arial"; 
    ctx.fillText(`${Math.round(currentSpeed * 2.5)} KM/H`, 40, 65);
    ctx.font = "24px Arial";
    ctx.fillStyle = "#00FF00";
    ctx.fillText(`DIST: ${Math.floor(totalDistance)}m`, 40, 110);

    // --- RESTORED PLAYERS ---
    if (p1.alive) ctx.drawImage(sprites[p1.spriteName], p1.x - 40, p1.y - 40, 80, 80);
    if (isMultiMode && p2.alive) ctx.drawImage(sprites[p2.spriteName], p2.x - 40, p2.y - 40, 80, 80);

    // Game Over
    if (!p1.alive && (isMultiMode ? !p2.alive : true)) {
        gameStarted = false;
        ctx.fillStyle = "rgba(0,0,0,0.9)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.font = "bold 80px Arial";
        ctx.fillText("CRASHED!", canvas.width / 2, canvas.height / 2 - 40);
        ctx.font = "bold 45px Arial";
        ctx.fillStyle = "#00FF00";
        ctx.fillText(`${Math.floor(totalDistance)} METERS`, canvas.width / 2, canvas.height / 2 + 40);
    }
}

function gameLoop() {
    if (!gameStarted) return;
    if (isGameOver) {
        currentSpeed = 0;
        return;
    }
    const currentTime = performance.now();
    const elapsed = currentTime - lastTime;
    if (elapsed < frameInterval) {
        animationFrameId = requestAnimationFrame(gameLoop);
        return;
    }
    let dt = elapsed / frameInterval;
    if (dt > 2.0) dt = 2.0; 
    lastTime = currentTime - (elapsed % frameInterval);

    updatePhysics(dt);
    drawGame();
    if (!isGameOver) {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}