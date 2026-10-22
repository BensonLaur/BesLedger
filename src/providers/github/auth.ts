import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { AuthorizationInvalid, parseTokenReply, type AuthTokens } from './tokens';
const service = import.meta.env.VITE_AUTH_SERVICE as string | undefined;
export const authConfigured = !!service;
export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};
async function relay<T>(path: string, payload: unknown): Promise<T> {
  if (!service) throw new Error('生产授权服务尚未配置；当前版本不能完成 GitHub 登录');
  const url = new URL(service);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    throw new Error('授权服务必须使用 HTTPS');
  const response = await fetch(`${service.replace(/\/$/, '')}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`授权服务不可用（${response.status}）`);
  return response.json() as Promise<T>;
}
export async function startAuthorization(): Promise<DeviceCode> {
  const code = await relay<DeviceCode & { error?: string }>('device', {});
  if (
    code.error ||
    !code.device_code ||
    !code.user_code ||
    code.verification_uri !== 'https://github.com/login/device'
  )
    throw new Error('GitHub 无法创建授权请求，请检查应用注册及 Device Flow 开关');
  return code;
}
export async function openAuthorization(url: string): Promise<void> {
  if (url !== 'https://github.com/login/device') throw new Error('授权地址不受信任');
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}
export async function pollAuthorization(
  code: DeviceCode,
): Promise<{ tokens?: AuthTokens; interval?: number }> {
  const token = await relay<{ access_token?: string; scope?: string; error?: string; interval?: number }>(
    'token',
    { device_code: code.device_code },
  );
  if (token.error === 'authorization_pending') return {};
  if (token.error === 'slow_down') return { interval: token.interval || code.interval + 5 };
  if (token.error === 'access_denied') throw new Error('你已取消 GitHub 授权，可重新连接');
  if (token.error === 'expired_token') throw new Error('授权码已过期，请重新连接');
  if (!token.access_token) throw new Error('GitHub 授权失败，请重新连接');
  return { tokens: parseTokenReply(token) };
}
export async function refreshAuthorization(refreshToken: string): Promise<AuthTokens> {
  const reply = await relay<{ error?: string }>('refresh', { refresh_token: refreshToken });
  if (['bad_refresh_token', 'invalid_grant', 'expired_token', 'access_denied'].includes(reply.error || ''))
    throw new AuthorizationInvalid();
  if (reply.error) throw new Error('GitHub 暂时无法续期，请稍后重试；登录状态已保留');
  return parseTokenReply(reply);
}
