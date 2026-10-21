import Dexie, { type Table } from 'dexie';
import { Capacitor, registerPlugin } from '@capacitor/core';
export type StoredVault = { id: 'vault'; revision: number; payload: string; previous?: string };
export interface Backend {
  read(): Promise<StoredVault | undefined>;
  compareSwap(expected: number, payload: string): Promise<number>;
}
export class WebBackend implements Backend {
  private db: Dexie;
  private table: Table<StoredVault, string>;
  constructor(name = 'BesLedger.encrypted.v1') {
    this.db = new Dexie(name);
    this.db.version(1).stores({ vault: '&id' });
    this.table = this.db.table('vault');
  }
  async read(): Promise<StoredVault | undefined> {
    return this.table.get('vault');
  }
  async compareSwap(expected: number, payload: string): Promise<number> {
    return this.db.transaction('rw', this.table, async () => {
      const previous = await this.table.get('vault');
      if ((previous?.revision ?? 0) !== expected)
        throw new Error('另一个窗口已更新账本，请重新解锁后再保存；当前草稿仍保留');
      const revision = expected + 1;
      await this.table.put({ id: 'vault', revision, payload, previous: previous?.payload });
      return revision;
    });
  }
  close(): void {
    this.db.close();
  }
}
interface NativeVault {
  read(): Promise<{ value?: StoredVault }>;
  compareSwap(options: { expected: number; payload: string }): Promise<{ revision: number }>;
}
const native = registerPlugin<NativeVault>('EncryptedVault');
export class AndroidBackend implements Backend {
  async read(): Promise<StoredVault | undefined> {
    return (await native.read()).value;
  }
  async compareSwap(expected: number, payload: string): Promise<number> {
    return (await native.compareSwap({ expected, payload })).revision;
  }
}
export function backend(): Backend {
  return Capacitor.isNativePlatform() ? new AndroidBackend() : new WebBackend();
}
