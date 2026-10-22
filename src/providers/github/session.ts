import { z } from 'zod';
import { decrypt, encrypt } from '../../crypto/vault';
import type { CredentialBackend, StoredCredential } from '../../storage/credentials';
import { GitHub, type GitHubUser } from './client';
import { AuthorizationInvalid, tokensSchema, type AuthTokens } from './tokens';
import { githubApp, sameApp, type GitHubAppIdentity } from './app';

const userSchema = z.object({ id: z.number().int().positive(), login: z.string().min(1).max(100) });
const sessionSchema = z.object({
  version: z.literal(2),
  id: z.string().uuid(),
  user: userSchema,
  tokens: tokensSchema,
});
type Credential = z.infer<typeof sessionSchema>;
export type Login = { github: GitHub; user: GitHubUser };
const context = 'local-github-session';
let fallbackQueue: Promise<unknown> = Promise.resolve();
async function exclusive<T>(task: () => Promise<T>): Promise<T> {
  // Web Locks 覆盖同源多个窗口，避免同时使用会轮换的 refresh token。
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request('BesLedger.github-session.v1', task);
  const result = fallbackQueue.then(task);
  fallbackQueue = result.catch(() => undefined);
  return result;
}

export class GitHubSession {
  private key?: CryptoKey;
  private generation = 0;
  private sessionId?: string;
  private verifiedToken?: string;
  private channel?: BroadcastChannel;
  constructor(
    private disk: CredentialBackend,
    private renew: (token: string) => Promise<AuthTokens>,
    private changed: (login?: Login, message?: string) => void,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private now: () => number = Date.now,
    private expectedApp: GitHubAppIdentity | undefined = githubApp,
  ) {}
  observe(): void {
    if (typeof BroadcastChannel === 'undefined' || this.channel) return;
    this.channel = new BroadcastChannel('BesLedger.github-session.v1');
    this.channel.onmessage = () => {
      void this.reload().catch(() => {
        this.changed(undefined, '无法读取登录状态，请重试；本机凭证未删除');
      });
    };
  }
  dispose(): void {
    this.channel?.close();
    this.suspend();
  }
  private notify(): void {
    this.channel?.postMessage('changed');
  }
  private active(generation: number): void {
    if (!this.key || generation !== this.generation)
      throw new Error('账本已锁定或登录状态已改变，请解锁后重试');
  }
  private async read(key: CryptoKey): Promise<{ row: StoredCredential; value: Credential } | undefined> {
    const row = await this.disk.read();
    if (!row?.payload) return undefined;
    if (row.payload.length > 100_000) throw new Error('本机登录凭证格式无效，原数据已保留');
    let decoded: unknown;
    try {
      decoded = await decrypt(JSON.parse(row.payload), key, context);
    } catch {
      throw new Error('本机登录凭证无法解密，原数据已保留；可退出 GitHub 后重新连接');
    }
    // 旧 OAuth 的宽权限凭证不能在新版本中恢复，更不能拿来验证新安装。
    if (decoded && typeof decoded === 'object' && 'version' in decoded && decoded.version === 1) {
      if (!(await this.disk.compareSwap(row.revision, null))) return this.read(key);
      this.notify();
      this.changed(undefined, '已清除旧 OAuth 本机凭证，请改用 BesLedger Sync 登录；账目保持不变');
      return undefined;
    }
    const parsed = sessionSchema.safeParse(decoded);
    if (!parsed.success) throw new Error('本机登录格式无法识别，原数据已保留');
    if (!this.expectedApp) throw new Error('GitHub App 尚未配置，已暂停云端访问');
    if (!sameApp(parsed.data.tokens.app, this.expectedApp)) return this.invalidate(row);
    return { row, value: parsed.data };
  }
  private publish(value?: Credential, message?: string): void {
    const id = value?.id;
    this.sessionId = id;
    this.changed(
      value
        ? {
            user: value.user,
            github: new GitHub('', (input, init) => this.authorizedFetch(id!, input, init), value.tokens.app),
          }
        : undefined,
      message,
    );
  }
  async resume(key: CryptoKey): Promise<void> {
    this.suspend();
    this.key = key;
    await this.reload();
  }
  private async reload(): Promise<void> {
    if (!this.key) return;
    const generation = this.generation;
    const stored = await this.read(this.key);
    if (generation !== this.generation || !this.key) return;
    if (this.sessionId !== stored?.value.id) {
      this.generation++;
      this.verifiedToken = undefined;
    }
    // 离线也能恢复已保存身份；首次联网操作再核对令牌及 GitHub 数字用户 ID。
    this.publish(stored?.value);
  }
  suspend(): void {
    this.generation++;
    this.key = undefined;
    this.verifiedToken = undefined;
    this.publish();
  }
  async accept(tokens: AuthTokens, stillCurrent: () => boolean = () => true): Promise<void> {
    tokens = tokensSchema.parse(tokens);
    if (!sameApp(tokens.app, this.expectedApp)) throw new Error('此授权不属于配置的 GitHub App');
    const generation = this.generation,
      key = this.key;
    this.active(generation);
    const row = await this.disk.read();
    const user = userSchema.parse(await new GitHub(tokens.accessToken, this.transport).user());
    this.active(generation);
    if (!stillCurrent()) return;
    const value: Credential = {
      version: 2,
      id: crypto.randomUUID(),
      user,
      tokens: tokensSchema.parse(tokens),
    };
    const payload = JSON.stringify(await encrypt(value, key!, context));
    this.active(generation);
    if (!stillCurrent()) return;
    if (!(await this.disk.compareSwap(row?.revision ?? 0, payload)))
      throw new Error('另一个窗口已改变登录状态，请重试');
    this.notify();
    if (generation !== this.generation || !stillCurrent()) return;
    this.verifiedToken = tokens.accessToken;
    this.publish(value);
  }
  async logout(): Promise<void> {
    const oldId = this.sessionId,
      key = this.key;
    this.generation++;
    this.verifiedToken = undefined;
    this.publish();
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this.disk.read();
      if (row?.payload && key && oldId) {
        try {
          const value = sessionSchema.parse(await decrypt(JSON.parse(row.payload), key, context));
          if (value.id !== oldId) return; // 不清除另一窗口刚建立的新登录。
        } catch {
          /* 损坏凭证仍允许用户显式退出清除。 */
        }
      }
      if (await this.disk.compareSwap(row?.revision ?? 0, null)) {
        this.notify();
        return;
      }
    }
    throw new Error('尚未清除本机凭证，请重试退出；不能将本次退出视为成功');
  }
  private async invalidate(row: StoredCredential): Promise<never> {
    if (await this.disk.compareSwap(row.revision, null)) {
      this.generation++;
      this.verifiedToken = undefined;
      this.publish(undefined, 'GitHub 授权已失效，请重新登录；本地账目不受影响');
      this.notify();
    }
    throw new AuthorizationInvalid();
  }
  private async token(id: string, failedToken?: string) {
    return exclusive(async () => {
      const generation = this.generation,
        key = this.key;
      this.active(generation);
      let stored = await this.read(key!);
      this.active(generation);
      if (!stored || stored.value.id !== id) {
        await this.reload();
        throw new Error('此 GitHub 登录已退出或被替换');
      }
      const { tokens } = stored.value;
      const expired = tokens.expiresAt !== undefined && tokens.expiresAt <= this.now();
      const rejected = failedToken === tokens.accessToken;
      const nearExpiry = tokens.expiresAt !== undefined && tokens.expiresAt <= this.now() + 60_000;
      const canRefresh =
        tokens.refreshToken &&
        (tokens.refreshExpiresAt === undefined || tokens.refreshExpiresAt > this.now());
      if ((expired || rejected) && !canRefresh) return this.invalidate(stored.row);
      if (canRefresh && (nearExpiry || rejected)) {
        let next: AuthTokens;
        try {
          next = tokensSchema.parse(await this.renew(tokens.refreshToken!));
        } catch (error) {
          if (error instanceof AuthorizationInvalid) return this.invalidate(stored.row);
          throw error; // 超时、断网、限流、服务故障均保留登录。
        }
        const value = { ...stored.value, tokens: next };
        const payload = JSON.stringify(await encrypt(value, key!, context));
        // 轮换结果需落盘，即使期间锁定；退出墓碑的版本比较仍可阻止复活。
        if (!(await this.disk.compareSwap(stored.row.revision, payload)))
          throw new Error('登录状态已改变，本次续期结果未覆盖，请重试');
        stored = { row: { ...stored.row, revision: stored.row.revision + 1, payload }, value };
        this.notify();
      }
      this.active(generation);
      return stored;
    });
  }
  private async authorizedFetch(
    inputId: string,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const generation = this.generation;
    const request = (url: RequestInfo | URL, token: string, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('Accept', 'application/vnd.github+json');
      headers.set('X-GitHub-Api-Version', '2026-03-10');
      return this.transport(url, {
        ...options,
        headers,
        cache: 'no-store',
        credentials: 'omit',
        signal: options?.signal || AbortSignal.timeout(30000),
      });
    };
    let failed: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      this.active(generation);
      const stored = await this.token(inputId, failed),
        token = stored.value.tokens.accessToken;
      this.active(generation);
      if (this.verifiedToken !== token) {
        const identity = await request('https://api.github.com/user', token);
        this.active(generation);
        if (identity.status === 401) {
          if (attempt === 1) return this.invalidate(stored.row);
          failed = token;
          continue;
        }
        if (!identity.ok) return identity;
        const result = userSchema.safeParse(await identity.json());
        this.active(generation);
        if (!result.success || result.data.id !== stored.value.user.id) return this.invalidate(stored.row);
        this.verifiedToken = token;
      }
      const response = await request(input, token, init);
      this.active(generation);
      if (response.status !== 401) return response;
      if (attempt === 1) return this.invalidate(stored.row);
      failed = token;
    }
    throw new AuthorizationInvalid();
  }
}
