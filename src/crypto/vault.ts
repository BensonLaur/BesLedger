import { z } from 'zod';
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const base64 = z
  .string()
  .max(50_000_000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
export const envelopeSchema = z.object({ version: z.literal(1), iv: base64, ciphertext: base64 });
export type Envelope = z.infer<typeof envelopeSchema>;
export const keyHeaderSchema = z.object({
  version: z.literal(1),
  salt: base64,
  iterations: z.literal(600000),
  wrapped: envelopeSchema,
});
export type KeyHeader = z.infer<typeof keyHeaderSchema>;
export function encode(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export function recoveryText(raw: Uint8Array): string {
  return Array.from(raw)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export function parseRecovery(text: string): Uint8Array<ArrayBuffer> {
  const normalized = text.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('恢复密钥必须是完整的 64 位字符');
  return Uint8Array.from(normalized.match(/../g)!, (v) => parseInt(v, 16));
}
async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encrypt(value: unknown, key: CryptoKey, context: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`BesLedger:v1:${context}`) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { version: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
export async function decrypt<T = unknown>(input: unknown, key: CryptoKey, context: string): Promise<T> {
  const envelope = envelopeSchema.parse(input);
  const iv = decode(envelope.iv);
  if (iv.length !== 12) throw new Error('密文随机数长度无效');
  try {
    const data = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(`BesLedger:v1:${context}`) },
      key,
      decode(envelope.ciphertext),
    );
    return JSON.parse(decoder.decode(data)) as T;
  } catch {
    throw new Error('密钥不匹配或数据已损坏，原数据未改动');
  }
}
export async function wrapKey(raw: Uint8Array<ArrayBuffer>, password: string): Promise<KeyHeader> {
  if (password.length < 10) throw new Error('请设置至少 10 个字符的解锁口令');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    version: 1,
    iterations: 600000,
    salt: encode(salt),
    wrapped: await encrypt(encode(raw), await passwordKey(password, salt), 'master-key'),
  };
}
export async function unlockKey(
  input: unknown,
  password: string,
): Promise<{ key: CryptoKey; raw: Uint8Array<ArrayBuffer> }> {
  const header = keyHeaderSchema.parse(input);
  const salt = decode(header.salt);
  if (salt.length !== 16) throw new Error('密钥参数无效');
  const raw = decode(await decrypt<string>(header.wrapped, await passwordKey(password, salt), 'master-key'));
  if (raw.length !== 32) throw new Error('密钥长度无效');
  return { raw, key: await importKey(raw) };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export async function digest(value: unknown): Promise<string> {
  return recoveryText(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value)))),
  );
}
