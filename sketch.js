// ============================================================================
// Popping Bubbles — Production Game Script (sketch.js)
// Owner: Ken Pao
//
// About this file
// - q5.js + p5play v3 game loop (setup/draw) with three modes: classic | challenge | mood
// - Mood mode: face-api.js sampling, emotion smoothing, "stressed" blend (fearful+disgusted+surprised)
// - UI flow: Splash -> Login (device check + username) -> Mode Picker -> Gameplay -> Post-game
// - Stats posted to Google Apps Script via a Cloudflare Worker proxy
//
// Structure guide (search for these section banners):
//   [Game constants]        core tunables for gameplay + mood thresholds
//   [Backend config]        worker endpoint for Google Apps Script
//   [Identity & storage]    deviceId/username/moodConsent keys
//   [Troubleshooting mode]  laptop-only toggle 't' to reveal camera button
//   [UI helpers]            viewport sizing, walls/safe area, overlay for face box, body-mode classes
//   [Submit Run]            sends round results (score + emotion counts) to Sheets
//   [Setup & Draw]          q5 lifecycle; input wiring; per-frame UI updates
//   [Gameplay]              bubble spawn, hit logic, restart/endGame
//   [Mood (face-api)]        model loading, webcam controls, sampler and dominantEmotion()
//   [Modals & Splash]       helpers to open/close, splash controller
//   [Login & start]         device profile check, username flow, mode picker trigger
//
// Safe customization points
// - GAME_DURATION, bubble sizes/speeds
// - EMO_CFG and EMO_FORCE thresholds (tune mood responsiveness)
// - CHALLENGE_TRICK_RATE for trick bubble frequency
// - Consent copy is in index.html; Sheets columns are handled in Apps Script
//
// ============================================================================
// NOTE: 
// a. Do not rename existing variables/IDs. UI and Sheets integrations depend on current names.
// b. Coding with ChatGPT assistance
//
// ============================================================================


/* =============================
 *        Game constants
 * ============================= */
const GV = 'v10.5.2';                 // game version number
const GAME_DURATION = 30;             // seconds
const START_BUBBLES_CLASSIC   = 12;
const START_BUBBLES_CHALLENGE = 16;
const START_BUBBLES_MOOD      = 10;

const MIN_DIAM = 50, MAX_DIAM = 88;   // bubble size range
const MIN_SPEED = 1.6, MAX_SPEED = 3.8;
const MIN_PLAY_SPEED = 0.9;           // floor after multipliers

// Scoring (size-based): smaller bubbles => more points
const SCORE_BASE = 1;                  // base points for a normal pop
const SCORE_SIZE_MULTIPLIER = 1.8;     // tune how much small size boosts score
const SCORE_TRICK_PENALTY = 1;         // points removed for trick bubbles

// Miss-streak easing (reduce frustration on phones)
const MISS_STREAK_TRIGGER        = 3;    // start easing after this many consecutive misses
const MISS_STREAK_SLOW_PER_MISS  = 0.08; // each miss beyond trigger slows ~8%
const MISS_STREAK_SLOW_CAP       = 0.35; // never slow more than 35%
let currentMode = 'classic'; // 'classic' | 'challenge' | 'mood'

const CLASSIC_SPEED_SCALE = 0.75;
const CLASSIC_SPEED_CAP   = 3.0;
// v10.5.2 — Mode labels, mood presets, unified speed helpers
const MODE_LABEL = { classic: 'Zen', challenge: 'Focus', mood: 'Emotion' };

// v10.0.0 — Classic variants + static board (Step 2)
const CLASSIC_TIME_MS = 60000;       // 60s for Timed
let classicVariant = null;
let classicDeadline = 0;             // ms; 0 => relax (no timer)

const EMO_PRESET = {
  neutral: { bg: '#f3f4f6', chip: '#e5e7eb', speed: 1.0, emoji: '' },
  happy:   { bg: '#dcfce7', chip: '#a7f3d0', speed: 1.3, emoji: '😊' },
  sad:     { bg: '#bfdbfe', chip: '#93c5fd', speed: 0.8, emoji: '😢' },
  angry:   { bg: '#fee2e2', chip: '#fca5a5', speed: 1.0, emoji: '😠' },
  stressed:{ bg: '#fef3c7', chip: '#fde047', speed: 0.6, emoji: '😟' },
};

const MODE_SPEED_BASE = { classic: (typeof CLASSIC_SPEED_SCALE!=='undefined'?CLASSIC_SPEED_SCALE:1.0), challenge: 1.3, mood: 1.0 };
const MODE_SPEED_CAP  = { classic: (typeof CLASSIC_SPEED_CAP!=='undefined'?CLASSIC_SPEED_CAP:Infinity), challenge: Infinity, mood: Infinity };

function getModeSpeedMult(mode, emo /* string or null */){
  if (mode === 'mood') return EMO_PRESET[emo || 'neutral'].speed;
  return MODE_SPEED_BASE[mode] || 1.0;
}

function applyModeUI(mode, emo /* string or null */){
  const modeChip = document.getElementById('modeChip');
  const moodChip = document.getElementById('moodChip');
  const camBtnEl = document.getElementById('cameraBtn');

  if (modeChip){
    modeChip.textContent = `Mode: ${MODE_LABEL[mode] || '—'}`;
    modeChip.style.display = 'inline-flex';
  }

  // Camera + mood chip visibility
  if (mode === 'mood'){
    moodChip?.classList.remove('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'inline-flex';
    const p = EMO_PRESET[emo || 'neutral'];
    if (moodChip) moodChip.style.background = p.chip;
    document.body.style.setProperty('--mood-background-color', p.bg);
    document.body.style.setProperty('--mood-emoji-url', p.emoji);
  } else {
    moodChip?.classList.add('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'none';
  }
}

// v10.0.0 — Red penalty & flyout
const RED_RATE    = 0.15;   // ~15% of bubbles are red in Classic
const RED_PENALTY = 2;      // popping a red bubble subtracts 2

const MOOD_SAMPLE_MS = 1500;           // face sampling cadence (ms)

const COLOR_TEAL = [15, 118, 110, 200];
const COLOR_RED  = [198, 40, 40, 200];

// Mood end-game behavior: 'pause' (sampler only) or 'stop' (sampler + camera)
const MOOD_STOP_STRATEGY = 'pause';
const MOOD_IDLE_STOP_MS = 45000;       // stop camera after idle timeout on Game Over
let moodIdleStopTO = null;

const TOUCH_HIT_PAD = 12;
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);



const CHALLENGE_TRICK_RATE = 0.22;
const MOOD_TRICK_RATE = 0.18;
const MAX_TRICK_RATIO = 0.5;   // at most 50% of on-screen bubbles can be red/trick

// Extra scoring juice for tougher modes
const MODE_SCORE_MULT = {
  challenge: 1.5,
  mood: 1.8
};

let bubbles;               // p5play Group of bubbles
let walls;                 // boundary walls
let prevSafeTop = -1;      // last safe top for wall rebuild

let score = 0;
let startTime = 0;
let gameOver = false;

let missStreak = 0;    // consecutive misses since last hit
let rubberSlow = 0;    // 0..MISS_STREAK_SLOW_CAP

// NEW: per-round input & pop stats
let tapsTotal = 0;              // all tap/click attempts
let tapsMissed = 0;             // attempts that didn’t hit any bubble
let bubblesPopped = 0;          // total bubbles removed by the player
let bubblesPoppedGood = 0;      // non-trick pops (these increase score)
let bubblesPoppedTrick = 0;     // trick pops (these decrease score)

// v9.0.1 — feedback state (one POST per round)
window.__feedbackBefore = '';   // set from Login "Feedback (optional)"
window.__feedbackAfter  = '';   // set from Post-game "Feedback"
window.__runSubmitted   = false; // guard to ensure single POST per round

// Camera state
let currentStream = null;
let selectedDeviceId = null;

// Mood (face-api) state
let modelsReady = false;
let moodTimerId = null;
let overlay, octx;         // overlay canvas for green box
// Hidden detector canvas we control (to avoid face-api creating its own readback-heavy canvas)
let detectorCanvas = null, dctx = null;

// Aggregated expression state (smoothed)
const moodState = { gaze: { x: 0.5, y: 0.5 }, happy: 0, sad: 0, angry: 0, stressed:0, neutral: 1 };

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

// Per-round emotion counts (incremented by the Mood sampler)
let emoCounts = { happy: 0, sad: 0, angry: 0, stressed: 0, neutral: 0 };

// v10.0.1 — Step 4A: challenge combo
let comboHitStreak = 0;
let comboMult  = 1.0;   // 1.0 → 1.5 after 5 hits → 2.0 after 10 hits


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
const STORAGE_KEYS = { deviceId: 'bbg_device_id', username: 'bbg_username', moodConsent: 'bbg_mood_consent'};
let playerDeviceId = null;
let playerUsername = null;
window.__playerReady = false; // gate the draw loop & inputs until username exists

// v9.1 migration: carry over any old 'bio' consent key once
(function migrateBioConsentToMood(){
  try {
    const oldKey = 'bbg_bio_consent';
    const newKey = STORAGE_KEYS.moodConsent;
    if (localStorage.getItem(oldKey) !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey));
      localStorage.removeItem(oldKey);
    }
  } catch(_) {}
})();

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
// Troubleshoot visibility (toggles the camera button on laptops in Mood mode)
let troubleshootMode = false;

function isLaptop(){
  const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const w = Math.max( viewportW?.() || 0, window.innerWidth || 0 );
  const ua = (navigator.userAgent || '').toLowerCase();
  const desktopUA = /(macintosh|mac os x|windows nt|linux|cros)/.test(ua);
  return !hasTouch && !coarse && (desktopUA || w >= 900);
}

// this function must place after isLaptop() function
function detectDeviceType(){
  const ua = (navigator.userAgent || '').toLowerCase();
  const isIpad = /ipad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIphone = /iphone/.test(ua);
  const isAndroid = /android/.test(ua);
  const isSamsung = /sm-|samsungbrowser/.test(ua);
  const isPixel = /pixel/.test(ua);
  const isTablet = isAndroid && !/mobile/.test(ua);
  if (isIphone) return 'iphone';
  if (isIpad) return 'ipad';
  if (isSamsung && isAndroid) return 'samsung_phone';
  if (isPixel && isAndroid) return 'google_phone';
  if (isAndroid && !isTablet) return 'android_phone';
  if (isTablet) return 'android_tablet';
  return isLaptop() ? 'laptop' : 'desktop';
}

function refreshCameraBtn(){
  const btn = document.getElementById('cameraBtn');
  if (!btn) return;
  const show = window.__playerReady && isMoodMode() && isLaptop() && troubleshootMode;
  btn.style.display = show ? 'inline-flex' : 'none';
}

