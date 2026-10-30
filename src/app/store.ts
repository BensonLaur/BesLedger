import { computed, reactive, ref, shallowRef } from 'vue';
import { Vault, type SyncKeyLease } from '../storage/vault';
import { backend } from '../storage/backend';
import { list, type Entry, type State } from '../domain/model';
import { draftTime, localTime, today } from '../domain/time';
import { generateDue } from '../domain/recurring';
import { GitHubSession, type Login } from '../providers/github/session';
import { refreshAuthorization } from '../providers/github/auth';
import { credentialBackend } from '../storage/credentials';

export const vault = new Vault(backend());
export const state = shallowRef<State>();
export const ui = reactive({
  error: '',
  notice: '',
  busy: false,
  selectedDay: '',
  month: today().slice(0, 7),
  allTime: false,
  editor: false,
  editingId: '',
  detailId: '',
  accountForm: false,
  accountId: '',
  quick: false,
  ruleForm: false,
  ruleId: '',
  draft: undefined as Entry | undefined,
  confirm: '',
  smsPicker: false,
  smsQueue: [] as string[],
  loginRecovery: false,
  loginProblem: '',
  passwordRecoveryRequested: false,
});
export const online = ref(navigator.onLine);
window.addEventListener('online', () => {
  online.value = true;
});
window.addEventListener('offline', () => {
  online.value = false;
});
export const cloudState = reactive({ phase: 'idle' as 'idle' | 'preparing' | 'ready' | 'error', error: '' });
export const auth = shallowRef<Login>();
export const githubSession = new GitHubSession(
  credentialBackend(),
  refreshAuthorization,
  (login, message) => {
    if (login?.user.id !== auth.value?.user.id) {
      cloudState.phase = 'idle';
      cloudState.error = '';
    }
    auth.value = login;
    if (login) {
      ui.loginRecovery = false;
      ui.loginProblem = '';
    } else if (message) ui.loginProblem = message;
    if (message) ui.notice = message;
  },
);
githubSession.observe();
export async function restoreLogin(): Promise<void> {
  try {
    await githubSession.resume(await vault.credentialKey());
  } catch (error) {
    ui.loginRecovery = true;
    ui.error = error instanceof Error ? error.message : '无法恢复登录状态，请重试';
  }
}
export const currentLedgerId = computed(() => state.value?.preferences.currentLedger ?? '');
export const ledgers = computed(() => (state.value ? list(state.value, 'ledger') : []));
export const currentLedger = computed(() => ledgers.value.find((l) => l.id === currentLedgerId.value));
export const accounts = computed(() => (state.value ? list(state.value, 'account') : []));
export const entries = computed(() => (state.value ? list(state.value, 'entry') : []));
export const currentEntries = computed(() =>
  entries.value.filter((e) => e.data.ledgerId === currentLedgerId.value),
);
export function refresh(): void {
  state.value = vault.state;
}
export async function mutate<T>(operation: (s: State) => T): Promise<T> {
  const result = await vault.mutate(operation);
  refresh();
  return result;
}
export async function rememberSyncKey<T>(lease: SyncKeyLease, operation: (s: State) => T): Promise<T> {
  const result = await vault.rememberSyncKey(lease, operation);
  refresh();
  return result;
}
export async function run(operation: () => Promise<void>): Promise<boolean> {
  if (ui.busy) return false;
  ui.busy = true;
  ui.error = '';
  try {
    await operation();
    return true;
  } catch (error) {
    ui.error = error instanceof Error ? error.message : '操作失败，数据未清空';
    return false;
  } finally {
    ui.busy = false;
  }
}
export function newEntry(type: Entry['type'] = 'expense', overrides: Partial<Entry> = {}): void {
  if (!currentLedgerId.value) {
    ui.error = '请先选择、取回或新建一本账';
    return;
  }
  ui.editingId = '';
  ui.draft = {
    kind: 'entry',
    ledgerId: currentLedgerId.value,
    type,
    amount: 0,
    interest: 0,
    from: '',
    to: '',
    categoryId: '',
    at: draftTime(ui.selectedDay || undefined),
    createdAt: localTime(),
    note: '',
    behavior: '转账',
    ...overrides,
  };
  ui.quick = false;
  ui.editor = true;
}
export function editEntry(id: string): void {
  const entity = state.value?.entities[id];
  if (entity?.data.kind !== 'entry' || entity.deleted) return;
  ui.editingId = id;
  ui.draft = structuredClone(entity.data);
  ui.detailId = '';
  ui.editor = true;
}
export async function catchUp(): Promise<void> {
  if (!state.value) return;
  const snapshot = structuredClone(state.value);
  generateDue(snapshot);
  if (JSON.stringify(snapshot.entities) !== JSON.stringify(state.value.entities))
    await mutate((s) => generateDue(s));
}
export function lock(): void {
  githubSession.suspend();
  vault.lock();
  state.value = undefined;
  ui.editor = false;
  ui.draft = undefined;
  ui.detailId = '';
  ui.smsQueue = [];
  ui.smsPicker = false;
}
export function requestPasswordRecovery(): void {
  ui.error = '';
  ui.passwordRecoveryRequested = true;
  lock();
}
