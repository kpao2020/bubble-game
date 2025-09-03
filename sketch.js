// ============================================================================
// Popping Bubbles — Production Game Script (sketch.js)
// Owner: Ken Pao
//
// About this file
// - q5.js + p5play v3 game loop (setup/draw) with three modes: classic | challenge | bio
// - Bio mode: face-api.js sampling, emotion smoothing, "stressed" blend (fearful+disgusted+surprised)
// - UI flow: Splash -> Login (device check + username) -> Mode Picker -> Gameplay -> Post-game
// - Stats posted to Google Apps Script via a Cloudflare Worker proxy
//
// Structure guide (search for these section banners):
//   [Game constants]        core tunables for gameplay + bio thresholds
//   [Backend config]        worker endpoint for Google Apps Script
//   [Identity & storage]    deviceId/username/bioConsent keys
//   [Troubleshooting mode]  laptop-only toggle 't' to reveal camera button
//   [UI helpers]            viewport sizing, walls/safe area, overlay for face box
//   [Submit Run]            sends round results (score + emotion counts) to Sheets
//   [Setup & Draw]          q5 lifecycle; input wiring; per-frame UI updates
//   [Gameplay]              bubble spawn, hit logic, restart/endGame
//   [Bio (face-api)]        model loading, webcam controls, sampler and dominantEmotion()
//   [Modals & Splash]       helpers to open/close, splash controller
//   [Login & start]         device profile check, username flow, mode picker trigger
//
// Safe customization points
// - GAME_DURATION, bubble sizes/speeds
// - EMO_CFG and EMO_FORCE thresholds (tune bio responsiveness)
// - CHALLENGE_TRICK_RATE for trick bubble frequency
// - Consent copy is in index.html; Sheets columns are handled in Apps Script
//
// NOTE: Do not rename existing variables/IDs. UI and Sheets integrations depend on current names.
// ============================================================================
// Version:
//    v8.5: Switch normal-bubble tint to curated palette (more visible; consistent alpha).
// Note: Coding with ChatGPT assistance


/* =============================
 *        Game constants
 * ============================= */
const GAME_DURATION = 30;             // seconds
const START_BUBBLES = 24;
const MIN_DIAM = 50, MAX_DIAM = 88;   // bubble size range
const MIN_SPEED = 1.6, MAX_SPEED = 3.8;
const MIN_PLAY_SPEED = 0.9;           // floor after multipliers
// High-contrast, cheerful palette for bubble tints (RGB)
const BUBBLE_COLORS = [
  [ 66, 135, 245],  // lively blue
  [ 52, 199,  89],  // green
  [255, 159,  10],  // orange
  [255,  99, 132],  // pink/red
  [175,  82, 222],  // purple
  [ 50, 212, 222],  // teal
  [255, 204,  77],  // warm yellow
];

const BIO_SAMPLE_MS = 1500;           // face sampling cadence (ms)

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

// NEW: per-round input & pop stats
let tapsTotal = 0;              // all tap/click attempts
let tapsMissed = 0;             // attempts that didn’t hit any bubble
let bubblesPopped = 0;          // total bubbles removed by the player
let bubblesPoppedGood = 0;      // non-trick pops (these increase score)
let bubblesPoppedTrick = 0;     // trick pops (these decrease score)

// Camera state
let currentStream = null;
let selectedDeviceId = null;

// Bio (face-api) state
let modelsReady = false;
let bioTimerId = null;
let overlay, octx;         // overlay canvas for green box
// Hidden detector canvas we control (to avoid face-api creating its own readback-heavy canvas)
let detectorCanvas = null, dctx = null;

// Aggregated expression state (smoothed)
const bioState = { gaze: { x: 0.5, y: 0.5 }, happy: 0, sad: 0, angry: 0, stressed:0, neutral: 1 };

// Make emotions a bit easier to trigger
const EMO_CFG = {
  ON: 0.22,          // was higher
  OFF: 0.16,         // stickiness
  NEUTRAL_ON: 0.38, 
  NEUTRAL_OFF: 0.30,
  MARGIN: 0.06,      // gap between #1 and #2
  COOLDOWN_MS: 500
};