// Press "t" to toggle troubleshoot mode (only matters in Mood mode on laptops)
document.addEventListener('keydown', (e) => {
  if ((e.key || '').toLowerCase() === 't' && window.__playerReady && isMoodMode() && isLaptop()){
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
    overlay.id = '__moodOverlay';
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

/** Is the UI in Mood mode? */
function isMoodMode(){
  return (typeof currentMode !== 'undefined' && String(currentMode).toLowerCase() === 'mood');
}

/** Update the Mood chip text */
function setEmotionChip(next){
  const chip = document.getElementById('moodChip');
  if (chip) chip.textContent = String(next || 'neutral').toUpperCase();
}

/** Keep <body> mode class in sync with currentMode so CSS can theme chips */
function setBodyModeClass(){
  const root = document.body;
  if (!root) return;
  root.classList.remove('mode-classic','mode-challenge','mode-mood');
  const cls = (currentMode === 'classic') ? 'mode-classic' : (currentMode === 'challenge') ? 'mode-challenge' : 'mode-mood';
  root.classList.add(cls);
}

function hasMoodConsent(){
  try { return localStorage.getItem(STORAGE_KEYS.moodConsent) === 'accepted'; }
  catch { return false; }
}
function acceptMoodConsent(){
  try { localStorage.setItem(STORAGE_KEYS.moodConsent, 'accepted'); } catch {}
}

function showMoodConsentModal(onAccept, onDecline){
  const m = document.getElementById('moodConsentModal');
  const yes = document.getElementById('moodConsentAgreeBtn');
  const no  = document.getElementById('moodConsentDeclineBtn');
  if (!m || !yes || !no){ onAccept && onAccept(); return; }

  closeAllModalsExcept('moodConsentModal');
  m.classList.remove('hidden');
  yes.onclick = () => { acceptMoodConsent(); m.classList.add('hidden'); onAccept && onAccept(); };
  no.onclick  = () => { m.classList.add('hidden'); onDecline && onDecline(); };
}

function showModePicker(){
  // Cancel any lingering Classic auto-start timers
  try { if (window.__classicAutoTO) clearTimeout(window.__classicAutoTO); } catch(_) {}
  window.__classicAutoTO = null;

  // While the mode chooser is open, freeze gameplay and mark picking
  window.__modePicking = true;
  window.__playerReady = false;   // stops draw() early
  try { noLoop(); } catch(_) {}

  const m  = document.getElementById('modeModal');
  const bC = document.getElementById('modeClassicBtn');
  const bH = document.getElementById('modeChallengeBtn');
  const bB = document.getElementById('modeMoodBtn');

  // Hide top bar while choosing a mode
  const topBar = document.getElementById('topBar');
  if (topBar) topBar.classList.add('hidden');

  document.body.classList.remove('login-active');
  document.body.classList.add('mode-pick');
  document.body.classList.remove('game-active');

  // Bail safely if any element is missing
  if (!m || !bC || !bH || !bB){
    console.warn('[mode] Mode picker elements missing; not auto-starting.');
    return;
  }

  const hide = () => {
    m.classList.add('hidden');
    window.__modePicking = false;    // release the guard when leaving picker
  };

  closeAllModalsExcept('modeModal');
  m.classList.remove('hidden');

  // Prefetch face-api on idle while menu is visible
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => prefetchFaceApi(), { timeout: 1200 });
  } else {
    setTimeout(prefetchFaceApi, 800);
  }

  // sketch.js — around line 738

  // Classic mode
  bC.onclick = () => {
    currentMode = 'classic';
    setBodyModeClass();
    hide();
    afterModeSelected(false);
  };

  // Challenge mode
  bH.onclick = () => {
    currentMode = 'challenge';
    setBodyModeClass();
    hide();
    afterModeSelected(false);
  };

  // Mood mode (use unified pointer event to avoid iOS double-fire)
  bB.onclick = () => {
    prefetchFaceApi();
    const proceedMood = () => {
      currentMode = 'mood';
      setBodyModeClass();
      hide();
      afterModeSelected(true);
    };
    if (hasMoodConsent()) {
      proceedMood();
    } else {
      showMoodConsentModal(
        proceedMood,
        () => {
          currentMode = 'classic';
          setBodyModeClass();
          hide();
          afterModeSelected(false);
        }
      );
    }
  };
}

async function afterModeSelected(isMood){
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

  window.__playerReady = true;

  const loading = document.getElementById('loadingOverlay'); // define DOM "loading" to be used

  // Mood branch
  if (isMood){
    // show loading overlay while models load
    
    if (loading) loading.classList.remove('hidden');

    try {
      const loadingBar = document.querySelector('#loadingOverlay .loadingBar');
      if (loadingBar) loadingBar.style.width = '30%';

      await ensureFaceApiLib();
      await loadFaceApiModels();
      
      if (loadingBar) loadingBar.style.width = '60%';

      await startWebcam();  // startWebcam will startSampler when frames are ready
      
      if (loadingBar) loadingBar.style.width = '80%';

      // show progress while waiting for first sample
      const loadingMsg = document.getElementById('loadingMsg');
      if (loadingMsg) loadingMsg.textContent = 'Analyzing first frame…';

      // wait for first sample (with 3s fail-safe so mobiles don't get stuck)
      await new Promise((resolve) => {
        const fallback = setTimeout(() => {
          if (loadingBar) loadingBar.style.width = '100%';
          if (loadingMsg) loadingMsg.textContent = 'Starting…';
          resolve();
        }, 3000);

        const check = () => {
          if (modelsReady && Object.values(emoCounts).some(v => v > 0)) {
            if (loadingBar) loadingBar.style.width = '100%';
            if (loadingMsg) loadingMsg.textContent = 'Ready!';
            clearTimeout(fallback);
            resolve();
          } else {
            setTimeout(check, 300);
          }
        };
        check();
      });
    } finally {
      // do nothing
    }
  } else {
    stopSampler();
    stopWebcam();
  }

  // If Classic, show the options modal first (Timed/Relax), then start in startClassicRound()
  if (!isMood && currentMode === 'classic') {
    
    if (loading) loading.classList.add('hidden'); // just in case it was visible
    openClassicOpts();
    return; // IMPORTANT: do not call restart() yet
  }

  refreshCameraBtn();
  setBodyModeClass(); // keep CSS theming in sync

  refreshQuitBtn(); // keep to-bar Quit in sync
  noLoop();
  showCountdown(() => { restart(false); });
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

  // fade out, then update, then fade in (keeps prior smooth animation)
  el.classList.add('updating');
  setTimeout(() => {
    el.textContent = msg || '';
    el.className = `loginStatus ${cls}`;

    // fade back in
    requestAnimationFrame(() => {
      el.classList.remove('updating');

      // if this is an error, give a subtle shake nudge
      if (cls === 'err') {
        el.classList.remove('shake');   // restart animation if already present
        void el.offsetWidth;            // reflow to reset
        el.classList.add('shake');
        setTimeout(() => el.classList.remove('shake'), 360);
      }
    });
  }, 200);
}

function onKbFocus() {
  document.body.classList.add('kbd-open');  // if you ever want special styles
}
function onKbBlur() {
  document.body.classList.remove('kbd-open');
  // After the keyboard closes, recenter and ensure canvas/layout refresh
  setTimeout(() => {
    window.scrollTo(0, 0);
    if (typeof resizeCanvas === 'function') {
      try { resizeCanvas(windowWidth, windowHeight); } catch (_) {}
    }
  }, 120);
}

function wireViewportGuard() {
  // iOS/Android: track visual viewport changes (keyboard/zoom)
  if (!window.visualViewport) return;
  let lastScale = window.visualViewport.scale;
  window.visualViewport.addEventListener('resize', () => {
    // If scale drifts and no text field is focused, nudge back to top
    const active = document.activeElement && /^(input|textarea|select)$/i.test(document.activeElement.tagName);
    if (!active && window.visualViewport.scale !== 1) {
      setTimeout(() => window.scrollTo(0, 0), 60);
    }
    lastScale = window.visualViewport.scale;
  });
}

function readSurveyJSON(context){
  if (context === 'before'){
    const q1 = document.querySelector('input[name="preQ1"]:checked')?.value || '';
    const q2 = document.querySelector('input[name="preQ2"]:checked')?.value || '';
    return JSON.stringify({ q1, q2 });
  } else {
    const q1 = document.querySelector('input[name="postQ1"]:checked')?.value || '';
    const q2 = document.querySelector('input[name="postQ2"]:checked')?.value || '';
    const q3 = document.querySelector('input[name="postQ3"]:checked')?.value || '';
    const q4 = document.querySelector('input[name="postQ4"]:checked')?.value || '';
    const q5 = (document.getElementById('postQ5')?.value || '').trim();
    return JSON.stringify({ q1, q2, q3, q4, free: q5 });
  }
}

function hydrateSurveyFromJSON(context, jsonStr){
  try {
    const obj = JSON.parse(jsonStr || '{}');
    if (context === 'before'){
      if (obj.q1) document.querySelector(`input[name="preQ1"][value="${CSS.escape(obj.q1)}"]`)?.setAttribute('checked',true);
      if (obj.q2) document.querySelector(`input[name="preQ2"][value="${CSS.escape(obj.q2)}"]`)?.setAttribute('checked',true);
    } else {
      if (obj.q1) document.querySelector(`input[name="postQ1"][value="${CSS.escape(obj.q1)}"]`)?.setAttribute('checked',true);
      if (obj.q2) document.querySelector(`input[name="postQ2"][value="${CSS.escape(obj.q2)}"]`)?.setAttribute('checked',true);
      if (obj.q3) document.querySelector(`input[name="postQ3"][value="${CSS.escape(obj.q3)}"]`)?.setAttribute('checked',true);
      if (obj.q4) document.querySelector(`input[name="postQ4"][value="${CSS.escape(obj.q4)}"]`)?.setAttribute('checked',true);
      if (obj.free) document.getElementById('postQ5').value = obj.free;
    }
  } catch(_) { }
}

function renderFeedbackThanks(context){
  const container = document.querySelector('#feedbackModal .modalRow.stacked');
  if (!container) return;

  // Replace the questions with a persistent thank-you block
  container.innerHTML = `
    <div class="feedbackThanks">
      Thank you for your feedback for this round. You can play again or change mode anytime.
    </div>
  `;

  const ttl = document.getElementById('feedbackTitle');
  if (ttl) ttl.textContent = 'Thank you!';

  // Hide Save; turn Cancel into Close
  const save = document.getElementById('feedbackSave');
  if (save) save.style.display = 'none';

  const cancel = document.getElementById('feedbackCancel');
  if (cancel) {
    cancel.textContent = 'Close';
    // ensure it closes the modal
    cancel.onclick = () => closeFeedbackModal();
    // focus the Close button for accessibility
    setTimeout(() => cancel.focus(), 50);
  }
}

function startBubblesForMode(){
  return (currentMode === 'classic')
    ? START_BUBBLES_CLASSIC
    : (currentMode === 'challenge')
      ? START_BUBBLES_CHALLENGE
      : START_BUBBLES_MOOD; // mood
}

function rubberSpeedFactor(){
  // factor that multiplies whatever speed your update uses
  const f = 1 - rubberSlow;
  // honor your existing floor:
  return Math.max(f, MIN_PLAY_SPEED);
}

function noteHit(){
  // reset streak and recover one step of slowdown per successful pop
  missStreak = 0;
  rubberSlow = Math.max(0, rubberSlow - MISS_STREAK_SLOW_PER_MISS);
}

function noteMiss(){
  // increase slowdown only after a few consecutive misses
  missStreak++;
  if (missStreak >= MISS_STREAK_TRIGGER){
    rubberSlow = Math.min(MISS_STREAK_SLOW_CAP, rubberSlow + MISS_STREAK_SLOW_PER_MISS);
  }
}

// v10.0.0 — classic option modal
function openClassicOpts(){
  if (window.__modePicking) return;

  const m = document.getElementById('classicOpts');
  if (m) m.classList.remove('hidden');

  // prevent multiple auto-start timers
  clearTimeout(window.__classicAutoTO);
  window.__classicAutoTO = null;
}

function wireClassicOpts(){
  const m = document.getElementById('classicOpts');
  const bt = document.getElementById('classicTimedBtn');
  const br = document.getElementById('classicRelaxBtn');
  if (bt) bt.onclick = ()=>{ classicVariant='timed'; if (m) m.classList.add('hidden'); startClassicRound(); };
  if (br) br.onclick = ()=>{ classicVariant='relax'; if (m) m.classList.add('hidden'); startClassicRound(); };
}
document.addEventListener('DOMContentLoaded', wireClassicOpts);

function startClassicRound(){
  // build static board (no movement, no respawn)
  buildClassicBoard();

  // set end condition
  classicDeadline = (classicVariant === 'timed') ? (Date.now() + CLASSIC_TIME_MS) : 0;

  window.__classicRelax = (classicVariant === 'relax');
  refreshQuitBtn(); // keep to-bar Quit in sync

  // make sure we’re in classic visuals and start the round
  currentMode = 'classic';
  setBodyModeClass?.();          // if you have it
  refreshCameraBtn?.();          // safe no-op outside Mood
  restart(false);                // your existing game start/reset
}

function buildClassicBoard(){
  // Grid sizing — adjust if you like
  const cols = 6, rows = 8;
  const pad = 16;
  const sTop = safeTopPx();                // top of safe play area
  const w = width  - pad * 2;
  const h = (height - sTop) - pad * 2;     // only the space below the top bar
  const cx = w / cols;
  const cy = h / rows;
  const radius = Math.min(cx, cy) * 0.38;

  // Replace existing bubbles with one static grid
  bubbles = [];

  for (let r = 0; r < rows; r++){
    for (let c = 0; c < cols; c++){
      const x = pad + c * cx + cx / 2;
      const y = sTop + pad + r * cy + cy / 2;  // offset grid below top bar
      const isTrick = Math.random() < (window.__classicRelax ? (window.__dynamicRedRate || RED_RATE) : RED_RATE);
      bubbles.push({
        x, y, 
        r: radius,
        diameter: radius * 2,
        alive: true, 
        kind: isTrick ? 'trick' : 'normal',
        vx: 0, vy: 0
      });
    }
  }

  // Flag for “no movement” paths if your update loop checks it
  window.__classicStatic = true;
}

function onHit(){
  comboHitStreak++;
  if (comboHitStreak >= 10) comboMult = 2.0;
  else if (comboHitStreak >= 5) comboMult = 1.5;
  else comboMult = 1.0;
  showComboBadge();
}

function onMiss(){
  comboHitStreak = 0;
  comboMult = 1.0;
  showComboBadge();
}

function getComboMultiplier(){
  return (currentMode === 'challenge' || currentMode === 'mood') ? comboMult : 1.0;
}

// Tiny UI badge (creates once and updates text)
let __comboEl = null;
function ensureComboEl(){
  if (!__comboEl){
    __comboEl = document.createElement('div');
    __comboEl.className = 'comboBadge';
    document.body.appendChild(__comboEl);
  }
  return __comboEl;
}
function showComboBadge(){
  if (currentMode !== 'challenge') return;
  const el = ensureComboEl();
  el.textContent = (comboMult > 1) ? `Combo x${comboMult.toFixed(1)}` : 'Combo x1.0';
  el.classList.toggle('active', comboMult > 1);
}

async function resumeAudioOnGesture(){
  try { initAudioOnce?.(); } catch(_){}
  if (window.__audioCtx && typeof window.__audioCtx.resume === 'function'){
    try { await window.__audioCtx.resume(); } catch(_){}
  }
}

// One-time global gesture hook to unlock WebAudio (Chrome autoplay policy)
(function(){
  if (window.__audioGestureHooked) return;
  window.__audioGestureHooked = true;

  let resumed = false;
  const kick = async () => {
    if (resumed) return;
    resumed = true;
    try { await resumeAudioOnGesture(); } catch(_) {}
    window.removeEventListener('pointerdown', kick, true);
    window.removeEventListener('keydown', kick, true);
  };

  window.addEventListener('pointerdown', kick, true);
  window.addEventListener('keydown', kick, true);
})();

function shouldSpawnTrick(mode){
  // Mode-specific base rates
  const base =
    (mode === 'challenge') ? CHALLENGE_TRICK_RATE :
    (mode === 'mood')      ? MOOD_TRICK_RATE      :
    0;

  // Current on-screen composition
  const n = (bubbles && typeof bubbles.length === 'number') ? bubbles.length : 0;
  let trickCount = 0;
  if (n > 0) {
    for (let i = 0; i < bubbles.length; i++){
      const bb = bubbles[i];
      if (bb && bb.kind === 'trick') trickCount++;
    }
  }
  const ratio = (n > 0) ? (trickCount / n) : 0;

  // Cap: if already at or above the max ratio, force next spawns to be normal
  if (ratio >= MAX_TRICK_RATIO) return false;

  // Otherwise, use the mode’s base probability
  return random() < base;
}

function showMoodLoading(text = 'Setting up camera…'){
  const el = document.getElementById('loadingOverlay');
  if (!el) return;
  const title = el.querySelector('.modalTitle');
  const msg   = el.querySelector('.loadingText');
  if (title) title.textContent = 'Mood is starting…';
  if (msg)   msg.textContent   = text;
  el.classList.remove('hidden');
}

function hideMoodLoading(){
  const el = document.getElementById('loadingOverlay');
  if (el) el.classList.add('hidden');
}

// === Score Flyout Animation ===
function spawnFlyout(x, y, points, opts = {}) {
  const el = document.createElement('div');
  el.className = 'flyoutScore';
  el.textContent = (points > 0 ? `+${points}` : `${points}`);

  // Position relative to canvas
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  // Normal colors
  if (points > 0) {
    el.style.color = '#0f766e';   // teal good pops
  } else {
    el.style.color = '#c62828';   // red penalty
  }

  // Scale with score size
  const baseSize = 22;
  const sizeBoost = Math.min(50, baseSize + Math.abs(points) * 4);
  el.style.fontSize = `${sizeBoost}px`;

  // If this was a combo pop, override with gold + faster animation
  if (opts.combo && points > 0) {
    el.classList.add('flyoutCombo');
  }

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// === Bubble Burst Animation ===
function spawnBurst(x, y, color = '#ffffff', mood = 'neutral') {
  // Happy mood gets a vibrant, multi-color confetti burst
  if (mood === 'happy') {
    const happyColors = ['#f43f5e', '#ec4899', '#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b'];
    for (let i = 0; i < 15; i++) { // More particles!
      const angle = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 40; // Travel farther

      const p = document.createElement('div');
      p.className = 'burstParticle';
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      p.style.background = happyColors[Math.floor(Math.random() * happyColors.length)];
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out'; // Slightly longer life

      document.body.appendChild(p);
      setTimeout(() => p.remove(), 500);
    }
    return; // Stop here for the happy burst
  }

  // Stressed mood gets a soft, calming ripple effect
  if (mood === 'stressed') {
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 20; // Shorter, gentler distance

      const p = document.createElement('div');
      p.className = 'burstParticle';
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      p.style.background = '#60a5fa'; // A soft, calming blue
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.animationDuration = '0.8s'; // Slower, more graceful animation

      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
    return; // Stop here for the stressed burst
  }
  
  // Default burst for Neutral, Angry, Sad, etc.
  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 20;

    const p = document.createElement('div');
    p.className = 'burstParticle';
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = color;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);

    document.body.appendChild(p);
    setTimeout(() => p.remove(), 600);
  }
}

