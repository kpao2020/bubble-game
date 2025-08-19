// Global variables
const GAME_DURATION = 30;
const START_BUBBLES = 24;
const MIN_DIAM = 50, MAX_DIAM = 88;
const MIN_SPEED = 1.6, MAX_SPEED = 3.8;

let bubbles; // p5play Group
let score = 0;
let startTime = 0;
let gameOver = false;
let webcam;   // HTML video element
let modelsReady = false;

// ---- Modes ----
let currentMode = 'classic'; // 'classic' | 'challenge' | 'bio'

// Challenge mode settings
const CHALLENGE_TRICK_RATE = 0.22; // 22% trick bubbles

// Bio-Responsive state
let bioState = {
  gaze: { x: 0.5, y: 0.5 },  // 0..1
  happy: 0,                   // 0..1
  sad: 0,                     // 0..1
  angry: 0                    // 0..1
};
let lastBioSample = 0;
const BIO_SAMPLE_MS = 5000;

function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();

  // === UI for modes ===
  const modeSelect = document.getElementById('modeSelect');
  if (modeSelect) {
    currentMode = modeSelect.value;
  }
  const newGameBtn = document.getElementById('newGameBtn');
  if (newGameBtn) {
    newGameBtn.onclick = () => {
      if (modeSelect) currentMode = modeSelect.value;
      restart(true); // fresh session with new mode
    };
  }

  // Physics world
  world.gravity.y = 0;

  // Group config
  bubbles = new Group();
  bubbles.collider = 'dynamic';
  bubbles.bounciness = 1;
  bubbles.friction = 0;
  bubbles.drag = 0;

  for (let i = 0; i < START_BUBBLES; i++) spawnBubble();

  score = 0;
  startTime = millis();
  gameOver = false;

  // clear overlays
  const centerEl = document.getElementById('center');
  const btn = document.getElementById('restartBtn');
  if (centerEl) centerEl.style.display = 'none';
  if (btn) {
    btn.style.display = 'none';
    btn.onclick = () => restart(false);
  }

  // === Bio input setup ===
  webcam = document.getElementById('webcam');
  Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
    faceapi.nets.faceExpressionNet.loadFromUri('/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/models')
  ]).then(startWebcam);

  function startWebcam() {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        webcam.srcObject = stream;
        modelsReady = true;
      })
      .catch(err => console.error("Webcam error:", err));
  }

  loop();
}

function currentRadius(b) {
  // safe numbers
  const baseD    = (typeof b.diameter  === 'number' && isFinite(b.diameter))  ? b.diameter  : MIN_DIAM;
  const hitScale = (typeof b._hitScale === 'number' && isFinite(b._hitScale)) ? b._hitScale : 1;
  const angry    = (currentMode === 'bio') ? Number(bioState?.angry || 0) : 0;

  // angry enlarges bubbles up to +35%
  const angryScale = 1 + 0.35 * constrain(angry, 0, 1);

  const d = baseD * hitScale * angryScale;
  return max(1, d * 0.5); // radius, never below 1
}


function draw() {
  background(200, 230, 255);

  // --- Bio sampling (placeholder) ---
  if (currentMode === 'bio' && millis() - lastBioSample > BIO_SAMPLE_MS) {
    sampleBioPlaceholder(); // TODO: replace with real webcam input
    lastBioSample = millis();
  }

  // update & draw
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const r = currentRadius(b);

    // Mode-based speed scaling (Bio uses expression)
    if (currentMode === 'classic') {
      b.speed = b._baseSpeed;
    } else if (currentMode === 'challenge') {
      b.speed = b._baseSpeed * 1.3; // faster overall
    } else if (currentMode === 'bio') {
      // Speed: happy speeds up (+30%), sad slows down (-30%)
      const speedScale = 1 + 0.30 * bioState.happy - 0.30 * bioState.sad;
      b.speed = b._baseSpeed * constrain(speedScale, 0.5, 1.6);
    }


    // edge reflect
    if (b.x < r) { b.x = r; b.direction = 180 - b.direction; }
    if (b.x > width - r) { b.x = width - r; b.direction = 180 - b.direction; }
    if (b.y < r) { b.y = r; b.direction = 360 - b.direction; }
    if (b.y > height - r) { b.y = height - r; b.direction = 360 - b.direction; }

    // draw (type tint difference)
    const angryScale = 1 + 0.35 * (currentMode === 'bio' ? bioState.angry : 0); // up to +35%
    const drawD = b.diameter * b._hitScale * angryScale;  // if you kept _hitScale from polish
    fill(b._tint);
    circle(b.x, b.y, drawD);
    fill(255,255,255,60);
    circle(b.x - drawD * 0.2, b.y - drawD * 0.2, drawD * 0.4);
  }

  // HUD
  const timeLeft = Math.max(0, GAME_DURATION - Math.floor((millis() - startTime) / 1000));
  document.getElementById('scoreChip').textContent = `Score: ${score}`;
  document.getElementById('timeChip').textContent = `Time: ${timeLeft}`;

  if (!gameOver && timeLeft <= 0) endGame();
}

