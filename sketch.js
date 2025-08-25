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

// camera UI
let currentStream = null, deviceId = null, selectedDeviceId = null;

// Bio state
let webcam, modelsReady = false, bioTimerId = null;
let offCanvas = null, offCtx = null;

let bioState = {
  gaze:  { x: 0.5, y: 0.5 },
  happy: 0,
  sad:   0,
  angry: 0
};

// ===== Emotion thresholds & hysteresis =====
const EMO = {
  // show this emotion if its value >= on; keep it until it drops < off
  HAPPY_ON: 0.28, HAPPY_OFF: 0.22,
  SAD_ON:   0.24, SAD_OFF:   0.18,
  ANGRY_ON: 0.26, ANGRY_OFF: 0.20,

  // minimum to consider anything "dominant" at all
  MIN_DOMINANT: 0.18
};

// ===== Emotion decision config (INCLUDING NEUTRAL) =====
// We work on normalized shares over {happy, sad, angry, neutral}
const EMO_CFG = {
  // To switch INTO an emotion, its share must be >= ON and beat #2 by MARGIN
  ON:           0.40,   // 0.38–0.46 (lower = more sensitive)
  OFF:          0.33,   // 0.30–0.40 (lower = stickier once chosen)
  NEUTRAL_ON:   0.58,   // neutral is "dominant" if >= this
  NEUTRAL_OFF:  0.40,   // must drop below this before leaving neutral
  MARGIN:       0.05,   // top - second >= margin
  COOLDOWN_MS:  2200    // min time between switches (helps stability)
};
// Raw-force gates (post-EMA): if these are exceeded, allow the emotion even if margin is tight
const EMO_FORCE = {
  SAD_RAW:   0.38,   // if smoothed sad ≥ 0.38, let SAD win unless neutral is extremely high
  HAPPY_RAW: 0.42,
  ANGRY_RAW: 0.40
};
let lastEmotion = 'neutral'; // remember last shown to apply hysteresis
let lastSwitchMs = 0;

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
    octx = overlay.getContext('2d', { willReadFrequently: true });
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
    offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (offCanvas.width !== w || offCanvas.height !== h) {
    offCanvas.width = w;
    offCanvas.height = h;
  }

  return offCanvas;
}

// ===== Decision function =====
function dominantEmotion() {
  // raw (already EMA-smoothed in sampleBio)
  const h = Number(bioState.happy  || 0);
  const s = Number(bioState.sad    || 0);
  const a = Number(bioState.angry  || 0);

  // neutral: prefer face-api's value if available; else derive as leftover
  const nRaw = (bioState.neutral != null) ? Number(bioState.neutral) : 0;
  const n = nRaw > 0 ? nRaw : Math.max(0, 1 - (h + s + a));

  // normalized shares over all four
  const sum = h + s + a + n + 1e-6;
  const shares = [
    { k: 'happy',   v: h / sum },
    { k: 'sad',     v: s / sum },
    { k: 'angry',   v: a / sum },
    { k: 'neutral', v: n / sum }
  ].sort((x, y) => y.v - x.v);

  const now = (typeof millis === 'function') ? millis() : Date.now();
  const inCooldown = (now - lastSwitchMs) < EMO_CFG.COOLDOWN_MS;
  const neutralShare = shares.find(x => x.k === 'neutral').v;

  // --- Hysteresis: hold current state when still above OFF thresholds ---
  if (lastEmotion === 'neutral') {
    if (neutralShare >= EMO_CFG.NEUTRAL_OFF) return 'neutral';
  } else {
    const curShare = shares.find(x => x.k === lastEmotion)?.v || 0;
    if (curShare >= EMO_CFG.OFF) return lastEmotion;
  }

  // --- Strong neutral case ---
  if (shares[0].k === 'neutral' && shares[0].v >= EMO_CFG.NEUTRAL_ON) {
    if (!inCooldown || lastEmotion !== 'neutral') {
      lastEmotion = 'neutral'; lastSwitchMs = now;
    }
    return 'neutral';
  }

  // --- Non-neutral decision with margin & raw punch-through ---
  // Consider only H/S/A for ranking
  const hsa = shares.filter(x => x.k !== 'neutral').sort((x,y)=>y.v-x.v);
  const top = hsa[0], second = hsa[1];

  // Raw-force gates (help break out of neutral when a raw signal is clearly high)
  if (h >= EMO_FORCE.HAPPY_RAW && (!inCooldown || lastEmotion !== 'happy')) {
    lastEmotion = 'happy'; lastSwitchMs = now; return 'happy';
  }
  if (s >= EMO_FORCE.SAD_RAW && (!inCooldown || lastEmotion !== 'sad')) {
    lastEmotion = 'sad'; lastSwitchMs = now; return 'sad';
  }
  if (a >= EMO_FORCE.ANGRY_RAW && (!inCooldown || lastEmotion !== 'angry')) {
    lastEmotion = 'angry'; lastSwitchMs = now; return 'angry';
  }

  // Normal threshold + margin
  if (top.v >= EMO_CFG.ON && (top.v - second.v) >= EMO_CFG.MARGIN) {
    if (!inCooldown || lastEmotion !== top.k) {
      lastEmotion = top.k; lastSwitchMs = now;
    }
    return lastEmotion;
  }

  // Prefer neutral if it’s reasonably high
  if (neutralShare >= EMO_CFG.NEUTRAL_OFF) {
    if (!inCooldown || lastEmotion !== 'neutral') {
      lastEmotion = 'neutral'; lastSwitchMs = now;
    }
    return 'neutral';
  }

  // Otherwise hold prior state on weak/ambiguous signals
  return lastEmotion;
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
  if (modeSelect) {
    currentMode = modeSelect.value;
    modeSelect.onchange = () => {
      currentMode = modeSelect.value;
      restart(true);
    }
  }
  // *** Remove newGameBtn ***
  // const newGameBtn = document.getElementById('newGameBtn');
  // if (newGameBtn) {
  //   newGameBtn.onclick = () => {
  //     if (modeSelect) currentMode = modeSelect.value;
  //     restart(true);
  //   };
  // }

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
  wirePreviewToggle();
  listCameras();
  loop();

  const sel = document.getElementById('cameraSelect');
  if (sel) {
    sel.onchange = () => {
      selectedDeviceId = sel.value;  // persist user choice
      restartWebcam();
    };
  }

  // Watch for cameras being added/removed
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      await listCameras();
      const sel = document.getElementById('cameraSelect');
      if (sel && selectedDeviceId) sel.value = selectedDeviceId;
    });
  }  

}

