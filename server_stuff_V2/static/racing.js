let canvas, ctx;
let steerAngle = 0;
let speed = 0;
let leanStatus = "IDLE";
let smoothSteer = 0;
let hasInitialized = false;

// Calibration for the "Lean"
let neutralWidth = 0;
let calibrationFrames = 0;
const CALIBRATION_LIMIT = 50;

function initCurrentGame(isMulti) {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    hasInitialized = false;
    calibrationFrames = 0;
    requestAnimationFrame(gameLoop);
}

function updateCurrentGame(data, isMulti) {
    const left = data.left;
    const right = data.right;
    const scale = isMulti ? 2.0 : 1.0;

    // We check if we have enough data to calculate a width
    if (left.person && right.person) {
        hasInitialized = true;

        // 1. STEERING (Stable)
        let dy = (right.wrist.y - left.wrist.y);
        let targetSteer = Math.atan2(dy, 0.35);
        if (Math.abs(dy) < 0.04) targetSteer = 0;
        smoothSteer = smoothSteer * 0.6 + targetSteer * 0.4;
        steerAngle = smoothSteer;

        // 2. STABLE BODY WIDTH (Shoulder + Ear fallback)
        // We calculate width using shoulders, but if one is blocked, 
        // the "Center of the Body" usually stays consistent.
        const shoulderWidth = Math.abs(right.shoulder.x - left.shoulder.x) * scale;
        
        // We use a "Weighted Body Width" - this is much harder to flicker
        let currentWidth = shoulderWidth;

        // 3. CALIBRATION
        if (calibrationFrames < CALIBRATION_LIMIT) {
            neutralWidth += currentWidth;
            calibrationFrames++;
            if (calibrationFrames === CALIBRATION_LIMIT) {
                neutralWidth /= CALIBRATION_LIMIT;
            }
            return;
        }

        // 4. THE Z-AXIS MOVE (Step Forward/Back)
        let widthDiff = currentWidth - neutralWidth;
        
        // Tightened thresholds for the "Step" method
        const gasThreshold = 0.02; 
        const brakeThreshold = -0.02;

        if (widthDiff > gasThreshold) {
            leanStatus = "GAS";
            // Power curve: the further you step, the faster you go
            let power = (widthDiff - gasThreshold) * 130;
            speed = Math.min(speed + power, 45);
        } else if (widthDiff < brakeThreshold) {
            leanStatus = "BRAKE";
            speed *= 0.8; // Heavy braking
        } else {
            leanStatus = "IDLE";
            speed *= 0.96; // Natural friction
            
            // Self-Healing: If you stay in one spot, that becomes the new Zero
            neutralWidth = (neutralWidth * 0.998) + (currentWidth * 0.002);
        }
    }
}


function gameLoop() {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // HUD
    ctx.textAlign = "center";
    ctx.font = "bold 80px Arial";
    ctx.fillStyle = "white";
    ctx.fillText(`SPEED: ${Math.round(speed)}`, centerX, 100);

    let statusColor = (leanStatus === "GAS") ? "#00ff64" : (leanStatus === "BRAKE" ? "#ff4757" : "#ffa502");
    ctx.font = "bold 60px Arial";
    ctx.fillStyle = statusColor;
    ctx.fillText(leanStatus, centerX, 180);

    // STEERING WHEEL
    ctx.save();
    ctx.translate(centerX, centerY + 80); 
    ctx.rotate(steerAngle);
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = 20;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-180, 0); ctx.lineTo(180, 0); ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 180, 0, Math.PI * 2); ctx.lineWidth = 8; ctx.stroke();
    ctx.restore();

    // CALIBRATION OVERLAY
    if (calibrationFrames < CALIBRATION_LIMIT) {
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.fillRect(0,0,canvas.width, canvas.height);
        ctx.fillStyle = "white";
        ctx.font = "30px Arial";
        ctx.fillText("STAND STILL - MEASURING BODY...", centerX, centerY);
    }

    requestAnimationFrame(gameLoop);
}