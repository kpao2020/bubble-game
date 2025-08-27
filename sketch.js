// Bubble Bio Game — optimized build
// - Detection runs only in Bio mode
// - Sampler interval is configurable via BIO_SAMPLE_MS (default 1000ms)
// - Cleaned up: removed hamburger/collapsed cam controls code
// - Added JSDoc-style comments for key functions

/* =============================
 *        Game constants
 * ============================= */
const GAME_DURATION = 30;             // seconds
const START_BUBBLES = 24;
const MIN_DIAM = 50, MAX_DIAM = 88;   // bubble size range
const MIN_SPEED = 1.6, MAX_SPEED = 3.8;
const MIN_PLAY_SPEED = 0.9;           // floor after multipliers

const BIO_SAMPLE_MS = 1000;           // face sampling cadence (ms)

// Bio end-game behavior: 'pause' (sampler only) or 'stop' (sampler + camera)
const BIO_STOP_STRATEGY = 'pause';
const BIO_IDLE_STOP_MS = 45000;       // stop camera after idle timeout on Game Over
let bioIdleStopTO = null;

const TOUCH_HIT_PAD = 12;
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const CLASSIC_SPEED_SCALE = 0.75;
const CLASSIC_SPEED_CAP   = 3.0;

let currentMode = 'classic'; // 'classic' | 'challenge' | 'bio'
const CHALLENGE_TRICK_RATE = 0.22;

let bubbles;               // p5play Group of bubbles
let walls;                 // boundary walls
let prevSafeTop = -1;      // last safe top for wall rebuild

let score = 0;
let startTime = 0;
let gameOver = false;

// Camera state
let currentStream = null;
let selectedDeviceId = null;

// Bio (face-api) state
let modelsReady = false;
let bioTimerId = null;
let overlay, octx;         // overlay canvas for green box

// Aggregated expression state (smoothed)
const bioState = { gaze: { x: 0.5, y: 0.5 }, happy: 0, sad: 0, angry: 0, neutral: 1 };

// Emotion decision thresholds
const EMO_CFG = {
  ON: 0.40, OFF: 0.33, NEUTRAL_ON: 0.58, NEUTRAL_OFF: 0.40, MARGIN: 0.05, COOLDOWN_MS: 2200
};
const EMO_FORCE = { HAPPY_RAW: 0.42, SAD_RAW: 0.38, ANGRY_RAW: 0.40 };
let lastEmotion = 'neutral', lastSwitchMs = 0;

/* =============================
 *        UI helpers
 * ============================= */

/** Get viewport width/height with visualViewport support */
function viewportW(){ return (window.visualViewport ? Math.round(window.visualViewport.width)  : window.innerWidth); }
function viewportH(){ return (window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight); }
// ===== Viewport sizing =====
function fitCanvasToViewport() {
  const w = viewportW();
  const h = viewportH();
  if (width !== w || height !== h) resizeCanvas(w, h);
  rebuildWallsIfNeeded();
}
/** Return the y-px of the safe play area's top (just below the top bar + padding) */
function safeTopPx(){
  const bar = document.getElementById('topBar');
  const pad = 8;
  return bar ? Math.ceil(bar.getBoundingClientRect().bottom) + pad : 0;
}

/** Ensure boundary walls match current viewport and top bar height */
function buildWalls(){
  if (walls) for (let i = walls.length - 1; i >= 0; i--) walls[i].remove();
  walls = new Group();
  walls.collider = 'static';
  walls.color = color(255,255,255,0);

  const T = 40, sTop = safeTopPx();
  const wl = new Sprite(-T/2,         height/2, T, height, 'static');
  const wr = new Sprite(width+T/2,    height/2, T, height, 'static');
  const wt = new Sprite(width/2,      sTop - T/2, width, T, 'static');
  const wb = new Sprite(width/2,      height+T/2, width, T, 'static');
  walls.add(wl); walls.add(wr); walls.add(wt); walls.add(wb);
  walls.visible = false;
  prevSafeTop = sTop;
}
function rebuildWallsIfNeeded(){
  const sTop = safeTopPx();
  const need = !walls || walls.length < 4 || Math.abs(prevSafeTop - sTop) > 1;
  if (need) buildWalls();
}

