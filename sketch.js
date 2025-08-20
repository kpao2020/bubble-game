// ===== Game constants =====
const GAME_DURATION = 30;            // seconds
const START_BUBBLES = 24;
const MIN_DIAM = 50, MAX_DIAM = 88;  // per your request
const MIN_SPEED = 1.6, MAX_SPEED = 3.8;

// Touch + classic tuning
const TOUCH_HIT_PAD = 12;            // extra px on mobile hit radius
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const CLASSIC_SPEED_SCALE = 0.75;    // classic is friendlier on phones
const CLASSIC_SPEED_CAP   = 3.0;

// Modes
let currentMode = 'classic'; // 'classic' | 'challenge' | 'bio'
const CHALLENGE_TRICK_RATE = 0.22;   // ~22% trick bubbles (-1 score)

// p5play groups + state
let bubbles;     // dynamic group
let walls;       // static edge walls

let score = 0;
let startTime = 0;
let gameOver = false;

// Bio state
let webcam, modelsReady = false, bioTimerId = null;
let offCanvas = null, offCtx = null;

let bioState = {
  gaze:  { x: 0.5, y: 0.5 },
  happy: 0,
  sad:   0,
  angry: 0
};

// Overlay canvas that sits exactly on top of the preview video on screen
let overlay, octx;

function ensureOverlay() {
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.id = '__bioOverlay';
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = 9999;
    document.body.appendChild(overlay);
    octx = overlay.getContext('2d');
  }
  const vid = document.getElementById('webcam');
  const rect = vid.getBoundingClientRect();
  // Match overlay to the *on-screen* preview box
  overlay.style.left = rect.left + 'px';
  overlay.style.top  = rect.top + 'px';
  overlay.style.width  = rect.width + 'px';
  overlay.style.height = rect.height + 'px';

  // Use the video’s native pixels for drawing accuracy
  overlay.width  = vid.videoWidth  || 640;
  overlay.height = vid.videoHeight || 480;
}


// ===== Viewport sizing =====
function viewportW() {
  return (window.visualViewport ? Math.round(window.visualViewport.width) : window.innerWidth);
}
function viewportH() {
  return (window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight);
}
function fitCanvasToViewport() {
  const w = viewportW();
  const h = viewportH();
  if (width !== w || height !== h) resizeCanvas(w, h);
  rebuildWallsIfNeeded();
}

// ===== Walls (static colliders to keep sprites in-bounds) =====
function buildWalls() {
  if (walls) {
    for (let i = walls.length - 1; i >= 0; i--) walls[i].remove();
  }
  walls = new Group();
  walls.collider = 'static';
  walls.color = color(255, 255, 255, 0);

  const T = 40; // thickness
  // left, right, top, bottom
  const wl = new Sprite(-T/2, height/2, T, height, 'static');
  const wr = new Sprite(width+T/2, height/2, T, height, 'static');
  const wt = new Sprite(width/2, -T/2, width, T, 'static');
  const wb = new Sprite(width/2, height+T/2, width, T, 'static');

  walls.add(wl); walls.add(wr); walls.add(wt); walls.add(wb);
}
function rebuildWallsIfNeeded() {
  if (!walls || walls.length < 4) { buildWalls(); return; }
  // if size changed notably, rebuild
  const any = walls[0];
  if (Math.abs(any.y - height/2) > 2 || Math.abs(any.h - height) > 2) buildWalls();
}

// ===== Helpers =====
function ensureOffcanvas(w = 416, h = 416) {
  if (!offCanvas) {
    offCanvas = document.createElement('canvas');
    offCtx = offCanvas.getContext('2d');
  }
  if (offCanvas.width !== w || offCanvas.height !== h) {
    offCanvas.width = w;
    offCanvas.height = h;
  }
  return offCanvas;
}

function dominantEmotion() {
  const vals = [
    { k: 'happy', v: bioState.happy || 0 },
    { k: 'sad',   v: bioState.sad   || 0 },
    { k: 'angry', v: bioState.angry || 0 }
  ].sort((a,b)=>b.v-a.v);
  return (vals[0].v >= 0.20) ? vals[0].k : 'neutral'; // lower threshold so it registers
}

