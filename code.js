// === CONFIG ===
// const ALLOWED_ORIGINS = ['https://bubble-game-proxy.xoakuma.workers.dev']; // only allow your proxy to call this
const SECRET = 'should be pull from cloudflare worker';
const RUNS = 'Runs';
const PROFILES = 'Profiles';

// Small helper to return JSON
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- GET endpoints: top, checkUsername, profile ----
function doGet(e) {
  try {
    const qp = e && e.parameter ? e.parameter : {};
    const action = qp.action || 'top';
    const runs = sheet_(RUNS), profiles = sheet_(PROFILES);

    if (action === 'top') {
      const n = Math.min(parseInt(qp.n || '10', 10) || 10, 100);
      const rows = runs.getDataRange().getValues();
      const [header, ...data] = rows;
      // score at index 4 (timestamp,deviceId,username,mode,score,...)
      data.sort((a, b) => (b[4] ?? 0) - (a[4] ?? 0));
      const top = data.slice(0, n).map(r => ({
        timestamp: r[0], deviceId: r[1], username: r[2],
        mode: r[3], score: r[4], durationMs: r[5],
        bubblesPopped: r[6], accuracy: r[7], gameVersion: r[8],
        sessionId: r[9], runId: r[10]
      }));
      return json_({ ok: true, top });
    }

    if (action === 'checkUsername') {
      const username = (qp.username || '').trim();
      if (username.length < 3) return json_({ ok: false, error: 'too short' });
      const taken = findByValue_(profiles, 1, username); // col 1 = username
      return json_({ ok: true, available: !taken });
    }

    if (action === 'profile') {
      const deviceId = qp.deviceId || '';
      if (!deviceId) return json_({ ok: false, error: 'deviceId required' });
      const match = findByKey_(profiles, 0, deviceId); // col 0 = deviceId
      if (!match) return json_({ ok: true, profile: null });
      const v = match.values;
      return json_({
        ok: true,
        profile: {
          deviceId: v[0],
          username: v[1],
          gamesPlayed: v[2],
          bestScore: v[3],
          lastSeen: v[4],
          createdAt: v[5]
        }
      });
    }

    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ---- POST endpoints: setUsername, run (secret required) ----
function doPost(e) {
  try {
    const qp = e && e.parameter ? e.parameter : {};
    const secret = qp.secret || '';  // Worker adds ?secret=...
    if (secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    const body = JSON.parse(e.postData && e.postData.contents || '{}');
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
        deviceId, username, mode, score, durationMs,
        bubblesPopped, accuracy, gameVersion, sessionId, runId
      } = body;

      if (!deviceId || typeof score !== 'number') return json_({ ok: false, error: 'bad input' });

      runs.appendRow([
        new Date(), deviceId, username || '', mode || '', score,
        durationMs || '', bubblesPopped || '', accuracy || '',
        gameVersion || '', sessionId || '', runId || ''
      ]);

      const existing = findByKey_(profiles, 0, deviceId);
      const now = new Date();
      if (!existing) {
        profiles.appendRow([deviceId, username || '', 1, score, now, now]);
      } else {
        const { row, values } = existing;
        const gamesPlayed = (parseInt(values[2], 10) || 0) + 1;
        const bestScore = Math.max(parseInt(values[3], 10) || 0, score);
        const keepName = values[1] || username || '';
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