function showCountdown(onFinish) {
  const centerEl = document.getElementById('center');
  const loading = document.getElementById('loadingOverlay');
  if (!centerEl) { onFinish?.(); return; }

  const steps = ["3", "2", "1", "GO!"];
  let i = 0;

  // 🔹 Clear old gameplay before countdown
  try {
    background(255); // plain white; or use background(color('#e0f2f1')) for teal fade
  } catch (_) {}
  if (bubbles && typeof bubbles.removeAll === 'function') {
    bubbles.removeAll();
  } else {
    bubbles = [];
  }

  centerEl.style.display = 'block';
  centerEl.style.fontSize = '64px';
  centerEl.style.fontWeight = '800';
  centerEl.style.color = '#0f766e';
  centerEl.style.textShadow = '0 2px 6px rgba(0,0,0,.3)';
  centerEl.style.opacity = '0';
  centerEl.textContent = 'Get Ready…';

  // fade-in
  centerEl.style.transition = 'opacity 300ms ease';
  requestAnimationFrame(() => centerEl.style.opacity = '1');

  // 🔹 Step 2: After ~0.8 s, proceed to the normal 3-2-1 countdown
  setTimeout(() => {
    const steps = ['3', '2', '1', 'GO!'];
    let i = 0;
    function next() {
      if (i < steps.length) {
        centerEl.textContent = steps[i];
        if (i === 0 && loading) loading.classList.add('hidden');
        i++;
        setTimeout(next, 800);
      } else {
        centerEl.style.display = 'none';
        centerEl.textContent = '';
        onFinish?.();
      }
    }
    next();
  }, 800);
}

function refreshQuitBtn(){
  const btn = document.getElementById('quitBtn');
  if (!btn) return;
  const isRelax = (currentMode === 'classic' && !classicDeadline); // 0 → relax
  const visible = window.__playerReady && !gameOver && isRelax;
  btn.style.display = visible ? 'inline-flex' : 'none';
}

function exitToSplash(){
  try { noLoop(); } catch (_){}
  stopSampler?.();
  stopWebcam?.();
  window.__playerReady = false;
  gameOver = true;

  document.body.classList.remove('game-active');
  document.body.classList.remove('mode-pick');
  document.body.classList.add('login-active'); // splash/login phase UI rules

  document.getElementById('topBar')?.classList.add('hidden');

  const splash = document.getElementById('splash');
  if (splash){
    splash.classList.add('is-visible');
    splash.classList.remove('is-fading-out');
    window.__splashActive = true;
  }
}

