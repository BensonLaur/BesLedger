// 仅生成虚构的旧格式升级样本；安装/注入仅允许在隔离的 BesLedgerUiApi36 模拟器操作。
import { createServer } from 'vite';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { Vault } = await server.ssrLoadModule('/src/storage/vault.ts');
  const { put } = await server.ssrLoadModule('/src/domain/model.ts');
  const { encrypt } = await server.ssrLoadModule('/src/crypto/vault.ts');
  let row;
  const backend = {
    read: async () => row,
    compareSwap: async (expected, payload) => {
      if ((row?.revision ?? 0) !== expected) throw Error('CAS');
      row = { revision: expected + 1, payload, previous: row?.payload };
      return row.revision;
    },
  };
  fs.mkdirSync('artifacts', { recursive: true });
  const vault = new Vault(backend);
  await vault.create('fictional-upgrade-password');
  const binding = {
    owner: 'fictional-upgrade-user',
    repo: 'BesLedger-Data',
    userId: 42,
    remoteExists: true,
    remoteHash: '1'.repeat(40),
    lastChecked: '2026-10-23T00:00:00Z',
  };
  await vault.mutate((s) => {
    put(s, { kind: 'ledger', name: 'Fictional upgrade A' }, 'upgrade-local');
    put(s, { kind: 'ledger', name: 'Fictional upgrade B' }, 'upgrade-cloud');
    s.preferences.currentLedger = 'upgrade-local';
    put(
      s,
      {
        kind: 'account',
        name: 'Fictional cash',
        type: 'cash',
        opening: 100000,
        openedAt: '2026-01-01T00:00:00',
        bank: '',
        tail: '',
      },
      'upgrade-cash',
    );
    put(
      s,
      {
        kind: 'entry',
        ledgerId: 'upgrade-local',
        type: 'expense',
        amount: 1234,
        interest: 0,
        from: 'upgrade-cash',
        to: '',
        categoryId: 'expense.food.002',
        at: '2026-10-23T12:00:00',
        note: 'Fictional upgrade entry',
        behavior: '',
        createdAt: '2026-10-23T12:00:00',
      },
      'upgrade-entry',
    );
    s.bindings['upgrade-cloud'] = binding;
  });
  const lease = await vault.prepareSyncKey('upgrade-cloud', binding, '12'.repeat(32));
  await vault.rememberSyncKey(lease, () => undefined);
  const credential = JSON.stringify(
    await encrypt(
      {
        version: 2,
        id: crypto.randomUUID(),
        user: { id: 42, login: 'fictional-upgrade-user' },
        tokens: {
          accessToken: 'ghu_fictionalUpgradeOnly',
          app: { id: 5426577, clientId: 'Iv23liqKVYOk5K5MFB1j', slug: 'besledger-sync' },
        },
      },
      await vault.credentialKey(),
      'local-github-session',
    ),
  );
  fs.writeFileSync(
    'artifacts/upgrade-fixture.json',
    JSON.stringify({ vault: row, credential: { revision: 1, payload: credential } }),
  );
  const db = new DatabaseSync('artifacts/upgrade-fixture.db');
  db.exec(
    'CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL, previous TEXT); CREATE TABLE IF NOT EXISTS credentials (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT); PRAGMA user_version=2;',
  );
  db.prepare('INSERT OR REPLACE INTO vault VALUES (1,?,?,?)').run(
    row.revision,
    row.payload,
    row.previous || null,
  );
  db.prepare('INSERT OR REPLACE INTO credentials VALUES (1,1,?)').run(credential);
  db.close();
  console.log(
    'Created encrypted fictional upgrade fixture: 2 books, 1 account, 1 entry, 1 binding, credential and remembered foreign key',
  );
} finally {
  await server.close();
}
