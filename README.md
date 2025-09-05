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

## 📜 Version History
- **v1.0** → Initial game with bubble popping & mouse input
- **v3.2** → Added scoring & timer
- **v4.5** → Splash screen, Challenge & Bio mode
- **v5.6** → Bio emotion tuning, Sheets integration via Cloudflare Worker
- **v7.6** → Added login & end game screens
- **v8.0** → Baseline release with full mode flow & Sheets logging
- **v8.8.2** → Fixed Google Sheets variable order

(See full changelog in `sketch.js` header.)

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