// End of UI Helper section

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
        runId,
        sessionId: window.__sessionId,
        deviceId: playerDeviceId,
        deviceType: (window.__deviceType || detectDeviceType()),
        username: (playerUsername || '').trim(),
        mode: currentMode,
        gameVersion: GV, // keep in sync with version comment
        score,
        durationMs,
        bubblesPopped,
        accuracy: +( (bubblesPopped / Math.max(1, tapsTotal)).toFixed(3) ),
        emoHappy:    emoCounts.happy,
        emoSad:      emoCounts.sad,
        emoAngry:    emoCounts.angry,
        emoStressed: emoCounts.stressed,
        emoNeutral:  emoCounts.neutral,
        feedbackBefore: window.__feedbackBefore || '',
        feedbackAfter:  window.__feedbackAfter  || ''
      })
    });
  } catch (e) {
    console.warn('[submitRun] failed:', e);
  }
}

// Submit exactly once per round; includes any after-feedback if present
function submitRunOnce(){
  if (window.__runSubmitted) return;
  window.__runSubmitted = true;
  submitRun();
}

// v9.9.7 — leaderboard (no separate rank endpoint)
// Simple fetch wrapper
async function fetchJSON(url, opts){
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function computeAccuracyPct(){
  const acc = (bubblesPopped / Math.max(1, tapsTotal));
  return Math.round(acc * 100);
}

// GET Top N leaderboard, ask backend to include my rank via ?username=
async function getLeaderboard(limit = 5, mode = (currentMode || 'classic')){
  // Apps Script supports: action=leaderboard&limit=5&username=...
  const qs = new URLSearchParams({
    action: 'leaderboard',
    limit: String(limit),
    username: (playerUsername || '').trim(),
    mode: mode
  });
  return fetchJSON(`${GOOGLE_SCRIPT_URL}?${qs.toString()}`);
}

// Build the post-game inner HTML for the leaderboard screen (no Mode column; keep Accuracy)
// Inputs: { username, score, accuracyPct, rank, board }
function renderPostGameContent({ username, score, accuracyPct, rank, board }) {
  const myName = (username || '').trim();

  // Build Top 5 rows: rank, user, score, accuracy
  const rowsHtml = (board || []).slice(0, 5).map((r, i) => {
    const rnk = (r && r.rank != null) ? Number(r.rank) : (i + 1);
    const name = ((r && (r.username ?? r.name)) || '').toString().trim();
    const sc   = (r && r.score != null) ? Number(r.score) : 0;

    // Accept either accuracyPct (integer %) or accuracy (0..1)
    const accPct = (r && typeof r.accuracyPct === 'number')
      ? Math.round(r.accuracyPct)
      : (r && typeof r.accuracy === 'number')
        ? Math.round(r.accuracy * 100)
        : null;

    const isMe = !!name && !!myName && name.toLowerCase() === myName.toLowerCase();
    const accStr = (accPct != null) ? `${accPct}%` : '';

    return `<tr class="${isMe ? 'meRow' : ''}">
              <td>${rnk}</td>
              <td>${name || '—'}</td>
              <td>${sc}</td>
              <td>${accStr}</td>
            </tr>`;
  }).join('');

  // If I'm not in Top 5 but we have my rank, append a 6th highlighted row
  let extraRow = '';
  const myRankNum = (rank != null && !Number.isNaN(Number(rank))) ? Number(rank) : null;
  const isInTop5 = (myRankNum != null && myRankNum >= 1 && myRankNum <= 5);

  if (!isInTop5 && myRankNum != null) {
    const myAccStr = (typeof accuracyPct === 'number') ? `${accuracyPct}%` : '';
    extraRow = `<tr class="meRow">
                  <td>${myRankNum}</td>
                  <td>${myName || 'You'}</td>
                  <td>${Number(score) || 0}</td>
                  <td>${myAccStr}</td>
                </tr>`;
  }

  // Render table into #leaderboard
  const lbEl = document.getElementById('leaderboard');
  if (lbEl) {
    lbEl.innerHTML = `
      <h3>Top 5</h3>
      <table class="lbTable">
        <thead>
          <tr><th>#</th><th>User</th><th>Score</th><th>Acc</th></tr>
        </thead>
        <tbody>${rowsHtml}${extraRow}</tbody>
      </table>
    `;
  }
}

let __lastLbFetch = 0;   // <-- put this at top level (file scope)

// Save the run (once), then fetch & render stats
async function hydratePostGame(){
  const now = Date.now();
  if (now - __lastLbFetch < 5000) {
    console.warn('[leaderboard] Skipping fetch (debounced)');
    return;
  }
  __lastLbFetch = now;
  try {
    submitRunOnce();                       // ensure row exists before reading
    const username = (playerUsername || '').trim();
    const mode = (currentMode || 'classic');
    const accuracyPct = computeAccuracyPct();

    // Leaderboard
    const lbEl = document.getElementById('leaderboard');
    if (lbEl) {
      lbEl.innerHTML = `<p style="opacity:.7;">Loading leaderboard…</p>`;
    }

    // Fetch leaderboard (includes top + rank if username provided)
    const data = await getLeaderboard(5, mode);
    const board = Array.isArray(data?.scores) ? data.scores : (data?.rows || []);

    // TEMP: debug what the server is actually returning (remove later)
    // const sampleModes = [...new Set(board.slice(0, 5).map(r => r?.mode).filter(Boolean))];
    // console.log('[leaderboard]', {
    //   requestedMode: mode,
    //   sampleRowModes: sampleModes,         // e.g., ["mood"] or ["bio"]
    //   meMode: data?.me?.mode ?? null       // if your script echoes this
    // });

    const rankRaw = data?.me?.rank;
    const rank = (rankRaw != null && !Number.isNaN(Number(rankRaw))) ? Number(rankRaw) : null;

    // capture session game data
    window.__sessionRuns = window.__sessionRuns || [];
    window.__sessionRuns.push({
      ts: Date.now(),
      username,
      mode,
      score,
      accuracyPct
    });
    // keep only the last ~20 so it doesn't grow unbounded (we'll show 5)
    if (window.__sessionRuns.length > 20) {
      window.__sessionRuns.splice(0, window.__sessionRuns.length - 20);
    }

    renderPostGameContent({ username, score, accuracyPct, rank, board });
  } catch (e){
    console.warn('[post-game] hydrate failed:', e);

    renderPostGameContent({
      username: playerUsername,
      score,
      accuracyPct: computeAccuracyPct(),
      rank: null,
      board: []
    });

    const lbEl = document.getElementById('leaderboard');
    if (lbEl) {
      lbEl.innerHTML = `<p style="opacity:.7;">Leaderboard unavailable (please try again later).</p>`;
    }
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

  setBodyModeClass();

  // Camera modal buttons
  const camBtn = document.getElementById('cameraBtn');
  const closeBtn = document.getElementById('modalClose');
  if (camBtn) camBtn.onclick = () => { if (isMoodMode()) openCameraModal(); };
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

  // Helper: if Feedback modal is open, capture text & close it
  function sealFeedbackIfOpen(){
    const fm = document.getElementById('feedbackModal');
    if (fm && !fm.classList.contains('hidden')) {
      const ft = document.getElementById('postQ5');
      const v = (ft && ft.value) ? ft.value.trim() : '';
      if (v && !window.__feedbackAfter) window.__feedbackAfter = v;
      closeFeedbackModal();
    }
  }

  // Post-game modal buttons
  const pg = document.getElementById('postGameModal');
  const pgPlay  = document.getElementById('postPlayAgain');
  const pgMode  = document.getElementById('postChangeMode');

  // Post-game "Stats" button
  const pgStats = document.getElementById('postPlayerStatsBtn');
  if (pgStats) pgStats.onclick = () => openStatsModal();

  // Stats modal close
  const statsClose = document.getElementById('statsCloseBtn');
  if (statsClose) statsClose.onclick = () => {
    const sm = document.getElementById('statsModal');
    if (sm) sm.classList.add('hidden');
    // If a round just ended, reopen the post-game modal
    if (typeof openPostGameModal === 'function') openPostGameModal();
  };

  // prevent the game close if not clicking the play again button or change mode button
  // if (pg) pg.addEventListener('click', (e) => { if (e.target.id === 'postGameModal') closePostGameModal(); });

  // Play Again handler
  if (pgPlay) pgPlay.onclick = () => {
    // If the feedback modal is open, auto-capture unsaved text
    sealFeedbackIfOpen();
    submitRunOnce();         // first trigger wins; no double-posts
    closePostGameModal();
    if (window.__playerReady) {
      noLoop();
      showCountdown(() => restart(false));
    }
  };

  // Change Mode handler
  if (pgMode) pgMode.onclick = () => {
    sealFeedbackIfOpen();
    submitRunOnce();
    closePostGameModal();
    showModePicker();
  };

  // --- Login "Feedback" button (before-game feedback) ---
  const loginFb = document.getElementById('preFeedbackBtn');
  if (loginFb) loginFb.onclick = () => openFeedbackModal('before');

  // Make sure the reusable Feedback modal is wired once
  wireFeedbackModal();

  // Wire Sound toggles (Mode Picker + Post-game)
  (function wireSoundToggles(){
    const pre = document.getElementById('soundTogglePre');
    const post = document.getElementById('soundTogglePost');
    if (pre){
      pre.checked = __sfxOn;
      pre.onchange = () => setSfx(pre.checked);
    }
    if (post){
      post.checked = __sfxOn;
      post.onchange = () => setSfx(post.checked);
    }
  })();

  // v9.1.2 — mobile typing glue
  const u = document.getElementById('usernameInput') || document.querySelector('input[name="username"]');
  if (u) {
    u.addEventListener('focus', onKbFocus, { passive: true });
    u.addEventListener('blur',  onKbBlur,  { passive: true });
  }
  const ftxt = document.getElementById('postQ5');
  if (ftxt) {
    ftxt.addEventListener('focus', onKbFocus, { passive: true });
    ftxt.addEventListener('blur',  onKbBlur,  { passive: true });
  }
  wireViewportGuard();

  // Login OK
  const okBtn = document.getElementById('loginOkBtn');
  if (okBtn) okBtn.onclick = () => {
    if (typeof playerDeviceId === 'undefined') {
      playerDeviceId = getOrCreateDeviceId();
    }

    const uname = (document.getElementById('usernameInput')?.value || '').trim();
    if (!uname) {
      setLoginStatus('Please enter a username', 'err');
      return;
    }

    playerUsername = uname;
    try { localStorage.setItem(STORAGE_KEYS.username, playerUsername); } catch(_) {}

    showLoginScreen(playerDeviceId);
  };

  // Allow feedback if username changed
  if (u) {
    u.addEventListener('input', () => {
      const lfb = document.getElementById('preFeedbackBtn');
      if (lfb && lfb.classList.contains('is-disabled')) {
        lfb.classList.remove('is-disabled');
        lfb.textContent = '📝 Feedback';
        lfb.onclick = () => openFeedbackModal('before');
        // Optionally clear stored baseline if changing identity should reset it:
        // window.__feedbackBefore = '';
      }
    });
  }

  const savedName = localStorage.getItem(STORAGE_KEYS.username);
  if (savedName) {
    const u = document.getElementById('usernameInput');
    if (u) u.value = savedName;
    playerUsername = savedName;
  }

  initSplash();

  // Top-bar Quit (non-timed rounds)
  const quitBtn = document.getElementById('quitBtn');
  if (quitBtn) quitBtn.onclick = () => {
    if (!window.__playerReady || gameOver) return;
    endGame();     // finishes the round; post-game modal + submitRunOnce() are handled later
  };

  // Post-game "Close" → back to Splash
  const pgClose = document.getElementById('postCloseGame');
  if (pgClose) pgClose.onclick = () => {
    submitRunOnce();
    closePostGameModal();
    exitToSplash();
  };

} // end of setup()

function draw(){
  if (window.__splashActive || !window.__playerReady) return; // do nothing until after login
  fitCanvasToViewport();

  // Read the dynamic background color from our CSS variable
  const bgColor = getComputedStyle(document.body).getPropertyValue('--mood-background-color');
  background(color(bgColor));

  // Draw a giant, faint emoji when in Mood mode (purely decorative)
  if (isMoodMode()) {
    const emo = dominantEmotion();
    let emojiChar = '';
    if (emo === 'happy')    emojiChar = '😊';
    if (emo === 'sad')      emojiChar = '😢';
    if (emo === 'angry')    emojiChar = '😠';
    if (emo === 'stressed') emojiChar = '😟';

    if (emojiChar) {
      textAlign(CENTER, CENTER);
      textSize(Math.min(width, height) * 0.5);
      fill(0, 0, 0, 8);
      text(emojiChar, width / 2, height / 2);
    }
  }

  // --- Timers ---
  let timeLeft;
  if (currentMode === 'classic'){
    if (classicDeadline){
      timeLeft = Math.max(0, Math.ceil((classicDeadline - Date.now())/1000));
    } else {
      timeLeft = null; // relax (endless) variant
    }
  } else {
    timeLeft = Math.max(0, GAME_DURATION - Math.floor((millis() - startTime)/1000));
  }

  // --- Top HUD chips ---
  document.getElementById('scoreChip').textContent = `Score: ${score}`;

  // Consolidated Mode UI + speed presets
  const modeChip = document.getElementById('modeChip');
  const moodChip = document.getElementById('moodChip');
  const camBtnEl = document.getElementById('cameraBtn');

  // Local lookups to avoid if/else spam
  const MODE_LABEL = { classic: 'Zen', challenge: 'Focus', mood: 'Emotion' };
  const EMO_PRESET = {
    neutral: { bg: '#f3f4f6', chip: '#e5e7eb', speed: 1.0, emoji: '' },
    happy:   { bg: '#dcfce7', chip: '#a7f3d0', speed: 1.3, emoji: '😊' },
    sad:     { bg: '#bfdbfe', chip: '#93c5fd', speed: 0.8, emoji: '😢' },
    angry:   { bg: '#fee2e2', chip: '#fca5a5', speed: 1.0, emoji: '😠' },
    stressed:{ bg: '#fef3c7', chip: '#fde047', speed: 0.6, emoji: '😟' },
  };

  if (modeChip){
    modeChip.textContent = `Mode: ${MODE_LABEL[currentMode] || '—'}`;
    modeChip.style.display = 'inline-flex';
  }

  let modeSpeedMult = 1.0;

  if (currentMode === 'mood'){
    // Show camera + mood chip
    if (camBtnEl) { refreshCameraBtn(); camBtnEl.style.display = 'inline-flex'; }
    moodChip?.classList.remove('hiddenChip');

    const emo = dominantEmotion() || 'neutral';
    const p = EMO_PRESET[emo] || EMO_PRESET.neutral;

    if (moodChip){
      moodChip.textContent = emo.toUpperCase();
      moodChip.style.background = p.chip;
    }
    // Push mood visuals via CSS vars
    document.body.style.setProperty('--mood-background-color', p.bg);
    document.body.style.setProperty('--mood-emoji-url', p.emoji);

    modeSpeedMult = p.speed;
  } else {
    // Non-mood: hide extras
    moodChip?.classList.add('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'none';
    modeSpeedMult = (currentMode === 'classic') ? CLASSIC_SPEED_SCALE : 1.3; // challenge default
  }

  const sTop = safeTopPx();
  const MINF  = MIN_PLAY_SPEED;

  // Guard against uninitialized bubbles & surface errors (keep the frame alive)
  if (!bubbles || typeof bubbles.length !== 'number'){
    console.warn('[draw] bubbles not initialized yet');
    return;
  }

  // --- Draw/animate all bubbles ---
  try {
    for (let i = 0; i < bubbles.length; i++){
      const b = bubbles[i];
      if (!b) continue;

      // Skip invisible or dead bubbles early
      if (b.hidden === true) continue;

      // Handle popping animation / removal
      if (b._popping === true){
        // simple expand + fade pop
        const popAge = millis() - (b._popStart || millis());
        const d = max(0, (b.radius || 12) * (1 + Math.min(0.9, popAge / 160)));
        noFill();
        strokeWeight(2);
        stroke(255, 255, 255, 235 - Math.min(235, popAge * 1.2));
        circle(b.x, b.y, d);

        // cleanup & respawn logic
        if (popAge > 160){
          if (b._respawnAfterPop){
            if (typeof b.remove === 'function') b.remove();
            spawnBubble();
            b._respawnAfterPop = false;
          } else {
            if (typeof b.remove === 'function') b.remove();
          }
          b._popping = false;
        }

        continue; // skip normal drawing for this bubble
      }

      // --- Classic draw quirks & dead-skip ---
      if (currentMode === 'classic') {
        // If we already "popped" it in classic, don't draw or move it
        if (b.alive === false) continue;

        // Force a single tint for normal bubbles, and red for penalties
        b._tint = (b.kind === 'trick') ? color(...COLOR_RED) : color(...COLOR_TEAL);
      }

      // Skip movement in Classic static mode
      if (currentMode !== 'classic' || !window.__classicStatic) {
        b.direction += random(-0.35, 0.35);
        const r = currentRadius(b);

        // Unified speed computation (caps Classic only)
        const __cap = (typeof CLASSIC_SPEED_CAP !== 'undefined' && currentMode === 'classic') ? CLASSIC_SPEED_CAP : Infinity;
        b.speed = max(
          min(
            b._baseSpeed * (currentMode==='mood' ? constrain(modeSpeedMult, 0.5, 1.6) : modeSpeedMult) * rubberSpeedFactor(),
            __cap
          ),
          MINF
        );

        // Move
        b.x += cos(b.direction) * b.speed;
        b.y += sin(b.direction) * b.speed;

        // Keep inside bounds with a "soft bounce"
        if (b.y - r <= sTop){ b.y = sTop + r + 0.5;  b.direction = 360 - b.direction; }
        if (b.y + r >= height){ b.y = height - r - 0.5; b.direction = 360 - b.direction; }
        if (b.x - r <= 0){ b.x = r + 0.5;  b.direction = 180 - b.direction; }
        if (b.x + r >= width){ b.x = width - r - 0.5; b.direction = 180 - b.direction; }

        // Unstick if too slow for too long
        if (b._stuck == null) b._stuck = 0;
        if (b.speed < 0.15) b._stuck++; else b._stuck = 0;
        if (b._stuck > 18){
          b.direction = random(360);
          b.speed = max(b._baseSpeed * 1.05, MINF + 0.2);
          if (b.y - r <= sTop + 1)         b.y = sTop + r + 2;
          else if (b.y + r >= height - 1)  b.y = height - r - 2;
          if (b.x - r <= 1)                 b.x = r + 2;
          else if (b.x + r >= width - 1)    b.x = width - r - 2;
        }
      }

      // --- Render bubble (fill + stroke) ---
      noStroke();
      const rr = currentRadius(b);
      const tintCol = b._tint || (b.kind === 'trick' ? color(...COLOR_RED) : color(...COLOR_TEAL));
      
      // Clean bubble rendering
      noStroke();
      fill(tintCol);
      circle(b.x, b.y, rr * 2);

      // Subtle outline
      stroke(255, 255, 255, 60);
      strokeWeight(1);
      noFill();
      circle(b.x - rr*0.2, b.y - rr*2*0.98);
    }
  } catch (err) {
    console.warn('[draw] bubble loop error:', err);
  }

  // End-game trigger
  if (!gameOver && timeLeft != null && timeLeft <= 0) endGame();

  // Classic “relax” refill logic: when all teal popped, auto-refill
  const anyTealAlive = Array.isArray(bubbles) && bubbles.some(b => b.alive && b.kind !== 'trick');

  if (currentMode === 'classic') {
    if (window.__classicRelax) {
      if (!anyTealAlive) {
        window.__relaxRefills = (window.__relaxRefills || 0) + 1;
        refillClassicBoard();
      }
    } else {
      // Classic timed variant: already handled by timeLeft/endGame above
    }
  }

  // HUD timer text (right chip)
  const timeChip = document.getElementById('timeChip');
  if (timeChip){
    if (timeLeft == null) {
      timeChip.textContent = '∞';
    } else {
      const mm = Math.floor(timeLeft / 60);
      const ss = (timeLeft % 60).toString().padStart(2, '0');
      timeChip.textContent = `${mm}:${ss}`;
    }
  }
} // end of draw()

/* =============================
 *        Gameplay
 * ============================= */
function spawnBubble(){
  const d = random(MIN_DIAM, MAX_DIAM), r = d / 2, sTop = safeTopPx();
  let angle = random(TWO_PI);
  if (abs(sin(angle)) < 0.2) angle += PI/4;
  const speed = random(MIN_SPEED, MAX_SPEED);
  const topSafe = safeTopPx() + r + 8;     // 8px buffer below top bar
  let sx = random(r, width - r);
  let sy = random(topSafe, height - r);


  if (isMoodMode()){
    const biasX = width * moodState.gaze.x,
          biasY = constrain(height * moodState.gaze.y, sTop + r, height - r);
    sx = constrain(lerp(random(r, width - r), biasX, 0.6), r, width - r);
    sy = constrain(lerp(random(sTop + r, height - r), biasY, 0.6), sTop + r, height - r);
  }

  const b = new Sprite(sx, sy, d);
  b.shape = 'circle';
  b.color = color(255,255,255,0);
  b.diameter = d;

  // v10.0.5 — Challenge & Mood: trick spawn with a hard cap on red ratio
  if (currentMode === 'challenge' || currentMode === 'mood'){
    b.kind = shouldSpawnTrick(currentMode) ? 'trick' : 'normal';
  } else {
    b.kind = 'normal';
  }

  const __teal = (typeof COLOR_TEAL !== 'undefined') ? color(...COLOR_TEAL) : color(15,118,110,200);
  const __red  = (typeof COLOR_RED  !== 'undefined') ? color(...COLOR_RED)  : color(198,40,40,200);
  b._tint = (b.kind === 'trick') ? __red : __teal;

  b.direction = degrees(angle);
  b.speed = speed;
  b._baseSpeed = speed;
  b.mass = PI * r * r;
  b.rotationLock = true;
  b._hitScale = 1;
  b._stuck = 0;

  bubbles.add(b);
  return b;
}

function currentRadius(b){
  const baseD = (typeof b.diameter === 'number' && isFinite(b.diameter)) ? b.diameter : MIN_DIAM;
  const angry = isMoodMode() ? Number(moodState.angry || 0) : 0;
  const d = baseD * (1 + 0.35 * constrain(angry, 0, 1));
  return max(1, d * 0.5);
}

// Capture game stat during gameplay
function handlePop(px, py){
  if (gameOver || !window.__playerReady || !bubbles) return;

  tapsTotal++;
  let hit = false;

  for (let i = bubbles.length - 1; i >= 0; i--){
    const b = bubbles[i], r = currentRadius(b);

    // Classic: skip already-popped bubbles
    if (currentMode === 'classic' && b.alive === false) continue;

    // Classic: exact circle; others get a tiny touch pad
    const pad = (currentMode === 'classic') ? 0 : (IS_TOUCH ? TOUCH_HIT_PAD : 0);
    const rHit = r + pad;

    const dx = px - b.x, dy = py - b.y;
    if (dx*dx + dy*dy <= rHit*rHit){
      hit = true;

      // Classic branch
      if (currentMode === 'classic'){
        // Classic: teal +1, red penalty; NO respawn
        const delta = (b.kind === 'trick') ? -RED_PENALTY : 1;
        score += delta;
        if (score < 0) score = 0;

        // stats
        bubblesPopped++;
        if (b.kind === 'trick') bubblesPoppedTrick++;
        else bubblesPoppedGood++;

        // flyout
        if (typeof spawnFlyout === 'function') spawnFlyout(b.x, b.y - b.diameter * 0.6, delta);

        // burst effect
        const mood = isMoodMode() ? dominantEmotion() : 'neutral';
        spawnBurst(b.x, b.y, (b.kind === 'trick') ? '#c62828' : '#0f766e', mood);
        b._popping = true;
        b._popStart = millis ? millis() : Date.now();

        // play SFX ONLY (no combo/scoring side-effects)
        try { b.kind==='trick' ? maybeBuzz() : maybePop() } catch (_) {}

        // mark dead; draw() will skip it, end condition will handle “all popped”
        b.alive = false;
        break;

      // Challenge - Mood mode
      } else {
        // Challenge/Mood: size-based scoring + respawn
        const diameterNow = r * 2;
        const sizeBoost = Math.min(3, Math.max(1, (MIN_DIAM / diameterNow) * SCORE_SIZE_MULTIPLIER));

        // Tougher red penalty outside Classic (min 2)
        const trickPenalty = Math.max(2, SCORE_TRICK_PENALTY);

        let delta = (b.kind === 'trick')
          ? -trickPenalty
          : Math.max(1, Math.round(SCORE_BASE * sizeBoost));

        // Get current mood score multiplier (defaults to 1.0)
        let moodScoreMult = 1.0;
        if (currentMode === 'mood') {
          const emo = dominantEmotion();
          if (emo === 'happy') moodScoreMult = 2.0; // 2x score for happy
          if (emo === 'stressed') moodScoreMult = 1.5; // 1.5x score as a bonus for playing while stressed
        }
        
        // Apply multipliers (combo → mood → mode) only to positive scores
        if (delta > 0) {
          const modeMult = MODE_SCORE_MULT[currentMode] || 1.0;
          delta = Math.round(delta * getComboMultiplier() * moodScoreMult * modeMult);
        }
        score += delta;

        onHit();
        noteHit(); 
        if (score < 0) score = 0;

        // --- choose SFX based on bubble kind (non-Classic) ---
        if (b.kind === 'trick') { 
          maybeBuzz(); 
        } else { 
          maybePop(); 
        }

        // stats
        bubblesPopped++;
        if (b.kind === 'trick') bubblesPoppedTrick++;
        else bubblesPoppedGood++;

        // animation for pop bubbles
        spawnFlyout(b.x, b.y - b.diameter * 0.6, delta, { combo: ((currentMode === 'challenge' || currentMode === 'mood') && getComboMultiplier() > 1.0) });

        // burst effect
        const mood = isMoodMode() ? dominantEmotion() : 'neutral';
        spawnBurst(b.x, b.y, (b.kind === 'trick') ? '#c62828' : '#0f766e', mood);
        b._popping = true;
        b._popStart = millis ? millis() : Date.now();
        b._respawnAfterPop = true; // mark to respawn after animation
        break;
      }
    }
  }

  if (!hit) {
    tapsMissed++;
    if (currentMode !== 'classic'){
      onMiss();
      noteMiss();
    }
  }
}

function endGame(){
  gameOver = true;
  refreshQuitBtn(); // hide Quit when round ends

  if (currentMode === 'classic' && Array.isArray(bubbles)) {
    for (const b of bubbles) b.alive = false; // hide leftovers (e.g., reds)
  }
  noLoop();

  if (isMoodMode()){
    if (MOOD_STOP_STRATEGY === 'pause') { stopSampler(); }
    else { stopSampler(); stopWebcam(); }
    clearTimeout(moodIdleStopTO);
    moodIdleStopTO = setTimeout(() => { if (gameOver && isMoodMode()) stopWebcam(); }, MOOD_IDLE_STOP_MS);
  }

  openPostGameModal();
  // NEW: fill stats + leaderboard (submits run once, then fetches data)
  hydratePostGame();
}

function restart(fromModeButton){
  // Do not restart while the mode picker is visible
  if (window.__modePicking) return;

  // Clear any leftover timer
  try {
    if (window.__classicAutoTO){ clearTimeout(window.__classicAutoTO); }
  } catch(_) {}
  window.__classicAutoTO = null;

  // === Classic: keep static grid ===
  if (currentMode === 'classic' && window.__classicStatic){
    // clear any p5play group without touching classic array objects
    if (bubbles && bubbles.length && typeof bubbles[0]?.remove === 'function'){
      for (let i = bubbles.length - 1; i >= 0; i--) bubbles[i].remove();
    }
    // rebuild static board and walls as needed
    buildClassicBoard();
    if (!walls || walls.length < 4) buildWalls();

    // reset timer for the chosen variant (Timed → 60s; Relax → ∞)
    classicDeadline = (classicVariant === 'timed')
      ? (Date.now() + CLASSIC_TIME_MS)
      : 0; // relax

    // Make sure top-bar Quit reflects the new round state (esp. Relax/Zen)
    gameOver = false;
    refreshQuitBtn();

    // reset per-round stats (same as your existing code)
    tapsTotal = 0; tapsMissed = 0;
    bubblesPopped = 0; bubblesPoppedGood = 0; bubblesPoppedTrick = 0;
    window.__feedbackAfter = '';
    
    window.__runSubmitted = false;
    score = 0; startTime = millis(); gameOver = false;
    closePostGameModal();
    if (isMoodMode()){ clearTimeout(moodIdleStopTO); startSampler(); }
    loop();
    return; // <— IMPORTANT: stop here for Classic
  }

  // Reset classic flag when leaving Classic
  window.__classicStatic = false;

  // Non-Classic Restart logic
  if (!bubbles) {
    bubbles = new Group();
    bubbles.collider = 'dynamic';
    bubbles.bounciness = 1;
    bubbles.friction = 0;
    bubbles.drag = 0;
  } else {
    // If bubbles was a Classic array, rebuild as Group first
    if (!bubbles || typeof bubbles[0]?.remove !== 'function') {
      bubbles = new Group();
      bubbles.collider = 'dynamic';
      bubbles.bounciness = 1;
      bubbles.friction = 0;
      bubbles.drag = 0;
    } else {
      for (let i = bubbles.length - 1; i >= 0; i--) {
        bubbles[i].remove();
      }
    }
  }
  const N0 = startBubblesForMode();
  for (let i = 0; i < N0; i++) spawnBubble();
  if (!walls || walls.length < 4) buildWalls();

  // reset per-round stats
  tapsTotal = 0;
  tapsMissed = 0;
  bubblesPopped = 0;
  bubblesPoppedGood = 0;
  bubblesPoppedTrick = 0;
  // v9.0.1 — feedback + submit guards (per round)
  window.__feedbackAfter = '';   // only after-feedback is cleared each round


  window.__runSubmitted  = false;

  score = 0;
  startTime = millis();
  gameOver = false;

  closePostGameModal();                     // close post-game UI if it was open

  const centerEl = document.getElementById('center');
  if (centerEl){ centerEl.textContent = ''; centerEl.style.display = 'none'; }

  if (isMoodMode()){ clearTimeout(moodIdleStopTO); startSampler(); }
  loop();
}
function windowResized(){ const w = viewportW(), h = viewportH(); if (width !== w || height !== h) resizeCanvas(w, h); rebuildWallsIfNeeded(); }

// --- Lazy load & prefetch helpers for face-api.js ---------------------------
const FACE_API_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';

function prefetchFaceApi(){
  if (document.querySelector('link[data-face-prefetch]') || window.faceapi) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'script';
  link.href = FACE_API_URL;
  link.crossOrigin = 'anonymous';
  link.setAttribute('data-face-prefetch', '1');
  document.head.appendChild(link);
}

let __faceApiPromise = null;
function ensureFaceApiLib(){
  if (window.faceapi) return Promise.resolve(true);
  if (__faceApiPromise) return __faceApiPromise;

  __faceApiPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = FACE_API_URL;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(true);
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });

  return __faceApiPromise;
}
// ---------------------------------------------------------------------------



/* =============================
 *        Mood (face-api.js)
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
      faceapi.nets.faceExpressionNet.isLoaded || faceapi.nets.faceExpressionNet.loadFromUri('./models')
    ]);
    modelsReady = true; console.log('[mood] models loaded'); return true;
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
  if (!navigator.mediaDevices?.getUserMedia){ console.error('[mood] getUserMedia not supported'); return false; }

  // Stop existing media + sampler if restarting or switching devices
  try {
    if (isRestart && moodTimerId){ clearInterval(moodTimerId); moodTimerId = null; }
    if (currentStream?.getTracks) currentStream.getTracks().forEach(t => t.stop());
  } catch (e) { console.warn('[mood] error stopping previous stream:', e); }

  let constraints = {
    video: selectedDeviceId
      ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  };

  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
  catch (e){
    console.warn('[mood] exact device failed, fallback to facingMode:user', e);
    constraints = { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  }
  currentStream = stream;

  if (!v){ console.error('[mood] #webcam element not found'); return false; }
  v.srcObject = stream; v.playsInline = true; v.muted = true; v.autoplay = true;
  if (vPrev){ vPrev.srcObject = stream; vPrev.playsInline = true; vPrev.muted = true; vPrev.autoplay = true; }

  let played = false;
  try { await v.play(); played = true; } catch { console.warn('[mood] video.play blocked; will resume on gesture'); }

  // When frames are ready, hide overlay and start the sampler
  const onReady = () => {
    if (isMoodMode() && window.__playerReady) {
      startSampler();
    }
  };
  v.addEventListener('playing', onReady, { once: true });
  v.addEventListener('loadeddata', onReady, { once: true });
  if (v.readyState >= 2) onReady();

  if (!played){
    const resume = () => {
      v.play().catch(()=>{}); vPrev?.play?.().catch(()=>{});
      onReady();
      document.removeEventListener('click', resume);
      document.removeEventListener('touchstart', resume);
    };
    document.addEventListener('click', resume, { once: true });
    document.addEventListener('touchstart', resume, { once: true, passive: true });
  }

  setTimeout(listCameras, 400);
  console.log('[mood] webcam started');
  return true;
}

/** Stop the webcam tracks and detach stream */
function stopWebcam(){
  try { if (currentStream?.getTracks) currentStream.getTracks().forEach(t => t.stop()); }
  catch (e){ console.warn('[mood] error stopping webcam:', e); }
  currentStream = null;
  const v = document.getElementById('webcam'); if (v) v.srcObject = null;
  const vp = document.getElementById('webcamPreview'); if (vp) vp.srcObject = null;
}

/** Start the sampling loop (Mood-only) */
function startSampler(){
  if (moodTimerId) return;
  moodTimerId = setInterval(() => {
    if (!isMoodMode() || document.hidden) return;
    const v = document.getElementById('webcam');
    if (v && v.readyState >= 2 && modelsReady) sampleMood();
  }, MOOD_SAMPLE_MS);
  console.log('[mood] sampler started @' + MOOD_SAMPLE_MS);
}

/** Stop the sampling loop */
function stopSampler(){
  if (!moodTimerId) return;
  clearInterval(moodTimerId); moodTimerId = null;
  console.log('[mood] sampler stopped');
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
 * Run one face-api sample: detect faces/expressions, update moodState, draw overlay.
 * Hard-gated to Mood mode.
 */
async function sampleMood(){
  if (!isMoodMode()) return;
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
    detections = await faceapi.detectAllFaces(det, tinyOpts).withFaceExpressions();
  } catch (e) { console.warn('[mood] tinyFace error:', e); }

  if (!detections || !detections.length){
    // Decay toward neutral if no face
    moodState.happy = ema(moodState.happy, 0, 0.3);
    moodState.sad   = ema(moodState.sad,   0, 0.3);
    moodState.angry = ema(moodState.angry, 0, 0.3);
    moodState.stressed = ema(moodState.stressed, 0, 0.3);
    moodState.neutral = ema(moodState.neutral, 1, 0.3);
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

  // Smooth into moodState
  moodState.happy = ema(moodState.happy, acc.happy, 0.75);
  moodState.sad   = ema(moodState.sad,   acc.sad,   0.75);
  moodState.angry = ema(moodState.angry, acc.angry, 0.75);
  moodState.neutral = ema(moodState.neutral, acc.neutral, 0.75);
  // STRESSED: blend fearful + disgusted + surprised
  const stressedRaw = 0.6 * acc.fearful + 0.3 * acc.disgusted + 0.1 * acc.surprised;
  moodState.stressed = ema(moodState.stressed, stressedRaw, 0.75);

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
    } catch (e){ console.warn('[mood] overlay draw error:', e); }
  }

  // Count one “tick” toward the dominant emotion each sample
  const emo = dominantEmotion();
  if (emo && emoCounts.hasOwnProperty(emo)) emoCounts[emo]++;
}

