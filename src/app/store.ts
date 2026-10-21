import { computed, reactive, shallowRef } from 'vue';
import { Vault } from '../storage/vault';
import { backend } from '../storage/backend';
import { list, type Entry, type State } from '../domain/model';
import { draftTime, localTime, today } from '../domain/time';
import { generateDue } from '../domain/recurring';
import type { GitHub, GitHubUser } from '../providers/github/client';
import type { Conflict } from '../sync/merge';

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
});
export const auth = shallowRef<{ github: GitHub; user: GitHubUser }>();
export const conflicts = shallowRef<Conflict[]>([]);
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
    ui.error = '请先创建账本';
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
  vault.lock();
  state.value = undefined;
  auth.value = undefined;
  ui.editor = false;
  ui.draft = undefined;
  ui.detailId = '';
  ui.smsQueue = [];
  ui.smsPicker = false;
  conflicts.value = [];
}
