export default {
  async fetch(req, env) {
    // === configure ===
    const GAS_URL = env.GAS_URL;     // e.g. https://script.google.com/macros/s/AKfycb.../exec
    const GAS_SECRET = env.GAS_SECRET; // set in Worker Secrets
    const ALLOWED = [
      'http://127.0.0.1:5500',   // your dev origin
      'http://localhost:5500',
      'https://github.com/kpao2020/bubble-game'   // your production site (add when ready)
    ];

    const origin = req.headers.get('origin') || '';
    const allowOrigin = ALLOWED.includes(origin) ? origin : ALLOWED[0];
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const inUrl = new URL(req.url);
    const upstream = new URL(GAS_URL);
    upstream.search = inUrl.search; // keep ?action=... etc.

    const init = { method: req.method, headers: {} };

    if (req.method === 'GET') {
      // pass-through GET
    } else if (req.method === 'POST') {
      // add ?secret=... server-side, never expose in client
      upstream.searchParams.set('secret', GAS_SECRET);
      init.headers['Content-Type'] = 'application/json';
      init.body = await req.text();
    }

    const r = await fetch(upstream, init);
    // echo response with CORS headers
    const body = await r.text();
    const contentType = r.headers.get('Content-Type') || 'application/json';
    return new Response(body, { status: r.status, headers: { ...cors, 'Content-Type': contentType } });
  }
}