/** Create/position overlay canvas over the on-screen preview video */
function ensureOverlay(){
  if (!overlay){
    overlay = document.createElement('canvas');
    overlay.id = '__bioOverlay';
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = 9999;
    document.body.appendChild(overlay);
    octx = overlay.getContext('2d', { willReadFrequently: true });
  }
  const vid = document.getElementById('webcamPreview');
  if (!vid) return;
  const rect = vid.getBoundingClientRect();
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.width = vid.videoWidth || 640;
  overlay.height = vid.videoHeight || 480;
}

/** Simple EMA smoothing */
function ema(prev, next, a = 0.75){ return prev == null ? next : (a*next + (1-a)*prev); }

/** Is the UI in Bio mode? */
function isBioMode(){
  return (typeof currentMode !== 'undefined' && String(currentMode).toLowerCase() === 'bio');
}

/** Update the Bio chip text */
function setEmotionChip(next){
  const chip = document.getElementById('bioChip');
  if (chip) chip.textContent = String(next || 'neutral').toUpperCase();
}

/* =============================
 *        Setup & Draw
 * ============================= */
function setup(){
  createCanvas(viewportW(), viewportH());
  noStroke();
  world.gravity.y = 0;

  // Mode selector wiring
  const modeSelect = document.getElementById('modeSelect');
  if (modeSelect){
    currentMode = modeSelect.value;
    modeSelect.onchange = async () => {
      currentMode = modeSelect.value;
      restart(true);
      if (isBioMode()){
        await loadFaceApiModels();
        await startWebcam(true);
        startSampler();
      }else{
        stopSampler();
        stopWebcam();
      }
    };
  }

  // Camera modal buttons
  const camBtn = document.getElementById('cameraBtn');
  const closeBtn = document.getElementById('modalClose');
  if (camBtn) camBtn.onclick = () => { if (isBioMode()) openCameraModal(); };
  if (closeBtn) closeBtn.onclick = closeCameraModal;
  const cameraModal = document.getElementById('cameraModal');
  if (cameraModal){
    cameraModal.addEventListener('click', (e) => { if (e.target.id === 'cameraModal') closeCameraModal(); });
  }

  // Preview checkbox toggles the PREVIEW video
  (function wirePreviewToggle(){
    const previewToggle = document.getElementById('showPreview');
    const vPrev = document.getElementById('webcamPreview');
    if (previewToggle && vPrev){
      previewToggle.onchange = () => {
        if (previewToggle.checked){ vPrev.classList.remove('camHidden'); vPrev.classList.add('preview'); }
        else { vPrev.classList.add('camHidden'); vPrev.classList.remove('preview'); }
      };
    }
  })();

  // Pointer popping (bulletproof across devices)
  const cnv = _renderer?.canvas || document.querySelector('canvas');
  if (cnv){
    cnv.style.touchAction = 'none';
    cnv.addEventListener('pointerdown', (e) => {
      // ignore clicks on top bar
      const ui = document.getElementById('topBar');
      const r = ui?.getBoundingClientRect?.();
      if (r && e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right) return;
      const rect = cnv.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (width / rect.width);
      const y = (e.clientY - rect.top)  * (height / rect.height);
      handlePop(x, y);
    }, { passive: true });
  }

  // Build bubbles
  bubbles = new Group();
  bubbles.collider = 'dynamic';
  bubbles.bounciness = 1;
  bubbles.friction = 0;
  bubbles.drag = 0;
  for (let i = 0; i < START_BUBBLES; i++) spawnBubble();

  score = 0; startTime = millis(); gameOver = false;
  document.getElementById('center').style.display = 'none';
  const btn = document.getElementById('restartBtn');
  if (btn){ btn.style.display = 'none'; btn.onclick = () => restart(false); }

  buildWalls();

  if (isBioMode()){
    loadFaceApiModels();
    startWebcam();
    startSampler();
  }

  // Resize safety
  if (window.visualViewport){
    visualViewport.addEventListener('resize', fitCanvasToViewport);
    visualViewport.addEventListener('scroll', fitCanvasToViewport);
  }

  // Camera device selector
  const sel = document.getElementById('cameraSelect');
  if (sel){
    sel.onchange = () => { selectedDeviceId = sel.value; restartWebcam(); };
  }
  if (navigator.mediaDevices?.addEventListener){
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      await listCameras();
      if (sel && selectedDeviceId) sel.value = selectedDeviceId;
    });
  }
  listCameras();
}

