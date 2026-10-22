import Dexie, { type Table } from 'dexie';
import { Capacitor, registerPlugin } from '@capacitor/core';

export type StoredCredential = { id: 'github'; revision: number; payload: string | null };
export interface CredentialBackend {
  read(): Promise<StoredCredential | undefined>;
  compareSwap(expected: number, payload: string | null): Promise<boolean>;
}

export class WebCredentialBackend implements CredentialBackend {
  private db: Dexie;
  private table: Table<StoredCredential, string>;
  constructor(name = 'BesLedger.credentials.v1') {
    this.db = new Dexie(name);
    this.db.version(1).stores({ credentials: '&id' });
    this.table = this.db.table('credentials');
  }
  read(): Promise<StoredCredential | undefined> {
    return this.table.get('github');
  }
  async compareSwap(expected: number, payload: string | null): Promise<boolean> {
    return this.db.transaction('rw', this.table, async () => {
      const current = await this.read();
      if ((current?.revision ?? 0) !== expected) return false;
      // 退出保留版本墓碑且没有 previous，迟到的续期结果不能复活旧登录。
      await this.table.put({ id: 'github', revision: expected + 1, payload });
      return true;
    });
  }
  close(): void {
    this.db.close();
  }
}
const native = registerPlugin<{
  readCredential(): Promise<{ value?: StoredCredential }>;
  compareSwapCredential(options: { expected: number; payload: string | null }): Promise<{ saved: boolean }>;
}>('EncryptedVault');
export class AndroidCredentialBackend implements CredentialBackend {
  async read(): Promise<StoredCredential | undefined> {
    return (await native.readCredential()).value;
  }
  async compareSwap(expected: number, payload: string | null): Promise<boolean> {
    return (await native.compareSwapCredential({ expected, payload })).saved;
  }
}
export function credentialBackend(): CredentialBackend {
  return Capacitor.isNativePlatform() ? new AndroidCredentialBackend() : new WebCredentialBackend();
}
