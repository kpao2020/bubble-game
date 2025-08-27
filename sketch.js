// ===== Game constants =====
const GAME_DURATION = 30;            // seconds
const START_BUBBLES = 24;
const MIN_DIAM = 50, MAX_DIAM = 88;  // per your request
const MIN_SPEED = 1.6, MAX_SPEED = 3.8;
const MIN_PLAY_SPEED = 0.9;   // floor after multipliers (tweak 0.8–1.0)

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
  HAPPY_ON: 0.22, HAPPY_OFF: 0.16,
  SAD_ON:   0.20, SAD_OFF:   0.14,
  ANGRY_ON: 0.21, ANGRY_OFF: 0.15,

  MIN_DOMINANT: 0.14
};

// ===== Emotion decision config (INCLUDING NEUTRAL) =====
const EMO_CFG = {
  ON:           0.33,   // was 0.40
  OFF:          0.28,   // was 0.33
  NEUTRAL_ON:   0.48,   // was 0.58
  NEUTRAL_OFF:  0.32,   // was 0.40
  MARGIN:       0.04,   // was 0.05
  COOLDOWN_MS:  1400    // was 2200
};

// Let strong raw signals punch through sooner
const EMO_FORCE = {
  SAD_RAW:   0.30,  // was 0.38
  HAPPY_RAW: 0.34,  // was 0.42
  ANGRY_RAW: 0.32   // was 0.40
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
        if (previewToggle.checked) {
          v.classList.remove('camHidden');
          v.classList.add('preview');   // NEW
        } else {
          v.classList.add('camHidden');
          v.classList.remove('preview'); // NEW
        }
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
      if (previewToggle.checked) {
        v.classList.remove('camHidden');
        v.classList.add('preview');   // NEW
      } else {
        v.classList.add('camHidden');
        v.classList.remove('preview'); // NEW
      }
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
      }, 500); // 500 = every 0.5 second sampling
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

  // More robust: larger input and lower threshold for tiny model
  let detections = [];
  try {
    const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.08 });
    detections = await faceapi
      .detectAllFaces(v, tinyOpts)
      .withFaceLandmarks()
      .withFaceExpressions();
  } catch (e) {
    console.warn('tinyFace pipeline error:', e);
  }

  if (!detections.length) {
    // Fallback once with SSD Mobilenet if available
    try {
      if (!faceapi.nets.ssdMobilenetv1.isLoaded) {
        await faceapi.nets.ssdMobilenetv1.loadFromUri('./models');
      }
      detections = await faceapi
        .detectAllFaces(v, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.15 }))
        .withFaceLandmarks()
        .withFaceExpressions();
    } catch (e) {
      console.warn('ssdMobilenet fallback error:', e);
    }
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