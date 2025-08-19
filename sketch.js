// sketch.js
const GAME_DURATION = 30;
const START_BUBBLES = 24;
const MIN_DIAM = 38, MAX_DIAM = 82;
const MIN_SPEED = 1.6, MAX_SPEED = 3.8;

let bubbles; // p5play Group
let score = 0;
let startTime = 0;
let gameOver = false;

// ---- Modes ----
let currentMode = 'classic'; // 'classic' | 'challenge' | 'bio'

// Challenge mode settings
const CHALLENGE_TRICK_RATE = 0.22; // 22% trick bubbles

// Bio-Responsive placeholders (to be replaced by webcam inputs)
let bioState = {
  gaze: { x: 0.5, y: 0.5 }, // normalized 0..1
  expression: 0.0            // 0..1 (e.g., smile intensity)
};
let lastBioSample = 0;
const BIO_SAMPLE_MS = 5000;

function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();

  // === UI wiring for modes ===
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
  const center = document.getElementById('center');
  const btn = document.getElementById('restartBtn');
  if (center) center.style.display = 'none';
  if (btn) {
    btn.style.display = 'none';
    btn.onclick = () => restart(false);
  }

  loop();
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
    const r = b.diameter * 0.5;

    // Mode-based speed scaling (Bio uses expression)
    if (currentMode === 'classic') {
      b.speed = b._baseSpeed;
    } else if (currentMode === 'challenge') {
      b.speed = b._baseSpeed * 1.3; // faster overall
    } else if (currentMode === 'bio') {
      const scale = map(bioState.expression, 0, 1, 0.9, 1.35);
      b.speed = b._baseSpeed * scale;
    }

    // edge reflect
    if (b.x < r) { b.x = r; b.direction = 180 - b.direction; }
    if (b.x > width - r) { b.x = width - r; b.direction = 180 - b.direction; }
    if (b.y < r) { b.y = r; b.direction = 360 - b.direction; }
    if (b.y > height - r) { b.y = height - r; b.direction = 360 - b.direction; }

    // draw (type tint difference)
    if (b._type === 'trick') fill(255, 120, 120, 170);
    else fill(b._tint);
    circle(b.x, b.y, b.diameter);
    fill(255,255,255,60);
    circle(b.x - r * 0.4, b.y - r * 0.4, r * 0.8);
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
    const r = b.diameter * 0.5;
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
  const center = document.getElementById('center');
  if (center) {
    center.textContent = `Game Over!\nScore: ${score}`;
    center.style.display = 'block';
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
  const center = document.getElementById('center');
  const btn = document.getElementById('restartBtn');
  if (center) { center.textContent = ''; center.style.display = 'none'; }
  if (btn) { btn.style.display = 'none'; btn.blur?.(); }

  // reset bio timer when switching modes
  if (fromModeButton) lastBioSample = 0;

  loop();
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

// ----- Bio placeholders (to be replaced by real webcam/mic) -----
function sampleBioPlaceholder() {
  // Simulate a “gaze” that drifts around the screen and an expression value 0..1
  const t = millis() / 3000;
  bioState.gaze.x = constrain(0.5 + 0.4 * sin(t + random(-0.2,0.2)), 0.05, 0.95);
  bioState.gaze.y = constrain(0.5 + 0.4 * cos(t + random(-0.2,0.2)), 0.05, 0.95);
  bioState.expression = constrain(noise(t * 0.3) + random(-0.15, 0.15), 0, 1);
}
