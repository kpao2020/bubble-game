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
// Version history
// v1.0   : Initial game built with basic popping bubbles and mousePressed input
//
// v2.2   : Fix bubbles spawn issues. Adjust walls. Minor bug fix.
//
// v3.2   : Add score system, Add timer. Update CSS and JS. Minor bug fix.
//
// v4.5   : Add splash screen. Minor fix HTML layout. Add Challenge Mode and Bio Mode. Add face-api.js
//
// v5.6   : Add topBar display. Add camera for facial expression troubleshooting. Adjust 3 Bio 
//          states - happy, sad, angry attributes and fix neutral values for improving detection.
//          Add google sheet to capture data. Add cloudflare worker for secret management.
//          Major update and bug fix.
//
// v6.2   : Add splash screen. Redesign topBar layout - remove "New Game" button. Adjust walls for proper playarea.
//
// v7.6   : Change facial expression detection from 5s to 1s. Add login screen. Add end game screen.
//
// v8.0   : Baseline release — Classic / Challenge / Mood (Bio) modes; Sheets logging via Worker;
//          face-api sampling; splash → login → mode picker → gameplay → post-game flow.
//
// v8.1   : Minor adjust sampling to improve facial expression detection.
//
// v8.2   : Update payload to send updated game statistic in correct order to google sheet.
//
// v8.3   : Update Google app script to fix the ordering. Update Google sheet headers manually.
//
// v8.4   : Optimize CSS, JS into logical groups to improve SDLC maintenance.
//
// v8.5   : Gameplay polish — switched normal bubble tint to a curated, high-contrast palette
//          (more visible colors; consistent alpha).
//
// v8.6   : UI pass — global button restyle (rounded, taller, tighter width) with clear hover/active/focus.
//
// v8.6.1 : Button shape tweaks — squarish icon feel (not pills), darker top-bar camera button.
//
// v8.6.2 : Mode picker buttons → square icon tiles with emoji + text (no overflow).
//
// v8.6.3 : Mode picker layout — centered “Choose a Mode” header and centered button column;
//          ensured labels don’t overflow on narrow screens.
//
// v8.6.4 : Color coding — distinct backgrounds for Classic/Challenge/Mood tiles;
//          post-game actions (Play/Mode) converted to square, color-coded tiles with emoji.
//
// v8.6.5 : Feedback states — added per-button hover (slightly darker) and active (deeper + press scale).
//
// v8.6.6 : Post-game UI — centered the two action tiles; kept them as square tiles with press feedback.
//
// v8.6.7 : Mode chip visibility & theming — mode chip always visible (Classic/Challenge/Mood);
//          CSS prepared for per-mode chip backgrounds (blue/orange/green); consolidated CSS structure.
//
// v8.6.7.1: Minor CSS fix — corrected the Challenge selector spacing so its chip color updates correctly.
//
// v8.6.8 : JS/CSS sync — added body mode-class toggling (mode-classic / mode-challenge / mode-mood) so
//          CSS can theme #modeChip automatically; no gameplay changes.
//
// v8.6.8.1: Simplified UX — removed legacy top-bar mode dropdown; the Mode Picker dialog is now the only way
//           to choose Classic / Challenge / Mood.
//
// v8.7   : Dialog system — responsive, four-corner rounded modals; camera modal centered;
//          post-game behaves like a bottom sheet on phones and “floats” slightly above bottom on larger screens.
//
// v8.7.1 : Dialog option (B) — even on small phones, keep four corners with a small bottom gap (no flush edge).
//
// v8.8   : Telemetry & login UX — detectDeviceType() added and included in Sheets payload;
//          login field is disabled during profile lookup, then enabled so returning users can keep or edit
//          their username; version string sent with each run.
//
// v8.8.2 : Fix google sheet variable order via app script
//
// v9.0   : Update google sheet 2 new headers "feedbackBefore", "feedbackAfter". Update google app script
//
// v9.0.1 : Feedback system (research note + before/after capture)
//          - Added study note + "Feedback" button on Login (before-game feedback).
//          - Added reusable Feedback modal (textarea) for both before/after feedback.
//          - Added "Feedback" button to Post-game modal (after-game feedback).
//          - Feedback (before) is stored locally and attached to the next run payload.
//          - Feedback (after) is captured via modal and included in the run payload.
//          - Changed submission flow: endGame no longer posts immediately.
//          - A run is posted exactly once per round when the player chooses Play Again,
//            Change Mode, or saves post-game feedback.
//          - Introduced submitRunOnce() guard and runSubmitted flag.
//
// v9.0.2 : Feedback safeguards + always-log option
//          - Adopted "Option 2": Close (✖) on the Post-game modal now also triggers
//            submitRunOnce(), so every finished round is logged.
//          - Added safeguard: if the Feedback modal is open with unsaved text when
//            the player taps Play Again / Change Mode / Close, that text is auto-
//            captured into feedbackAfter before posting. Prevents accidental loss
//            of feedback if the player skips Save.
//          - Guard logic still ensures only one POST per round (no duplicates).
//
// v9.1   : “bio” → “mood” refactor (no behavior change)
//          - Replaced all remaining bio* ids/selectors/keys with mood* across HTML/CSS/JS.
//          - Fixed isMoodMode() to check 'mood' (was 'bio') so Mood features always run.
//          - Renamed consent helpers and modal ids to moodConsent*; added one-time localStorage migration.
//          - Renamed top-bar chip id to #moodChip and updated JS to use it.
//          - (Optional) Renamed sampleBio() → sampleMood() and console tags “[bio]” → “[mood]”.
//
// v9.1.1 : fix comment bio -> mood on certain spots
//
// v9.2   : Pre- and Post-game surveys, JSON in single cell
//          - Added 2 baseline (pre-game) questions: stress level + mood.
//          - Added 4 multiple choice + 1 short answer survey after each round.
//          - Both stored as JSON strings in feedbackBefore / feedbackAfter.
//          - Replaces old free-text feedback field.
//          - Single-POST flow preserved via submitRunOnce(); no duplicate rows.
//
// v9.2.1 : Post-game feedback polish (mobile + UX)
//          - After saving post-game feedback: show “Thank you” state, disable the Feedback button,
//            and prevent reopening for the same round.
//          - Clear answers for the next round automatically.
//          - Compact mobile layout for post-game survey (2-column choices, larger tap targets).
//
// v9.2.2 : Login tidy + post-game layout + scrollable survey
//          - Login: shorter username field; OK + Feedback side-by-side; clearer note + separate disclaimer.
//          - Pre-game Feedback: when saved, lock button (no “thank you” modal).
//          - Post-game: Feedback moved to its own row; distinct colors on all three buttons.
//          - Feedback modal: header/footer fixed; questions area scrolls on mobile; hover/active states kept.
//
// v9.2.3 : Fix duplicate usernameInput reference in setup(); reuse single const (no functional change).
//          - Login OK wiring — replaced legacy #submitUsername with #loginOkBtn to match HTML; click handler now attaches correctly.
//
// v9.2.4 : Fix mismatch submitRun and submitRunOnce
//
// v9.2.5 : Feedback textarea id aligned to #postQ5 (was #feedbackText) so post-game comments are captured.
//
// v9.2.6 : Troubleshooting begins...
//
// v9.2.7 : Stabilize draw() — guard bubble loop (null-safe + try/catch) so a bad frame doesn’t black-screen.
//
// v9.2.8 : Remove undefined onLoginSave; bind loginOkBtn directly to showLoginScreen(playerDeviceId).
//
// v9.2.9 : Telemetry — gameVersion in submitRun() now matches header; start of cleanup pass.
//
// v9.2.10 : draw() cleanup — remove duplicate refreshCameraBtn() in Mood branch.
//
// v9.2.11 : Remove dead DOM refs — delete #modeSelect disables in endGame() and restart().
//
// v9.2.12 : Optimize code in sketch.js style.css and index.html
//
// v9.3    : Optimized Mood mode (lazy-load face-api, lighter models)
//           - Balanced gameplay: fewer bubbles per mode, size-based scoring, miss-streak easing
//
// v9.3.1  : Minor UI cleanup
//          - Removed legacy restartBtn (HTML, CSS, JS) since Post-game modal fully replaces it.
//          - Login screen: moved OK + Feedback buttons into their own row (right-aligned) for clearer layout.
// ============================================================================