function draw(){
  fitCanvasToViewport();
  background(200,230,255);

  const timeLeft = Math.max(0, GAME_DURATION - Math.floor((millis() - startTime)/1000));
  document.getElementById('scoreChip').textContent = `Score: ${score}`;
  document.getElementById('timeChip').textContent  = `Time: ${timeLeft}`;

  const bioChip  = document.getElementById('bioChip');
  const camBtnEl = document.getElementById('cameraBtn');
  let modeSpeedMult = 1.0;

  if (currentMode === 'classic'){
    modeSpeedMult = CLASSIC_SPEED_SCALE;
    bioChip?.classList.add('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'none';
  }else if (currentMode === 'challenge'){
    modeSpeedMult = 1.3;
    bioChip?.classList.add('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'none';
  }else{
    bioChip?.classList.remove('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'inline-flex';
    const emo = dominantEmotion();
    bioChip.textContent = emo.toUpperCase();
    if (emo === 'happy'){ bioChip.style.background = 'rgba(120,255,160,.85)'; modeSpeedMult = 1.3; }
    else if (emo === 'sad'){ bioChip.style.background = 'rgba(120,160,255,.85)'; modeSpeedMult = 0.8; }
    else if (emo === 'angry'){ bioChip.style.background = 'rgba(255,140,140,.85)'; modeSpeedMult = 1.0; }
    else { bioChip.style.background = 'rgba(255,255,255,.85)'; modeSpeedMult = 1.0; }
  }

  const sTop = safeTopPx();
  const MINF = MIN_PLAY_SPEED;

  for (let i = 0; i < bubbles.length; i++){
    const b = bubbles[i];
    b.direction += random(-0.35, 0.35);
    const r = currentRadius(b);

    if (currentMode === 'classic')      b.speed = max(min(b._baseSpeed * modeSpeedMult, CLASSIC_SPEED_CAP), MINF);
    else if (currentMode === 'challenge') b.speed = max(b._baseSpeed * modeSpeedMult, MINF);
    else                                  b.speed = max(b._baseSpeed * constrain(modeSpeedMult, 0.5, 1.6), MINF);

    if (b.x < r){ b.x = r + 0.5; b.direction = 180 - b.direction; b.direction += random(-1.5,1.5); }
    if (b.x > width - r){ b.x = width - r - 0.5; b.direction = 180 - b.direction; b.direction += random(-1.5,1.5); }
    if (b.y < sTop + r){ b.y = sTop + r + 0.5; b.direction = 360 - b.direction; b.direction += random(-1.5,1.5); }
    if (b.y > height - r){ b.y = height - r - 0.5; b.direction = 360 - b.direction; b.direction += random(-1.5,1.5); }

    const d = r * 2;
    fill(b._type === 'trick' ? color(255,120,120,170) : b._tint);
    circle(b.x, b.y, d);
    fill(255,255,255,60);
    circle(b.x - d*0.2, b.y - d*0.2, d*0.4);

    if (b._stuck == null) b._stuck = 0;
    if (b.speed < 0.15) b._stuck++; else b._stuck = 0;
    if (b._stuck > 18){
      b.direction = random(360); b.speed = max(b._baseSpeed * 1.05, MINF + 0.2);
      if (b.y - r <= sTop + 1) b.y = sTop + r + 2; else if (b.y + r >= height - 1) b.y = height - r - 2;
      if (b.x - r <= 1) b.x = r + 2; else if (b.x + r >= width - 1) b.x = width - r - 2;
      b._stuck = 0;
    }
  }

  if (!gameOver && timeLeft <= 0) endGame();
}

/* =============================
 *        Gameplay
 * ============================= */
function spawnBubble(){
  const d = random(MIN_DIAM, MAX_DIAM), r = d / 2, sTop = safeTopPx();
  let angle = random(TWO_PI); if (abs(sin(angle)) < 0.2) angle += PI/4;
  const speed = random(MIN_SPEED, MAX_SPEED);
  let sx = random(r, width - r), sy = random(max(sTop + r, sTop + 1), height - r);

  if (isBioMode()){
    const biasX = width * bioState.gaze.x, biasY = constrain(height * bioState.gaze.y, sTop + r, height - r);
    sx = constrain(lerp(random(r, width - r), biasX, 0.6), r, width - r);
    sy = constrain(lerp(random(sTop + r, height - r), biasY, 0.6), sTop + r, height - r);
  }

  const b = new Sprite(sx, sy, d);
  b.shape = 'circle'; b.color = color(255,255,255,0); b.diameter = d;
  b._tint = color(random(120,210), random(140,220), 255, 150);
  b.direction = degrees(angle); b.speed = speed; b._baseSpeed = speed; b.mass = PI * r * r;
  b.rotationLock = true; b._hitScale = 1; b._stuck = 0;
  b._type = (currentMode === 'challenge' && random() < 0.22) ? 'trick' : 'normal';
  bubbles.add(b); return b;
}

function currentRadius(b){
  const baseD = (typeof b.diameter === 'number' && isFinite(b.diameter)) ? b.diameter : MIN_DIAM;
  const angry = isBioMode() ? Number(bioState.angry || 0) : 0;
  const d = baseD * (1 + 0.35 * constrain(angry, 0, 1));
  return max(1, d * 0.5);
}

function handlePop(px, py){
  if (gameOver) return;
  for (let i = bubbles.length - 1; i >= 0; i--){
    const b = bubbles[i], r = currentRadius(b), rHit = r + (IS_TOUCH ? TOUCH_HIT_PAD : 0);
    const dx = px - b.x, dy = py - b.y;
    if (dx*dx + dy*dy <= rHit*rHit){
      score += (b._type === 'trick') ? -1 : 1; if (score < 0) score = 0;
      b.remove(); spawnBubble(); break;
    }
  }
}
function mousePressed(){ handlePop(mouseX, mouseY); }
function touchStarted(){
  if (touches && touches.length) for (const t of touches) handlePop(t.x, t.y);
  else handlePop(mouseX, mouseY);
}

function endGame(){
  gameOver = true; noLoop();
  const centerEl = document.getElementById('center'), btn = document.getElementById('restartBtn');
  if (centerEl){ centerEl.textContent = `Game Over!\nScore: ${score}`; centerEl.style.display = 'block'; }
  if (btn){ btn.style.display = 'block'; }
  if (isBioMode()){
    if (BIO_STOP_STRATEGY === 'pause') stopSampler(); else { stopSampler(); stopWebcam(); }
    clearTimeout(bioIdleStopTO);
    bioIdleStopTO = setTimeout(() => { if (gameOver && isBioMode()) { stopWebcam(); } }, BIO_IDLE_STOP_MS);
  }
}
function restart(fromModeButton){
  for (let i = bubbles.length - 1; i >= 0; i--) bubbles[i].remove();
  for (let i = 0; i < START_BUBBLES; i++) spawnBubble();
  score = 0; startTime = millis(); gameOver = false;
  const centerEl = document.getElementById('center'), btn = document.getElementById('restartBtn');
  if (centerEl){ centerEl.textContent = ''; centerEl.style.display = 'none'; }
  if (btn){ btn.style.display = 'none'; btn.blur?.(); }
  if (isBioMode()){ clearTimeout(bioIdleStopTO); startSampler(); }
  loop();
}
function windowResized(){ const w = viewportW(), h = viewportH(); if (width !== w || height !== h) resizeCanvas(w, h); rebuildWallsIfNeeded(); }

/* =============================
 *        Bio (face-api.js)
 * ============================= */
/**
 * Load the face-api models from ./models and mark modelsReady on success.
 * @returns {Promise<boolean>} true on success
 */
async function loadFaceApiModels(){
  if (typeof faceapi === 'undefined'){ setTimeout(loadFaceApiModels, 300); return false; }
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.isLoaded  || faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
      faceapi.nets.faceExpressionNet.isLoaded || faceapi.nets.faceExpressionNet.loadFromUri('./models'),
      faceapi.nets.faceLandmark68Net.isLoaded || faceapi.nets.faceLandmark68Net.loadFromUri('./models')
    ]);
    modelsReady = true; console.log('[bio] models loaded'); return true;
  } catch (e) { console.warn('Model load error:', e); return false; }
}