// Raw “force” thresholds — used for quick switches
const EMO_FORCE = {
  HAPPY_RAW:   0.36,
  SAD_RAW:     0.33,
  ANGRY_RAW:   0.34,
  STRESSED_RAW:0.28     // LOWERED so stressed can win
};


let lastEmotion = 'neutral', lastSwitchMs = 0;

// Per-round emotion counts (incremented by the Bio sampler)
let emoCounts = { happy: 0, sad: 0, angry: 0, stressed: 0, neutral: 0 };

/* =============================
 *        Backend config
 * ============================= */
// Single place to configure your Google Apps Script (prefer a proxy/worker URL that handles CORS + SECRET)
const GOOGLE_SCRIPT_URL = "https://bubble-game-proxy.xoakuma.workers.dev/";
// If (and only if) you POST directly to Apps Script with SECRET enforced, you can append it here.
// Recommended: leave empty and let your proxy add the secret server-side.
const GOOGLE_SCRIPT_POST_SUFFIX = "";

/* =============================
 *        Identity & storage
 * ============================= */
const STORAGE_KEYS = { deviceId: 'bbg_device_id', username: 'bbg_username', bioConsent: 'bbg_bio_consent'};
let playerDeviceId = null;
let playerUsername = null;
window.__playerReady = false; // gate the draw loop & inputs until username exists

