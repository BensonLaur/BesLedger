import { z } from 'zod';
import {
  decrypt,
  encrypt,
  envelopeSchema,
  importKey,
  keyHeaderSchema,
  parseRecovery,
  recoveryText,
  unlockKey,
  wrapKey,
  type KeyHeader,
} from '../crypto/vault';
import { emptyState, stateSchema, type State } from '../domain/model';
import { validateState } from '../domain/ledger';
import type { Backend } from './backend';

const archiveSchema = z.object({
  format: z.literal('BesLedger.vault'),
  version: z.literal(1),
  header: keyHeaderSchema,
  data: envelopeSchema,
});
type Archive = z.infer<typeof archiveSchema>;
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
    const archive = archiveSchema.parse(JSON.parse(stored.payload));
    const { key, raw } = await unlockKey(archive.header, password);
    const state = migrate(await decrypt(archive.data, key, 'local-state'));
    this.key = key;
    this.raw = raw;
    this.header = archive.header;
    this.state = state;
    this.revision = stored.revision;
  }
  lock(): void {
    this.generation++;
    this.raw?.fill(0);
    this.raw = undefined;
    this.key = undefined;
    this.header = undefined;
    this.state = undefined;
  }
  get recovery(): string {
    if (!this.raw) throw new Error('请先解锁');
    return recoveryText(this.raw);
  }
  get encryptionKey(): CryptoKey {
    if (!this.key) throw new Error('请先解锁');
    return this.key;
  }
  private async archive(state: State, key: CryptoKey, header: KeyHeader): Promise<Archive> {
    return { format: 'BesLedger.vault', version: 1, header, data: await encrypt(state, key, 'local-state') };
  }
  async mutate<T>(operation: (state: State) => T): Promise<T> {
    const task = this.queue.then(async () => {
      if (!this.state || !this.key || !this.header) throw new Error('请先解锁');
      const generation = this.generation;
      const draft = structuredClone(this.state);
      const result = operation(draft);
      validateState(stateSchema.parse(draft));
      const payload = JSON.stringify(await this.archive(draft, this.key, this.header));
      if (generation !== this.generation) throw new Error('账本已锁定，本次保存尚未提交');
      // 加密在事务外完成；提交通过版本比较，避免多个标签页最后写入者覆盖。
      const revision = await this.backend.compareSwap(this.revision, payload);
      if (generation !== this.generation) throw new Error('保存期间已锁定，请重新解锁核对结果');
      this.state = draft;
      this.revision = revision;
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
  async restore(text: string, credential: string, newPassword: string, recovery = false): Promise<void> {
    await this.queue;
    const verified = await this.inspectBackup(text, credential, recovery);
    const header = await wrapKey(verified.raw, newPassword);
    // 恢复为独立设备身份，保留实体向量和墓碑，防止两端共用同一递增计数器。
    verified.state.deviceId = crypto.randomUUID();
    const existing = await this.backend.read();
    const revision = await this.backend.compareSwap(
      existing?.revision ?? 0,
      JSON.stringify(await this.archive(verified.state, verified.key, header)),
    );
    this.key = verified.key;
    this.raw = verified.raw;
    this.header = header;
    this.state = verified.state;
    this.revision = revision;
  }
  async recoverPrevious(password: string): Promise<void> {
    const stored = await this.backend.read();
    if (!stored?.previous) throw new Error('没有可恢复的上一版本');
    const verified = await this.inspectBackup(stored.previous, password);
    const revision = await this.backend.compareSwap(stored.revision, stored.previous);
    this.key = verified.key;
    this.raw = verified.raw;
    this.header = verified.header;
    this.state = verified.state;
    this.revision = revision;
  }
}
