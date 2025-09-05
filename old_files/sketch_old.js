// ===== Game constants =====
const GAME_DURATION = 30;            // seconds
const START_BUBBLES = 24;
const MIN_DIAM = 50, MAX_DIAM = 88;  // per your request
const MIN_SPEED = 1.6, MAX_SPEED = 3.8;
const MIN_PLAY_SPEED = 0.9;   // floor after multipliers (tweak 0.8–1.0)

// How often to run face sampling
const BIO_SAMPLE_MS = 1000; // 1000 = 1 sec

// ——— Bio end-game strategy ———
// "pause": stop sampler only (recommended: instant resume, minimal delay)
// "stop":  stop sampler + camera tracks (saves more battery, slower resume)
const BIO_STOP_STRATEGY = 'pause';
const BIO_IDLE_STOP_MS = 45000; // after 45s on Game Over, stop camera too

let bioIdleStopTO = null;

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
let _lastSafeTop = 0;   // cached px of the safe play area's top
let prevSafeTop  = -1;  // for detecting changes (orientation, UI changes)

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
function safeTopPx() {
  const bar = document.getElementById('topBar');
  const pad = 8;  // +8px padding so bubbles don’t “kiss” the bar
  const y = bar ? Math.ceil(bar.getBoundingClientRect().bottom) + pad : 0;
  _lastSafeTop = y;
  return y;
}

function buildWalls() {
  // remove old walls
  if (walls) {
    for (let i = walls.length - 1; i >= 0; i--) walls[i].remove();
  }
  walls = new Group();
  walls.collider = 'static';
  walls.color = color(255, 255, 255, 0);

  const T = 40;                 // wall thickness
  const sTop = safeTopPx();     // safe top edge under the top bar

  // left, right, top (at safe line), bottom
  const wl = new Sprite(-T/2, height/2, T, height, 'static');
  const wr = new Sprite(width+T/2, height/2, T, height, 'static');
  const wt = new Sprite(width/2, sTop - T/2, width, T, 'static'); // top wall moved down
  const wb = new Sprite(width/2, height+T/2, width, T, 'static');

  walls.add(wl); 
  walls.add(wr); 
  walls.add(wt); 
  walls.add(wb);
  walls.visible = false;

  prevSafeTop = sTop; // remember where we built it
}

