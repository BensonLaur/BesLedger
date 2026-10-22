import { expect, it } from 'vitest';
import { nativeAuthorization } from '../src/providers/github/native-auth';
import { fixtureApp } from './fixtures';

it('原生设备授权直连 GitHub，仅请求离线续期并禁用重定向', async () => {
  const result = await nativeAuthorization(fixtureApp, 'device', {}, async (options) => {
    expect(options.url).toBe('https://github.com/login/device/code');
    expect(options.disableRedirects).toBe(true);
    expect(new URLSearchParams(options.data)).toEqual(
      new URLSearchParams({ client_id: fixtureApp.clientId, scope: 'offline_access' }),
    );
    return {
      status: 200,
      url: options.url,
      headers: {},
      data: { user_code: 'TEST-CODE', unexpected: 'discard' },
    };
  });
  expect(result).toEqual({ user_code: 'TEST-CODE', app: fixtureApp });
});
it('原生换取和续期均不传 client secret，保留 GitHub 失效错误供会话层判断', async () => {
  for (const [path, payload, grant] of [
    ['token', { device_code: 'fictional-device-code' }, 'urn:ietf:params:oauth:grant-type:device_code'],
    ['refresh', { refresh_token: 'fictional-refresh' }, 'refresh_token'],
  ] as const) {
    const reply = await nativeAuthorization(fixtureApp, path, payload, async (options) => {
      expect(options.url).toBe('https://github.com/login/oauth/access_token');
      const body = new URLSearchParams(options.data);
      expect(body.get('grant_type')).toBe(grant);
      expect(body.has('client_secret')).toBe(false);
      return { status: 400, url: options.url, headers: {}, data: { error: 'bad_refresh_token' } };
    });
    expect(reply.error).toBe('bad_refresh_token');
  }
});
it('拒绝任意路径、错误重定向与带敏感正文的服务异常，不将原响应暴露到错误信息', async () => {
  let calls = 0;
  await expect(
    nativeAuthorization(fixtureApp, 'https://unrelated.invalid', {}, async () => {
      calls++;
      throw new Error('Unexpected call');
    }),
  ).rejects.toThrow('不支持');
  expect(calls).toBe(0);
  await expect(
    nativeAuthorization(fixtureApp, 'device', {}, async () => ({
      status: 200,
      url: 'https://unrelated.invalid',
      headers: {},
      data: {},
    })),
  ).rejects.toThrow('暂时不可用');
  await expect(
    nativeAuthorization(fixtureApp, 'device', {}, async (options) => ({
      status: 503,
      url: options.url,
      headers: {},
      data: 'fictional-sensitive-data',
    })),
  ).rejects.toThrow('暂时不可用');
});