/**
 * Decide dominant emotion based on smoothed moodState with hysteresis/cooldown.
 * @returns {'happy'|'sad'|'angry'|'stressed'|'neutral'}
 */
function dominantEmotion(){
  const h = Number(moodState.happy||0),
        s = Number(moodState.sad||0),
        a = Number(moodState.angry||0),
        t = Number(moodState.stressed||0);
  const nRaw = (moodState.neutral != null) ? Number(moodState.neutral) : 0;
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

let __feedbackContext = 'before'; // 'before' | 'after'

function openFeedbackModal(context){
  __feedbackContext = (context === 'after') ? 'after' : 'before';
  const m   = document.getElementById('feedbackModal');
  const ttl = document.getElementById('feedbackTitle');
  if (!m || !ttl) return;

  // Title
  ttl.textContent = (__feedbackContext === 'after') ? 'Post-game Survey' : 'Pre-game Survey';

  // Show relevant question blocks
  document.querySelectorAll('.preOnly').forEach(el => el.style.display = (__feedbackContext==='before'?'block':'none'));
  document.querySelectorAll('.postOnly').forEach(el => el.style.display = (__feedbackContext==='after'?'block':'none'));

  // Prefill OR show “thanks” if already submitted for this round
  const alreadySaved = (__feedbackContext === 'after') && !!window.__feedbackAfter;
  if (alreadySaved){
    renderFeedbackThanks('after');
  } else {
    // restore survey markup if we previously showed thanks
    const container = document.querySelector('#feedbackModal .modalRow.stacked');
    if (container && container.querySelector('.feedbackThanks')) {
      // re-render original inner HTML by reopening page (fallback) or simply no-op because
      // we will hydrate; but if you prefer full restore, consider storing original HTML.
      // For simplicity we’ll just close if user tries to re-open after save:
      // (alreadySaved above prevents this path for 'after')
    }
    const saved = (__feedbackContext === 'after') ? (window.__feedbackAfter || '') : (window.__feedbackBefore || '');
    hydrateSurveyFromJSON(__feedbackContext==='after' ? 'after' : 'before', saved);
    const save = document.getElementById('feedbackSave');
    if (save) save.style.display = ''; // ensure visible when editing
  }

  m.classList.remove('hidden');
}

function closeFeedbackModal(){
  const m = document.getElementById('feedbackModal');
  if (m) m.classList.add('hidden');
}

function wireFeedbackModal(){
  const m = document.getElementById('feedbackModal');
  const save = document.getElementById('feedbackSave');
  const cancel = document.getElementById('feedbackCancel');
  const closeBtn = document.getElementById('feedbackClose');

  if (!m || !save || !cancel || !closeBtn) return;

  // Save Handler
  save.onclick = () => {
    // Serialize answers
    const json = readSurveyJSON(__feedbackContext==='after' ? 'after' : 'before');

    if (__feedbackContext === 'after'){
      window.__feedbackAfter = json;     // lock-in for this round



      // Show thank-you in the modal immediately
      renderFeedbackThanks('after');

      // Submit the run (guarded — only once)
      submitRunOnce();
    } else {
      // PRE-GAME: store JSON and lock the Login feedback button (no “thank you” modal)
      window.__feedbackBefore = json;
      const lfb = document.getElementById('preFeedbackBtn');
      if (lfb) {
        lfb.classList.add('is-disabled');
        lfb.textContent = '✅ Saved';
        lfb.onclick = null;
      }
      closeFeedbackModal();
    }
  };

  cancel.onclick  = closeFeedbackModal;
  closeBtn.onclick = closeFeedbackModal;

  // clicking outside card closes modal
  m.addEventListener('click', (e) => { if (e.target.id === 'feedbackModal') closeFeedbackModal(); });
}

function openStatsModal(){
  const m = document.getElementById('statsModal');
  if (!m) return;
  closeAllModalsExcept('statsModal');
  m.classList.remove('hidden');

  // Build table from last 5 runs
  const runs = (window.__sessionRuns || []).slice(-5).reverse(); // most recent first
  const tbody = document.getElementById('statsTableBody');
  if (tbody){
    tbody.innerHTML = runs.map((r, i) => {
      const when = new Date(r.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      const accStr = (typeof r.accuracyPct === 'number') ? `${r.accuracyPct}%` : '';
      // show friendly label for mode
      const label = (r.mode === 'classic') ? 'Zen' : (r.mode === 'challenge') ? 'Focus' : 'Emotion';
      return `<tr>
                <td>${i+1}</td>
                <td>${when}</td>
                <td>${r.score}</td>
                <td>${accStr}</td>
                <td>${label}</td>
              </tr>`;
    }).join('');
  }

  // Summary: average & best score across the session so far
  const all = (window.__sessionRuns || []);
  const avg = all.length ? Math.round(all.reduce((s,x)=>s+(Number(x.score)||0),0)/all.length) : 0;
  const hi  = all.length ? Math.max(...all.map(x=>Number(x.score)||0)) : 0;

  const sumEl = document.getElementById('statsSummaryRow');
  if (sumEl){
    sumEl.innerHTML = `
      <div style="width:100%;text-align:center;opacity:.85;">
        <strong>Summary</strong> — Avg Score: <b>${avg}</b> • Best: <b>${hi}</b> • Rounds: <b>${all.length}</b>
      </div>`;
  }
}

function closeStatsModal(){
  document.getElementById('statsModal')?.classList.add('hidden');
}
// end of modal helper section

/* =============================
 *        Audio SFX (WebAudio)
 * ============================= */
function playPop(vel=1){
  const ctx = window.__audioCtx; if (!ctx) return;
  const t = ctx.currentTime;

  // Noise click (bubble skin snap)
  const nbuf = ctx.createBuffer(1, 4410, 44100);
  const data = nbuf.getChannelData(0);
  for (let i=0; i<data.length; i++) data[i] = (Math.random()*2-1) * (1 - i/data.length);
  const noise = ctx.createBufferSource(); noise.buffer = nbuf;

  const band = ctx.createBiquadFilter(); band.type='bandpass';
  band.frequency.value = 1000 + Math.random()*800; band.Q.value = 8;

  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.7*vel, t);
  nGain.gain.exponentialRampToValueAtTime(0.001, t+0.06);

  noise.connect(band).connect(nGain).connect(ctx.destination);
  noise.start(t); noise.stop(t+0.06);

  // Short sine ping with downward sweep (air release)
  const osc = ctx.createOscillator(); osc.type='sine';
  const f0 = 700 + Math.random()*400;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(180, t+0.08);

  const oGain = ctx.createGain();
  oGain.gain.setValueAtTime(0.55*vel, t);
  oGain.gain.exponentialRampToValueAtTime(0.001, t+0.09);

  osc.connect(oGain).connect(ctx.destination);
  osc.start(t); osc.stop(t+0.10);
}

// ===== Audio SFX (procedural) =====
let __audioCtx = null, __popBuf = null, __buzzBuf = null, __audioReady = false;

// Persisted SFX state (default ON)
let __sfxOn = (function(){
  try { return localStorage.getItem('sfxOn') !== '0'; }
  catch { return true; }
})();
window.__sfxOn = __sfxOn; // keep window + local in sync

function initAudioOnce(){
  if (__audioReady && __audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  try {
    __audioCtx = __audioCtx || new Ctx();
    window.__audioCtx = __audioCtx;      // sync
    __popBuf   = __popBuf   || makePopBuffer(__audioCtx);
    __buzzBuf  = __buzzBuf  || makeBuzzBuffer(__audioCtx);
    __audioReady = true;
    window.__audioReady = true;          // sync
  } catch(e){
    console.warn('[audio] init failed:', e);
    __audioReady = false;
    window.__audioReady = false;
  }
}

// v10.0.6 — unified SFX state sync (top-bar button removed; keep bottom-left floater)
function setSfx(on){
  __sfxOn = !!on;
  window.__sfxOn = __sfxOn;
  try { localStorage.setItem('sfxOn', __sfxOn ? '1' : '0'); } catch {}
}

// Good hit sound
function maybePop(force=false){
  if (!__audioReady) return;
  if (!force && !__sfxOn) return;
  const ctx = __audioCtx, src = ctx.createBufferSource();
  src.buffer = __popBuf;
  const g = ctx.createGain();
  g.gain.value = force ? 0.35 : 0.28; // confirmation slightly louder
  src.connect(g).connect(ctx.destination);
  src.start();
}

// Render a super-short “pop” into an AudioBuffer (decaying sine with click)
function makePopBuffer(ctx){
  const dur = 0.06, sr = ctx.sampleRate, n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  // freq glide 650 → 180 Hz with exp envelope
  for (let i=0;i<n;i++){
    const t = i/sr;
    const f = 180 + (650-180) * Math.pow(1 - t/dur, 2.2);
    const env = Math.pow(1 - t/dur, 2.8);
    d[i] = Math.sin(2*Math.PI*f*t) * env;
  }
  // add a tiny click/pitch bend at start to feel “snappy”
  d[0] *= 0.6; d[1] *= 0.8;
  return buf;
}

// Bad hit sound
function makeBuzzBuffer(ctx){
  const dur = 0.09, sr = ctx.sampleRate, n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  for (let i=0;i<n;i++){
    const t = i/sr;
    // nasal buzz ~220→120 Hz with light distortion
    const f = 120 + (220-120) * Math.pow(1 - t/dur, 1.8);
    const wave = Math.sign(Math.sin(2*Math.PI*f*t)); // squarey
    const env = Math.pow(1 - t/dur, 2.2);
    d[i] = wave * env * 0.6;
  }
  return buf;
}

function maybeBuzz(force=false){
  if (!__audioReady) return;
  if (!force && !__sfxOn) return;
  const ctx = __audioCtx, src = ctx.createBufferSource();
  src.buffer = __buzzBuf;
  const g = ctx.createGain();
  g.gain.value = 0.24;
  src.connect(g).connect(ctx.destination);
  src.start();
}

// ===== Splash Controller =====
// ===== Splash Controller =====
function initSplash() {
  const splash = document.getElementById('splash');
  const splashCard = document.getElementById('splashCard') || splash.querySelector('.splash-inner');
  if (!splash) return;

  function dismissSplash() {
    if (!splash.classList.contains('is-visible')) return;

    // 🔑 only init audio AFTER user taps/clicks splash
    if (!window.__audioReady) {
      try { 
        initAudioOnce(); 
        __audioCtx?.resume();
        maybePop(true); 
      } catch (_) {}
    }

    splash.classList.add('is-fading-out');

    setTimeout(() => {
      splash.classList.remove('is-visible', 'is-fading-out');
      if (typeof window.onSplashDismiss === 'function') {
        try { window.onSplashDismiss(); } catch (e) { console.warn(e); }
      }
    }, 420);
  }

  requestAnimationFrame(() => splash.classList.add('is-visible'));

  const startEvents = ['click', 'touchend'];
  startEvents.forEach(evt =>
    splashCard?.addEventListener(evt, dismissSplash, { passive: true })
  );
  splashCard?.addEventListener('keydown', (e) => {
    const k = e.key?.toLowerCase();
    if (k === 'enter' || k === ' ') dismissSplash();
  });
}

window.__splashActive = true;
window.onSplashDismiss = function () {
  window.__splashActive = false;
  playerDeviceId = playerDeviceId || getOrCreateDeviceId();
  window.__deviceType = detectDeviceType(); // set once
  showLoginScreen(playerDeviceId); // open login after splash
};

function openPostGameModal(){ closeAllModalsExcept('postGameModal'); document.getElementById('postGameModal')?.classList.remove('hidden'); }
function closePostGameModal(){ document.getElementById('postGameModal')?.classList.add('hidden'); }


/* =============================
 *        Login & start
 * ============================= */
function startGame() {
  // Fade out login if visible, then proceed
  const modal = document.getElementById('loginModal');

  if (modal && !modal.classList.contains('hidden')) {
    modal.classList.add('is-fading-out');

    setTimeout(() => {
      modal.classList.remove('is-fading-out');
      modal.classList.add('hidden');
      document.body.classList.remove('login-active');
      showModePicker();
    }, 240);
  } else {
    // If it was already hidden (edge cases), just continue
    document.body.classList.remove('login-active');
    showModePicker();
  }
}

/**
 * Show login screen: prefill from profile or suggest, validate, then POST setUsername.
 * Keeps naming consistent: deviceId, username.
 */
function showLoginScreen(deviceId){
  const modal  = document.getElementById('loginModal');
  const input  = document.getElementById('usernameInput');
  const submit = document.getElementById('loginOkBtn');
  if (!modal || !input || !submit) return;

  // Allow input while we check if this device has a saved username
  input.disabled = false;

  // keep top bar hidden here
  const topBar = document.getElementById('topBar');
  if (topBar) topBar.classList.add('hidden');

  document.body.classList.add('login-active');
  document.body.classList.remove('mode-pick');
  document.body.classList.remove('game-active');

  modal.classList.remove('hidden');

  /* Autofocus + place cursor at end (no scroll jump) */
  try {
    input.setAttribute('inputmode', 'text');      // mobile keyboard hint
    input.focus({ preventScroll: true });
    setTimeout(() => {
      const len = (input.value || '').length;
      input.setSelectionRange(len, len);
    }, 30);
  } catch (_) {}

  // track if user started typing
  let loginUserEdited = false;
  input.addEventListener('input', () => { loginUserEdited = true; });

  /* Press Enter to submit (respect busy/disabled state) */
  input.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if (k === 'enter') {
      e.preventDefault();
      if (!submit.disabled) {
        // reuse the same click handler
        submit.onclick();
      }
    }
  }, { passive: false });

  /* Auto-select suggested username on first focus */
  let firstFocus = true;
  input.addEventListener('focus', () => {
    if (firstFocus && input.value) {
      input.select();
      firstFocus = false;
    }
  });

  // only clear if nothing was pre-filled (localStorage hydration)
  if (!input.value) {
    input.value = '';
    setLoginStatus('Enter your preferred name while we check for an existing name…', 'info');
  }

  let priorProfile = null;

  // Fetch prior profile for this deviceId
  fetch(`${GOOGLE_SCRIPT_URL}?action=profile&deviceId=${encodeURIComponent(deviceId)}`)
    .then(r => r.json())
    .then(data => {
      const suggested = (data && data.ok && data.profile && data.profile.username)
        ? String(data.profile.username || '').trim()
        : `Player-${deviceId.slice(0,6)}`;

      // Don’t override the current input — instead show as a suggestion button
      const sugRow = document.getElementById('serverSuggestionRow');
      const sugBtn = document.getElementById('serverSuggestionBtn');
      if (sugRow && sugBtn) {
        sugBtn.textContent = `Use previous name: ${suggested}`;
        sugRow.classList.remove('hidden');
        sugBtn.onclick = () => {
          const username = suggested;
          input.value = username;
          playerUsername = username;
          try { localStorage.setItem(STORAGE_KEYS.username, username); } catch {}
          setLoginStatus(`Welcome back, ${username}!`, 'ok');

          // Add a spinner to indicate busy icon
          submit.classList.add('is-busy');
          submit.disabled = true;

          // 🔑 bypass the OK button — go straight to saving
          fetch(`${GOOGLE_SCRIPT_URL}${GOOGLE_SCRIPT_POST_SUFFIX}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'setUsername', deviceId, username })
          })
          .then(() => {
            playerUsername = username;
            try { localStorage.setItem(STORAGE_KEYS.username, username); } catch {}
            setLoginStatus(`Welcome, ${username}!`, 'ok');
            startGame(); // open Mode Picker right away
          })
          .catch(() => {
            setLoginStatus('Could not save username. Please try again.', 'err');
          })
          .finally(() => {
            submit.classList.remove('is-busy');
            submit.disabled = false;
          });
        };
      }

      if (data && data.ok && data.profile) {
        priorProfile = data.profile;
        const typed = (input.value || '').trim();
        if (typed && typed.toLowerCase() !== suggested.toLowerCase()) {
          // User already typed something different — be explicit which will be used
          setLoginStatus(`We’ll use your username “${typed}”. This device was previously linked to “${suggested}”.`, 'ok');
        } else {
          // User hasn’t typed (or matches suggestion)
          setLoginStatus(`This device is linked to “${suggested}”. You can use this username or type a new one.`, 'ok');
        }
        input.disabled = false;  // returning device -> allow editing
      } else {
        setLoginStatus('You’re new here. Pick a username to start.', 'info');
        input.disabled = false; // new device -> enable typing
      }
    })
    .catch(() => {
      const suggested = `Player-${deviceId.slice(0,6)}`;
      if (!loginUserEdited && (!input.value || input.value.trim() === '')) input.value = suggested;
      else input.placeholder = suggested;
      setLoginStatus('Can\'t check existing name right now. You can still create a name.', 'err');
      input.disabled = false; // assume new device on error -> allow typing
    });

  // SUBMIT: check availability first (keep modal open). Only show "Saving…" progress after it’s available.
  submit.onclick = function() {
    const raw = (input.value || '');
    const trimmed = raw.trim();

    // If empty (or just spaces), auto-suggest and fill, don't error
    if (!trimmed) {
      const suggestedNow = (priorProfile && priorProfile.username)
        ? String(priorProfile.username).trim()
        : `Player-${deviceId.slice(0,6)}`;

      input.value = suggestedNow;
      setLoginStatus(`We suggested the username “${suggestedNow}”. You can edit it or press OK to continue.`, 'info');
      input.focus();
      try { input.setSelectionRange(suggestedNow.length, suggestedNow.length); } catch(_) {}
      return;
    }

    const username = trimmed;

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

        // Now proceed to save (keep login visible; show inline status + busy state)
        setLoginStatus('Saving your username…', 'info');

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

          setLoginStatus(`${greet} Opening mode selection…`, 'ok');

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