/**
 * Start/Restart the webcam and mirror the stream to both the hidden detector
 * video (#webcam) and the on-screen preview (#webcamPreview).
 * Starts the sampler when frames become available.
 * @param {boolean} isRestart
 * @returns {Promise<boolean>}
 */
async function startWebcam(isRestart = false){
  const v = document.getElementById('webcam');            // detector (offscreen)
  const vPrev = document.getElementById('webcamPreview'); // preview (optional)
  if (!navigator.mediaDevices?.getUserMedia){ console.error('[bio] getUserMedia not supported'); return false; }

  // Stop existing media + sampler if restarting or switching devices
  try {
    if (isRestart && bioTimerId){ clearInterval(bioTimerId); bioTimerId = null; }
    if (currentStream?.getTracks) currentStream.getTracks().forEach(t => t.stop());
  } catch (e) { console.warn('[bio] error stopping previous stream:', e); }

  let constraints = {
    video: selectedDeviceId
      ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  };

  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
  catch (e){
    console.warn('[bio] exact device failed, fallback to facingMode:user', e);
    constraints = { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  }
  currentStream = stream;

  if (!v){ console.error('[bio] #webcam element not found'); return false; }
  v.srcObject = stream; v.playsInline = true; v.muted = true; v.autoplay = true;
  if (vPrev){ vPrev.srcObject = stream; vPrev.playsInline = true; vPrev.muted = true; vPrev.autoplay = true; }

  let played = false;
  try { await v.play(); played = true; } catch { console.warn('[bio] video.play blocked; will resume on gesture'); }

  const onReady = () => { if (isBioMode()) startSampler(); };
  v.addEventListener('playing', onReady, { once: true });
  v.addEventListener('loadeddata', onReady, { once: true });
  if (v.readyState >= 2) onReady();

  if (!played){
    const resume = () => { v.play().catch(()=>{}); vPrev?.play?.().catch(()=>{}); onReady();
      document.removeEventListener('click', resume);
      document.removeEventListener('touchstart', resume);
    };
    document.addEventListener('click', resume, { once: true });
    document.addEventListener('touchstart', resume, { once: true, passive: true });
  }

  setTimeout(listCameras, 400);
  console.log('[bio] webcam started');
  return true;
}

/** Stop the webcam tracks and detach stream */
function stopWebcam(){
  try { if (currentStream?.getTracks) currentStream.getTracks().forEach(t => t.stop()); }
  catch (e){ console.warn('[bio] error stopping webcam:', e); }
  currentStream = null;
  const v = document.getElementById('webcam'); if (v) v.srcObject = null;
  const vp = document.getElementById('webcamPreview'); if (vp) vp.srcObject = null;
}

/** Start the sampling loop (Bio-only) */
function startSampler(){
  if (bioTimerId) return;
  bioTimerId = setInterval(() => {
    if (!isBioMode() || document.hidden) return;
    const v = document.getElementById('webcam');
    if (v && v.readyState >= 2 && modelsReady) sampleBio();
  }, BIO_SAMPLE_MS);
  console.log('[bio] sampler started @' + BIO_SAMPLE_MS);
}

/** Stop the sampling loop */
function stopSampler(){
  if (!bioTimerId) return;
  clearInterval(bioTimerId); bioTimerId = null;
  console.log('[bio] sampler stopped');
}

/**
 * List cameras into #cameraSelect. After permission, labels will be populated.
 */
async function listCameras(){
  const sel = document.getElementById('cameraSelect');
  if (!navigator.mediaDevices?.enumerateDevices || !sel) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === 'videoinput');
  sel.innerHTML = '';
  cams.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = c.deviceId || '';
    opt.textContent = c.label || `Camera ${i+1}`;
    sel.appendChild(opt);
  });
  if (selectedDeviceId && cams.some(c => c.deviceId === selectedDeviceId)) sel.value = selectedDeviceId;
  else if (cams.length){ selectedDeviceId = cams[0].deviceId || ''; sel.value = selectedDeviceId; }
}