function rebuildWallsIfNeeded() {
  const sTop = safeTopPx();
  const needBuild =
    !walls || walls.length < 4 ||
    Math.abs(prevSafeTop - sTop) > 1 ||          // top bar height changed / orientation
    Math.abs(walls[1].x - (width + 20)) > 1 ||   // right wall no longer aligned
    Math.abs(walls[3].y - (height + 20)) > 1;    // bottom wall no longer aligned

  if (needBuild) buildWalls();
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

function wireHamburger() {
  const btn = document.getElementById('menuBtn');
  const cam = document.getElementById('camControls');
  if (!btn || !cam) return;

  btn.onclick = (e) => {
    e.stopPropagation();
    // toggle only if in Bio mode
    if (currentMode !== 'bio') return;
    cam.classList.toggle('open');
    cam.classList.toggle('collapsed');
  };

  // optional: click outside closes the panel
  document.addEventListener('click', (ev) => {
    if (!cam.classList.contains('open')) return;
    if (!cam.contains(ev.target) && ev.target !== btn) {
      cam.classList.remove('open');
      cam.classList.add('collapsed');
    }
  });
}

function openCameraModal() {
  const m = document.getElementById('cameraModal');
  if (!m) return;
  m.classList.remove('hidden');
}

function closeCameraModal() {
  const m = document.getElementById('cameraModal');
  if (!m) return;
  m.classList.add('hidden');
}

function pauseBioDetection() {
  stopSampler(); // you already have this
  // keep currentStream running so resume is instant
}

function stopBioCamera() {
  stopSampler();
  stopWebcam();  // you already have this (stops tracks + detaches)
}

function resumeBioDetection() {
  if (!isBioMode()) return;
  // if camera tracks were stopped, bring them back
  if (!currentStream) {
    startWebcam(false).then(() => startSampler());
  } else {
    startSampler();
  }
}

function scheduleBioIdleStop() {
  clearTimeout(bioIdleStopTO);
  bioIdleStopTO = setTimeout(() => {
    // only stop if we're still on the Game Over screen and still in Bio
    if (gameOver && isBioMode()) stopBioCamera();
  }, BIO_IDLE_STOP_MS);
}
function cancelBioIdleStop() {
  clearTimeout(bioIdleStopTO);
  bioIdleStopTO = null;
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
    modeSelect.onchange = async () => {
      const prev = currentMode;
      currentMode = modeSelect.value;
      restart(true);
      if (currentMode === 'bio') {
        await loadFaceApiModels();
        await startWebcam(true);
        startSampler();
      } else {
        stopSampler();
        stopWebcam();
      }
    };
  }
  
  // Camera modal buttons
  const camBtn = document.getElementById('cameraBtn');
  const closeBtn = document.getElementById('modalClose');
  camBtn.onclick = () => { if (currentMode === 'bio') openCameraModal(); };
  closeBtn.onclick = closeCameraModal;

  // Close modal on backdrop click
  document.getElementById('cameraModal').addEventListener('click', (e) => {
    if (e.target.id === 'cameraModal') closeCameraModal();
  });

  // Preview checkbox wiring (runs once)
  (function wirePreviewToggle(){
    const previewToggle = document.getElementById('showPreview');
    const v = document.getElementById('webcam');
    if (previewToggle && v) {
      previewToggle.onchange = () => {
        if (previewToggle.checked) v.classList.remove('camHidden');
        else v.classList.add('camHidden');
      };
    }
  })();

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

  // Bio models + webcam (only if starting in bio)
  if (currentMode === 'bio') {
    loadFaceApiModels();
    startWebcam();
    startSampler();
  }

  // Keep canvas in sync with visible viewport
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fitCanvasToViewport);
    visualViewport.addEventListener('scroll', fitCanvasToViewport);
  }
  wirePreviewToggle();
  listCameras();
  loop();
  wireHamburger();

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
  // Keep canvas + walls sized to the visible viewport
  fitCanvasToViewport();
  background(200, 230, 255);

  // ----- TIMER / HUD -----
  const timeLeft = Math.max(0, GAME_DURATION - Math.floor((millis() - startTime) / 1000));
  document.getElementById('scoreChip').textContent = `Score: ${score}`;
  document.getElementById('timeChip').textContent = `Time: ${timeLeft}`;

  // ----- UI (Bio chip + camera icon) & per-frame speed multiplier -----
  const bioChip  = document.getElementById('bioChip');
  const camBtnEl = document.getElementById('cameraBtn');

  let modeSpeedMult = 1.0; // applied per bubble below

  if (currentMode === 'classic') {
    modeSpeedMult = CLASSIC_SPEED_SCALE; // e.g., 0.75
    bioChip?.classList.add('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'none';
  } else if (currentMode === 'challenge') {
    modeSpeedMult = 1.3;
    bioChip?.classList.add('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'none';
  } else if (currentMode === 'bio') {
    bioChip?.classList.remove('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'inline-flex';

    const emo = dominantEmotion(); // uses your tuned thresholds/hysteresis
    bioChip.textContent = emo.toUpperCase();

    if (emo === 'happy') {
      bioChip.style.background = 'rgba(120,255,160,.85)';
      modeSpeedMult = 1.3;
    } else if (emo === 'sad') {
      bioChip.style.background = 'rgba(120,160,255,.85)';
      modeSpeedMult = 0.8; // slightly higher than 0.7 to reduce “stuck” feel
    } else if (emo === 'angry') {
      bioChip.style.background = 'rgba(255,140,140,.85)'; // size boost handled in currentRadius()
      modeSpeedMult = 1.0;
    } else {
      bioChip.style.background = 'rgba(255,255,255,.85)';
      modeSpeedMult = 1.0;
    }
  }

  // ----- SAFETY LINE under the top bar -----
  const sTop = safeTopPx(); // px from top where play area starts (bar bottom + padding)

  // Optional speed floor fallback (won’t error if MIN_PLAY_SPEED not defined)
  const MINF = (typeof MIN_PLAY_SPEED === 'number') ? MIN_PLAY_SPEED : 0.9;

  // ----- UPDATE & DRAW BUBBLES -----
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];

    // slight heading jitter so paths aren’t perfectly straight
    b.direction += random(-0.35, 0.35);

    // radius (angry increases size via currentRadius)
    const r = currentRadius(b);

    // per-mode speed (+ floor to avoid sticky grazing)
    if (currentMode === 'classic') {
      b.speed = max(min(b._baseSpeed * modeSpeedMult, CLASSIC_SPEED_CAP), MINF);
    } else if (currentMode === 'challenge') {
      b.speed = max(b._baseSpeed * modeSpeedMult, MINF);
    } else if (currentMode === 'bio') {
      b.speed = max(b._baseSpeed * constrain(modeSpeedMult, 0.5, 1.6), MINF);
    }

    // manual clamps/bounces (walls are primary; this is a second safety)
    if (b.x < r) {
      b.x = r + 0.5;
      b.direction = 180 - b.direction;
      b.direction += random(-1.5, 1.5);
    }
    if (b.x > width - r) {
      b.x = width - r - 0.5;
      b.direction = 180 - b.direction;
      b.direction += random(-1.5, 1.5);
    }
    if (b.y < sTop + r) {
      b.y = sTop + r + 0.5;
      b.direction = 360 - b.direction;
      b.direction += random(-1.5, 1.5);
    }
    if (b.y > height - r) {
      b.y = height - r - 0.5;
      b.direction = 360 - b.direction;
      b.direction += random(-1.5, 1.5);
    }

    // draw
    const drawD = r * 2;
    if (b._type === 'trick') fill(255, 120, 120, 170);
    else fill(b._tint);
    circle(b.x, b.y, drawD);
    fill(255, 255, 255, 60);
    circle(b.x - drawD * 0.2, b.y - drawD * 0.2, drawD * 0.4);

    // simple “stuck” detector & kick (safe if not initialized)
    if (b._stuck == null) b._stuck = 0;
    const approxV = b.speed;
    if (approxV < 0.15) b._stuck++; else b._stuck = 0;
    if (b._stuck > 18) {
      b.direction = random(360);
      b.speed = max(b._baseSpeed * 1.05, MINF + 0.2);
      if (b.y - r <= sTop + 1) b.y = sTop + r + 2;
      else if (b.y + r >= height - 1) b.y = height - r - 2;
      if (b.x - r <= 1) b.x = r + 2;
      else if (b.x + r >= width - 1) b.x = width - r - 2;
      b._stuck = 0;
    }
  }

  // ----- END GAME -----
  if (!gameOver && timeLeft <= 0) endGame();
}


