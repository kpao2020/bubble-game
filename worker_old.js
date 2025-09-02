// Cloudflare Worker: Bubble Game proxy -> Google Apps Script
export default {
  async fetch(request, env) {
    // --- CORS ---
    const incomingOrigin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowOrigin = allowed.includes(incomingOrigin) ? incomingOrigin : (allowed[0] || '*');
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Vary': 'Origin',
      'Cache-Control': 'no-store'
    };
    if (request.method === 'OPTIONS') {
      return new Response('', { status: 204, headers: cors });
    }

    // --- Forward to Apps Script ---
    if (!env.APPS_SCRIPT_URL || !env.SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'proxy not configured' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    const target = new URL(env.APPS_SCRIPT_URL);
    const selfUrl = new URL(request.url);

    // pass through query params (action, n, username, deviceId, etc.)
    for (const [k, v] of selfUrl.searchParams) target.searchParams.set(k, v);

    // add secret (query + header)
    target.searchParams.set('secret', env.SECRET);
    const init = { method: request.method, headers: { 'X-Game-Secret': env.SECRET } };

    if (request.method === 'POST') {
      init.headers['Content-Type'] = 'application/json';
      init.body = await request.text();
    }

    // fetch Apps Script
    const rs = await fetch(target.toString(), init);
    const body = await rs.text();

    // return as JSON with CORS
    return new Response(body, {
      status: rs.status,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
