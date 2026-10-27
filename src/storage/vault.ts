import { z } from 'zod';
import {
  decrypt,
  deriveCredentialKey,
  deriveSyncKeyStorageKey,
  digest,
  encrypt,
  envelopeSchema,
  importKey,
  keyHeaderSchema,
  parseRecovery,
  recoveryText,
  unlockKey,
  wrapKey,
  type KeyHeader,
  type Envelope,
} from '../crypto/vault';
import { bindingSchema, emptyState, stateSchema, type Binding, type State } from '../domain/model';
import { validateState } from '../domain/ledger';
import type { Backend } from './backend';

const archiveSchema = z.object({
  format: z.literal('BesLedger.vault'),
  version: z.literal(1),
  header: keyHeaderSchema,
  data: envelopeSchema,
  // 仅本机归档的可选扩展；旧归档可直接读取，导出备份不包含此字段。
  deviceSyncKeys: z.record(z.string().regex(/^[0-9a-f]{64}$/), envelopeSchema).optional(),
});
type Archive = z.infer<typeof archiveSchema>;
export class LocalDataUnreadable extends Error {
  constructor() {
    super('当前本地账目无法完整读取，原数据未改动');
  }
}
class UnsupportedLocalVersion extends Error {
  constructor() {
    super('当前账本格式需要更新版本的 Bes记账，请先更新应用');
  }
}
async function inspectLocal(text: string, password: string) {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new LocalDataUnreadable();
  }
  if (!input || typeof input !== 'object') throw new LocalDataUnreadable();
  const value = input as Record<string, unknown>;
  if (value.format !== 'BesLedger.vault' || value.version !== 1) throw new UnsupportedLocalVersion();
  for (const part of [value.header, value.data]) {
    if (
      part &&
      typeof part === 'object' &&
      'version' in part &&
      typeof part.version === 'number' &&
      part.version > 1
    )
      throw new UnsupportedLocalVersion();
  }
  // 先验证密码封装。密码错误与封装损坏无法可靠区分，不能据此引导用户回退账目。
  const keys = await unlockKey(value.header, password);
  try {
    const archive = archiveSchema.parse(value);
    const decoded = await decrypt(archive.data, keys.key, 'local-state');
    if (
      decoded &&
      typeof decoded === 'object' &&
      'schemaVersion' in decoded &&
      typeof decoded.schemaVersion === 'number' &&
      decoded.schemaVersion > 2
    )
      throw new UnsupportedLocalVersion();
    return {
      ...keys,
      state: migrate(decoded),
      header: archive.header,
      deviceSyncKeys: archive.deviceSyncKeys ?? {},
    };
  } catch (error) {
    keys.raw.fill(0);
    if (error instanceof UnsupportedLocalVersion) throw error;
    throw new LocalDataUnreadable();
  }
}
export type SyncKeyLease = {
  key: CryptoKey;
  source: 'provided' | 'saved' | 'local';
  assertCurrent(): void;
};
async function syncKeyId(ledgerId: string, binding: Binding): Promise<string> {
  const b = bindingSchema.parse(binding);
  if (!ledgerId || ledgerId.length > 180) throw new Error('同步账本身份无效');
  return digest([ledgerId, b.userId, b.owner.toLowerCase(), b.repo.toLowerCase()]);
}
export function migrate(input: unknown): State {
  if (!input || typeof input !== 'object') throw new Error('备份内容无效');
  const value = structuredClone(input) as Record<string, unknown>;
  if (value.schemaVersion === 1) {
    value.schemaVersion = 2;
    value.bindings ??= {};
    value.preferences ??= { currentLedger: '', quick: {} };
  }
  const state = stateSchema.parse(value);
  validateState(state);
  return state;
}
export class Vault {
  state?: State;
  private key?: CryptoKey;
  private raw?: Uint8Array<ArrayBuffer>;
  private header?: KeyHeader;
  private revision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private deviceSyncKeys: Record<string, Envelope> = {};
  private syncLeases = new WeakMap<SyncKeyLease, { id: string; envelope: Envelope; previous?: string }>();
  constructor(private backend: Backend) {}
  async exists(): Promise<boolean> {
    return !!(await this.backend.read());
  }
  async create(password: string): Promise<string> {
    if (await this.exists()) throw new Error('本机已有账本，请解锁或恢复');
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await importKey(raw),
      header = await wrapKey(raw, password),
      state = emptyState();
    const revision = await this.backend.compareSwap(
      0,
      JSON.stringify(await this.archive(state, key, header)),
    );
    this.raw = raw;
    this.key = key;
    this.header = header;
    this.state = state;
    this.revision = revision;
    return recoveryText(raw);
  }
  async unlock(password: string): Promise<void> {
    const stored = await this.backend.read();
    if (!stored) throw new Error('尚未创建本地空间');
    const verified = await inspectLocal(stored.payload, password);
    this.lock();
    this.key = verified.key;
    this.raw = verified.raw;
    this.header = verified.header;
    this.state = verified.state;
    this.revision = stored.revision;
    this.deviceSyncKeys = verified.deviceSyncKeys;
  }
  async resetPasswordWithRecovery(recovery: string, password: string, signal?: AbortSignal): Promise<void> {
    const generation = this.generation;
    const task = this.queue.then(async () => {
      const assertCurrent = () => {
        if (signal?.aborted || generation !== this.generation)
          throw new Error('重设操作已取消或本地空间已改变，请重新解锁');
        if (this.key || this.state) throw new Error('请先锁定，再使用恢复密钥重设密码');
      };
      assertCurrent();
      const stored = await this.backend.read();
      assertCurrent();
      if (!stored) throw new Error('这台设备尚未创建本地账本，请先创建或从备份恢复');
      const original = JSON.parse(stored.payload);
      const archive = archiveSchema.parse(original);
      const raw = parseRecovery(recovery);
      let adopted = false;
      try {
        const key = await importKey(raw);
        let state: State;
        try {
          state = migrate(await decrypt(archive.data, key, 'local-state'));
        } catch {
          throw new Error('恢复密钥不正确或本机数据已损坏，请核对；原账目保持不变');
        }
        assertCurrent();
        const header = await wrapKey(raw, password);
        assertCurrent();
        // 只更换密码封装，保留原密文、设备身份和设备同步密钥；凭证派生密钥不变。
        const payload = JSON.stringify({ ...original, header });
        // 同次事务建立新密码检查点，避免旧密码经“恢复上一版本”再次打开当前账目。
        const revision = await this.backend.compareSwap(stored.revision, payload, { resetPrevious: true });
        // 提交期间锁定或关闭页面时不得重新解锁；已提交的密码以新密码为准。
        assertCurrent();
        this.lock();
        this.raw = raw;
        this.key = key;
        this.header = header;
        this.state = state;
        this.revision = revision;
        this.deviceSyncKeys = archive.deviceSyncKeys ?? {};
        adopted = true;
      } finally {
        if (!adopted) raw.fill(0);
      }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  lock(): void {
    this.generation++;
    this.raw?.fill(0);
    this.raw = undefined;
    this.key = undefined;
    this.header = undefined;
    this.state = undefined;
    this.deviceSyncKeys = {};
    this.syncLeases = new WeakMap();
  }
  get recovery(): string {
    if (!this.raw) throw new Error('请先解锁');
    return recoveryText(this.raw);
  }
  get encryptionKey(): CryptoKey {
    if (!this.key) throw new Error('请先解锁');
    return this.key;
  }
  async credentialKey(): Promise<CryptoKey> {
    if (!this.raw) throw new Error('请先解锁');
    const generation = this.generation;
    const key = await deriveCredentialKey(this.raw);
    if (generation !== this.generation) throw new Error('账本已锁定');
    return key;
  }
  async hasSyncKey(ledgerId: string, binding: Binding): Promise<boolean> {
    return !!this.key && !!this.deviceSyncKeys[await syncKeyId(ledgerId, binding)];
  }
  async prepareSyncKey(
    ledgerId: string,
    binding: Binding,
    recovery = '',
    allowLocal = false,
  ): Promise<SyncKeyLease> {
    if (!this.raw) throw new Error('请先解锁');
    const generation = this.generation;
    const assertCurrent = () => {
      if (!this.key || generation !== this.generation)
        throw new Error('账本已锁定或本地空间已改变，请解锁后重试');
    };
    const id = await syncKeyId(ledgerId, binding);
    assertCurrent();
    const wrappingKey = await deriveSyncKeyStorageKey(this.raw!);
    assertCurrent();
    const saved = this.deviceSyncKeys[id];
    const source = recovery.trim() ? 'provided' : saved ? 'saved' : 'local';
    let raw: Uint8Array<ArrayBuffer>;
    if (source === 'provided') raw = parseRecovery(recovery);
    else if (saved) {
      try {
        raw = parseRecovery(await decrypt<string>(saved, wrappingKey, `sync-key:${id}`));
      } catch {
        throw new Error('此设备保存的同步密钥无法读取，请输入原设备的恢复密钥后重试；本地账目保持不变');
      }
    } else {
      if (!allowLocal) throw new Error('首次下载请填写原设备的同步恢复密钥，验证成功后将在此设备加密保存');
      raw = this.raw!.slice();
    }
    try {
      const key = await importKey(raw);
      const envelope =
        source === 'saved' ? saved! : await encrypt(recoveryText(raw), wrappingKey, `sync-key:${id}`);
      assertCurrent();
      const lease: SyncKeyLease = { key, source, assertCurrent };
      this.syncLeases.set(lease, { id, envelope, previous: saved && JSON.stringify(saved) });
      return lease;
    } finally {
      raw.fill(0);
    }
  }
  async rememberSyncKey<T>(lease: SyncKeyLease, operation: (state: State) => T): Promise<T> {
    lease.assertCurrent();
    const saved = this.syncLeases.get(lease);
    if (!saved) throw new Error('同步密钥会话已失效，请重试');
    // 只有调用方完成远端解密或首次上传后才能提交；与账目在同一次 CAS 中落盘。
    return this.update((state, keys) => {
      lease.assertCurrent();
      if (JSON.stringify(keys[saved.id]) !== saved.previous)
        throw new Error('此设备的同步密钥已改变，请重新同步；旧请求不会恢复已忘记的密钥');
      keys[saved.id] = saved.envelope;
      return operation(state);
    });
  }
  async forgetSyncKey(ledgerId: string, binding: Binding): Promise<void> {
    const generation = this.generation;
    const id = await syncKeyId(ledgerId, binding);
    if (generation !== this.generation) throw new Error('账本已锁定或本地空间已改变');
    await this.update((_state, keys) => {
      delete keys[id];
    });
  }
  private async archive(
    state: State,
    key: CryptoKey,
    header: KeyHeader,
    deviceSyncKeys?: Record<string, Envelope>,
  ): Promise<Archive> {
    const archive: Archive = {
      format: 'BesLedger.vault',
      version: 1,
      header,
      data: await encrypt(state, key, 'local-state'),
      ...(deviceSyncKeys && Object.keys(deviceSyncKeys).length ? { deviceSyncKeys } : {}),
    };
    if (JSON.stringify(archive).length > 50_000_000)
      throw new Error('本机加密空间达到 50 MB 上限，请先备份并整理已同步副本');
    return archive;
  }
  async mutate<T>(operation: (state: State) => T): Promise<T> {
    return this.update((state) => operation(state));
  }
  private async update<T>(operation: (state: State, keys: Record<string, Envelope>) => T): Promise<T> {
    const generation = this.generation;
    const task = this.queue.then(async () => {
      if (!this.state || !this.key || !this.header) throw new Error('请先解锁');
      if (generation !== this.generation) throw new Error('本地空间已改变，本次操作未提交');
      const draft = structuredClone(this.state);
      const keys = structuredClone(this.deviceSyncKeys);
      const result = operation(draft, keys);
      validateState(stateSchema.parse(draft));
      const payload = JSON.stringify(await this.archive(draft, this.key, this.header, keys));
      if (generation !== this.generation) throw new Error('账本已锁定，本次保存尚未提交');
      // 加密在事务外完成；提交通过版本比较，避免多个标签页最后写入者覆盖。
      const revision = await this.backend.compareSwap(this.revision, payload);
      if (generation !== this.generation) throw new Error('保存期间已锁定，请重新解锁核对结果');
      this.state = draft;
      this.revision = revision;
      this.deviceSyncKeys = keys;
      return result;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  async exportBackup(): Promise<string> {
    if (!this.state || !this.key || !this.header) throw new Error('请先解锁');
    return JSON.stringify(await this.archive(this.state, this.key, this.header));
  }
  async inspectBackup(
    text: string,
    credential: string,
    recovery = false,
  ): Promise<{ state: State; key: CryptoKey; raw: Uint8Array<ArrayBuffer>; header: KeyHeader }> {
    if (text.length > 50_000_000) throw new Error('备份超过 50 MB，请拆分账本后恢复');
    const archive = archiveSchema.parse(JSON.parse(text));
    const keys = recovery
      ? { raw: parseRecovery(credential), key: await importKey(parseRecovery(credential)) }
      : await unlockKey(archive.header, credential);
    const state = migrate(await decrypt(archive.data, keys.key, 'local-state'));
    return { ...keys, state, header: archive.header };
  }
  async previewRestore(
    text: string,
    credential: string,
    recovery = false,
  ): Promise<{ state: State; revision: number }> {
    await this.queue;
    const generation = this.generation;
    const revision = (await this.backend.read())?.revision ?? 0;
    const verified = await this.inspectBackup(text, credential, recovery);
    try {
      if (generation !== this.generation) throw new Error('本地空间已改变，请重新校验备份');
      return { state: verified.state, revision };
    } finally {
      // 预览不采用解密密钥；确认恢复时重新校验文件，并核对目标空间的版本。
      verified.raw.fill(0);
    }
  }
  async restore(
    text: string,
    credential: string,
    newPassword: string,
    recovery = false,
    options: { expectedRevision?: number; signal?: AbortSignal } = {},
  ): Promise<void> {
    const generation = this.generation;
    const task = this.queue.then(async () => {
      const assertCurrent = () => {
        if (options.signal?.aborted || generation !== this.generation)
          throw new Error('恢复操作已取消或本地空间已改变，请重新解锁核对');
      };
      assertCurrent();
      const existing = await this.backend.read();
      assertCurrent();
      const expected = existing?.revision ?? 0;
      if (options.expectedRevision !== undefined && expected !== options.expectedRevision)
        throw new Error('本地账目已在其他窗口改变，请重新校验备份后再恢复');
      const verified = await this.inspectBackup(text, credential, recovery);
      let adopted = false;
      try {
        assertCurrent();
        const header = await wrapKey(verified.raw, newPassword);
        assertCurrent();
        // 恢复为独立设备身份，保留实体向量和墓碑，防止两端共用同一递增计数器。
        verified.state.deviceId = crypto.randomUUID();
        const payload = JSON.stringify(await this.archive(verified.state, verified.key, header));
        assertCurrent();
        // 使用解密前读到的版本，避免校验或确认期间覆盖其他窗口的新账目。
        const revision = await this.backend.compareSwap(expected, payload);
        assertCurrent();
        this.lock();
        this.key = verified.key;
        this.raw = verified.raw;
        this.header = header;
        this.state = verified.state;
        this.revision = revision;
        adopted = true;
      } finally {
        if (!adopted) verified.raw.fill(0);
      }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  private async inspectPrevious(password: string) {
    if (this.key || this.state) throw new Error('请先锁定本地账本');
    const stored = await this.backend.read();
    if (!stored) throw new Error('没有可读取的本地账本');
    try {
      const current = await inspectLocal(stored.payload, password);
      current.raw.fill(0);
      throw new Error('当前账本可以正常读取，请直接打开账本');
    } catch (error) {
      if (!(error instanceof LocalDataUnreadable)) throw error;
    }
    if (!stored.previous) throw new Error('没有可用的本地备用副本，请从加密备份恢复');
    const verified = await inspectLocal(stored.previous, password);
    return { ...verified, revision: stored.revision };
  }
  async previewPrevious(password: string): Promise<{ state: State; revision: number }> {
    await this.queue;
    const generation = this.generation;
    const verified = await this.inspectPrevious(password);
    try {
      if (generation !== this.generation) throw new Error('本地空间已改变，请重新解锁核对');
      return { state: verified.state, revision: verified.revision };
    } finally {
      verified.raw.fill(0);
    }
  }
  async recoverPrevious(
    password: string,
    options: { expectedRevision?: number; signal?: AbortSignal } = {},
  ): Promise<void> {
    const generation = this.generation;
    const task = this.queue.then(async () => {
      const assertCurrent = () => {
        if (options.signal?.aborted || generation !== this.generation)
          throw new Error('恢复操作已取消或本地空间已改变，请重新解锁核对');
      };
      assertCurrent();
      const verified = await this.inspectPrevious(password);
      let adopted = false;
      try {
        assertCurrent();
        if (options.expectedRevision !== undefined && options.expectedRevision !== verified.revision)
          throw new Error('本地账目已改变，请重新解锁核对');
        // 备用副本只恢复业务数据，不让已忘记的设备密钥随历史归档重新出现。
        const payload = JSON.stringify(await this.archive(verified.state, verified.key, verified.header));
        assertCurrent();
        const revision = await this.backend.compareSwap(verified.revision, payload);
        assertCurrent();
        this.lock();
        this.key = verified.key;
        this.raw = verified.raw;
        this.header = verified.header;
        this.state = verified.state;
        this.revision = revision;
        adopted = true;
      } finally {
        if (!adopted) verified.raw.fill(0);
      }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
