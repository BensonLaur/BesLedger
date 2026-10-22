import { describe, expect, it } from 'vitest';
import { GitHub } from '../src/providers/github/client';
import { fixtureApp, fixtureInstallation, fixtureRepository } from './fixtures';

function harness() {
  let installation: Record<string, unknown> = structuredClone(fixtureInstallation);
  let repositories = [structuredClone(fixtureRepository)];
  let failCreate = false,
    createdPublic = false;
  const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
  const github = new GitHub(
    'ghu_fictionalApp',
    async (input, init) => {
      const path = new URL(String(input)).pathname,
        method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });
      if (path === '/user') return Response.json(fixtureRepository.owner);
      if (path === '/user/installations') return Response.json({ installations: [installation] });
      if (path === '/user/installations/11/repositories') return Response.json({ repositories });
      if (path === '/user/repos' && method === 'POST') {
        if (failCreate) return Response.json({}, { status: 422 });
        const repo = {
          ...fixtureRepository,
          id: 502,
          name: body.name,
          full_name: `fictional-owner/${body.name}`,
          private: !createdPublic,
        };
        repositories.push(repo);
        return Response.json(repo, { status: 201 });
      }
      const repo = repositories.find((r) => path === `/repos/${r.full_name}`);
      if (repo) return Response.json(repo);
      throw new Error('Unexpected endpoint in permission test');
    },
    fixtureApp,
  );
  return {
    github,
    calls,
    installation: (next: Record<string, unknown>) => {
      installation = { ...installation, ...next };
    },
    repositories: (next: typeof repositories) => {
      repositories = next;
    },
    failCreate: () => {
      failCreate = true;
    },
    createdPublic: () => {
      createdPublic = true;
    },
  };
}

describe('GitHub App 最小授权与专用仓库边界', () => {
  it('只枚举安装中选定的仓库，不调用账号级全部私有仓库列表', async () => {
    const f = harness();
    expect(await f.github.repositories()).toEqual([fixtureRepository]);
    expect(f.calls.some((c) => c.path === '/user/repos')).toBe(false);
    expect(f.calls.some((c) => c.path === '/user/installations/11/repositories')).toBe(true);
  });
  it.each([
    { repository_selection: 'all' },
    { permissions: { ...fixtureInstallation.permissions, administration: 'write' } },
    { permissions: { ...fixtureInstallation.permissions, workflows: 'write' } },
    { permissions: { ...fixtureInstallation.permissions, contents: 'read' } },
    { app_id: 999 },
    { account: { id: 99, login: 'unrelated' } },
    { suspended_at: '2026-10-22T00:00:00Z' },
  ])('拒绝超范围、错误归属或不可用的安装：%j', async (installation) => {
    const f = harness();
    f.installation(installation);
    await expect(f.github.createRepository('BesLedger-Data-new')).rejects.toThrow();
    expect(f.calls.some((c) => c.path === '/user/repos')).toBe(false);
    expect(f.calls.some((c) => c.path.includes('/contents/'))).toBe(false);
  });
  it.each([
    { ...fixtureRepository, name: 'unrelated-business' },
    { ...fixtureRepository, private: false },
    { ...fixtureRepository, owner: { id: 99, login: 'unrelated' } },
  ])('安装中混入无关/公开/非本人仓库时整体停止，不只隐藏列表项', async (repository) => {
    const f = harness();
    f.repositories([fixtureRepository, repository]);
    await expect(f.github.verifyPrivate('fictional-owner', 'BesLedger-Data-test', 42)).rejects.toThrow(
      '非专用或非私有',
    );
    expect(f.calls.some((c) => c.path.startsWith('/repos/'))).toBe(false);
  });
  it('合法前缀仍不能绕过安装授权，不触碰未选中仓库的文件', async () => {
    const f = harness();
    await expect(
      f.github.readLedger(
        'fictional-owner',
        'BesLedger-Data-unselected',
        '11111111-1111-4111-8111-111111111111',
        42,
      ),
    ).rejects.toThrow('未授予');
    expect(f.calls.some((c) => c.path.startsWith('/repos/'))).toBe(false);
  });
  it('已有安装可自动创建，读回新仓库授权与 private 后才成功（不证明零仓库首次安装）', async () => {
    const f = harness();
    f.repositories([]);
    expect((await f.github.createRepository('BesLedger-Data')).private).toBe(true);
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(f.calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'BesLedger-Data',
      private: true,
    });
    expect(f.calls.at(-1)!.path).toBe('/repos/fictional-owner/BesLedger-Data');
  });
  it('同名仓库未授权导致创建失败时不覆盖、不自动改名重建或申请更多权限', async () => {
    const f = harness();
    f.repositories([]);
    f.failCreate();
    await expect(f.github.createRepository('BesLedger-Data')).rejects.toThrow('同名仓库可能已存在但尚未授权');
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(f.calls.some((c) => c.method === 'PUT' || c.method === 'DELETE')).toBe(false);
  });
  it('创建返回公开仓库时拒绝继续，不上传任何账目', async () => {
    const f = harness();
    f.repositories([]);
    f.createdPublic();
    await expect(f.github.createRepository('BesLedger-Data')).rejects.toThrow('非私有');
    expect(f.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});