function currentRadius(b) {
  const baseD    = (typeof b.diameter  === 'number' && isFinite(b.diameter))  ? b.diameter  : MIN_DIAM;
  const hitScale = (typeof b._hitScale === 'number' && isFinite(b._hitScale)) ? b._hitScale : 1;
  const angry    = (currentMode === 'bio') ? Number(bioState?.angry || 0) : 0;
  const angryScale = 1 + 0.35 * constrain(angry, 0, 1);
  const d = baseD * hitScale * angryScale;
  return max(1, d * 0.5);
}

// ===== p5 lifecycle =====
function setup() {
  createCanvas(viewportW(), viewportH());
  noStroke();

  // Modes UI hookup
  const modeSelect = document.getElementById('modeSelect');
  if (modeSelect) currentMode = modeSelect.value;
  const newGameBtn = document.getElementById('newGameBtn');
  if (newGameBtn) {
    newGameBtn.onclick = () => {
      if (modeSelect) currentMode = modeSelect.value;
      restart(true);
    };
  }

  // Physics world
  world.gravity.y = 0;

  bubbles = new Group();
  bubbles.collider = 'dynamic';
  bubbles.bounciness = 1;
  bubbles.friction = 0;
  bubbles.drag = 0;

  for (let i = 0; i < START_BUBBLES; i++) spawnBubble();

  score = 0;
  startTime = millis();
  gameOver = false;

  // end-game UI hidden
  const centerEl = document.getElementById('center');
  const btn = document.getElementById('restartBtn');
  if (centerEl) centerEl.style.display = 'none';
  if (btn) {
    btn.style.display = 'none';
    btn.onclick = () => restart(false);
  }

  // Build edge walls
  buildWalls();

  // Bio models + webcam
  loadFaceApiModels();
  startWebcam();

  // Keep canvas in sync with visible viewport
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fitCanvasToViewport);
    visualViewport.addEventListener('scroll', fitCanvasToViewport);
  }

  listCameras();
  loop();
}

function draw() {
  fitCanvasToViewport();
  background(200, 230, 255);

  // Update bubbles
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    let r = currentRadius(b);

    // Slight heading jitter so paths aren’t perfectly straight
    b.direction += random(-0.35, 0.35);

    // Mode-based speed scaling & challenge trick tint
    if (currentMode === 'classic') {
      b.speed = min(b._baseSpeed * CLASSIC_SPEED_SCALE, CLASSIC_SPEED_CAP);
    } else if (currentMode === 'challenge') {
      b.speed = b._baseSpeed * 1.3;
    } else if (currentMode === 'bio') {
      const speedScale = 1 + 0.30 * bioState.happy - 0.30 * bioState.sad;
      b.speed = b._baseSpeed * constrain(speedScale, 0.5, 1.6);
    }

    // Manual clamp as a second layer (walls are primary)
    if (b.x < r) { b.x = r; b.direction = 180 - b.direction; }
    if (b.x > width - r) { b.x = width - r; b.direction = 180 - b.direction; }
    if (b.y < r) { b.y = r; b.direction = 360 - b.direction; }
    if (b.y > height - r) { b.y = height - r; b.direction = 360 - b.direction; }

    // Draw
    const drawD = r * 2;
    if (b._type === 'trick') fill(255, 120, 120, 170);
    else fill(b._tint);
    circle(b.x, b.y, drawD);
    fill(255,255,255,60);
    circle(b.x - drawD * 0.2, b.y - drawD * 0.2, drawD * 0.4);
  }

  // HUD
  const timeLeft = Math.max(0, GAME_DURATION - Math.floor((millis() - startTime) / 1000));
  document.getElementById('scoreChip').textContent = `Score: ${score}`;
  document.getElementById('timeChip').textContent = `Time: ${timeLeft}`;

  // Bio chip update (center of top bar)
  const bioChip = document.getElementById('bioChip');

  if (currentMode === 'bio') {
    bioChip.classList.remove('hiddenChip');   // show but keep layout stable
    const emo = dominantEmotion();
    bioChip.textContent = emo.toUpperCase();
    if (emo === 'happy') bioChip.style.background = 'rgba(120,255,160,.85)';
    else if (emo === 'sad') bioChip.style.background = 'rgba(120,160,255,.85)';
    else if (emo === 'angry') bioChip.style.background = 'rgba(255,140,140,.85)';
    else bioChip.style.background = 'rgba(255,255,255,.85)';
  } else {
    bioChip.classList.add('hiddenChip');      // hide but keep the middle column
    // optional: reset text/background
    bioChip.textContent = '';
    bioChip.style.background = 'rgba(255,255,255,.85)';
  }

  if (!gameOver && timeLeft <= 0) endGame();
}

