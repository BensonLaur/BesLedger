import { describe, expect, it } from 'vitest';
import { GitHub, type Repository } from '../src/providers/github/client';
import { encode } from '../src/crypto/vault';
import { fixtureApp, fixtureInstallation, fixtureRepository } from './fixtures';

function harness() {
  let installation: Record<string, unknown> = {
    ...structuredClone(fixtureInstallation),
    repository_selection: 'all',
  };
  const repositories = new Map<string, { repo: Repository; marked: boolean }>();
  let publicCreation = false;
  const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
  const add = (name: string, marked = true, isPrivate = true) => {
    const repo = {
      ...structuredClone(fixtureRepository),
      id: 500 + repositories.size,
      name,
      full_name: `fictional-owner/${name}`,
      private: isPrivate,
    };
    repositories.set(name, { repo, marked });
    return repo;
  };
  const github = new GitHub(
    'ghu_fictionalApp',
    async (input, init) => {
      const path = new URL(String(input)).pathname,
        method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });
      if (path === '/user') return Response.json(fixtureRepository.owner);
      if (path === '/user/installations') return Response.json({ installations: [installation] });
      if (path === '/user/installations/11/repositories')
        return Response.json({ repositories: [...repositories.values()].map((x) => x.repo) });
      if (path === '/user/repos' && method === 'POST') {
        if (repositories.has(body.name)) return Response.json({}, { status: 422 });
        return Response.json(add(body.name, false, !publicCreation), { status: 201 });
      }
      const match = path.match(/^\/repos\/fictional-owner\/([^/]+)(.*)$/);
      if (!match) throw new Error('Unexpected endpoint');
      const item = repositories.get(match[1]),
        suffix = match[2];
      if (!item) return Response.json({}, { status: 404 });
      if (!suffix) return Response.json(item.repo);
      if (suffix === '/contents/besledger/repository.json') {
        if (method === 'PUT') {
          if (item.marked) return Response.json({}, { status: 422 });
          item.marked = true;
          return Response.json({ content: { sha: 'marker' } });
        }
        if (!item.marked) return Response.json({}, { status: 404 });
        const content = encode(
          new TextEncoder().encode(
            JSON.stringify({
              format: 'BesLedger.repository',
              version: 1,
              repositoryId: item.repo.id,
              ownerId: 42,
            }),
          ),
        );
        return Response.json({ content, encoding: 'base64', size: 120 });
      }
      if (suffix === '/contents') return Response.json([{ name: 'unrelated.txt', type: 'file' }]);
      throw new Error('Unexpected file access');
    },
    fixtureApp,
  );
  return {
    github,
    calls,
    add,
    installation: (next: Record<string, unknown>) => {
      installation = { ...installation, ...next };
    },
    publicCreation: () => {
      publicCreation = true;
    },
  };
}

describe('GitHub App 全部仓库安装下的自动准备与应用写入边界', () => {
  it('零现有仓库安装后自动创建、校验私有与标记，再次准备复用同一仓库', async () => {
    const f = harness();
    const repo = await f.github.prepareRepository();
    expect(repo.name).toBe('BesLedger-Data');
    expect(repo.private).toBe(true);
    expect((await f.github.prepareRepository()).id).toBe(repo.id);
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(f.calls.find((c) => c.method === 'POST')!.body).toMatchObject({ private: true });
    expect(f.calls.some((c) => c.path.includes('/user/installations/11/repositories'))).toBe(false);
    expect(f.calls.some((c) => c.path === '/user/repos' && c.method === 'GET')).toBe(false);
  });
  it.each([false, true])('同名其他用途仓库（公开=%s）不覆盖，自动采用稳定备用名称', async (isPublic) => {
    const f = harness();
    f.add('BesLedger-Data', false, !isPublic);
    expect((await f.github.prepareRepository()).name).toBe('BesLedger-Data-7');
    expect(
      f.calls.some((c) => c.method === 'PUT' && c.path.startsWith('/repos/fictional-owner/BesLedger-Data/')),
    ).toBe(false);
    expect(f.calls.some((c) => c.path.endsWith('unrelated.txt'))).toBe(false);
  });
  it('名称不是安全边界，任意有效名称的已标记账本均可复用', async () => {
    const f = harness();
    const repo = f.add('my-ledger-with-a-typo');
    expect((await f.github.prepareRepository([repo.name])).id).toBe(repo.id);
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(await f.github.repositories([repo.name])).toEqual([repo]);
  });
  it('新建的任意有效名称会初始化标记，不要求输入特定前缀', async () => {
    const f = harness();
    expect((await f.github.createRepository('personal-book')).name).toBe('personal-book');
    expect(f.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });
  it('账本前缀不构成授权，缺少标记和旧格式时禁止写流水', async () => {
    const f = harness();
    f.add('BesLedger-Data', false);
    await expect(
      f.github.writeLedger(
        'fictional-owner',
        'BesLedger-Data',
        '11111111-1111-4111-8111-111111111111',
        42,
        'encrypted',
      ),
    ).rejects.toThrow('尚未确认');
    expect(f.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
  it('已有绑定变成公开时停止，不悄悄切换到新空库', async () => {
    const f = harness();
    f.add('existing-book', true, false);
    await expect(f.github.prepareRepository(['existing-book'])).rejects.toThrow('不是私有');
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it.each([
    { repository_selection: 'invalid' },
    { permissions: { ...fixtureInstallation.permissions, administration: 'write' } },
    { permissions: { ...fixtureInstallation.permissions, workflows: 'write' } },
    { permissions: { ...fixtureInstallation.permissions, contents: 'read' } },
    { app_id: 999 },
    { account: { id: 99, login: 'unrelated' } },
    { suspended_at: '2026-10-22T00:00:00Z' },
  ])('仍拒绝额外能力、错误归属或不可用安装：%j', async (installation) => {
    const f = harness();
    f.installation(installation);
    await expect(f.github.prepareRepository()).rejects.toThrow();
    expect(f.calls.some((c) => c.method === 'POST' || c.path.includes('/contents'))).toBe(false);
  });
  it('选择仓库模式仍先检查选中成员，不访问未选中仓库文件', async () => {
    const f = harness();
    f.installation({ repository_selection: 'selected' });
    await expect(f.github.verifyPrivate('fictional-owner', 'unselected', 42)).rejects.toThrow('未授予');
    expect(f.calls.some((c) => c.path.startsWith('/repos/'))).toBe(false);
  });
  it('创建返回公开仓库时不写标记或账目', async () => {
    const f = harness();
    f.publicCreation();
    await expect(f.github.prepareRepository()).rejects.toThrow('不是私有');
    expect(f.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});
