// ============================================================================
// Bubble Game Google Apps Script — v9.0
// - Runs sheet header order extended with feedbackBefore / feedbackAfter
// - Accepts optional feedback strings in POST body
// - Keeps "top" sorting by score (column index 8)
// ============================================================================

// === CONFIG ===
const SECRET   = '<redact>';  // Cloudflare Worker appends ?secret=...
const RUNS     = 'Runs';
const PROFILES = 'Profiles';

// Expected Runs header (0-based):
//  0 timestamp | 1 runId | 2 sessionId | 3 deviceId | 4 deviceType | 5 username |
//  6 mode | 7 gameVersion | 8 score | 9 durationMs | 10 bubblesPopped | 11 accuracy |
//  12 emoHappy | 13 emoSad | 14 emoAngry | 15 emoStressed | 16 emoNeutral |
//  17 feedbackBefore | 18 feedbackAfter

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const qp   = e && e.parameter ? e.parameter : {};
    const act  = qp.action || 'top';
    const runs = sheet_(RUNS), profiles = sheet_(PROFILES);

    if (act === 'leaderboard') return handleLeaderboard_(qp);

    if (act === 'top') {
      const n = Math.min(parseInt(qp.n || '10', 10) || 10, 100);
      const rows = runs.getDataRange().getValues();
      if (rows.length <= 1) return json_({ ok: true, top: [] });
      const [header, ...data] = rows;

      // score is index 8
      data.sort((a, b) => (Number(b[8]) || 0) - (Number(a[8]) || 0));
      const top = data.slice(0, n).map(r => ({
        timestamp:     r[0],
        runId:         r[1],
        sessionId:     r[2],
        deviceId:      r[3],
        deviceType:    r[4],
        username:      r[5],
        mode:          r[6],
        gameVersion:   r[7],
        score:         r[8],
        durationMs:    r[9],
        bubblesPopped: r[10],
        accuracy:      r[11],
        emoHappy:      r[12],
        emoSad:        r[13],
        emoAngry:      r[14],
        emoStressed:   r[15],
        emoNeutral:    r[16],
        feedbackBefore:r[17] || '',
        feedbackAfter: r[18] || ''
      }));
      return json_({ ok: true, top });
    }

    if (act === 'checkUsername') {
      const username = (qp.username || '').trim();
      const deviceId = qp.deviceId || '';
      if (username.length < 3) return json_({ ok: false, error: 'too short' });
      const taken = findByValue_(profiles, 1, username); // col 1 = username
      const available = !taken || (deviceId && taken.values[0] === deviceId);
      return json_({ ok: true, available });
    }

    if (act === 'profile') {
      const deviceId = qp.deviceId || '';
      if (!deviceId) return json_({ ok: false, error: 'deviceId required' });
      const match = findByKey_(profiles, 0, deviceId); // col 0 = deviceId
      if (!match) return json_({ ok: true, profile: null });
      const v = match.values;
      return json_({
        ok: true,
        profile: {
          deviceId:   v[0],
          username:   v[1],
          gamesPlayed:v[2],
          bestScore:  v[3],
          lastSeen:   v[4],
          createdAt:  v[5]
        }
      });
    }

    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const qp = e && e.parameter ? e.parameter : {};
    if ((qp.secret || '') !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    const body = JSON.parse(e.postData && e.postData.contents || '{}');
    
    // alias: submitRun -> run
    if ((body.action || '').toLowerCase() === 'submitrun') body.action = 'run';

    const runs = sheet_(RUNS), profiles = sheet_(PROFILES);

    if (body.action === 'setUsername') {
      const deviceId = body.deviceId || '';
      const username = (body.username || '').trim();
      if (!deviceId || username.length < 3) return json_({ ok: false, error: 'bad input' });

      const taken = findByValue_(profiles, 1, username); // username
      if (taken && taken.values[0] !== deviceId) return json_({ ok: false, error: 'name in use' });

      const existing = findByKey_(profiles, 0, deviceId);
      const now = new Date();
      if (!existing) {
        profiles.appendRow([deviceId, username, 0, 0, now, now]);
      } else {
        const { row, values } = existing;
        profiles.getRange(row + 1, 1, 1, 6)
          .setValues([[deviceId, username, values[2] || 0, values[3] || 0, now, values[5] || now]]);
      }
      return json_({ ok: true });
    }

    if (body.action === 'run') {
      const {
        runId, sessionId,
        deviceId, deviceType, username,
        mode, gameVersion,
        score, durationMs,
        bubblesPopped, accuracy,
        emoHappy, emoSad, emoAngry, emoStressed, emoNeutral,
        feedbackBefore, feedbackAfter   // ← optional strings
      } = body;

      if (!deviceId || typeof score !== 'number') return json_({ ok: false, error: 'bad input' });

      // Append EXACTLY in header order (timestamp is server-generated)
      runs.appendRow([
        new Date(),           // 0 timestamp
        runId || '',          // 1 runId
        sessionId || '',      // 2 sessionId
        deviceId,             // 3 deviceId
        deviceType || '',     // 4 deviceType
        username || '',       // 5 username
        mode || '',           // 6 mode
        gameVersion || '',    // 7 gameVersion
        score,                // 8 score
        durationMs || '',     // 9 durationMs
        bubblesPopped || '',  // 10 bubblesPopped
        accuracy || '',       // 11 accuracy
        emoHappy || '',       // 12 emoHappy
        emoSad || '',         // 13 emoSad
        emoAngry || '',       // 14 emoAngry
        emoStressed || '',    // 15 emoStressed
        emoNeutral || '',     // 16 emoNeutral
        feedbackBefore || '', // 17 feedbackBefore (new)
        feedbackAfter  || ''  // 18 feedbackAfter  (new)
      ]);

      // Upsert profile (unchanged)
      const existing = findByKey_(profiles, 0, deviceId);
      const now = new Date();
      if (!existing) {
        profiles.appendRow([deviceId, username || '', 1, score, now, now]);
      } else {
        const { row, values } = existing;
        const gamesPlayed = (parseInt(values[2], 10) || 0) + 1;
        const bestScore   = Math.max(parseInt(values[3], 10) || 0, score);
        const keepName    = values[1] || username || '';
        profiles.getRange(row + 1, 1, 1, 6)
          .setValues([[deviceId, keepName, gamesPlayed, bestScore, now, values[5] || now]]);
      }

      return json_({ ok: true });
    }

    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// v9.9.6 — unified leaderboard over Runs
function handleLeaderboard_(qp) {
  const runs = sheet_(RUNS);
  const limit = Math.max(1, Math.min(100, parseInt(qp.limit || qp.n || '5', 10) || 5));
  const userQ = (qp.username || '').trim();
  const modeQ = (qp.mode || '').trim().toLowerCase();   // NEW

  const rowsAll = runs.getDataRange().getValues();
  if (rowsAll.length <= 1) return json_({ ok: true, scores: [], me: null });

  const data = rowsAll.slice(1).map(r => ({
    ts:       r[0],
    username: (r[5] || '') + '',
    mode:     (r[6] || '') + '',
    score:    Number(r[8]) || 0,
    accuracy: Number(r[11]) || 0
  }));

  // NEW: filter by mode if provided
  const filtered = modeQ ? data.filter(x => x.mode.toLowerCase() === modeQ) : data;

  // Sort: score ↓, accuracy ↓, newest first
  filtered.sort((a, b) =>
    (b.score - a.score) ||
    (b.accuracy - a.accuracy) ||
    (new Date(b.ts).getTime() - new Date(a.ts).getTime())
  );

  const top = filtered.slice(0, limit).map(x => ({
    username: x.username,
    score: x.score,
    accuracy: x.accuracy,
    mode: x.mode
  }));

  let me = null;
  if (userQ) {
    const idx = filtered.findIndex(r => r.username === userQ);
    if (idx >= 0) me = { rank: idx + 1 };
  }

  return json_({ ok: true, scores: top, me });
}

// ---- Helpers ----
function sheet_(name) {
  return SpreadsheetApp.getActive().getSheetByName(name)
      || SpreadsheetApp.getActive().insertSheet(name);
}
function findByKey_(sheet, col, key) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) if (values[i][col] === key) return { row: i, values: values[i] };
  return null;
}
function findByValue_(sheet, col, val) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) if (values[i][col] === val) return { row: i, values: values[i] };
  return null;
}