/* =============================
 *        Game constants
 * ============================= */
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

const MOOD_SAMPLE_MS = 1500;           // face sampling cadence (ms)

// Mood end-game behavior: 'pause' (sampler only) or 'stop' (sampler + camera)
const MOOD_STOP_STRATEGY = 'pause';
const MOOD_IDLE_STOP_MS = 45000;       // stop camera after idle timeout on Game Over
let moodIdleStopTO = null;

const TOUCH_HIT_PAD = 12;
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const CLASSIC_SPEED_SCALE = 0.75;
const CLASSIC_SPEED_CAP   = 3.0;

let currentMode = 'classic'; // 'classic' | 'challenge' | 'mood'
const CHALLENGE_TRICK_RATE = 0.22;

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
  const m  = document.getElementById('modeModal');
  const bC = document.getElementById('modeClassicBtn');
  const bH = document.getElementById('modeChallengeBtn');
  const bB = document.getElementById('modeMoodBtn');

  // NEW: hide top bar while choosing a mode
  const topBar = document.getElementById('topBar');
  if (topBar) topBar.classList.add('hidden');

  document.body.classList.remove('login-active');
  document.body.classList.add('mode-pick');
  document.body.classList.remove('game-active');

  if (!m || !bC || !bH || !bB){ 
    currentMode = 'classic'; 
    setBodyModeClass();
    afterModeSelected(false); 
    return; 
  }

  const hide = () => m.classList.add('hidden');
  closeAllModalsExcept('modeModal');
  m.classList.remove('hidden');

  // Light prefetch on idle while the mode menu is visible
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => prefetchFaceApi(), { timeout: 1200 });
  } else {
    setTimeout(prefetchFaceApi, 800);
  }

  bC.onclick = () => { currentMode = 'classic'; setBodyModeClass(); hide(); afterModeSelected(false); };
  bH.onclick = () => { currentMode = 'challenge'; setBodyModeClass(); hide(); afterModeSelected(false); };
  bB.onclick = () => {
    bB.addEventListener('mouseenter', prefetchFaceApi, {once: true});
    bB.addEventListener('touchstart', prefetchFaceApi, {once: true});
    const proceedMood = () => { currentMode = 'mood'; setBodyModeClass(); hide(); afterModeSelected(true); };
    if (hasMoodConsent()) proceedMood();
    else showMoodConsentModal(proceedMood, () => { currentMode = 'classic'; setBodyModeClass(); hide(); afterModeSelected(false); });
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

  // Now actually start the game round
  const centerEl = document.getElementById('center');
  if (centerEl){ centerEl.textContent = ''; centerEl.style.display = 'none'; }

  window.__playerReady = true;

  if (isMood){
    await ensureFaceApiLib();
    await loadFaceApiModels();
    startWebcam();
    startSampler();
  } else {
    stopSampler();
    stopWebcam();
  }

  refreshCameraBtn();
  setBodyModeClass(); // keep CSS theming in sync
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
        username: playerUsername || '',
        mode: currentMode,
        gameVersion: 'v9.3.1', // keep in sync with version comment
        score,
        durationMs,
        bubblesPopped,
        accuracy: +( (bubblesPoppedGood / Math.max(1, tapsTotal)).toFixed(3) ),
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
  
  if (isMoodMode()){
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

  // prevent the game close if not clicking the play again button or change mode button
  // if (pg) pg.addEventListener('click', (e) => { if (e.target.id === 'postGameModal') closePostGameModal(); });

  // Play Again handler
  if (pgPlay) pgPlay.onclick = () => {
    // If the feedback modal is open, auto-capture unsaved text
    sealFeedbackIfOpen();
    submitRunOnce();         // first trigger wins; no double-posts
    closePostGameModal();
    if (window.__playerReady) restart(false);
  };

  // Change Mode handler
  if (pgMode) pgMode.onclick = () => {
    sealFeedbackIfOpen();
    submitRunOnce();
    closePostGameModal();
    showModePicker();
  };

  // --- Post-game "Feedback" button (after-game feedback) ---
  const pgFeedback = document.getElementById('postFeedbackBtn');
  if (pgFeedback) pgFeedback.onclick = () => openFeedbackModal('after');

  // --- Login "Feedback" button (before-game feedback) ---
  const loginFb = document.getElementById('preFeedbackBtn');
  if (loginFb) loginFb.onclick = () => openFeedbackModal('before');

  // Make sure the reusable Feedback modal is wired once
  wireFeedbackModal();

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

} // end of setup()

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
    modeChip.style.display = 'inline-flex';   // always visible
  }

  const moodChip  = document.getElementById('moodChip');
  const camBtnEl = document.getElementById('cameraBtn');
  let modeSpeedMult = 1.0;

  if (currentMode === 'classic'){
    modeSpeedMult = CLASSIC_SPEED_SCALE;
    moodChip?.classList.add('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'none';
  }else if (currentMode === 'challenge'){
    modeSpeedMult = 1.3;
    moodChip?.classList.add('hiddenChip');
    if (camBtnEl) camBtnEl.style.display = 'none';
  }else{
    // Mood mode
    refreshCameraBtn(); // decides visibility based on laptop + toggle
    moodChip?.classList.remove('hiddenChip');

    const emo = dominantEmotion();
    moodChip.textContent = emo.toUpperCase();
    if (emo === 'happy'){ moodChip.style.background = 'rgba(120,255,160,.85)'; modeSpeedMult = 1.5; }
    else if (emo === 'sad'){ moodChip.style.background = 'rgba(120,160,255,.85)'; modeSpeedMult = 0.8; }
    else if (emo === 'angry'){ moodChip.style.background = 'rgba(255,140,140,.85)'; modeSpeedMult = 1; }
    else if (emo === 'stressed'){ moodChip.style.background = 'rgba(255,200,120,.85)'; modeSpeedMult = 0.5; }
    else { moodChip.style.background = 'rgba(255,255,255,.85)'; modeSpeedMult = 1.0; }
  }

  const sTop = safeTopPx();
  const MINF = MIN_PLAY_SPEED;

  // Guard against uninitialized bubbles & surface errors instead of hard-crashing the frame
  if (!bubbles || typeof bubbles.length !== 'number') return;

  try {

    for (let i = 0; i < bubbles.length; i++){
      const b = bubbles[i];
      b.direction += random(-0.35, 0.35);
      const r = currentRadius(b);

      if (currentMode === 'classic')      b.speed = max(min(b._baseSpeed * modeSpeedMult * rubberSpeedFactor(), CLASSIC_SPEED_CAP), MINF);
      else if (currentMode === 'challenge') b.speed = max(b._baseSpeed * modeSpeedMult * rubberSpeedFactor(), MINF);
      else                                  b.speed = max(b._baseSpeed * constrain(modeSpeedMult, 0.5, 1.6) * rubberSpeedFactor(), MINF);

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
  } catch (err) {
    console.warn('[draw] bubble loop error:', err);
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

  if (isMoodMode()){
    const biasX = width * moodState.gaze.x, biasY = constrain(height * moodState.gaze.y, sTop + r, height - r);
    sx = constrain(lerp(random(r, width - r), biasX, 0.6), r, width - r);
    sy = constrain(lerp(random(sTop + r, height - r), biasY, 0.6), sTop + r, height - r);
  }

  const b = new Sprite(sx, sy, d);
  b.shape = 'circle'; b.color = color(255,255,255,0); b.diameter = d;
  // new (choose a palette color with a stronger, visible alpha):
  const cIdx = Math.floor(random(BUBBLE_COLORS.length));
  const [cr,cg,cb] = BUBBLE_COLORS[cIdx];
  b._tint = color(cr, cg, cb, 200);

  b.direction = degrees(angle); b.speed = speed; b._baseSpeed = speed; b.mass = PI * r * r;
  b.rotationLock = true; b._hitScale = 1; b._stuck = 0;
  b._type = (currentMode === 'challenge' && random() < CHALLENGE_TRICK_RATE) ? 'trick' : 'normal';
  bubbles.add(b); return b;
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
    const b = bubbles[i], r = currentRadius(b), rHit = r + (IS_TOUCH ? TOUCH_HIT_PAD : 0);
    const dx = px - b.x, dy = py - b.y;
    if (dx*dx + dy*dy <= rHit*rHit){
      hit = true;

      // size-based scoring: smaller bubble => more points
      const diameterNow = r * 2; // r from currentRadius(b), includes mood scaling
      const sizeBoost = Math.min(3, Math.max(1, (MIN_DIAM / diameterNow) * SCORE_SIZE_MULTIPLIER));
      const delta = (b._type === 'trick')
        ? -SCORE_TRICK_PENALTY
        : Math.max(1, Math.round(SCORE_BASE * sizeBoost));
      score += delta;
      noteHit();
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

  if (!hit) {
    tapsMissed++;
    noteMiss();
  }
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
  if (centerEl){ centerEl.textContent = `Game Over!\nScore: ${score}`; centerEl.style.display = 'block'; }

  if (isMoodMode()){
    if (MOOD_STOP_STRATEGY === 'pause') { stopSampler(); }
    else { stopSampler(); stopWebcam(); }
    clearTimeout(moodIdleStopTO);
    moodIdleStopTO = setTimeout(() => { if (gameOver && isMoodMode()) stopWebcam(); }, MOOD_IDLE_STOP_MS);
  }

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
  // v9.2.1 — reset post-game Feedback button state for the new round
  const pgFeedback = document.getElementById('postFeedbackBtn');
  if (pgFeedback) {
    pgFeedback.classList.remove('is-disabled');
    pgFeedback.innerHTML = '📝<br>Feedback';   // original label
    pgFeedback.onclick = () => openFeedbackModal('after');  // re-bind
  }

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

  const onReady = () => { if (isMoodMode() && window.__playerReady) startSampler(); };
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

      // Disable the post-game Feedback button and mark as saved
      const pgFeedback = document.getElementById('postFeedbackBtn');
      if (pgFeedback) {
        pgFeedback.classList.add('is-disabled');
        pgFeedback.innerHTML = '✅<br>Saved';
        // Prevent reopening (optional hard block)
        pgFeedback.onclick = null;
      }

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
  window.__deviceType = detectDeviceType(); // set once
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
  const submit = document.getElementById('loginOkBtn');
  if (!modal || !input || !submit) return;

  // Disable input while we check if this device has a saved username
  input.disabled = true;

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
        setLoginStatus(`Welcome back! This device is linked to “${suggested}”. You can keep it or choose a new username.`, 'ok');
        input.disabled = false;  // returning device -> allow editing
      } else {
        setLoginStatus('New device detected. Please create a username.', 'info');
        input.disabled = false; // new device -> enable typing
      }
    })
    .catch(() => {
      const suggested = `Player-${deviceId.slice(0,6)}`;
      if (!loginUserEdited && (!input.value || input.value.trim() === '')) input.value = suggested;
      else input.placeholder = suggested;
      setLoginStatus('Could not check device right now. You can still create a username.', 'err');
      input.disabled = false; // assume new device on error -> allow typing
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