/** Restart webcam after camera selection change */
function restartWebcam(){ startWebcam(true); }

/**
 * Run one face-api sample: detect faces/expressions, update bioState, draw overlay.
 * Hard-gated to Bio mode.
 */
async function sampleBio(){
  if (!isBioMode()) return;
  const v = document.getElementById('webcam');
  if (!v || v.readyState < 2) return;
  if (!modelsReady) return;

  let detections = [];
  try {
    const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.08 });
    detections = await faceapi.detectAllFaces(v, tinyOpts).withFaceLandmarks().withFaceExpressions();
  } catch (e) { console.warn('[bio] tinyFace error:', e); }

  if (!detections || !detections.length){
    // Decay toward neutral if no face
    bioState.happy = ema(bioState.happy, 0, 0.3);
    bioState.sad   = ema(bioState.sad,   0, 0.3);
    bioState.angry = ema(bioState.angry, 0, 0.3);
    bioState.neutral = ema(bioState.neutral, 1, 0.3);
    if (overlay && octx) octx.clearRect(0,0,overlay.width,overlay.height);
    return;
  }

  const facesWithExpr = detections.filter(d => d && d.expressions);
  if (!facesWithExpr.length){ if (overlay && octx) octx.clearRect(0,0,overlay.width,overlay.height); return; }

  // Average expressions across faces
  const acc = { happy:0, sad:0, angry:0, neutral:0, disgusted:0, fearful:0, surprised:0 };
  for (const d of facesWithExpr){
    const e = d.expressions || {};
    acc.happy += e.happy || 0; acc.sad += e.sad || 0; acc.angry += e.angry || 0; acc.neutral += e.neutral || 0;
    acc.disgusted += e.disgusted || 0; acc.fearful += e.fearful || 0; acc.surprised += e.surprised || 0;
  }
  const n = facesWithExpr.length;
  Object.keys(acc).forEach(k => acc[k] = acc[k] / n);

  // Smooth into bioState
  bioState.happy = ema(bioState.happy, acc.happy, 0.75);
  bioState.sad   = ema(bioState.sad,   acc.sad,   0.75);
  bioState.angry = ema(bioState.angry, acc.angry, 0.75);
  bioState.neutral = ema(bioState.neutral, acc.neutral, 0.75);

  // Draw overlay box on preview if visible
  const vPrev = document.getElementById('webcamPreview');
  if (vPrev && vPrev.classList.contains('preview')){
    try {
      ensureOverlay();
      octx.clearRect(0,0,overlay.width,overlay.height);
      // Choose largest face for box
      facesWithExpr.sort((a,b)=> (b.detection.box.area - a.detection.box.area));
      const box = facesWithExpr[0].detection.box;
      octx.save();
      octx.translate(overlay.width, 0); octx.scale(-1, 1); // mirror
      octx.strokeStyle = 'lime'; octx.lineWidth = 4;
      octx.strokeRect(box.x, box.y, box.width, box.height);
      octx.restore();
    } catch (e){ console.warn('[bio] overlay draw error:', e); }
  }
}