function draw() {
  fitCanvasToViewport();
  background(200, 230, 255);

  // ----- TIMER / HUD -----
  const timeLeft = Math.max(0, GAME_DURATION - Math.floor((millis() - startTime) / 1000));
  document.getElementById('scoreChip').textContent = `Score: ${score}`;
  document.getElementById('timeChip').textContent = `Time: ${timeLeft}`;

  // ----- BIO UI + per-frame speed multiplier -----
  const bioChip = document.getElementById('bioChip');
  const camControls = document.getElementById('camControls');

  // Default multiplier per mode; computed once per frame
  let modeSpeedMult = 1.0;

  if (currentMode === 'classic') {
    // classic feels calmer on phones; cap will be applied per-bubble
    modeSpeedMult = CLASSIC_SPEED_SCALE; // e.g., 0.75
    camControls?.classList.add('hiddenCamControls');
    bioChip?.classList.add('hiddenChip');
  }
  else if (currentMode === 'challenge') {
    modeSpeedMult = 1.3;
    camControls?.classList.add('hiddenCamControls');
    bioChip?.classList.add('hiddenChip');
  }
  else if (currentMode === 'bio') {
    // show camera controls + bio chip, and style chip by dominant emotion
    camControls?.classList.remove('hiddenCamControls');
    bioChip?.classList.remove('hiddenChip');

    const emo = dominantEmotion(); // uses your thresholds/hysteresis
    bioChip.textContent = emo.toUpperCase();

    if (emo === 'happy') {
      bioChip.style.background = 'rgba(120,255,160,.85)';
      modeSpeedMult = 1.3;
    } else if (emo === 'sad') {
      bioChip.style.background = 'rgba(120,160,255,.85)';
      modeSpeedMult = 0.7;
    } else if (emo === 'angry') {
      // speed unchanged; size boost handled in currentRadius()
      bioChip.style.background = 'rgba(255,140,140,.85)';
      modeSpeedMult = 1.0;
    } else {
      // neutral
      bioChip.style.background = 'rgba(255,255,255,.85)';
      modeSpeedMult = 1.0;
    }
  }

  // ----- UPDATE & DRAW BUBBLES -----
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];

    // slight heading jitter so paths aren’t perfectly straight
    b.direction += random(-0.35, 0.35);

    // compute radius (angry increases size inside currentRadius)
    const r = currentRadius(b);

    // apply per-mode speed once per bubble
    if (currentMode === 'classic') {
      b.speed = min(b._baseSpeed * modeSpeedMult, CLASSIC_SPEED_CAP);
    } else if (currentMode === 'challenge') {
      b.speed = b._baseSpeed * modeSpeedMult;
    } else if (currentMode === 'bio') {
      // keep movement sane
      b.speed = b._baseSpeed * constrain(modeSpeedMult, 0.5, 1.6);
    }

    // secondary manual clamp (walls are primary)
    if (b.x < r) { b.x = r; b.direction = 180 - b.direction; }
    if (b.x > width - r) { b.x = width - r; b.direction = 180 - b.direction; }
    if (b.y < r) { b.y = r; b.direction = 360 - b.direction; }
    if (b.y > height - r) { b.y = height - r; b.direction = 360 - b.direction; }

    // draw bubble + highlight
    const drawD = r * 2;
    if (b._type === 'trick') fill(255, 120, 120, 170);
    else fill(b._tint);
    circle(b.x, b.y, drawD);
    fill(255, 255, 255, 60);
    circle(b.x - drawD * 0.2, b.y - drawD * 0.2, drawD * 0.4);
  }

  // ----- END GAME -----
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
      // add SSD MobileNet fallback:
      // faceapi.nets.ssdMobilenetv1.loadFromUri('./models')
    ]);
  } catch (e) {
    console.warn('Model load error:', e);
  }
}

