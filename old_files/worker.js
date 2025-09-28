export default {
  async fetch(req, env) {
    // === configure ===
    const GAS_URL = env.GAS_URL;        // e.g. https://script.google.com/macros/s/AKfycb.../exec
    const GAS_SECRET = env.GAS_SECRET;  // set as a Worker Secret

    // Allow localhost (dev) and your GitHub Pages origin (prod)
    const ALLOWED_HOSTS = new Set([
      '127.0.0.1:5500',
      'localhost:5500',
      'kpao2020.github.io'            // ← your production origin
    ]);

    const origin = req.headers.get('origin') || '';
    let allowOrigin = '';
    try {
      const u = new URL(origin);
      if (ALLOWED_HOSTS.has(u.host)) allowOrigin = `${u.protocol}//${u.host}`;
    } catch {}
    // Default to your prod origin if we didn't match
    if (!allowOrigin) allowOrigin = 'https://kpao2020.github.io';

    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Build upstream request to Apps Script
    const url = new URL(GAS_URL);
    const incoming = new URL(req.url);
    // forward query (?action=..., &username=..., &deviceId=...)
    for (const [k, v] of incoming.searchParams) url.searchParams.set(k, v);

    // v9.9.6 — normalize ?limit -> ?n for older GAS handlers (no-op if not present)
    const limit = incoming.searchParams.get('limit');
    const hasN  = incoming.searchParams.has('n');
    if (limit && !hasN) url.searchParams.set('n', limit);

    const init = { method: req.method, headers: {} };

    if (req.method === 'GET') {
      // pass-through
    } else if (req.method === 'POST') {
      // append secret server-side
      url.searchParams.set('secret', GAS_SECRET);
      init.headers['Content-Type'] = 'application/json';
      init.body = await req.text();
    }

    const upstreamResp = await fetch(url, init);
    const body = await upstreamResp.text();
    const contentType = upstreamResp.headers.get('Content-Type') || 'application/json';

    return new Response(body, {
      status: upstreamResp.status,
      headers: { ...cors, 'Content-Type': contentType }
    });
  }
}
