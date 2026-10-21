import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { fixture, entry } from '../fixtures';
import { put, type Binding } from '../../src/domain/model';
import { saveEntry, deleteEntry, restoreEntity } from '../../src/domain/ledger';
import { GitHub } from '../../src/providers/github/client';
import { Vault } from '../../src/storage/vault';
import { WebBackend } from '../../src/storage/backend';
import { downloadLedger, syncLedger } from '../../src/sync/engine';
import { importKey, parseRecovery } from '../../src/crypto/vault';
import { mergeEntities, resolveConflict } from '../../src/sync/merge';

test.skipIf(!process.env.BESLEDGER_TEST_REPO)(
  '真实私有测试仓库：独立加密存储发现、双向修改、并发、删除及恢复',
  async () => {
    const repository = process.env.BESLEDGER_TEST_REPO!;
    if (!/^[\w-]+\/BesLedger-Data-SyncTest-[\w-]+$/.test(repository))
      throw new Error('集成测试只允许专用测试仓库');
    const [owner, repo] = repository.split('/');
    const token = process.env.BESLEDGER_TEST_TOKEN;
    if (!token) throw new Error('缺少测试授权凭证');
    const github = new GitHub(token),
      user = await github.user();
    await github.verifyPrivate(owner, repo, user.id);
    const a = new Vault(new WebBackend(`BesLedger-test-a-${crypto.randomUUID()}`));
    const b = new Vault(new WebBackend(`BesLedger-test-b-${crypto.randomUUID()}`));
    const recovery = await a.create('fictional-integration-password-a');
    await b.create('fictional-integration-password-b');
    const key = await importKey(parseRecovery(recovery));
    const ledgerId = crypto.randomUUID();
    let transactionId = '';
    await a.mutate((s) => {
      const f = fixture();
      s.entities = f.entities;
      delete s.entities[f.preferences.currentLedger];
      put(s, { kind: 'ledger', name: '完全虚构的同步验收账本' }, ledgerId);
      s.preferences.currentLedger = ledgerId;
      transactionId = saveEntry(
        s,
        entry(s, {
          type: 'income',
          from: '',
          to: 'bank',
          amount: 600000,
          categoryId: 'income.001',
          note: '虚构工资示例 6000 元',
        }),
      ).id;
    });
    let binding: Binding = { owner, repo, userId: user.id, remoteExists: false };
    const sync = async (vault: Vault) => {
      const result = await syncLedger(vault.state!, ledgerId, binding, key, github);
      if (!result.conflicts.length) {
        await vault.mutate((s) => {
          s.entities = mergeEntities(s.entities, result.entities).entities;
          s.bindings[ledgerId] = result.binding;
        });
        binding = result.binding;
      }
      return result;
    };
    await sync(a);
    expect((await github.discover(owner, repo, user.id)).some((f) => f.id === ledgerId)).toBe(true);
    const downloaded = await downloadLedger(ledgerId, binding, key, github);
    await b.mutate((s) => {
      s.entities = downloaded;
      s.preferences.currentLedger = ledgerId;
      s.bindings[ledgerId] = binding;
    });
    expect(b.state!.entities[transactionId].data).toEqual(a.state!.entities[transactionId].data);
    await b.mutate((s) =>
      saveEntry(
        s,
        entry(s, { from: 'bank', amount: 1234, note: '独立设备乙虚构支出' }),
        'test-device-b-entry',
      ),
    );
    await sync(b);
    await sync(a);
    expect(a.state!.entities['test-device-b-entry']).toBeDefined();
    await a.mutate((s) => {
      const d = s.entities[transactionId].data;
      if (d.kind === 'entry') saveEntry(s, { ...d, note: '甲修改虚构工资说明' }, transactionId);
    });
    await b.mutate((s) => {
      const d = s.entities[transactionId].data;
      if (d.kind === 'entry') saveEntry(s, { ...d, note: '乙修改虚构工资说明' }, transactionId);
    });
    await sync(a);
    const conflict = await sync(b);
    expect(conflict.conflicts).toHaveLength(1);
    await b.mutate((s) => resolveConflict(s, conflict.conflicts[0], 'remote'));
    await sync(b);
    await sync(a);
    await a.mutate((s) => deleteEntry(s, 'test-device-b-entry'));
    await sync(a);
    await sync(b);
    expect(b.state!.entities['test-device-b-entry'].deleted).toBe(true);
    await b.mutate((s) => restoreEntity(s, 'test-device-b-entry'));
    await sync(b);
    await sync(a);
    expect(a.state!.entities['test-device-b-entry'].deleted).toBe(false);
    const file = await github.readLedger(owner, repo, ledgerId, user.id);
    expect(file!.text).not.toContain('虚构');
    expect(file!.text).not.toContain('600000');
    // 测试密钥不写文件或日志；最后删除测试账本，远端只留下不可恢复的虚构密文历史。
    await a.mutate((s) => {
      for (const e of Object.values(s.entities))
        if (e.id === ledgerId || ('ledgerId' in e.data && e.data.ledgerId === ledgerId))
          put(s, e.data, e.id, true);
    });
    await sync(a);
    a.lock();
    b.lock();
  },
  180000,
);