function getOrCreateDeviceId() {
  try {
    let id = localStorage.getItem(STORAGE_KEYS.deviceId);
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEYS.deviceId, id);
    }
    return id;
  } catch {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/* =============================
 *        Troubleshooting mode
 * ============================= */

// Troubleshoot visibility (toggles the camera button on laptops in Bio mode)
let troubleshootMode = false;

function isLaptop(){
  const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const w = Math.max( viewportW?.() || 0, window.innerWidth || 0 );
  const ua = (navigator.userAgent || '').toLowerCase();
  const desktopUA = /(macintosh|mac os x|windows nt|linux|cros)/.test(ua);
  return !hasTouch && !coarse && (desktopUA || w >= 900);
}

function refreshCameraBtn(){
  const btn = document.getElementById('cameraBtn');
  if (!btn) return;
  const show = window.__playerReady && isBioMode() && isLaptop() && troubleshootMode;
  btn.style.display = show ? 'inline-flex' : 'none';
}

// Press "t" to toggle troubleshoot mode (only matters in Bio mode on laptops)
document.addEventListener('keydown', (e) => {
  if ((e.key || '').toLowerCase() === 't' && window.__playerReady && isBioMode() && isLaptop()){
    troubleshootMode = !troubleshootMode;
    refreshCameraBtn();
  }
});

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
  // Only rebuild walls after login so mobile keyboards/resize during login don't touch physics
  if (window.__playerReady) rebuildWallsIfNeeded();
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

/** Hidden canvas as face-api input (readback-friendly) */
function ensureDetectorCanvas(w, h){
  if (!detectorCanvas){
    detectorCanvas = document.createElement('canvas');
    detectorCanvas.width = Math.max(1, w || 640);
    detectorCanvas.height = Math.max(1, h || 480);
    dctx = detectorCanvas.getContext('2d', { willReadFrequently: true });
  } else {
    // keep it sized to the current video
    if (w && h && (detectorCanvas.width !== w || detectorCanvas.height !== h)){
      detectorCanvas.width = w; detectorCanvas.height = h;
    }
  }
  return detectorCanvas;
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

function hasBioConsent(){
  try { return localStorage.getItem(STORAGE_KEYS.bioConsent) === 'accepted'; }
  catch { return false; }
}
function acceptBioConsent(){
  try { localStorage.setItem(STORAGE_KEYS.bioConsent, 'accepted'); } catch {}
}

function showBioConsentModal(onAccept, onDecline){
  const m = document.getElementById('bioConsentModal');
  const yes = document.getElementById('bioConsentAgreeBtn');
  const no  = document.getElementById('bioConsentDeclineBtn');
  if (!m || !yes || !no){ onAccept && onAccept(); return; }

  closeAllModalsExcept('bioConsentModal');
  m.classList.remove('hidden');
  yes.onclick = () => { acceptBioConsent(); m.classList.add('hidden'); onAccept && onAccept(); };
  no.onclick  = () => { m.classList.add('hidden'); onDecline && onDecline(); };
}

function showModePicker(){
  const m  = document.getElementById('modeModal');
  const bC = document.getElementById('modeClassicBtn');
  const bH = document.getElementById('modeChallengeBtn');
  const bB = document.getElementById('modeBioBtn');

  // NEW: hide top bar while choosing a mode
  const topBar = document.getElementById('topBar');
  if (topBar) topBar.classList.add('hidden');

  document.body.classList.remove('login-active');
  document.body.classList.add('mode-pick');
  document.body.classList.remove('game-active');

  if (!m || !bC || !bH || !bB){ 
    currentMode = 'classic'; 
    afterModeSelected(false); 
    return; 
  }

  const hide = () => m.classList.add('hidden');
  closeAllModalsExcept('modeModal');
  m.classList.remove('hidden');

  bC.onclick = () => { currentMode = 'classic'; hide(); afterModeSelected(false); };
  bH.onclick = () => { currentMode = 'challenge'; hide(); afterModeSelected(false); };
  bB.onclick = () => {
    const proceedBio = () => { currentMode = 'bio'; hide(); afterModeSelected(true); };
    if (hasBioConsent()) proceedBio();
    else showBioConsentModal(proceedBio, () => { currentMode = 'classic'; hide(); afterModeSelected(false); });
  };
}

function afterModeSelected(isBio){
  // show the top bar again
  const topBar = document.getElementById('topBar');
  if (topBar){
    topBar.classList.remove('hidden');
    topBar.style.display = 'grid';   // ensure visibility even if a previous style lingered
  }

  document.body.classList.remove('login-active');
  document.body.classList.remove('mode-pick');
  document.body.classList.add('game-active');

  // Lock legacy dropdown during a round
  const ms = document.getElementById('modeSelect');
  if (ms) ms.disabled = true;

  // Now actually start the game round
  const centerEl = document.getElementById('center'), btn = document.getElementById('restartBtn');
  if (centerEl){ centerEl.textContent = ''; centerEl.style.display = 'none'; }
  if (btn){ btn.style.display = 'none'; }

  window.__playerReady = true;

  if (isBio){
    loadFaceApiModels();
    startWebcam();
    startSampler();
  } else {
    stopSampler();
    stopWebcam();
  }

  refreshCameraBtn();
  restart(false);
}


function openLoginProgress(msg){
  const m = document.getElementById('loginProgressModal');
  const p = document.getElementById('loginProgressMsg');
  const c = document.getElementById('loginProgressContinue');
  if (m && p){ 
    closeAllModalsExcept('loginProgressModal'); 
    p.textContent = msg || ''; 
    m.classList.remove('hidden'); 
  }
  if (c){ 
    c.classList.add('hidden');  // keep hidden during fetch
    c.disabled = true;          // and not focusable
    c.onclick = null; }
}

function updateLoginProgress(msg, showContinue, onContinue){
  const p = document.getElementById('loginProgressMsg');
  const c = document.getElementById('loginProgressContinue');
  if (p) p.textContent = msg || '';
  if (c){
    if (showContinue){ 
      c.classList.remove('hidden'); 
      c.disabled = false;
      c.onclick = onContinue || null; }
    else {
      c.classList.add('hidden');  // hide while waiting
      c.disabled = true;
      c.onclick = null;
    }
  }
}
function closeLoginProgress(){ document.getElementById('loginProgressModal')?.classList.add('hidden'); }

// --- Block library key handlers while any modal is open ---
function modalOpen(){ return !!document.querySelector('.modal:not(.hidden)'); }
function isFormTarget(el){
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return el.isContentEditable || ['input','textarea','select','button'].includes(tag) || el.closest('.modal');
}
function swallowKeysIfModal(e){
  // Some browsers dispatch key events with undefined e.key during UI interactions.
  // Stop them from reaching q5/p5play to avoid crashes.
  if (modalOpen() && isFormTarget(e.target)) {
    e.stopImmediatePropagation();
  }
}
document.addEventListener('keydown', swallowKeysIfModal, true);
document.addEventListener('keyup', swallowKeysIfModal, true);

function setLoginStatus(msg, cls='info') {
  const el = document.getElementById('loginStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = `loginStatus ${cls}`;
}


/* =======================================
 *        Update Game Run and Profile
 * ======================================= */

function nowMs(){ return (typeof millis === 'function') ? millis() : Date.now(); }

async function submitRun(){
  try {
    const durationMs = Math.max(0, nowMs() - startTime);
    // one per page load; useful for grouping runs
    window.__sessionId = window.__sessionId || (crypto.randomUUID?.() || ('s-' + Date.now()));
    const runId = crypto.randomUUID?.() || ('run-' + Date.now());

    await fetch(`${GOOGLE_SCRIPT_URL}${GOOGLE_SCRIPT_POST_SUFFIX}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'run',
        deviceId: playerDeviceId,
        username: playerUsername || '',
        mode: currentMode,
        score,
        durationMs,
        // optional fields; Apps Script accepts empty
        bubblesPopped,
        accuracy: +( (bubblesPoppedGood / Math.max(1, tapsTotal)).toFixed(3) ),
        // emotion counts (sampler ticks per round)
        emoHappy:    emoCounts.happy,
        emoSad:      emoCounts.sad,
        emoAngry:    emoCounts.angry,
        emoStressed: emoCounts.stressed,
        emoNeutral:  emoCounts.neutral,
        // game info
        gameVersion: 'v8.0',
        sessionId: window.__sessionId,
        runId
      })
    });
  } catch (e) {
    console.warn('[submitRun] failed:', e);
  }
}


/* =============================
 *        Setup & Draw
 * ============================= */
function setup(){
  const mainCanvas = createCanvas(viewportW(), viewportH());
  if (mainCanvas?.drawingContext){
    try { mainCanvas.drawingContext.willReadFrequently = true; } catch(e){}
  }
  noStroke();
  world.gravity.y = 0;

  // Mode selector wiring
  const modeSelect = document.getElementById('modeSelect');
  if (modeSelect){
    currentMode = modeSelect.value;
    modeSelect.onchange = async () => {
      currentMode = modeSelect.value;
      if (window.__playerReady) restart(true);  // restart only after login
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
  // const cnv = _renderer?.canvas || document.querySelector('canvas');
  const cnv = document.querySelector('canvas') || (typeof _renderer !== 'undefined' && _renderer.canvas);

  if (cnv){
    cnv.style.touchAction = 'none';
    cnv.addEventListener('pointerdown', (e) => {
      if (!window.__playerReady) return; // ignore clicks until after login
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

  // Defer entity creation until after login (startGame -> restart)
  score = 0; startTime = millis(); gameOver = false;
  document.getElementById('center').style.display = 'none';
  const btn = document.getElementById('restartBtn');
  if (btn){ btn.style.display = 'none'; btn.onclick = () => { if (window.__playerReady) restart(false); }; }

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

  // Pause draw loop until player completes login
  try { noLoop(); } catch {}

  // Post-game modal buttons
  const pg = document.getElementById('postGameModal');
  const pgClose = document.getElementById('postGameClose');
  const pgPlay  = document.getElementById('postPlayAgain');
  const pgMode  = document.getElementById('postChangeMode');

  if (pgClose) pgClose.onclick = closePostGameModal;
  // prevent the game close if not clicking the play again button or change mode button
  // if (pg) pg.addEventListener('click', (e) => { if (e.target.id === 'postGameModal') closePostGameModal(); });

  if (pgPlay) pgPlay.onclick = () => { closePostGameModal(); if (window.__playerReady) restart(false); };
  if (pgMode) pgMode.onclick = () => { closePostGameModal(); showModePicker(); };
}

function draw(){
  if (window.__splashActive || !window.__playerReady) return; // do nothing until after login
  fitCanvasToViewport();
  background(200,230,255);

  const timeLeft = Math.max(0, GAME_DURATION - Math.floor((millis() - startTime)/1000));
  document.getElementById('scoreChip').textContent = `Score: ${score}`;
  document.getElementById('timeChip').textContent  = `Time: ${timeLeft}`;

  const modeChip = document.getElementById('modeChip');
  if (modeChip){
    const label = (currentMode === 'classic') ? 'Classic'
                : (currentMode === 'challenge') ? 'Challenge'
                : 'Mood';
    // Always keep the text current
    modeChip.textContent = `Mode: ${label}`;
    // Visible only in Bio mode (per your spec)
    modeChip.style.display = isBioMode() ? 'inline-flex' : 'none';
  }

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
    // Bio mode
    refreshCameraBtn(); // decides visibility based on laptop + toggle
    bioChip?.classList.remove('hiddenChip');
    refreshCameraBtn();

    const emo = dominantEmotion();
    bioChip.textContent = emo.toUpperCase();
    if (emo === 'happy'){ bioChip.style.background = 'rgba(120,255,160,.85)'; modeSpeedMult = 1.5; }
    else if (emo === 'sad'){ bioChip.style.background = 'rgba(120,160,255,.85)'; modeSpeedMult = 0.8; }
    else if (emo === 'angry'){ bioChip.style.background = 'rgba(255,140,140,.85)'; modeSpeedMult = 1; }
    else if (emo === 'stressed'){ bioChip.style.background = 'rgba(255,200,120,.85)'; modeSpeedMult = 0.5; }
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
  // old:
  // b._tint = color(random(120,210), random(140,220), 255, 150);

  // new (choose a palette color with a stronger, visible alpha):
  const cIdx = Math.floor(random(BUBBLE_COLORS.length));
  const [r,g,bv] = BUBBLE_COLORS[cIdx];
  b._tint = color(r, g, bv, 200);

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

// Capture game stat during gameplay
function handlePop(px, py){
  if (gameOver || !window.__playerReady || !bubbles) return;

  tapsTotal++;
  let hit = false;

  for (let i = bubbles.length - 1; i >= 0; i--){
    const b = bubbles[i], r = currentRadius(b), rHit = r + (IS_TOUCH ? TOUCH_HIT_PAD : 0);
    const dx = px - b.x, dy = py - b.y;
    if (dx*dx + dy*dy <= rHit*rHit){
      hit = true;

      // update score exactly like before
      score += (b._type === 'trick') ? -1 : 1;
      if (score < 0) score = 0;

      // NEW: stats
      bubblesPopped++;
      if (b._type === 'trick') bubblesPoppedTrick++;
      else bubblesPoppedGood++;

      b.remove();
      spawnBubble();
      break;
    }
  }

  if (!hit) tapsMissed++;
}


function mousePressed(){ if (!window.__playerReady) return; handlePop(mouseX, mouseY); }
function touchStarted(){
  if (!window.__playerReady) return;
  if (touches && touches.length) for (const t of touches) handlePop(t.x, t.y);
  else handlePop(mouseX, mouseY);
}

function endGame(){
  gameOver = true; 
  noLoop();

  const centerEl = document.getElementById('center');
  const btn = document.getElementById('restartBtn');
  if (centerEl){ centerEl.textContent = `Game Over!\nScore: ${score}`; centerEl.style.display = 'block'; }
  if (btn){ btn.style.display = 'none'; }

  const ms = document.getElementById('modeSelect');
  if (ms) ms.disabled = true; // keep mode locked during post-game UI

  if (isBioMode()){
    if (BIO_STOP_STRATEGY === 'pause') { stopSampler(); }
    else { stopSampler(); stopWebcam(); }
    clearTimeout(bioIdleStopTO);
    bioIdleStopTO = setTimeout(() => { if (gameOver && isBioMode()) stopWebcam(); }, BIO_IDLE_STOP_MS);
  }

  // Send game stat to google sheet
  submitRun();

  openPostGameModal();
}


function restart(fromModeButton){
  // Lazy init groups/walls on first start
  if (!bubbles) {
    bubbles = new Group();
    bubbles.collider = 'dynamic';
    bubbles.bounciness = 1;
    bubbles.friction = 0;
    bubbles.drag = 0;
  } else {
    for (let i = bubbles.length - 1; i >= 0; i--) bubbles[i].remove();
  }
  for (let i = 0; i < START_BUBBLES; i++) spawnBubble();
  if (!walls || walls.length < 4) buildWalls();

  // reset per-round stats
  tapsTotal = 0;
  tapsMissed = 0;
  bubblesPopped = 0;
  bubblesPoppedGood = 0;
  bubblesPoppedTrick = 0;

  score = 0;
  startTime = millis();
  gameOver = false;

  closePostGameModal();                     // close post-game UI if it was open
  const ms = document.getElementById('modeSelect');
  if (ms) ms.disabled = true;               // lock mode during the round

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

  const onReady = () => { if (isBioMode() && window.__playerReady) startSampler(); };
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
    const vw = v.videoWidth  || 640;
    const vh = v.videoHeight || 480;
    const det = ensureDetectorCanvas(vw, vh);
    // draw the current video frame onto our own canvas
    if (dctx){ dctx.drawImage(v, 0, 0, vw, vh); }
    const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.08 });
    detections = await faceapi.detectAllFaces(det, tinyOpts).withFaceLandmarks().withFaceExpressions();
  } catch (e) { console.warn('[bio] tinyFace error:', e); }

  if (!detections || !detections.length){
    // Decay toward neutral if no face
    bioState.happy = ema(bioState.happy, 0, 0.3);
    bioState.sad   = ema(bioState.sad,   0, 0.3);
    bioState.angry = ema(bioState.angry, 0, 0.3);
    bioState.stressed = ema(bioState.stressed, 0, 0.3);
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
  // STRESSED: blend fearful + disgusted + surprised
  const stressedRaw = 0.6 * acc.fearful + 0.3 * acc.disgusted + 0.1 * acc.surprised;
  bioState.stressed = ema(bioState.stressed, stressedRaw, 0.75);

  if (troubleshootMode) console.log('emo raw:', acc);

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

  // Count one “tick” toward the dominant emotion each sample
  const emo = dominantEmotion();
  if (emo && emoCounts.hasOwnProperty(emo)) emoCounts[emo]++;
}

/**
 * Decide dominant emotion based on smoothed bioState with hysteresis/cooldown.
 * @returns {'happy'|'sad'|'angry'|'stressed'|'neutral'}
 */
function dominantEmotion(){
  const h = Number(bioState.happy||0),
        s = Number(bioState.sad||0),
        a = Number(bioState.angry||0),
        t = Number(bioState.stressed||0);
  const nRaw = (bioState.neutral != null) ? Number(bioState.neutral) : 0;
  const n = nRaw > 0 ? nRaw : Math.max(0, 1 - (h + s + a + t));

  const sum = h + s + a + t + n + 1e-6;
  const shares = [
    {k:'happy',v:h/sum},{k:'sad',v:s/sum},{k:'angry',v:a/sum},{k:'stressed',v:t/sum},{k:'neutral',v:n/sum}
  ].sort((x,y)=>y.v-x.v);

  const now = (typeof millis === 'function') ? millis() : Date.now();
  const inCooldown = (now - lastSwitchMs) < EMO_CFG.COOLDOWN_MS;
  const neutralShare = shares.find(x=>x.k==='neutral').v;

  if (lastEmotion === 'neutral'){ if (neutralShare >= EMO_CFG.NEUTRAL_OFF) return 'neutral'; }
  else { const curShare = shares.find(x=>x.k===lastEmotion)?.v || 0; if (curShare >= EMO_CFG.OFF) return lastEmotion; }

  // Strong neutral
  if (shares[0].k === 'neutral' && shares[0].v >= EMO_CFG.NEUTRAL_ON){
    if (!inCooldown || lastEmotion!=='neutral'){ lastEmotion='neutral'; lastSwitchMs=now; }
    return 'neutral';
  }

  // Raw-force gates
  if (h >= EMO_FORCE.HAPPY_RAW   && (!inCooldown || lastEmotion!=='happy'))   { lastEmotion='happy';   lastSwitchMs=now; return 'happy'; }
  if (s >= EMO_FORCE.SAD_RAW     && (!inCooldown || lastEmotion!=='sad'))     { lastEmotion='sad';     lastSwitchMs=now; return 'sad'; }
  if (a >= EMO_FORCE.ANGRY_RAW   && (!inCooldown || lastEmotion!=='angry'))   { lastEmotion='angry';   lastSwitchMs=now; return 'angry'; }
  if (t >= EMO_FORCE.STRESSED_RAW&& (!inCooldown || lastEmotion!=='stressed')){ lastEmotion='stressed';lastSwitchMs=now; return 'stressed'; }

  // Otherwise, take the top non-neutral if it beats #2 by a margin
  const nonNeutral = shares.filter(x=>x.k!=='neutral').sort((x,y)=>y.v-x.v);
  const top = nonNeutral[0], second = nonNeutral[1];
  if (top.v >= EMO_CFG.ON && (top.v - second.v) >= EMO_CFG.MARGIN){
    if (!inCooldown || lastEmotion!==top.k){ lastEmotion=top.k; lastSwitchMs=now; }
    return lastEmotion;
  }

  // Fallbacks
  if (neutralShare >= EMO_CFG.NEUTRAL_OFF){
    if (!inCooldown || lastEmotion!=='neutral'){ lastEmotion='neutral'; lastSwitchMs=now; }
    return 'neutral';
  }
  return lastEmotion;
}


/* =============================
 *        Modal helpers
 * ============================= */
function openCameraModal(){ closeAllModalsExcept('cameraModal'); document.getElementById('cameraModal')?.classList.remove('hidden'); }
function closeCameraModal(){ document.getElementById('cameraModal')?.classList.add('hidden'); }
// this function closeAllModalsExcept will ensure only 1 modal is ever visible - prevent "grey window behind"
function closeAllModalsExcept(id){
  document.querySelectorAll('.modal').forEach(el => {
    if (el.id !== id) el.classList.add('hidden');
  });
}

// ===== Splash Controller =====
(function initSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;

  // Helper to end the splash with fade-out
  function dismissSplash() {
    if (!splash.classList.contains('is-visible')) return;

    splash.classList.add('is-fading-out');

    // Give the CSS transition time to finish
    setTimeout(() => {
      splash.classList.remove('is-visible', 'is-fading-out');

      // Hook for your game: start music later, restart level, etc.
      if (typeof window.onSplashDismiss === 'function') {
        try { window.onSplashDismiss(); } catch (e) { console.warn(e); }
      }
    }, 420);
  }

  // Make it visible on load (CSS handles fade-in)
  requestAnimationFrame(() => splash.classList.add('is-visible'));

  // Interactions: click/tap or keys (Enter/Space)
  const startEvents = ['click', 'touchend'];
  startEvents.forEach(evt => splash.addEventListener(evt, dismissSplash, { passive: true }));
  window.addEventListener('keydown', (e) => {
    const k = e.key?.toLowerCase();
    if (k === 'enter' || k === ' ') dismissSplash();
  });
})();

window.__splashActive = true;
window.onSplashDismiss = function () {
  window.__splashActive = false;
  playerDeviceId = playerDeviceId || getOrCreateDeviceId();
  showLoginScreen(playerDeviceId); // open login after splash
};

function openPostGameModal(){ closeAllModalsExcept('postGameModal'); document.getElementById('postGameModal')?.classList.remove('hidden'); }
function closePostGameModal(){ document.getElementById('postGameModal')?.classList.add('hidden'); }


/* =============================
 *        Login & start
 * ============================= */
function startGame() {
  // Close login UI
  const modal = document.getElementById('loginModal');
  if (modal) modal.classList.add('hidden');
  document.body.classList.remove('login-active');

  // Show mode picker instead of starting immediately
  showModePicker();
}


/**
 * Show login screen: prefill from profile or suggest, validate, then POST setUsername.
 * Keeps naming consistent: deviceId, username.
 */
function showLoginScreen(deviceId){
  const modal  = document.getElementById('loginModal');
  const input  = document.getElementById('usernameInput');
  const submit = document.getElementById('submitUsername');
  if (!modal || !input || !submit) return;

  // keep top bar hidden here
  const topBar = document.getElementById('topBar');
  if (topBar) topBar.classList.add('hidden');

  document.body.classList.add('login-active');
  document.body.classList.remove('mode-pick');
  document.body.classList.remove('game-active');

  modal.classList.remove('hidden');

  // track if user started typing
  let loginUserEdited = false;
  input.addEventListener('input', () => { loginUserEdited = true; });

  // reset and show device check status
  input.value = '';
  setLoginStatus('Checking if this device is already recognized…', 'info');

  let priorProfile = null;

  // Fetch prior profile for this deviceId
  fetch(`${GOOGLE_SCRIPT_URL}?action=profile&deviceId=${encodeURIComponent(deviceId)}`)
    .then(r => r.json())
    .then(data => {
      const suggested = (data && data.ok && data.profile && data.profile.username)
        ? String(data.profile.username || '').trim()
        : `Player-${deviceId.slice(0,6)}`;

      if (!loginUserEdited && (!input.value || input.value.trim() === '')) {
        input.value = suggested;
      } else {
        input.placeholder = suggested; // don't overwrite what the user typed
      }

      if (data && data.ok && data.profile) {
        priorProfile = data.profile;
        setLoginStatus(`Welcome back! This device is linked to “${suggested}”. You can keep it or choose a new name.`, 'ok');
      } else {
        setLoginStatus('New device detected. Please create a username.', 'info');
      }
    })
    .catch(() => {
      const suggested = `Player-${deviceId.slice(0,6)}`;
      if (!loginUserEdited && (!input.value || input.value.trim() === '')) input.value = suggested;
      else input.placeholder = suggested;
      setLoginStatus('Could not check device right now. You can still create a username.', 'err');
    });

  // SUBMIT: check availability first (keep modal open). Only show "Saving…" progress after it’s available.
  submit.onclick = function() {
    const username = (input.value || '').trim();
    if (!username) return;

    submit.classList.add('is-busy');
    submit.disabled = true;
    setLoginStatus('Checking username…', 'info');

    // include deviceId so your server allows the owner device to reuse its name
    fetch(`${GOOGLE_SCRIPT_URL}?action=checkUsername&username=${encodeURIComponent(username)}&deviceId=${encodeURIComponent(deviceId)}`)
      .then(r => r.json())
      .then(data => {
        const canUse = !!(data && data.ok && (data.available || (priorProfile && priorProfile.username === username)));
        if (!canUse) {
          // taken by another device/player — keep modal open and show message
          setLoginStatus(`“${username}” is already taken by another device. Please choose a different username.`, 'err');
          throw new Error('username_taken');
        }

        // Now proceed to save (show progress modal only here)
        const loginM = document.getElementById('loginModal');
        if (loginM) loginM.classList.add('hidden');
        document.body.classList.remove('login-active');

        openLoginProgress(`Saving your username… this can take a moment.\nAfter this, you’ll choose a mode and the round will start.`);

        return fetch(`${GOOGLE_SCRIPT_URL}${GOOGLE_SCRIPT_POST_SUFFIX}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'setUsername', deviceId, username })
        }).then(() => {
          try { localStorage.setItem(STORAGE_KEYS.username, username); } catch {}
          playerUsername = username;

          const greet = (priorProfile && priorProfile.username === username)
            ? `Welcome back, ${username}!`
            : `Saved. Hello, ${username}!`;

          updateLoginProgress(`${greet}\nOpening mode selection…`, false);
          closeLoginProgress();
          startGame();  // opens Mode Picker immediately
        });
      })
      .catch((err) => {
        // if we already hid login for progress (unexpected error), reopen it
        const wasTaken = String(err && err.message) === 'username_taken';
        if (!wasTaken) {
          // generic failure while saving — show in-login error and keep modal
          const loginM2 = document.getElementById('loginModal');
          if (loginM2) { loginM2.classList.remove('hidden'); document.body.classList.add('login-active'); }
          setLoginStatus('Could not save username. Please try again.', 'err');
        }
      })
      .finally(() => {
        submit.classList.remove('is-busy');
        submit.disabled = false;
      });
  };
}