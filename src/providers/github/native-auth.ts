import type { HttpOptions, HttpResponse } from '@capacitor/core';
import type { GitHubAppIdentity } from './app';

export async function nativeAuthorization(
  app: GitHubAppIdentity,
  path: string,
  payload: Record<string, unknown>,
  post: (options: HttpOptions) => Promise<HttpResponse>,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ client_id: app.clientId });
  let url: string;
  if (path === 'device') {
    url = 'https://github.com/login/device/code';
    params.set('scope', 'offline_access');
  } else if (path === 'token') {
    if (typeof payload.device_code !== 'string' || !/^[a-zA-Z0-9_-]{10,200}$/.test(payload.device_code))
      throw new Error('设备授权码格式无效');
    url = 'https://github.com/login/oauth/access_token';
    params.set('device_code', payload.device_code);
    params.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
  } else if (path === 'refresh') {
    if (typeof payload.refresh_token !== 'string' || !/^[a-zA-Z0-9_.-]{1,4096}$/.test(payload.refresh_token))
      throw new Error('登录续期材料格式无效');
    url = 'https://github.com/login/oauth/access_token';
    params.set('refresh_token', payload.refresh_token);
    params.set('grant_type', 'refresh_token');
  } else throw new Error('不支持的授权操作');
  // 原生直连固定 GitHub 端点，不经中转或任意重定向；桥接日志在应用配置中关闭。
  let response: HttpResponse;
  try {
    response = await post({
      url,
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      data: params.toString(),
      responseType: 'json',
      connectTimeout: 15000,
      readTimeout: 15000,
      disableRedirects: true,
    });
  } catch {
    throw new Error('无法连接 GitHub，请检查网络后重试；登录状态已保留');
  }
  if (![200, 400, 401].includes(response.status) || response.url !== url)
    throw new Error('GitHub 授权服务暂时不可用，请稍后重试');
  let data: unknown = response.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error('GitHub 授权响应格式无效');
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('GitHub 授权响应格式无效');
  const allowed = [
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
  return { ...Object.fromEntries(Object.entries(data).filter(([key]) => allowed.includes(key))), app };
}
