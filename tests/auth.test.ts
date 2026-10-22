import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { GitHubSession, type Login } from '../src/providers/github/session';
import { AuthorizationInvalid, parseTokenReply, type AuthTokens } from '../src/providers/github/tokens';
import { WebCredentialBackend } from '../src/storage/credentials';
import { WebBackend } from '../src/storage/backend';
import { Vault } from '../src/storage/vault';
import { decrypt, encrypt } from '../src/crypto/vault';
import { createRelay } from '../services/auth-relay/src/index';
import { fixtureApp, fixtureInstallation } from './fixtures';

const password = 'fictional-auth-test-password';
const original: AuthTokens = {
  accessToken: 'ghu_fictionalAccess',
  app: fixtureApp,
  refreshToken: 'fictional-refresh',
  expiresAt: 100_000,
  refreshExpiresAt: 900_000,
};
const rotated: AuthTokens = {
  accessToken: 'ghu_fictionalAccessNext',
  app: fixtureApp,
  refreshToken: 'fictional-refresh-next',
  expiresAt: 800_000,
  refreshExpiresAt: 2_000_000,
};
const user = { id: 42, login: 'fictional-user' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup() {
  const vaultDisk = new WebBackend(crypto.randomUUID());
  const disk = new WebCredentialBackend(crypto.randomUUID());
  const vault = new Vault(vaultDisk);
  await vault.create(password);
  let login: Login | undefined,
    clock = 0,
    status = 200,
    offline = false,
    identity = user,
    renewCount = 0;
  const sent: string[] = [];
  let renew = async (_token: string): Promise<AuthTokens> => rotated;
  const transport: typeof fetch = async (input, init) => {
    if (offline) throw new TypeError('模拟断网');
    sent.push(new Headers(init?.headers).get('Authorization') || '');
    if (status !== 200) return Response.json({}, { status });
    const path = new URL(String(input)).pathname;
    if (path === '/user/installations')
      return Response.json({ installations: [{ ...fixtureInstallation, account: identity }] });
    if (path === '/user/installations/11/repositories') return Response.json({ repositories: [] });
    return Response.json(path === '/user' ? identity : []);
  };
  const build = () =>
    new GitHubSession(
      disk,
      async (token) => {
        renewCount++;
        return renew(token);
      },
      (value) => {
        login = value;
      },
      transport,
      () => clock,
      fixtureApp,
    );
  const session = build();
  await session.resume(await vault.credentialKey());
  await session.accept(original);
  return {
    disk,
    vault,
    vaultDisk,
    session,
    build,
    sent,
    get login() {
      return login;
    },
    get renewCount() {
      return renewCount;
    },
    clock: (value: number) => {
      clock = value;
    },
    status: (value: number) => {
      status = value;
    },
    offline: (value: boolean) => {
      offline = value;
    },
    identity: (value: typeof user) => {
      identity = value;
    },
    renew: (value: typeof renew) => {
      renew = value;
    },
  };
}

describe('受保护的 GitHub 登录状态', () => {
  it('旧 OAuth 凭证迁移时清除，绝不向 GitHub 发送旧令牌，账目不受影响', async () => {
    const f = await setup();
    const row = (await f.disk.read())!,
      key = await f.vault.credentialKey();
    const old = await decrypt<Record<string, unknown>>(JSON.parse(row.payload!), key, 'local-github-session');
    old.version = 1;
    old.tokens = { accessToken: 'gho_fictionalOldOAuth', refreshToken: 'fictional-refresh' };
    await f.disk.compareSwap(row.revision, JSON.stringify(await encrypt(old, key, 'local-github-session')));
    f.sent.length = 0;
    await f.session.resume(key);
    expect(f.login).toBeUndefined();
    expect((await f.disk.read())!.payload).toBeNull();
    expect(f.sent).toHaveLength(0);
    expect(f.vault.state).toBeTruthy();
  });
  it('独立密文保存；刷新、进程重建、锁定解锁及离线不需要重新授权，备份不携带凭证', async () => {
    const f = await setup();
    const row = (await f.disk.read())!;
    expect(row.payload).not.toContain('fictional-');
    await expect(
      decrypt(JSON.parse(row.payload!), f.vault.encryptionKey, 'local-github-session'),
    ).rejects.toThrow();
    const backup = JSON.parse(await f.vault.exportBackup());
    const business = await decrypt(backup.data, f.vault.encryptionKey, 'local-state');
    expect(JSON.stringify(business)).not.toContain('fictional-');
    f.session.suspend();
    f.vault.lock();
    expect(f.login).toBeUndefined();
    expect((await f.disk.read())!.payload).toBe(row.payload);
    const restartedVault = new Vault(f.vaultDisk),
      restartedSession = f.build();
    await restartedVault.unlock(password);
    f.offline(true);
    await restartedSession.resume(await restartedVault.credentialKey());
    expect(f.login?.user).toEqual(user);
    await expect(f.login!.github.repositories()).rejects.toThrow('断网');
    expect((await f.disk.read())!.payload).toBe(row.payload);
    f.offline(false);
    await expect(f.login!.github.repositories()).resolves.toEqual([]);
    expect(f.renewCount).toBe(0);
  });

  it.each([403, 429, 500, 503])('HTTP %s 不删除已保存登录', async (status) => {
    const f = await setup();
    f.status(status);
    await expect(f.login!.github.repositories()).rejects.toThrow();
    expect((await f.disk.read())!.payload).toBeTruthy();
    expect(f.login?.user.id).toBe(42);
  });

  it('令牌自动续期并原子保存轮换结果；多个实例同时使用只续期一次', async () => {
    const f = await setup();
    f.clock(70_000);
    const a = f.login!,
      another = f.build();
    await another.resume(await f.vault.credentialKey());
    const b = f.login!;
    await Promise.all([a.github.repositories(), b.github.repositories()]);
    expect(f.renewCount).toBe(1);
    expect(f.sent.at(-1)).toBe('Bearer ghu_fictionalAccessNext');
    f.session.suspend();
    another.suspend();
    const fresh = f.build();
    await fresh.resume(await f.vault.credentialKey());
    await f.login!.github.repositories();
    expect(f.renewCount).toBe(1);
  });

  it('401 先尝试续期，已被撤销的 refresh token 清除本机登录且不修改账目', async () => {
    const f = await setup();
    const originalVault = await f.vaultDisk.read();
    f.status(401);
    f.renew(async () => {
      throw new AuthorizationInvalid();
    });
    await expect(f.login!.github.repositories()).rejects.toThrow('授权已失效');
    expect(f.renewCount).toBe(1);
    expect((await f.disk.read())!.payload).toBeNull();
    expect(f.login).toBeUndefined();
    expect(await f.vaultDisk.read()).toEqual(originalVault);
    await f.session.resume(await f.vault.credentialKey());
    expect(f.login).toBeUndefined();
  });

  it('兼容旧式无 refresh token 的授权；仅真实 401 才清除', async () => {
    const f = await setup();
    await f.session.accept({ accessToken: 'ghu_fictionalNonExpiring', app: fixtureApp });
    f.session.suspend();
    await f.session.resume(await f.vault.credentialKey());
    await f.login!.github.repositories();
    f.status(401);
    await expect(f.login!.github.repositories()).rejects.toThrow('授权已失效');
    expect(f.renewCount).toBe(0);
    expect((await f.disk.read())!.payload).toBeNull();
  });

  it('暂时续期失败保留凭证，恢复网络后能够继续', async () => {
    const f = await setup();
    f.clock(110_000);
    f.renew(async () => {
      throw new TypeError('模拟服务不可达');
    });
    const row = await f.disk.read();
    await expect(f.login!.github.repositories()).rejects.toThrow('不可达');
    expect(await f.disk.read()).toEqual(row);
    f.renew(async () => rotated);
    await f.login!.github.repositories();
    expect(f.sent.at(-1)).toBe('Bearer ghu_fictionalAccessNext');
  });

  it('退出期间的迟到续期不能复活登录，旧客户端也不能继续访问', async () => {
    const f = await setup(),
      begin = deferred<void>(),
      finish = deferred<AuthTokens>();
    f.clock(70_000);
    f.renew(async () => {
      begin.resolve();
      return finish.promise;
    });
    const oldClient = f.login!.github;
    const request = oldClient.repositories();
    const rejected = expect(request).rejects.toThrow('登录状态已改变');
    await begin.promise;
    await f.session.logout();
    finish.resolve(rotated);
    await rejected;
    expect((await f.disk.read())!.payload).toBeNull();
    await expect(oldClient.repositories()).rejects.toThrow();
    await f.session.resume(await f.vault.credentialKey());
    expect(f.login).toBeUndefined();
  });

  it('锁定期间迟到的轮换只更新密文，不解锁 UI；再次解锁继续使用新令牌', async () => {
    const f = await setup(),
      begin = deferred<void>(),
      finish = deferred<AuthTokens>();
    f.clock(70_000);
    f.renew(async () => {
      begin.resolve();
      return finish.promise;
    });
    const pending = expect(f.login!.github.repositories()).rejects.toThrow('锁定');
    await begin.promise;
    f.session.suspend();
    f.vault.lock();
    finish.resolve(rotated);
    await pending;
    expect(f.login).toBeUndefined();
    await f.vault.unlock(password);
    await f.session.resume(await f.vault.credentialKey());
    await f.login!.github.repositories();
    expect(f.renewCount).toBe(1);
  });

  it('恢复后验证数字用户身份，账号不匹配时阻止访问原仓库', async () => {
    const f = await setup();
    f.session.suspend();
    f.identity({ id: 99, login: 'fictional-other' });
    await f.session.resume(await f.vault.credentialKey());
    await expect(f.login!.github.repositories()).rejects.toThrow('授权已失效');
    expect((await f.disk.read())!.payload).toBeNull();
  });

  it('损坏凭证保留待处理，不影响本地账目；用户可显式退出清除', async () => {
    const f = await setup();
    const row = (await f.disk.read())!;
    await f.disk.compareSwap(row.revision, '{broken');
    await expect(f.session.resume(await f.vault.credentialKey())).rejects.toThrow('无法解密');
    expect((await f.disk.read())!.payload).toBe('{broken');
    expect(f.vault.state).toBeTruthy();
    await f.session.logout();
    expect((await f.disk.read())!.payload).toBeNull();
  });

  it('登录保存失败不显示成功；取消或锁定时的迟到登录不保存', async () => {
    const f = await setup();
    await f.session.logout();
    const gate = deferred<Response>();
    let login: Login | undefined;
    const session = new GitHubSession(
      f.disk,
      async () => rotated,
      (v) => {
        login = v;
      },
      async () => gate.promise,
      Date.now,
      fixtureApp,
    );
    await session.resume(await f.vault.credentialKey());
    const pending = expect(session.accept(original)).rejects.toThrow('锁定');
    session.suspend();
    gate.resolve(Response.json(user));
    await pending;
    expect(login).toBeUndefined();
    expect((await f.disk.read())!.payload).toBeNull();
    const broken = new GitHubSession(
      {
        read: () => f.disk.read(),
        compareSwap: async () => {
          throw new Error('模拟磁盘写入失败');
        },
      },
      async () => rotated,
      (v) => {
        login = v;
      },
      async () => Response.json(user),
      Date.now,
      fixtureApp,
    );
    await broken.resume(await f.vault.credentialKey());
    await expect(broken.accept(original)).rejects.toThrow('写入失败');
    expect(login).toBeUndefined();
  });
});

describe('续期协议与服务隔离', () => {
  it('校验 GitHub App 身份及有效期，拒绝 repo 范围和旧 OAuth 凭证', () => {
    expect(
      parseTokenReply({ access_token: 'ghu_fictionalAccess', scope: '', app: fixtureApp }, 100, fixtureApp),
    ).toEqual({
      accessToken: 'ghu_fictionalAccess',
      app: fixtureApp,
    });
    expect(
      parseTokenReply(
        {
          access_token: 'ghu_fictionalAccess',
          refresh_token: 'fictional-refresh',
          expires_in: 20,
          refresh_token_expires_in: 30,
          scope: '',
          app: fixtureApp,
        },
        100,
        fixtureApp,
      ),
    ).toMatchObject({ expiresAt: 20_100, refreshExpiresAt: 30_100 });
    expect(() =>
      parseTokenReply({ access_token: 'gho_fictionalOld', scope: 'repo', app: fixtureApp }, 100, fixtureApp),
    ).toThrow('最小权限');
    expect(() =>
      parseTokenReply(
        { access_token: 'fictional-secret\ninvalid', scope: '', app: fixtureApp },
        100,
        fixtureApp,
      ),
    ).toThrow('格式无效');
  });
  it('续期只转发固定 client ID/端点/参数，保留轮换字段并剔除秘密和未知字段', async () => {
    const calls: { url: string; body: string }[] = [];
    const relay = createRelay(async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return Response.json({
        access_token: 'fictional-next',
        refresh_token: 'fictional-next-refresh',
        expires_in: 60,
        refresh_token_expires_in: 120,
        scope: '',
        client_secret: 'fictional-forbidden',
      });
    });
    const result = await relay.fetch(
      new Request('https://relay.example/refresh', {
        method: 'POST',
        headers: { Origin: 'https://app.example' },
        body: JSON.stringify({
          refresh_token: 'fictional-refresh',
          client_id: 'attacker',
          endpoint: 'https://attacker.example',
        }),
      }),
      {
        GITHUB_CLIENT_ID: 'Iv1.fixed',
        GITHUB_APP_ID: '7',
        GITHUB_APP_SLUG: 'besledger-fixture',
        ALLOWED_ORIGINS: 'https://app.example',
      },
    );
    expect(calls).toEqual([
      {
        url: 'https://github.com/login/oauth/access_token',
        body: 'client_id=Iv1.fixed&refresh_token=fictional-refresh&grant_type=refresh_token',
      },
    ]);
    const data = await result.json();
    expect(data.refresh_token).toBe('fictional-next-refresh');
    expect(data.client_secret).toBeUndefined();
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
});