// ===== Gameplay =====
function spawnBubble() {
  const d = random(MIN_DIAM, MAX_DIAM);
  const r = d / 2;

  let angle = random(TWO_PI);
  const HORIZ_EPS = 0.2; // nudge off near-horizontal starts
  if (abs(sin(angle)) < HORIZ_EPS) angle += PI / 4;

  const speed = random(MIN_SPEED, MAX_SPEED);

  // Spawn position (Bio biases toward gaze)
  let sx, sy;
  if (currentMode === 'bio') {
    const biasX = width  * bioState.gaze.x;
    const biasY = height * bioState.gaze.y;
    sx = constrain(lerp(random(r, width - r),  biasX, 0.6), r, width - r);
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
  b._hitScale = 1;

  // Challenge trick bubbles
  b._type = (currentMode === 'challenge' && random() < CHALLENGE_TRICK_RATE) ? 'trick' : 'normal';

  bubbles.add(b);
  return b;
}

function handlePop(px, py) {
  if (gameOver) return;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    const r = currentRadius(b);
    const rHit = r + (IS_TOUCH ? TOUCH_HIT_PAD : 0); // bigger touch hitbox
    const dx = px - b.x, dy = py - b.y;
    if (dx * dx + dy * dy <= rHit * rHit) {
      // score
      if (b._type === 'trick') score = max(0, score - 1);
      else score++;

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
  // no return false; (don’t block buttons)
}

function endGame() {
  gameOver = true;
  noLoop();
  const centerEl = document.getElementById('center');
  const btn = document.getElementById('restartBtn');
  if (centerEl) {
    centerEl.textContent = `Game Over!\nScore: ${score}`;
    centerEl.style.display = 'block';
  }
  if (btn) btn.style.display = 'block';
}

function restart(fromModeButton) {
  for (let i = bubbles.length - 1; i >= 0; i--) bubbles[i].remove();
  for (let i = 0; i < START_BUBBLES; i++) spawnBubble();

  score = 0;
  startTime = millis();
  gameOver = false;

  const centerEl = document.getElementById('center');
  const btn = document.getElementById('restartBtn');
  if (centerEl) { centerEl.textContent = ''; centerEl.style.display = 'none'; }
  if (btn) { btn.style.display = 'none'; btn.blur?.(); }

  if (fromModeButton) lastBioSample = 0; // harmless if not defined

  loop();
}

function windowResized() { fitCanvasToViewport(); }

// ===== Bio (face-api.js) =====
async function loadFaceApiModels() {
  if (typeof faceapi === 'undefined') { setTimeout(loadFaceApiModels, 300); return; }
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
      faceapi.nets.faceExpressionNet.loadFromUri('./models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('./models')
      // If you later add SSD MobileNet fallback:
      // faceapi.nets.ssdMobilenetv1.loadFromUri('./models')
    ]);
  } catch (e) {
    console.warn('Model load error:', e);
  }
}

