export interface Env {
  GITHUB_CLIENT_ID: string;
  ALLOWED_ORIGINS: string;
}
export function createRelay(transport: typeof fetch = fetch) {
  const rates = new Map<string, { count: number; reset: number }>();
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET')
        return Response.json(
          { service: 'BesLedger OAuth device relay', configured: !!env.GITHUB_CLIENT_ID },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      const origin = request.headers.get('Origin') || '';
      const allowed = (env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!allowed.includes(origin)) return new Response('Origin denied', { status: 403 });
      const headers = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST' || !['/device', '/token', '/refresh'].includes(url.pathname))
        return new Response('Not found', { status: 404, headers });
      if (!env.GITHUB_CLIENT_ID)
        return Response.json({ error: 'app_not_configured' }, { status: 503, headers });
      if (Number(request.headers.get('Content-Length') || 0) > 8192)
        return new Response('Too large', { status: 413, headers });
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      const now = Date.now(),
        rate = rates.get(ip);
      if (rate && rate.reset > now && rate.count >= 90)
        return new Response('Slow down', { status: 429, headers });
      if (!rate || rate.reset <= now) rates.set(ip, { count: 1, reset: now + 60000 });
      else rate.count++;
      if (rates.size > 5000) for (const [key, r] of rates) if (r.reset < now) rates.delete(key);
      try {
        const text = await request.text();
        if (text.length > 8192) return new Response('Too large', { status: 413, headers });
        const body = JSON.parse(text || '{}') as Record<string, unknown>;
        const params = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID });
        let endpoint: string;
        if (url.pathname === '/device') {
          endpoint = 'https://github.com/login/device/code';
          params.set('scope', 'repo offline_access');
        } else if (url.pathname === '/refresh') {
          if (typeof body.refresh_token !== 'string' || !/^[a-zA-Z0-9_.-]{1,4096}$/.test(body.refresh_token))
            return new Response('Invalid refresh token', { status: 400, headers });
          endpoint = 'https://github.com/login/oauth/access_token';
          params.set('refresh_token', body.refresh_token);
          params.set('grant_type', 'refresh_token');
        } else {
          if (typeof body.device_code !== 'string' || !/^[a-zA-Z0-9_-]{10,200}$/.test(body.device_code))
            return new Response('Invalid device code', { status: 400, headers });
          endpoint = 'https://github.com/login/oauth/access_token';
          params.set('device_code', body.device_code);
          params.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
        }
        // 只转发固定授权端点，不接收账目、解密密钥或任意 URL；令牌不落盘、不记录。
        const upstream = await transport(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'BesLedger-Authorization',
          },
          body: params,
          signal: AbortSignal.timeout(15000),
        });
        if (!upstream.ok && upstream.status !== 400 && upstream.status !== 401)
          return Response.json({ error: 'github_unavailable' }, { status: 502, headers });
        const data = (await upstream.json()) as Record<string, unknown>;
        const allowedKeys = [
          'device_code',
          'user_code',
          'verification_uri',
          'expires_in',
          'interval',
          'access_token',
          'refresh_token',
          'refresh_token_expires_in',
          'token_type',
          'scope',
          'error',
        ];
        return Response.json(
          Object.fromEntries(Object.entries(data).filter(([key]) => allowedKeys.includes(key))),
          { headers },
        );
      } catch {
        return Response.json({ error: 'authorization_request_failed' }, { status: 502, headers });
      }
    },
  };
}
export default createRelay();
