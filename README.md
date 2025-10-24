<h2 align="center">📱 Play the Game</h2>
<p align="center">Scan this QR code to open the game instantly:</p>
<p align="center">
  <img src="./bubbleQR.png" alt="Play the Game QR Code" width="250">
</p>
<p align="center">
  <a href="https://kpao2020.github.io/bubble-game/">▶️ Play Now</a>
</p>

---

# Popping Bubbles 🎮

A browser-based game built with **p5.js** and **p5play v3**, featuring three gameplay modes:
- **Classic**
- **Challenge**
- **Mood (Bio)**

The game integrates **face-api.js** for emotion detection, **Google Apps Script** for statistics logging, and a **Cloudflare Worker proxy** for secure data submission.

---

## 🚀 Features
- Bubble popping gameplay with scoring and timer
- Three modes: Classic, Challenge (trick bubbles), and Mood (Bio)
- Mood detection using face-api.js (happy, sad, angry, stressed)
- Splash → Login → Mode Picker → Gameplay → Post-game flow
- Device check and username login system
- Data submission to Google Sheets via Cloudflare Worker
- Optimized UI with modal dialogs, color-coded tiles, and responsive layout

---

## 🛠 Tech Stack
- **p5.js** + **p5play v3** → Core game engine & loop
- **face-api.js** → Real-time emotion recognition
- **Google Apps Script** → Data logging & Sheets integration
- **Cloudflare Worker** → Secure proxy for API calls
- **HTML/CSS/JavaScript** → UI, styling, layout

---

## 📂 Project Structure
- **[Game constants]** → Core tunables for gameplay & bio thresholds
- **[Backend config]** → Worker endpoint for Google Apps Script
- **[Identity & storage]** → DeviceId, username, bioConsent keys
- **[Troubleshooting mode]** → Laptop-only toggle (`t`) to reveal camera button
- **[UI helpers]** → Viewport sizing, overlays, safe area setup
- **[Submit Run]** → Sends gameplay stats to Sheets
- **[Setup & Draw]** → Lifecycle functions & UI updates
- **[Gameplay]** → Bubble spawning, collisions, restart/end logic
- **[Bio (face-api)]** → Webcam controls, model loading, emotion sampling
- **[Modals & Splash]** → Modal handling, splash screen
- **[Login & Start]** → Device profile check, username flow, mode picker

---

## 🎯 Safe Customization Points
- `GAME_DURATION` → Adjust game length
- Bubble size & speed
- `EMO_CFG` and `EMO_FORCE` → Bio mode responsiveness
- `CHALLENGE_TRICK_RATE` → Trick bubble frequency
- Consent copy → `index.html`
- Google Sheets columns → handled in Apps Script

⚠️ **Important:** Do not rename existing variables/IDs. UI and Sheets integrations depend on them.

---

## 🧑‍💻 Development Notes
- Toggle troubleshooting mode with `t` (laptop only)
- Major updates include:
  - Bio mode with face-api.js
  - Splash, login, and post-game screens
  - Telemetry with device type and version string
  - Cloudflare Worker integration for security
  - Improved UI/UX with consistent styles and responsive design

---

## ▶️ How to Play
1. Open the game in your browser.
2. Enter a username on the login screen.
3. Pick a mode:
   - **Classic** → Standard bubble popping.
   - **Challenge** → Includes trick bubbles.
   - **Mood (Bio)** → Uses facial expressions to influence gameplay.
4. Play until the timer runs out!
5. View your score and stats on the post-game screen.

---

## 📊 Data Privacy
- Bio mode uses **local webcam access** with **face-api.js** for emotion detection.
- Data (score, emotions, device type, username) is sent securely via **Cloudflare Worker** to a Google Sheet.
- Consent is required for bio mode.

---

## 📌 License
This project is for **educational and research purposes**. Not intended for commercial use.

---

## 📜 Version History

