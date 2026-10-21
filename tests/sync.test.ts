import { expect, it, describe } from 'vitest';
import { fixture, entry } from './fixtures';
import { put, type Binding, type Entity } from '../src/domain/model';
import { saveEntry, deleteEntry } from '../src/domain/ledger';
import { ledgerProjection, mergeEntities, resolveConflict, mainStatus } from '../src/sync/merge';
import { syncLedger } from '../src/sync/engine';
import { GitHub } from '../src/providers/github/client';
import { decode, encode, importKey } from '../src/crypto/vault';
import { createRelay } from '../services/auth-relay/src/index';

describe('并发与同步边界', () => {
  it('两端独立生成同一期次能够收敛，自动游标推进不制造规则冲突', () => {
    const a = fixture(),
      b = structuredClone(a);
    b.deviceId = 'device-b';
    const data = entry(a, { source: { ruleId: 'rule-a', occurrence: '2026-10-20' } });
    saveEntry(a, data, 'period-a', false);
    saveEntry(b, { ...data, createdAt: '2026-10-22T12:00:00' }, 'period-a', false);
    const ab = mergeEntities(a.entities, b.entities),
      ba = mergeEntities(b.entities, a.entities);
    expect(ab.conflicts).toEqual([]);
    expect(ab.entities['period-a']).toEqual(ba.entities['period-a']);
    const rule = {
      kind: 'rule' as const,
      ledgerId: a.preferences.currentLedger,
      name: '虚构周期',
      start: '2026-10-01',
      cursor: '2026-10-21',
      frequency: 'daily' as const,
      paused: false,
      time: '12:00',
      template: entry(a),
    };
    put(a, rule, 'rule-a');
    put(b, { ...rule, cursor: '2026-10-22' }, 'rule-a');
    const merged = mergeEntities(a.entities, b.entities);
    expect(merged.conflicts).toEqual([]);
    expect(merged.entities['rule-a'].data).toMatchObject({ cursor: '2026-10-22' });
  });
  it('删除账本遇到另一端新流水必须确认，选择删除后不再复活', () => {
    const a = fixture(),
      b = structuredClone(a);
    b.deviceId = 'device-b';
    const id = a.preferences.currentLedger;
    put(a, a.entities[id].data, id, true);
    saveEntry(b, entry(b), 'offline-new');
    const result = mergeEntities(a.entities, b.entities);
    expect(result.conflicts[0].reason).toContain('未同步记录');
    resolveConflict(a, result.conflicts[0], 'local');
    const retry = mergeEntities(b.entities, a.entities);
    expect(retry.conflicts).toEqual([]);
    expect(retry.entities['offline-new'].deleted).toBe(true);
  });
  it('独立记录自动合并，同笔修改与删除保留冲突，显式选择能推进因果版本', () => {
    const a = fixture();
    const e = saveEntry(a, entry(a));
    const b = structuredClone(a);
    b.deviceId = 'device-b';
    saveEntry(a, { ...e.data, amount: 2000 }, e.id);
    deleteEntry(b, e.id);
    const conflict = mergeEntities(a.entities, b.entities).conflicts;
    expect(conflict).toHaveLength(1);
    expect(conflict[0].reason).toContain('删除');
    resolveConflict(a, conflict[0], 'remote');
    expect(mergeEntities(b.entities, a.entities).entities[e.id].deleted).toBe(true);
    expect(mergeEntities(a.entities, b.entities).conflicts).toEqual([]);
    saveEntry(a, entry(a), 'new-a');
    saveEntry(b, entry(b), 'new-b');
    const result = mergeEntities(a.entities, b.entities);
    expect(result.entities['new-a']).toBeDefined();
    expect(result.entities['new-b']).toBeDefined();
  });
  it('只投影当前账本与引用账户，不泄露另一本本地账或完整余额', () => {
    const a = fixture();
    saveEntry(a, entry(a), 'visible');
    put(a, { kind: 'ledger', name: '仅本地测试' }, 'local-only');
    saveEntry(a, entry(a, { ledgerId: 'local-only', note: '不应上传的虚构记录', amount: 600000 }), 'hidden');
    const projection = ledgerProjection(a, a.preferences.currentLedger);
    expect(projection.hidden).toBeUndefined();
    expect(projection['local-only']).toBeUndefined();
    expect(projection.cash).toBeDefined();
    expect(projection.bank).toBeUndefined();
    expect(JSON.stringify(projection)).not.toContain('不应上传');
    expect(mainStatus(true, false, true)).toBe('仅本地');
    expect(mainStatus(false, true, false)).toBe('仅云端');
    expect(mainStatus(true, true, true)).toBe('待同步');
    expect(mainStatus(true, true, false)).toBe('已同步');
  });
  it('实际协议处理写入响应丢失、重试、双端修改、权限失效和仓库公开', async () => {
    let content: string | undefined,
      version = 0,
      loseResponse = false,
      publicRepo = false,
      expired = false,
      writes = 0;
    const transport: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (expired) return Response.json({}, { status: 401 });
      if (path === '/user') return Response.json({ id: 42, login: 'fictional-owner' });
      if (path.endsWith('/BesLedger-Data-test'))
        return Response.json({
          private: !publicRepo,
          owner: { id: 42, login: 'fictional-owner' },
          permissions: { push: true },
        });
      if (path.includes('/contents/')) {
        if (init?.method === 'PUT') {
          const data = JSON.parse(String(init.body));
          if ((content ? String(version) : undefined) !== data.sha) return Response.json({}, { status: 409 });
          content = data.content;
          version++;
          writes++;
          if (loseResponse) {
            loseResponse = false;
            throw new TypeError('模拟写入成功后断线');
          }
          return Response.json({ content: { sha: String(version) } });
        }
        return content
          ? Response.json({ sha: String(version), content, encoding: 'base64', size: content.length })
          : Response.json({}, { status: 404 });
      }
      throw new Error('unexpected path');
    };
    const github = new GitHub('fictional-test-credential', transport),
      key = await importKey(crypto.getRandomValues(new Uint8Array(32)));
    const a = fixture(),
      id = a.preferences.currentLedger;
    saveEntry(a, entry(a), 'first');
    let binding: Binding = {
      owner: 'fictional-owner',
      repo: 'BesLedger-Data-test',
      userId: 42,
      remoteExists: false,
    };
    loseResponse = true;
    await expect(syncLedger(a, id, binding, key, github)).rejects.toThrow('断线');
    const retry = await syncLedger(a, id, binding, key, github);
    binding = retry.binding;
    expect(writes).toBe(1);
    expect(binding.remoteExists).toBe(true);
    expect(new TextDecoder().decode(decode(content!))).not.toContain('完全虚构测试');
    const b = structuredClone(a);
    b.deviceId = 'device-b';
    saveEntry(b, entry(b, { amount: 1234 }), 'second');
    const second = await syncLedger(b, id, binding, key, github);
    const third = await syncLedger(a, id, binding, key, github);
    expect(third.entities.second.data.kind).toBe('entry');
    expect(third.binding.syncedDigest).toBe(second.binding.syncedDigest);
    expired = true;
    await expect(syncLedger(a, id, binding, key, github)).rejects.toThrow('授权已失效');
    expired = false;
    publicRepo = true;
    const before = writes;
    await expect(syncLedger(a, id, binding, key, github)).rejects.toThrow('不是私有');
    expect(writes).toBe(before);
  });
});
describe('授权服务隔离', () => {
  it('拒绝非白名单来源和任意授权目标；固定客户端与 repo 权限，不透传秘密字段', async () => {
    const calls: { url: string; body: string }[] = [];
    const relay = createRelay(async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return Response.json({
        device_code: 'fictional-device',
        user_code: 'ABCD-EFGH',
        client_secret: 'not-for-client',
      });
    });
    const env = { GITHUB_CLIENT_ID: 'public-client-id', ALLOWED_ORIGINS: 'https://fictional.example' };
    const request = (origin: string, path: string, body = {}) =>
      new Request(`https://relay.example${path}`, {
        method: 'POST',
        headers: { Origin: origin },
        body: JSON.stringify(body),
      });
    expect((await relay.fetch(request('https://untrusted.example', '/device'), env)).status).toBe(403);
    const response = await relay.fetch(
      request('https://fictional.example', '/device', { client_id: 'attacker', scope: 'delete_repo' }),
      env,
    );
    expect(calls[0]).toEqual({
      url: 'https://github.com/login/device/code',
      body: 'client_id=public-client-id&scope=repo',
    });
    expect(await response.text()).not.toContain('client_secret');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