/**
 * Decide dominant emotion based on smoothed bioState with hysteresis/cooldown.
 * @returns {'happy'|'sad'|'angry'|'neutral'}
 */
function dominantEmotion(){
  const h = Number(bioState.happy||0), s = Number(bioState.sad||0), a = Number(bioState.angry||0);
  const nRaw = (bioState.neutral != null) ? Number(bioState.neutral) : 0;
  const n = nRaw > 0 ? nRaw : Math.max(0, 1 - (h + s + a));

  const sum = h + s + a + n + 1e-6;
  const shares = [
    {k:'happy',v:h/sum},{k:'sad',v:s/sum},{k:'angry',v:a/sum},{k:'neutral',v:n/sum}
  ].sort((x,y)=>y.v-x.v);

  const now = (typeof millis === 'function') ? millis() : Date.now();
  const inCooldown = (now - lastSwitchMs) < EMO_CFG.COOLDOWN_MS;
  const neutralShare = shares.find(x=>x.k==='neutral').v;

  if (lastEmotion === 'neutral'){ if (neutralShare >= EMO_CFG.NEUTRAL_OFF) return 'neutral'; }
  else { const curShare = shares.find(x=>x.k===lastEmotion)?.v || 0; if (curShare >= EMO_CFG.OFF) return lastEmotion; }

  if (shares[0].k === 'neutral' && shares[0].v >= EMO_CFG.NEUTRAL_ON){
    if (!inCooldown || lastEmotion!=='neutral'){ lastEmotion='neutral'; lastSwitchMs=now; }
    return 'neutral';
  }

  const hsa = shares.filter(x=>x.k!=='neutral').sort((x,y)=>y.v-x.v);
  const top=hsa[0], second=hsa[1];
  if (h >= EMO_FORCE.HAPPY_RAW && (!inCooldown || lastEmotion!=='happy')){ lastEmotion='happy'; lastSwitchMs=now; return 'happy'; }
  if (s >= EMO_FORCE.SAD_RAW   && (!inCooldown || lastEmotion!=='sad'))  { lastEmotion='sad';   lastSwitchMs=now; return 'sad'; }
  if (a >= EMO_FORCE.ANGRY_RAW && (!inCooldown || lastEmotion!=='angry')){ lastEmotion='angry'; lastSwitchMs=now; return 'angry'; }

  if (top.v >= EMO_CFG.ON && (top.v - second.v) >= EMO_CFG.MARGIN){
    if (!inCooldown || lastEmotion!==top.k){ lastEmotion=top.k; lastSwitchMs=now; }
    return lastEmotion;
  }
  if (neutralShare >= EMO_CFG.NEUTRAL_OFF){
    if (!inCooldown || lastEmotion!=='neutral'){ lastEmotion='neutral'; lastSwitchMs=now; }
    return 'neutral';
  }
  return lastEmotion;
}

/* =============================
 *        Modal helpers
 * ============================= */
function openCameraModal(){ document.getElementById('cameraModal')?.classList.remove('hidden'); }
function closeCameraModal(){ document.getElementById('cameraModal')?.classList.add('hidden'); }