### v1.0
- Initial game built with basic popping bubbles and mousePressed input
### v2.2
- Fix bubbles spawn issues. Adjust walls. Minor bug fix.
### v3.2
- Add score system, Add timer. Update CSS and JS. Minor bug fix.
### v4.5
- Add splash screen. Minor fix HTML layout. Add Challenge Mode and Bio Mode. Add face-api.js
### v5.6
- Add topBar display. Add camera for facial expression troubleshooting. Adjust 3 Bio states - happy, sad, angry attributes and fix neutral values for improving detection. Add google sheet to capture data. Add cloudflare worker for secret management. Major update and bug fix.
### v6.2
- Add splash screen. Redesign topBar layout - remove "New Game" button. Adjust walls for proper playarea.
### v7.6
- Change facial expression detection from 5s to 1s. Add login screen. Add end game screen.
### v8.0
- Baseline release — Classic / Challenge / Mood (Bio) modes; Sheets logging via Worker; face-api sampling; splash → login → mode picker → gameplay → post-game flow.
### v8.1
- Minor adjust sampling to improve facial expression detection.
### v8.2
- Update payload to send updated game statistic in correct order to google sheet.
### v8.3
- Update Google app script to fix the ordering. Update Google sheet headers manually.
### v8.4
- Optimize CSS, JS into logical groups to improve SDLC maintenance.
### v8.5
- Gameplay polish — switched normal bubble tint to a curated, high-contrast palette (more visible colors; consistent alpha).
### v8.6
- UI pass — global button restyle (rounded, taller, tighter width) with clear hover/active/focus.
### v8.6.1
- Button shape tweaks — squarish icon feel (not pills), darker top-bar camera button.
### v8.6.2
- Mode picker buttons → square icon tiles with emoji + text (no overflow).
### v8.6.3
- Mode picker layout — centered “Choose a Mode” header and centered button column; ensured labels don’t overflow on narrow screens.
### v8.6.4
- Color coding — distinct backgrounds for Classic/Challenge/Mood tiles; post-game actions (Play/Mode) converted to square, color-coded tiles with emoji.
### v8.6.5
- Feedback states — added per-button hover (slightly darker) and active (deeper + press scale).
### v8.6.6
- Post-game UI — centered the two action tiles; kept them as square tiles with press feedback.
### v8.6.7
- Mode chip visibility & theming — mode chip always visible (Classic/Challenge/Mood); CSS prepared for per-mode chip backgrounds (blue/orange/green); consolidated CSS structure.
- Minor CSS fix — corrected the Challenge selector spacing so its chip color updates correctly.
### v8.6.8
- JS/CSS sync — added body mode-class toggling (mode-classic / mode-challenge / mode-mood) so CSS can theme #modeChip automatically; no gameplay changes.
- Simplified UX — removed legacy top-bar mode dropdown; the Mode Picker dialog is now the only way to choose Classic / Challenge / Mood.
### v8.7.0
- Dialog system — responsive, four-corner rounded modals; camera modal centered; post-game behaves like a bottom sheet on phones and “floats” slightly above bottom on larger screens.
### v8.7.1
- Dialog option (B) — even on small phones, keep four corners with a small bottom gap (no flush edge).
### v8.8.0
- Telemetry & login UX — detectDeviceType() added and included in Sheets payload; login field is disabled during profile lookup, then enabled so returning users can keep or edit their username; version string sent with each run.
### v8.8.2
- Fix google sheet variable order via app script
### v9.0.0
- Update google sheet 2 new headers "feedbackBefore", "feedbackAfter". Update google app script
### v9.0.1
- Feedback system (research note + before/after capture) Added study note + "Feedback" button on Login (before-game feedback). Added reusable Feedback modal (textarea) for both before/after feedback. Added "Feedback" button to Post-game modal (after-game feedback). Feedback (before) is stored locally and attached to the next run payload. Feedback (after) is captured via modal and included in the run payload. Changed submission flow: endGame no longer posts immediately. A run is posted exactly once per round when the player chooses Play Again, Change Mode, or saves post-game feedback. Introduced submitRunOnce() guard and runSubmitted flag.
### v9.0.2
- Feedback safeguards + always-log option captured into feedbackAfter before posting. Prevents accidental loss of feedback if the player skips Save. Adopted "Option 2": Close (✖) on the Post-game modal now also triggers submitRunOnce(), so every finished round is logged. Added safeguard: if the Feedback modal is open with unsaved text when the player taps Play Again / Change Mode / Close, that text is auto Guard logic still ensures only one POST per round (no duplicates).
### v9.1.0
- “bio” → “mood” refactor (no behavior change) Replaced all remaining bio* ids/selectors/keys with mood* across HTML/CSS/JS. Fixed isMoodMode() to check 'mood' (was 'bio') so Mood features always run. Renamed consent helpers and modal ids to moodConsent*; added one-time localStorage migration. Renamed top-bar chip id to #moodChip and updated JS to use it. (Optional) Renamed sampleBio() → sampleMood() and console tags “[bio]” → “[mood]”.
### v9.1.1
- fix comment bio -> mood on certain spots
### v9.2.0
- Pre- and Post-game surveys, JSON in single cell Added 2 baseline (pre-game) questions: stress level + mood. Added 4 multiple choice + 1 short answer survey after each round. Both stored as JSON strings in feedbackBefore / feedbackAfter. Replaces old free-text feedback field. Single-POST flow preserved via submitRunOnce(); no duplicate rows.
### v9.2.1
- Post-game feedback polish (mobile + UX) After saving post-game feedback: show “Thank you” state, disable the Feedback button, and prevent reopening for the same round. Clear answers for the next round automatically. Compact mobile layout for post-game survey (2-column choices, larger tap targets).
### v9.2.2
- Login tidy + post-game layout + scrollable survey Login: shorter username field; OK + Feedback side-by-side; clearer note + separate disclaimer. Pre-game Feedback: when saved, lock button (no “thank you” modal). Post-game: Feedback moved to its own row; distinct colors on all three buttons. Feedback modal: header/footer fixed; questions area scrolls on mobile; hover/active states kept.
### v9.2.3
- Fix duplicate usernameInput reference in setup(); reuse single const (no functional change). Login OK wiring — replaced legacy #submitUsername with #loginOkBtn to match HTML; click handler now attaches correctly.
### v9.2.4
- Fix mismatch submitRun and submitRunOnce
### v9.2.5
- Feedback textarea id aligned to #postQ5 (was #feedbackText) so post-game comments are captured.
### v9.2.6
- — Troubleshooting begins...
### v9.2.7
- Stabilize draw() — guard bubble loop (null-safe + try/catch) so a bad frame doesn’t black-screen.
### v9.2.8
- Remove undefined onLoginSave; bind loginOkBtn directly to showLoginScreen(playerDeviceId).
### v9.2.9
- Telemetry — gameVersion in submitRun() now matches header; start of cleanup pass.
### v9.2.10
- draw() cleanup — remove duplicate refreshCameraBtn() in Mood branch.
### v9.2.11
- Remove dead DOM refs — delete #modeSelect disables in endGame() and restart().
### v9.2.12
- Optimize code in sketch.js style.css and index.html
### v9.3.0
- Optimized Mood mode (lazy-load face-api, lighter models) Balanced gameplay: fewer bubbles per mode, size-based scoring, miss-streak easing
### v9.3.1
- Minor UI cleanup - Removed legacy restartBtn (HTML, CSS, JS) since Post-game modal fully replaces it. Login screen: moved OK + Feedback buttons into their own row (right-aligned) for clearer layout.
### v9.3.2
- UI readability improvements Increased button text and emoji/icon size for better visibility. Adjusted button background colors for stronger contrast with text. Ensured higher legibility across login, mode picker, and post-game buttons.
### v9.4
- Login UX overhaul — type immediately, inline “Saving…” (no extra prompt), sleek pill OK button with spinner, animated helper text (fade + shake on errors), glassy login card + soft gradient backdrop, autofocus + Enter-to-submit, auto-select on first focus, and smooth fade-out into Mode Picker.
### v9.5
- Login card micro pop-in (scale + fade) on open for a smoother, modern feel.
### v9.6
- Single-helper copy + consistent “username” — clear which username will be used if you typed while device data loads.
### v9.6.1
- Remove duplicate helper line in index.html
### v9.7
- Auto-suggest on empty submit — if no username is typed, we fill with prior profile or Player-XXXXXX, update helper, and refocus the input so the user can confirm or edit quickly.
### v9.8
- Auto dark-mode theming for login and splash using `prefers-color-scheme`. Updates the glassy login card, backdrop, input, and helper text colors for dark backgrounds. Splash screen gets a darker gradient and matching card styling. Pure CSS — no changes to HTML or JS.
### v9.9
- Add procedural bubble-pop SFX (WebAudio) with top-bar toggle (default muted) and fix dark-mode splash CTA contrast.
### v9.9.1
- WebAudio SFX (muted by default) + first-tap confirmation pop; dark-mode splash CTA contrast; SFX toggle in header.
### v9.9.2
- Splash “Start” card acts as a single teal CTA (click/tap/Enter/Space); first tap plays a confirmation pop to init WebAudio; Mode Picker tiles unchanged. (minor)
### v9.9.3
- Unmuted SFX by default with first-tap confirm pop; add bottom-left floating sound toggle; canvas ignores taps on it. (minor)
### v9.9.4
- Remove duplicate top-bar sound button (#sfxBtn) next to Mode chip; keep bottom-left floating SFX toggle (#sfxFloat). Update setSfx() to reflect state on #sfxFloat so the visible control always mirrors the current audio setting. No functional changes elsewhere.
### v9.9.5
- Replace Mode Picker small icon buttons with full-width teal bar buttons. Reorder as Mood, Challenge, Classic. Buttons are responsive, stretch to container width, adjust height for icon+text, and keep consistent teal styling.
### v9.9.6
- GAS: add GET ?action=leaderboard (limit|n, username) over Runs; sort by score desc, accuracy desc, newest. Return {ok,scores[],me:{rank}}. In doPost, accept "submitRun" as alias for "run". Reuse existing Runs tab; no new sheet. Worker: normalize ?limit to ?n for backward-compat with GAS top handler. Keep CORS allowlist and POST secret append unchanged. No other behavioral changes; leaderboard and submitRun calls are forwarded verbatim.
### v9.9.7
- Post-game polish Removed legacy "Game Over / Score" overlay (#center); post-game modal is now the single source of round summary. Updated renderPostGameContent() to only update #playerStats and #leaderboard, keeping Play Again / Change Mode / Feedback buttons intact. Personalized stats: show "Your name" instead of generic "User"; rank shown when GAS matches username. Normalized username handling (trim) before submit/fetch so rank displays correctly; default to Guest if blank. CSS cleanup: removed duplicate survey/login blocks; removed unused leaderboardBlock ul/li rules. Table (.lbTable) styles finalized.
### v9.9.8
- Leaderboard by mode + UI polish Google Apps Script leaderboard now filters by mode; only top 5 scores from the same mode are shown (Classic / Challenge / Mood). Frontend getLeaderboard() passes current mode to GAS so results are mode-specific. Post-game stats block updated: align left for easier reading. Changed label from "Your name" to "Name" for cleaner presentation. Added placeholder text inside Post-game modal while stats + leaderboard are loading, so players see immediate feedback instead of a blank modal.
### v10.0.0
- Classic variants Step 2: startClassicRound(), buildClassicBoard() (static grid), timed/relax end checks in draw()
### v10.0.1
- Challenge tuning Combo multiplier: after 5 hits → x1.5, after 10 hits → x2.0; reset on miss. On-screen badge shows current combo state. Updated scoring in handlePop() to apply multiplier (no bonus on trick bubbles).
### v10.0.2
- Classic polish Reduce red penalty (−2 default; tweakable). End when all teal bubbles are popped; reds no longer block game end.
### v10.0.3
- Timer + Audio polish Classic Timed: reset timer to 60s on Play Again (re-sets classicDeadline in restart()). AudioContext: resume on first user gesture (global pointer/key listener) to satisfy Chrome autoplay policy.
### v10.0.4
- Color unification + cleanup Removed random palette; all modes now teal=score, red=penalty. Replaced b.red / b._type with b.kind ('normal' | 'trick'). Simplified tint logic (_tint set once at spawn, reused in draw).
### v10.0.5
- Mood trick bubbles Mood mode now spawns occasional red 'trick' bubbles (MOOD_TRICK_RATE), same teal/red scheme. spawnBubble() sets b.kind for Challenge and Mood; draw/score already use b.kind.
### v10.0.6
- SFX + Mood fixes SFX floater: single handle (__sfxBtn), init/resume audio, preview pop. Mood loader: show → await models/camera → hide; start sampler when frames ready. Post-game: “Your name” → “Name”.
### v10.0.7
- Classic SFX + Mood rank Classic: restored pop sound using `maybePop()` (sound-only), preserving Classic scoring and combo rules. Mood: rank parsing hardened (numeric coercion) so rank no longer shows “–” when the backend returns a string.
### v10.0.8
- Classic “Change Mode” guard Prevent Classic from auto-restarting when “Change Mode” is pressed. `showModePicker()` now freezes gameplay during selection and cancels Classic auto-start timers. `openClassicOpts()` and `restart()` honor a picking guard to avoid unintended starts.
### v10.0.9
- Classic: always show Timed/Relax picker (no auto-start). Login: saved name pre-fills; “Use previous name” button logs in directly.
### v10.1.0
- Splash audio fix AudioContext is now resumed immediately inside the splash tap/click handler (before timeouts), eliminating Chrome’s autoplay warnings. (minor)
### v10.1.1
- Accuracy fix — removed duplicate input handlers (mousePressed/touchStarted) and now compute accuracy using all pops, so displayed accuracy matches actual clicks. (minor)
### v10.1.2
- Leaderboard guard — debounce leaderboard fetches (5s) and show a fallback message if the proxy returns 429/failed, preventing blank summaries. (minor)
### v10.1.3
- Added bubble pop animations (shrink, fade, burst) with score flyout above bubble.
### v10.1.4
- Added pre-game **3-2-1-GO!** countdown before each round. Countdown pauses gameplay until finished, preventing early pops.
### v10.1.5
- Loading overlay polish: progress bar now fills step-by-step and reaches 100% before hiding. Ensures smoother transition into countdown and gameplay.
### v10.1.6
- Fix loading overlay (lingers 300 ms at 100%), hoist `loading` var (no ReferenceError), ensure Mood/Challenge spawn bubbles, and add 3 s fail-safe for iOS incognito dark-screen bug. (minor)
### v10.1.7
- Countdown polish — removed blank gap after loading (overlay hides after “3” shows), and added 3-2-1-GO before Play Again restarts. (minor)
### v10.1.8
- Mood mode polish — fixed premature overlay hide at ~60%, now shows 100% until first sample, overlay disappears exactly with “3” so no blank gap before countdown. (minor)
### v10.1.9
- Fix Mode Picker — Mood button on iOS no longer triggers Challenge; handler updated to allow Mood selection multiple times per session. (minor)
### v10.2.0
- Removed floating sound button (FAB).  
- Added “🔊 Sound on” checkbox in Mode Picker and Post-game modal.  
- Sound preference is stored in localStorage and applied each round via setSfx(). (minor)
### v10.3.0
- Adjust Mood Mode scoring system with higher multiplier.
- Adjust Mood Mode detection and indication system.
- Adjust Mood Mode popping animation.
### v10.3.1
- Pre-round polish — added short teal “Get Ready…” fade-in before 3-2-1 countdown on Play Again / Change Mode; clears previous game screen for a cleaner transition.
### v10.3.2
- UI polish — narrowed top-bar Quit button on mobile; adjusted bubble spawn Y-range to stay clear of top bar.
### v10.3.3
- Mobile tweak — compact top-bar “Quit” button on iPhone-width screens (≤430px) to prevent overflow.
### v10.3.4
- Top-bar layout — moved “Quit” into the center cluster (next to Mood chip) to keep Mode chip + Camera stable on the right; added phone-specific compact styling.
### v10.3.5
- Top-bar & post-game polish — Classic Relax grid respects safe top (no bubbles under header); Quit moved to center and compact on phones; Mode chip no longer overflows; post-game actions wrap to 2×2 on small screens.
### v10.3.6
- Classic options rename — “Relax” → “🌿 Endless Zen Mode”; “Timed” → “⏱️ 60-Second Sprint” (labels only; logic unchanged).
### v10.3.7
- Endless Classic — Relax is now truly non-stop: when all teal bubbles are cleared, a fresh board spawns automatically and the round continues until you tap Quit (Timed unchanged).
### v10.3.8
- UX & UI overhaul — added top-bar Quit button (visible in Relax/Endless), compact on phones; fixed bubbles spawning under top bar; centered Quit beside Mood chip without pushing Mode chip off-screen; ensured post-game buttons wrap neatly on small screens. 
- Classic updates — Relax renamed **🌿 Endless Zen Mode**, Timed renamed **⏱️ 60-Second Sprint** and reordered so Endless appears first. Relax is now truly endless, automatically refilling boards until the player quits. 
- Mode naming — UI-only rename: **Classic → Zen**, **Challenge → Focus**, **Mood → Emotion** (IDs unchanged; internal logic intact).
### v10.4.0
- Stabilizes Zen (Classic) mode flow: Options modal always shows, countdown gates gameplay, and the top bar only appears when a round actually starts. Also prevents “dark screen” by adding a safe background fallback.
### v10.4.1
- Leaderboard redesign — removed Mode column, retained Accuracy.  
  - Shows only Rank, Name, Score, and Accuracy.  
  - Player’s own row flashes teal if within Top 5.  
  - If player ranks outside Top 5, a 6th highlighted “You” row appears beneath the leaderboard.  
- Modal polish — replaced “Close” button with **Quit** for clearer exit intent.  
- Helper & consent copy refresh — renamed all remaining *Mood* references to **Emotion** to match UI display names (Zen / Focus / Emotion).  
- Added groundwork for “Player Stats” screen (session summary of last 5 games with average / high score).  
### v10.5.0
- Post-game UX fixes — guaranteed 3–2 action layout on wide screens (2 columns on small); no player stats shown on the leaderboard.
- Quit button reliability — automatically restored after **Play Again** and **Change Mode** across Zen/Endless and other modes.
- Stats modal flow — pressing **Close** returns to the post-game screen instead of leaving the UI blank.
- Leaderboard polish — shows only **Rank / Name / Score / Acc**; your row flashes teal when in Top 5, or appears as a 6th highlighted row if outside Top 5.
- Copy cleanup — helper text uses the new mode display names (Zen / Focus / Emotion); “Round complete” title remains static.

---
