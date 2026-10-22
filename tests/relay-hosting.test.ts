import { expect, it } from 'vitest';
import { createVercelRelay } from '../services/auth-relay/src/vercel';

const env = {
  GITHUB_CLIENT_ID: 'Iv1.fictional',
  GITHUB_APP_ID: '7',
  GITHUB_APP_SLUG: 'besledger-fixture',
  ALLOWED_ORIGINS: 'https://fictional.example',
};
function request(path: string, address = '192.0.2.1', origin = 'https://fictional.example') {
  return new Request(`https://relay.example${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': address,
      'CF-Connecting-IP': 'spoofed-constant',
    },
    body: '{}',
  });
}
it('托管健康检查无需用户登录，跨域预检不向 GitHub 发送请求', async () => {
  let calls = 0;
  const relay = createVercelRelay(async () => {
    calls++;
    throw new Error('Not expected');
  });
  for (const path of ['/', '/health', '/api/health']) {
    const response = await relay(new Request(`https://relay.example${path}`), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configured: true, app: { id: 7 } });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
  const unconfigured = await relay(new Request('https://relay.example/health'), {
    ...env,
    GITHUB_APP_ID: '',
  });
  expect(unconfigured.status).toBe(503);
  const preflight = await relay(
    new Request('https://relay.example/api/device', {
      method: 'OPTIONS',
      headers: { Origin: 'https://fictional.example' },
    }),
    env,
  );
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://fictional.example');
  expect((await relay(request('/device', undefined, 'https://untrusted.example'), env)).status).toBe(403);
  expect(calls).toBe(0);
});
it('新平台独立限制不同访客，保持固定 GitHub 上游和禁止重定向', async () => {
  const calls: string[] = [];
  const relay = createVercelRelay(async (url, init) => {
    calls.push(String(url));
    expect(init?.redirect).toBe('error');
    expect(String(init?.body)).toBe('client_id=Iv1.fictional&scope=offline_access');
    return Response.json({ user_code: 'TEST-CODE' });
  });
  for (let i = 0; i < 90; i++)
    expect((await relay(request('/api/device?endpoint=https://untrusted.example'), env)).status).toBe(200);
  expect((await relay(request('/device'), env)).status).toBe(429);
  expect((await relay(request('/device', '192.0.2.2'), env)).status).toBe(200);
  expect((await relay(request('/api/unrelated', '192.0.2.2'), env)).status).toBe(404);
  expect(new Set(calls)).toEqual(new Set(['https://github.com/login/device/code']));
});