function startWebcam(isRestart=false) {
  const v = document.getElementById('webcam');
  const constraints = {
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  };

  if (isRestart && currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }

  navigator.mediaDevices.getUserMedia(constraints).then(stream => {
    currentStream = stream;
    v.srcObject = stream;
    v.playsInline = true;
    v.muted = true;

    const startSampler = () => {
      modelsReady = true;
      if (!bioTimerId) {
        bioTimerId = setInterval(() => {
          if (document.hidden) return;
          if (v.readyState >= 2) sampleBio();
        }, 5000);
      }
    };
    v.addEventListener('playing', startSampler, { once: true });
    v.addEventListener('loadeddata', startSampler, { once: true });

    // populate device list (labels appear after permission)
    setTimeout(listCameras, 500);
  }).catch(err => console.error('Webcam error:', err));
}

function ema(prev, next, a = 0.75) {
  return prev == null ? next : (a * next + (1 - a) * prev);
}

async function sampleBio() {
  const v = document.getElementById('webcam');
  if (!modelsReady || typeof faceapi === 'undefined' || !v || v.readyState < 2) return;

  // Larger inputSize + low threshold = more robust
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.15 });

  let detections = [];
  try {
    detections = await faceapi
      .detectAllFaces(v, opts)
      .withFaceLandmarks()
      .withFaceExpressions();
  } catch (e) {
    console.warn('detectAllFaces full pipeline error:', e);
    return;
  }

  console.log('faces detected:', detections.length);
  if (!detections.length) {
    // decay toward neutral if no face this tick
    bioState.happy = ema(bioState.happy || 0, 0, 0.3);
    bioState.sad   = ema(bioState.sad   || 0, 0, 0.3);
    bioState.angry = ema(bioState.angry || 0, 0, 0.3);
    // clear overlay if showing
    if (overlay) { octx.clearRect(0,0,overlay.width,overlay.height); }
    return;
  }

  // choose largest face
  detections.sort((a,b) => (b.detection.box.area - a.detection.box.area));
  const det = detections[0];

  // --- Draw green box in correct place, accounting for mirror ---
  if (document.getElementById('webcam').classList.contains('preview')) {
    ensureOverlay();
    octx.clearRect(0, 0, overlay.width, overlay.height);

    const box = det.detection.box; // in video pixel coords (not CSS)
    octx.save();
    // Mirror horizontally to match preview's scaleX(-1)
    octx.translate(overlay.width, 0);
    octx.scale(-1, 1);

    octx.strokeStyle = 'lime';
    octx.lineWidth = 4;
    octx.strokeRect(box.x, box.y, box.width, box.height);

    octx.restore();
  }

  // --- Expressions (smooth to reduce jitter) ---
  const ex = det.expressions || {};
  bioState.happy = ema(bioState.happy || 0, ex.happy || 0, 0.75);
  bioState.sad   = ema(bioState.sad   || 0, ex.sad   || 0, 0.75);
  bioState.angry = ema(bioState.angry || 0, ex.angry || 0, 0.75);

  console.log('expr:',
    'happy', bioState.happy.toFixed(2),
    'sad',   bioState.sad.toFixed(2),
    'angry', bioState.angry.toFixed(2)
  );
}



let currentStream = null, deviceId = null;

async function listCameras() {
  const sel = document.getElementById('cameraSelect');
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === 'videoinput');
  sel.innerHTML = '';
  cams.forEach((c,i) => {
    const opt = document.createElement('option');
    opt.value = c.deviceId;
    opt.textContent = c.label || `Camera ${i+1}`;
    sel.appendChild(opt);
  });
  const front = cams.find(c => /front|user|face/i.test(c.label));
  deviceId = (front?.deviceId) || (cams[0]?.deviceId) || null;
  if (deviceId) sel.value = deviceId;
  sel.onchange = () => { deviceId = sel.value; restartWebcam(); };

  const previewToggle = document.getElementById('showPreview');
  previewToggle.onchange = () => {
    const v = document.getElementById('webcam');
    if (previewToggle.checked) { v.classList.add('preview'); v.classList.remove('hiddenVideo'); }
    else { v.classList.remove('preview'); v.classList.add('hiddenVideo'); }
  };
}

function restartWebcam() { startWebcam(true); }