// ===== Gameplay =====
function spawnBubble() {
  const d = random(MIN_DIAM, MAX_DIAM);
  const r = d / 2;
  const sTop = safeTopPx();

  // random 360° heading, nudge off near-perfect horizontals
  let angle = random(TWO_PI);
  if (abs(sin(angle)) < 0.2) angle += PI / 4;

  const speed = random(MIN_SPEED, MAX_SPEED);

  // Spawn position — always below the safe top line
  let sx = random(r, width - r);
  let sy = random(max(sTop + r, sTop + 1), height - r);

  if (currentMode === 'bio') {
    // bias spawns toward gaze but still constrain to safe area
    const biasX = width  * bioState.gaze.x;
    const biasY = constrain(height * bioState.gaze.y, sTop + r, height - r);
    sx = constrain(lerp(random(r, width - r),  biasX, 0.6), r, width - r);
    sy = constrain(lerp(random(sTop + r, height - r), biasY, 0.6), sTop + r, height - r);
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
  b._stuck = 0;   // counter for stuck frames

  // keep your challenge/trick logic
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
  if (currentMode === 'bio') {
    if (BIO_STOP_STRATEGY === 'pause') pauseBioDetection();
      else stopBioCamera();
      scheduleBioIdleStop(); // optional: full stop after idle timeout
  }
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

  if (currentMode === 'bio') {
    cancelBioIdleStop();
    resumeBioDetection();
  }

  loop();
}

function windowResized() { fitCanvasToViewport(); }

// ===== Bio (face-api.js) =====
async function loadFaceApiModels() {
  if (typeof faceapi === 'undefined') { setTimeout(loadFaceApiModels, 300); return false; }
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.isLoaded   || faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
      faceapi.nets.faceExpressionNet.isLoaded  || faceapi.nets.faceExpressionNet.loadFromUri('./models'),
      faceapi.nets.faceLandmark68Net.isLoaded  || faceapi.nets.faceLandmark68Net.loadFromUri('./models')
    ]);
    modelsReady = true;
    console.log('[bio] models loaded');
    return true;
  } catch (e) {
    console.warn('Model load error:', e);
    return false;
  }
}