function spawnBubble() {
  const d = random(MIN_DIAM, MAX_DIAM);
  const r = d / 2;

  let angle = random(TWO_PI);
  const HORIZ_EPS = 0.2;
  if (abs(sin(angle)) < HORIZ_EPS) angle += PI / 4;

  const speed = random(MIN_SPEED, MAX_SPEED);

  // --- Mode-based spawn position ---
  let sx, sy;
  if (currentMode === 'bio') {
    // Bias toward gaze position (placeholder values 0..1)
    const biasX = width * bioState.gaze.x;
    const biasY = height * bioState.gaze.y;
    sx = constrain(lerp(random(r, width - r), biasX, 0.6), r, width - r);
    sy = constrain(lerp(random(r, height - r), biasY, 0.6), r, height - r);
  } else {
    sx = random(r, width - r);
    sy = random(r, height - r);
  }

  const b = new Sprite(sx, sy, d);
  b.shape = 'circle';
  b.color = color(255,255,255,0);
  b.diameter = d;
  b._tint = color(random(120, 210), random(140, 220), 255, 150);
  b._hitScale = 1; // <-- make sure this exists so math never NaNs

  b.direction = degrees(angle);
  b.speed = speed;
  b._baseSpeed = speed;

  b.mass = PI * r * r;
  b.rotationLock = true;

  // Trick bubbles (Challenge mode only)
  b._type = (currentMode === 'challenge' && random() < CHALLENGE_TRICK_RATE) ? 'trick' : 'normal';

  bubbles.add(b);
  return b;
}

function handlePop(px, py) {
  if (gameOver) return;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    const r = currentRadius(b);
    const dx = px - b.x, dy = py - b.y;
    if (dx * dx + dy * dy <= r * r) {
      if (b._type === 'trick') {
        // penalty
        score = max(0, score - 1);
      } else {
        score++;
      }
      b.remove();
      spawnBubble();
      break;
    }
  }
}

function mousePressed() { handlePop(mouseX, mouseY); }
function touchStarted() {
  if (touches && touches.length) {
    for (const t of touches) handlePop(t.x, t.y);
  } else {
    handlePop(mouseX, mouseY);
  }
  // do not prevent default; allows button clicks
}

function endGame() {
  gameOver = true;
  noLoop();
  const centerEl = document.getElementById('center');
  if (centerEl) {
    centerEl.textContent = `Game Over!\nScore: ${score}`;
    centerEl.style.display = 'block';
  }
  const btn = document.getElementById('restartBtn');
  if (btn) btn.style.display = 'block';
}

function restart(fromModeButton) {
  for (let i = bubbles.length - 1; i >= 0; i--) bubbles[i].remove();
  for (let i = 0; i < START_BUBBLES; i++) spawnBubble();

  score = 0;
  startTime = millis();
  gameOver = false;

  // reset UI
  const centerEl = document.getElementById('center');
  const btn = document.getElementById('restartBtn');
  if (centerEl) { centerEl.textContent = ''; centerEl.style.display = 'none'; }
  if (btn) { btn.style.display = 'none'; btn.blur?.(); }

  // reset bio timer when switching modes
  if (fromModeButton) lastBioSample = 0;

  loop();
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

async function sampleBioPlaceholder() {
  if (!modelsReady || typeof faceapi === 'undefined') return;

  const det = await faceapi
    .detectSingleFace(webcam, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceExpressions();

  if (det) {
    // Expressions: clamp to 0..1 (face-api already gives 0..1)
    bioState.happy = det.expressions.happy || 0;
    bioState.sad   = det.expressions.sad   || 0;
    bioState.angry = det.expressions.angry || 0;

    // Gaze approximation via eye landmarks → normalized 0..1
    const leftEye = det.landmarks.getLeftEye();
    const rightEye = det.landmarks.getRightEye();
    const eyes = [...leftEye, ...rightEye];
    const avgX = eyes.reduce((s,p)=>s+p.x,0)/eyes.length;
    const avgY = eyes.reduce((s,p)=>s+p.y,0)/eyes.length;
    const box = det.detection.box;
    bioState.gaze.x = constrain((avgX - box.x) / box.width, 0, 1);
    bioState.gaze.y = constrain((avgY - box.y) / box.height, 0, 1);
  }
}