// Camera functions
function prettyCamLabel(label, i) {
  if (!label) return `Camera ${i+1}`;
  // Strip common trailing IDs like "(0x1234:0xabcd)" or "(Built-in)"
  // and random hex blobs; tweak as needed for your machines
  return label
    .replace(/\s*\((?:VID|PID|USB|[0-9a-f]{4}:[0-9a-f]{4}|[^\)]*)\)\s*$/i, '')
    .replace(/\s*-\s*[0-9a-f]{4}:[0-9a-f]{4}\s*$/i, '')
    .trim();
}

async function listCameras() {
  const sel = document.getElementById('cameraSelect');
  if (!navigator.mediaDevices?.enumerateDevices || !sel) return;

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === 'videoinput');
  
  sel.innerHTML = '';
  cams.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = c.deviceId || ''; // some browsers hide deviceId until permission
    opt.textContent = prettyCamLabel(c.label, i);       // show a cleaned label
    sel.appendChild(opt);
  });
  // If user already chose one, keep it; else pick a default
  if (selectedDeviceId && cams.some(c => c.deviceId === selectedDeviceId)) {
    sel.value = selectedDeviceId;
  } else if (cams.length) {
    // prefer front/integrated if available
    const front = cams.find(c => /front|user|face|integrated/i.test(c.label));
    selectedDeviceId = (front?.deviceId) || cams[0].deviceId || '';
    sel.value = selectedDeviceId;
  } else {
    selectedDeviceId = null;
  }
}

function wirePreviewToggle() {
  const previewToggle = document.getElementById('showPreview');
  const v = document.getElementById('webcam');
  if (previewToggle && v) {
    previewToggle.onchange = () => {
      if (previewToggle.checked) v.classList.remove('camHidden');
      else v.classList.add('camHidden');
    };
  }
}

function restartWebcam() { startWebcam(true); }

async function startWebcam(isRestart = false) {
  const v = document.getElementById('webcam');

  // stop old stream cleanly
  if (isRestart && currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
    v.srcObject = null; // clear element to avoid ghost frame
  }

  // try the selected device first
  let constraints = {
    video: selectedDeviceId
      ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // fallback if exact deviceId isn't available (OverconstrainedError or NotFoundError)
    console.warn('getUserMedia (exact device) failed, falling back to facingMode:user', e);
    constraints = {
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  }

  currentStream = stream;
  v.srcObject = stream;
  v.playsInline = true;
  v.muted = true;

  // 🔁 Sync selector to the ACTUAL track device
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings ? track.getSettings() : {};
  const actualId = settings.deviceId || selectedDeviceId; // Safari may omit

  const sel = document.getElementById('cameraSelect');
  if (actualId) {
    selectedDeviceId = actualId;
    if (sel) sel.value = actualId;
  } else if (sel) {
    // Fallback: match by label text if possible
    const label = track.label || '';
    const opt = [...sel.options].find(o => o.text === label);
    if (opt) {
      sel.value = opt.value;
      selectedDeviceId = opt.value;
    }
  }

  // Re-enumerate AFTER permission so labels populate
  setTimeout(listCameras, 400);

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
  bioState.neutral = ema(bioState.neutral || 0, ex.neutral || 0, 0.75);
  
  console.log('expr:',
    'happy', bioState.happy.toFixed(2),
    'sad',   bioState.sad.toFixed(2),
    'angry', bioState.angry.toFixed(2),
    'neutral', bioState.neutral.toFixed(2)
  );
}