// === Bio gating helpers ===
function isBioMode() {
  return (typeof currentMode !== 'undefined' && String(currentMode).toLowerCase() === 'bio');
}

function startSampler() {
  if (bioTimerId) return;
  bioTimerId = setInterval(() => {
    if (!isBioMode()) return;
    if (document.hidden) return;
    const v = document.getElementById('webcam');
    if (v && v.readyState >= 2 && modelsReady) {
      sampleBio();
    }
  }, BIO_SAMPLE_MS);
  console.log('[bio] sampler started @'+BIO_SAMPLE_MS);
}

function stopSampler() {
  if (!bioTimerId) return;
  clearInterval(bioTimerId);
  bioTimerId = null;
  console.log('[bio] sampler stopped');
}

function stopWebcam() {
  try {
    if (currentStream && typeof currentStream.getTracks === 'function') {
      currentStream.getTracks().forEach(t => t.stop());
    }
  } catch (e) {
    console.warn('[bio] error stopping webcam:', e);
  }
  currentStream = null;
  const v = document.getElementById('webcam');
  if (v) v.srcObject = null;
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
      if (previewToggle.checked) {
        v.classList.remove('camHidden'); 
        v.classList.add('preview');
      } else {
        v.classList.add('camHidden'); 
        v.classList.remove('preview');
      }
    };
  }
}

function restartWebcam() { startWebcam(true); }

async function startWebcam(isRestart = false) {
  const v = document.getElementById('webcam'); // detector + preview video in this project
  const vPrev = null; // no separate preview element in this project

  if (!navigator.mediaDevices?.getUserMedia) {
    console.error('[bio] getUserMedia not supported');
    return false;
  }

  // Stop existing media + sampler if restarting or switching devices
  try {
    if (isRestart && typeof bioTimerId !== 'undefined' && bioTimerId) {
      clearInterval(bioTimerId);
      bioTimerId = null;
    }
    if (currentStream && typeof currentStream.getTracks === 'function') {
      currentStream.getTracks().forEach(t => t.stop());
    }
  } catch (e) {
    console.warn('[bio] error stopping previous stream:', e);
  }

  // Camera constraints
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
    console.warn('[bio] getUserMedia (exact device) failed, fallback to facingMode:user', e);
    constraints = { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  }

  currentStream = stream;

  if (!v) {
    console.error('[bio] #webcam element not found');
    return false;
  }
  v.srcObject = stream;
  v.playsInline = true;
  v.muted = true;
  v.autoplay = true;

  // Ensure playback to advance readyState
  let played = false;
  try { await v.play(); played = true; } catch (err) {
    console.warn('[bio] video.play blocked by autoplay policy; will resume on user gesture');
  }

  // Start sampler when frames are available
  const onReady = () => {
    // Only start in Bio mode; otherwise ignore
    if (typeof isBioMode === 'function' ? isBioMode() : (currentMode === 'bio')) {
      startSampler();
    }
  };
  v.addEventListener('playing', onReady, { once: true });
  v.addEventListener('loadeddata', onReady, { once: true });
  if (v.readyState >= 2) onReady();

  // Gesture fallback
  if (!played) {
    const resume = () => {
      v.play().catch(()=>{});
      onReady();
      document.removeEventListener('click', resume);
      document.removeEventListener('touchstart', resume);
    };
    document.addEventListener('click', resume, { once: true });
    document.addEventListener('touchstart', resume, { once: true, passive: true });
  }

  // Refresh camera list after permission so labels populate
  setTimeout(listCameras, 400);
  console.log('[bio] webcam started');
  return true;
}


function ema(prev, next, a = 0.75) {
  return prev == null ? next : (a * next + (1 - a) * prev);
}

