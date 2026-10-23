import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Vault } from '../src/storage/vault';
import { WebBackend } from '../src/storage/backend';
import { list, put } from '../src/domain/model';

const password = 'fictional-backup-source-password';
const targetPassword = 'fictional-backup-target-password';
const newPassword = 'fictional-backup-restored-password';
async function setup() {
  const source = new Vault(new WebBackend(crypto.randomUUID()));
  const recovery = await source.create(password);
  await source.mutate((s) => put(s, { kind: 'ledger', name: '虚构备份账本' }, 'backup-book'));
  const text = await source.exportBackup();
  const disk = new WebBackend(crypto.randomUUID());
  const target = new Vault(disk);
  await target.create(targetPassword);
  await target.mutate((s) => put(s, { kind: 'ledger', name: '虚构当前账本' }, 'current-book'));
  target.lock();
  return { source, text, recovery, disk, target };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('先校验后确认恢复备份', () => {
  it('预览、错误文件与错误凭证不写入，确认后保留备份内容及原目标回退检查点', async () => {
    const { source, text, disk, target } = await setup();
    const before = await disk.read();
    for (const [file, credential] of [
      ['invalid', password],
      [text, 'fictional-wrong-password'],
    ]) {
      await expect(target.previewRestore(file, credential)).rejects.toThrow();
      expect(await disk.read()).toEqual(before);
      expect(target.state).toBeUndefined();
    }
    const preview = await target.previewRestore(text, password);
    expect(list(preview.state, 'ledger')[0].data.name).toBe('虚构备份账本');
    expect(await disk.read()).toEqual(before);
    expect(target.state).toBeUndefined();
    await target.restore(text, password, newPassword, false, { expectedRevision: preview.revision });
    expect(target.state!.entities).toEqual(source.state!.entities);
    expect((await disk.read())!.previous).toBe(before!.payload);
    target.lock();
    await expect(target.unlock(targetPassword)).rejects.toThrow();
    await target.unlock(newPassword);
    expect(target.state!.entities).toEqual(source.state!.entities);
  });

  it('确认前其他窗口新增账目时拒绝覆盖，重新校验后可用恢复密钥恢复', async () => {
    const { text, recovery, disk, target } = await setup();
    const preview = await target.previewRestore(text, password);
    const other = new Vault(disk);
    await other.unlock(targetPassword);
    await other.mutate((s) => put(s, { kind: 'ledger', name: '虚构新修改' }, 'new-change'));
    const changed = await disk.read();
    await expect(
      target.restore(text, password, newPassword, false, { expectedRevision: preview.revision }),
    ).rejects.toThrow('重新校验');
    expect(await disk.read()).toEqual(changed);
    expect(target.state).toBeUndefined();
    const latest = await target.previewRestore(text, recovery, true);
    await target.restore(text, recovery, newPassword, true, { expectedRevision: latest.revision });
    expect(target.state!.entities['backup-book']).toBeDefined();
  });

  it('解密后提交期间发生其他窗口写入时，CAS 仍保留较新的账目', async () => {
    const { text, disk } = await setup();
    const started = gate(),
      release = gate();
    const target = new Vault({
      read: () => disk.read(),
      compareSwap: async (revision, payload, options) => {
        started.resolve();
        await release.promise;
        return disk.compareSwap(revision, payload, options);
      },
    });
    const attempt = target.restore(text, password, newPassword);
    const rejected = expect(attempt).rejects.toThrow();
    await started.promise;
    const other = new Vault(disk);
    await other.unlock(targetPassword);
    await other.mutate((s) => put(s, { kind: 'ledger', name: '虚构并发新账本' }, 'concurrent'));
    const changed = await disk.read();
    release.resolve();
    await rejected;
    expect(await disk.read()).toEqual(changed);
    expect(target.state).toBeUndefined();
  });

  it('取消未提交的恢复不写入；提交期间锁定后不会被迟到回调重新打开', async () => {
    const { text, disk, target } = await setup();
    const before = await disk.read();
    const controller = new AbortController();
    controller.abort();
    await expect(
      target.restore(text, password, newPassword, false, { signal: controller.signal }),
    ).rejects.toThrow('取消');
    expect(await disk.read()).toEqual(before);
    const started = gate(),
      release = gate();
    const delayed = new Vault({
      read: () => disk.read(),
      compareSwap: async (revision, payload, options) => {
        const result = await disk.compareSwap(revision, payload, options);
        started.resolve();
        await release.promise;
        return result;
      },
    });
    const attempt = delayed.restore(text, password, newPassword);
    const rejected = expect(attempt).rejects.toThrow('本地空间已改变');
    await started.promise;
    delayed.lock();
    release.resolve();
    await rejected;
    expect(delayed.state).toBeUndefined();
    const check = new Vault(disk);
    await check.unlock(newPassword);
    expect(check.state!.entities['backup-book']).toBeDefined();
  });
});