async function sampleBio() {
  // Gate by mode
  if ((typeof isBioMode === 'function' ? !isBioMode() : (currentMode !== 'bio'))) return;

  const v = document.getElementById('webcam');
  if (!v || v.readyState < 2) { /* console.debug('[bio] video not ready'); */ return; }
  if (typeof faceapi === 'undefined' || !modelsReady) { /* console.debug('[bio] models not ready'); */ return; }

  let detections = [];
  // Try TinyFace first
  try {
    const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.08 });
    detections = await faceapi
      .detectAllFaces(v, tinyOpts)
      .withFaceLandmarks()
      .withFaceExpressions();
  } catch (e) {
    console.warn('[bio] tinyFace error:', e);
  }

  // Fallback to SSD if nothing
  if (!detections || !detections.length) {
    try {
      if (!faceapi.nets.ssdMobilenetv1.isLoaded) {
        await faceapi.nets.ssdMobilenetv1.loadFromUri('./models');
      }
      detections = await faceapi
        .detectAllFaces(v, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.15 }))
        .withFaceLandmarks()
        .withFaceExpressions();
    } catch (e) {
      console.warn('[bio] ssdMobilenet fallback error:', e);
    }
  }

  if (!detections || !detections.length) {
    // Decay toward neutral if no face
    bioState.happy = ema(bioState.happy || 0, 0, 0.3);
    bioState.sad   = ema(bioState.sad   || 0, 0, 0.3);
    bioState.angry = ema(bioState.angry || 0, 0, 0.3);
    bioState.neutral = ema(bioState.neutral || 0, 1, 0.3);
    // Clear overlay if showing
    if (overlay && octx) { octx.clearRect(0,0,overlay.width,overlay.height); }
    console.debug('[bio] faces detected: 0');
    return;
  }

  const facesWithExpr = detections.filter(d => d && d.expressions);
  if (!facesWithExpr.length) {
    if (overlay && octx) { octx.clearRect(0,0,overlay.width,overlay.height); }
    console.debug('[bio] faces found but no expressions');
    return;
  }

  // Choose largest face (by area)
  facesWithExpr.sort((a,b) => (b.detection.box.area - a.detection.box.area));
  const det = facesWithExpr[0];

  // Average expressions across all faces
  const acc = { happy: 0, sad: 0, angry: 0, neutral: 0, disgusted: 0, fearful: 0, surprised: 0 };
  for (const d of facesWithExpr) {
    const e = d.expressions || {};
    acc.happy     += e.happy     || 0;
    acc.sad       += e.sad       || 0;
    acc.angry     += e.angry     || 0;
    acc.neutral   += e.neutral   || 0;
    acc.disgusted += e.disgusted || 0;
    acc.fearful   += e.fearful   || 0;
    acc.surprised += e.surprised || 0;
  }
  const n = facesWithExpr.length;
  Object.keys(acc).forEach(k => acc[k] = acc[k] / n);

  // Smooth into bioState
  bioState.happy = ema(bioState.happy || 0, acc.happy, 0.75);
  bioState.sad   = ema(bioState.sad   || 0, acc.sad,   0.75);
  bioState.angry = ema(bioState.angry || 0, acc.angry, 0.75);
  bioState.neutral = ema(bioState.neutral || 0, acc.neutral, 0.75);

  console.log('[bio] faces detected:', n, 'expr:', {
    happy: bioState.happy.toFixed(2),
    sad: bioState.sad.toFixed(2),
    angry: bioState.angry.toFixed(2),
    neutral: bioState.neutral.toFixed(2)
  });

  // --- Draw overlay if preview is visible (uses #webcam element's box) ---
  const vidEl = document.getElementById('webcam');
  if (vidEl && (vidEl.classList.contains('preview') || !vidEl.classList.contains('camHidden'))) {
    try {
      ensureOverlay();
      octx.clearRect(0, 0, overlay.width, overlay.height);
      const box = det.detection.box;
      octx.save();
      // mirror to match CSS mirror if any (style.css sets transform: scaleX(-1)?)
      octx.translate(overlay.width, 0);
      octx.scale(-1, 1);
      octx.strokeStyle = 'lime';
      octx.lineWidth = 4;
      octx.strokeRect(box.x, box.y, box.width, box.height);
      octx.restore();
    } catch (e) {
      console.warn('[bio] overlay draw error:', e);
    }
  }
}