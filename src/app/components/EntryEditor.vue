<script setup lang="ts">
import { computed, reactive, ref, toRaw, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { accounts, currentEntries, mutate, newEntry, run, state, ui } from '../store';
import { categories, quickCategories } from '../../domain/categories';
import { list, put, type Entry } from '../../domain/model';
import { saveEntry, movements } from '../../domain/ledger';
import { decimal, minor, money } from '../../domain/money';
import { recognize, type Recognition } from '../../recognition/sms';
import { localTime } from '../../domain/time';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
import { entryIcon, loanIcons, transferIcons } from '../entry-presentation';
import AccountPicker from './AccountPicker.vue';
import AccountOpeningDialog from './AccountOpeningDialog.vue';
import { readAutoRecognition, rememberAutoRecognition } from '../recognition-mode';
import { automaticFields } from '../automatic-recognition';
import { useEntryViewport } from '../use-entry-viewport';
import EntryDateTimePicker from './EntryDateTimePicker.vue';
import RecognitionReview from './RecognitionReview.vue';
import type { ReviewedRecognition } from '../recognition-review';
const draft = reactive(structuredClone(toRaw(ui.draft!)));
const noteInput = ref<HTMLTextAreaElement>();
const entryForm = ref<HTMLElement>(),
  choices = ref<HTMLElement>(),
  direction = ref<HTMLElement>();
const noteEditing = ref(false),
  recognitionOpen = ref(false),
  checksOpen = ref(false),
  helpOpen = ref(false);
const { keyboardOpen, viewportStyle } = useEntryViewport(entryForm);
function resizeNote() {
  const input = noteInput.value;
  if (!input) return;
  // 先还原单行高度，删除文字和窄屏换行时也能重新测量；上限由可见区域决定。
  input.style.height = '0px';
  input.style.height = `${input.scrollHeight + 2}px`;
}
let noteObserver: ResizeObserver | undefined;
onMounted(() => {
  let width = 0;
  noteObserver = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width !== width) {
      width = entry.contentRect.width;
      resizeNote();
    }
  });
  if (noteInput.value) noteObserver.observe(noteInput.value);
  resizeNote();
});
onBeforeUnmount(() => noteObserver?.disconnect());
watch(
  () => draft.note,
  () => void nextTick(resizeNote),
);
async function focusNote() {
  noteEditing.value = true;
  await nextTick();
  noteInput.value?.focus({ preventScroll: true });
}
function finishNote() {
  noteInput.value?.blur();
  noteEditing.value = false;
  // 结束编辑后显示备注开头，不保留输入时的内部滚动位置。
  void nextTick(() => {
    if (noteInput.value) noteInput.value.scrollTop = 0;
  });
}
watch(keyboardOpen, (open, previous) => {
  if (!open && previous) finishNote();
});
const amount = ref(draft.amount ? decimal(draft.amount) : ''),
  interest = ref(decimal(draft.interest));
const protectedFields = reactive({
  amount: !!draft.amount,
  category: !!draft.categoryId,
  at: !!ui.editingId,
  from: !!draft.from,
  to: !!draft.to,
  type: !!ui.editingId || draft.type !== 'expense',
});
const automatic = reactive({ amount: false, category: false });
function protectAmount() {
  protectedFields.amount = true;
  automatic.amount = false;
}
function selectCategory(id: string) {
  protectedFields.category = true;
  automatic.category = false;
  draft.categoryId = id;
}
function selectAccount(side: 'from' | 'to', id: string) {
  protectedFields[side] = true;
  draft[side] = id;
}
const tab = ref(
  ['borrow', 'lend', 'repay', 'collect'].includes(draft.type)
    ? 'loan'
    : draft.type === 'refund'
      ? 'refund'
      : draft.type,
);
const datePicker = ref(false),
  expandedGroup = ref('餐饮');
function setDate(value: string) {
  draft.at = value;
  protectedFields.at = true;
  datePicker.value = false;
}
function openDate() {
  finishNote();
  datePicker.value = true;
}
const keypadTarget = ref<'amount' | 'interest'>('amount');
function keypress(key: string) {
  const target = keypadTarget.value === 'interest' ? interest : amount;
  let value = target.value;
  if (key === 'delete') value = value.slice(0, -1);
  else if (key === '.') {
    if (!value.includes('.')) value = (value || '0') + '.';
  } else value = value === '0' ? key : value + key;
  if (/^\d{0,12}(?:\.\d{0,2})?$/.test(value)) {
    if (keypadTarget.value === 'amount') protectAmount();
    target.value = value;
  }
}
const showInterest = ref(draft.interest > 0),
  categoryPicker = ref(false),
  categorySearch = ref(''),
  newCategory = ref('');
const accountPicker = ref<'from' | 'to' | ''>(''),
  parsed = ref<Recognition>(),
  confirmDuplicate = ref(false),
  confirmOpening = ref(false),
  error = ref('');
watch(accountPicker, (side) => {
  if (side) finishNote();
});
const autoRecognition = ref(readAutoRecognition()),
  recognitionQueued = ref(false),
  composingNote = ref(false),
  modeNotRemembered = ref(false);
let recognitionTimer: ReturnType<typeof setTimeout> | undefined;
function cancelScheduledRecognition() {
  clearTimeout(recognitionTimer);
  recognitionTimer = undefined;
  recognitionQueued.value = false;
}
function clearRecognition() {
  cancelScheduledRecognition();
  parsed.value = undefined;
  recognitionOpen.value = false;
  if (error.value === '请先确认采用或保留备注识别结果' || error.value === '请先完成备注输入')
    error.value = '';
}
function scheduleRecognition() {
  cancelScheduledRecognition();
  if (!autoRecognition.value || composingNote.value || !draft.note.trim()) return;
  recognitionQueued.value = true;
  const note = draft.note;
  // 中文组词期间不运行，只处理最后一版文本；明确字段可填草稿，手动值由保护标记保留。
  recognitionTimer = setTimeout(() => {
    recognitionTimer = undefined;
    recognitionQueued.value = false;
    if (autoRecognition.value && !composingNote.value && draft.note === note) parse();
  }, 350);
}
function toggleRecognitionMode() {
  autoRecognition.value = !autoRecognition.value;
  modeNotRemembered.value = !rememberAutoRecognition(autoRecognition.value);
  clearRecognition();
  scheduleRecognition();
}
function compositionStart() {
  composingNote.value = true;
  clearRecognition();
}
function compositionEnd() {
  composingNote.value = false;
  scheduleRecognition();
}
// 改备注时一并撤回上一版自动值，避免等待期间看到/保存过期金额；手动值不撤回。
watch(
  () => draft.note,
  () => {
    if (autoRecognition.value && automatic.amount && !protectedFields.amount) amount.value = '';
    if (autoRecognition.value && automatic.category && !protectedFields.category) draft.categoryId = '';
    automatic.amount = automatic.category = false;
    clearRecognition();
    scheduleRecognition();
  },
  { flush: 'sync' },
);
onBeforeUnmount(cancelScheduledRecognition);
const quick = {
  expense: quickCategories(state.value!, draft.ledgerId, 'expense').slice(0, 11),
  income: quickCategories(state.value!, draft.ledgerId, 'income').slice(0, 7),
};
const allCategories = computed(() =>
  categories(state.value!, draft.ledgerId).filter(
    (c) => c.type === (draft.type === 'income' ? 'income' : 'expense'),
  ),
);
const quickItems = computed(() =>
  (draft.type === 'income' ? quick.income : quick.expense)
    .map((id) => allCategories.value.find((c) => c.id === id))
    .filter((c) => !!c),
);
const category = computed(() => allCategories.value.find((c) => c.id === draft.categoryId));
watch(categoryPicker, async () => {
  finishNote();
  await nextTick();
  if (choices.value) choices.value.scrollTop = 0;
});
async function showDirection() {
  categoryPicker.value = false;
  finishNote();
  await nextTick();
  if (choices.value && direction.value)
    choices.value.scrollTop = direction.value.offsetTop - choices.value.offsetTop;
}
function finishRecognition() {
  recognitionOpen.value = false;
  if (!recognitionPending.value) error.value = '';
}
const isLoan = computed(() => ['borrow', 'lend', 'repay', 'collect'].includes(draft.type));
const twoAccounts = computed(() => isLoan.value || draft.type === 'transfer');
const interestSummary = computed(() => {
  try {
    const total = minor(amount.value),
      included = minor(interest.value || '0');
    if (total <= 0 || included < 0 || included > total) return '';
    return `本金 ¥ ${money(total - included)} · 包含利息 ¥ ${money(included)}`;
  } catch {
    return '';
  }
});
const filteredCategories = computed(() =>
  allCategories.value.filter((c) => `${c.group}${c.name}`.includes(categorySearch.value)),
);
const categoryGroups = computed(() => [...new Set(filteredCategories.value.map((c) => c.group))]);
const counterpartSide = computed(() => (['borrow', 'collect'].includes(draft.type) ? 'from' : 'to'));
const availableAccounts = computed(() =>
  accounts.value.filter(
    (a) =>
      !isLoan.value ||
      (accountPicker.value === counterpartSide.value
        ? a.data.type === 'receivable'
        : a.data.type !== 'receivable'),
  ),
);
const accountPickerTitle = computed(() => {
  if (isLoan.value && accountPicker.value === counterpartSide.value) return '选择往来方';
  if (draft.type === 'transfer') return accountPicker.value === 'from' ? '从哪个账户转出' : '转入哪个账户';
  if (draft.type === 'refund') return '选择退款入账账户';
  return accountPicker.value === 'from' ? '选择付款账户' : '选择收款账户';
});
function pickedAccount(id: string) {
  if (!accountPicker.value) return;
  selectAccount(accountPicker.value, id);
  accountPicker.value = '';
}
const originals = computed(() => currentEntries.value.filter((e) => e.data.type === 'expense'));
const typeLabels: Record<Entry['type'], string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  borrow: '借入',
  lend: '借出',
  repay: '还款',
  collect: '收款',
  refund: '退款',
};
const loanDrafts = new Map<string, { data: Entry; amount: string; interest: string }>();
function switchType(type: Entry['type']) {
  protectedFields.type = true;
  if (type === draft.type) return;
  const switchingLoan = isLoan.value && ['borrow', 'lend', 'repay', 'collect'].includes(type);
  if (isLoan.value)
    loanDrafts.set(draft.type, {
      data: structuredClone(toRaw(draft)),
      amount: amount.value,
      interest: interest.value,
    });
  const saved = loanDrafts.get(type);
  if (saved) {
    Object.assign(draft, saved.data);
    amount.value = saved.amount;
    interest.value = saved.interest;
  } else {
    if (switchingLoan) {
      amount.value = '';
      draft.note = '';
      draft.amount = 0;
      delete draft.settlesId;
    }
    draft.type = type;
    draft.from = '';
    draft.to = '';
    draft.categoryId = '';
    draft.interest = 0;
    draft.due = undefined;
    interest.value = '0';
  }
  keypadTarget.value = 'amount';
  tab.value = isLoan.value ? 'loan' : type;
  showInterest.value = interest.value !== '0' && interest.value !== '0.00';
  if (draft.type !== 'refund') delete draft.originalId;
  if (!['repay', 'collect'].includes(draft.type)) delete draft.settlesId;
  clearRecognition();
}
function accountName(id: string) {
  return accounts.value.find((a) => a.id === id)?.data.name || '选择账户';
}
function parse(showReview = !autoRecognition.value) {
  cancelScheduledRecognition();
  if (composingNote.value || !draft.note.trim()) return;
  parsed.value = recognize(draft.note, accounts.value);
  if (autoRecognition.value) {
    const plan = automaticFields(parsed.value, {
      type: draft.type,
      protectedAmount: protectedFields.amount,
      protectedCategory: protectedFields.category,
      automaticAmount: automatic.amount,
      automaticCategory: automatic.category,
    });
    if (plan.amount !== undefined) {
      amount.value = plan.amount === null ? '' : decimal(plan.amount);
      automatic.amount = plan.amount !== null;
    }
    if (plan.categoryId !== undefined) {
      draft.categoryId = plan.categoryId ?? '';
      automatic.category = plan.categoryId !== null;
    }
  }
  if (showReview) {
    finishNote();
    recognitionOpen.value = true;
  }
}
const normalizeTime = (value: string) => (value.length === 16 ? value + ':00' : value);
const recognitionReview = computed(() => {
  const p = parsed.value;
  if (!p) return [];
  const reasons: string[] = [];
  if (!protectedFields.amount && (!p.amountCertain || p.amount === undefined))
    reasons.push('请选择或填写本次金额');
  if (
    ['expense', 'income'].includes(draft.type) &&
    !protectedFields.category &&
    (p.categoryIds.length !== 1 || (!!p.type && p.type !== draft.type))
  )
    reasons.push('请选择分类');
  if (p.type && p.type !== draft.type && !protectedFields.type) reasons.push('请核对记账类型');
  if (p.at && !protectedFields.at && (p.yearBasis !== 'explicitText' || p.at !== normalizeTime(draft.at)))
    reasons.push('请核对发生时间和年份');
  const side = ['income', 'refund', 'collect', 'borrow'].includes(p.type || draft.type) ? 'to' : 'from';
  if (
    !protectedFields[side] &&
    (p.accountIds.length > 1 || (p.accountIds.length === 1 && p.accountIds[0] !== draft[side]))
  )
    reasons.push('请核对资金账户');
  return reasons;
});
const recognitionPending = computed(
  () => !!parsed.value && (!autoRecognition.value || recognitionReview.value.length > 0),
);
const automaticSummary = computed(() => {
  const fields = [automatic.amount ? '金额' : '', automatic.category ? '分类' : ''].filter(Boolean);
  return fields.length ? `已自动填入${fields.join('、')}` : '已保留当前填写';
});
onMounted(() => {
  if (!ui.editingId) scheduleRecognition();
});
function applyRecognition(choice: ReviewedRecognition) {
  cancelScheduledRecognition();
  const p = parsed.value;
  if (!p) return;
  if (p.type && !twoAccounts.value && (!autoRecognition.value || !protectedFields.type)) {
    draft.type = choice.type;
    tab.value = choice.type;
  }
  if (
    choice.amount !== undefined &&
    (choice.changed.amount || !autoRecognition.value || !protectedFields.amount)
  ) {
    amount.value = decimal(choice.amount);
    if (choice.changed.amount || !autoRecognition.value || !p.amountCertain) protectAmount();
    else automatic.amount = true;
  }
  if ((p.at || choice.changed.at) && (choice.changed.at || !autoRecognition.value || !protectedFields.at)) {
    draft.at = choice.at;
    protectedFields.at = true;
  }
  if (
    choice.accountId &&
    (choice.changed.account || !autoRecognition.value || !protectedFields[choice.side])
  ) {
    selectAccount(choice.side, choice.accountId);
  }
  if (choice.categoryId && (choice.changed.category || !autoRecognition.value || !protectedFields.category)) {
    draft.categoryId = choice.categoryId;
    if (choice.changed.category || !autoRecognition.value) protectedFields.category = true;
    else automatic.category = true;
  }
  draft.recognition = { rawDate: p.rawDate, yearBasis: p.yearBasis, confirmed: true, balance: p.balance };
  parsed.value = undefined;
  recognitionOpen.value = false;
  error.value = '';
}
const normalizedEntryTime = computed(() => (draft.at.length === 16 ? `${draft.at}:00` : draft.at));
const dateLabel = computed(() =>
  draft.at.slice(0, 10) === localTime().slice(0, 10)
    ? `今天 ${draft.at.slice(11, 16)}`
    : draft.at.slice(0, 16).replace('T', ' '),
);
const preOpeningAccounts = computed(() => {
  const used = new Set(movements(draft).map((m) => m.accountId));
  return accounts.value.filter((a) => used.has(a.id) && normalizedEntryTime.value < a.data.openedAt);
});
const hasPreOpening = computed(() => preOpeningAccounts.value.length > 0);
const openingAccountId = ref(''),
  openingNotice = ref('');
let openingNoticeTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(openingNoticeTimer));
// 换账户、改发生时间或调整任一边的起算点后，不能沿用上一种情形的历史确认。
watch(
  [
    () => draft.at,
    () => draft.from,
    () => draft.to,
    () => preOpeningAccounts.value.map((a) => `${a.id}:${a.data.openedAt}`).join('|'),
  ],
  () => {
    confirmOpening.value = false;
  },
);
function openAccountOpening(id: string) {
  openingAccountId.value = id;
  error.value = ui.error = openingNotice.value = '';
  clearTimeout(openingNoticeTimer);
}
async function openingAdjusted(message: string) {
  openingAccountId.value = '';
  error.value = '';
  confirmOpening.value = false;
  await nextTick();
  if (!hasPreOpening.value && !duplicates.value.length) checksOpen.value = false;
  openingNotice.value = message;
  openingNoticeTimer = setTimeout(() => {
    openingNotice.value = '';
  }, 5500);
}
const duplicates = computed(() =>
  currentEntries.value.filter(
    (e) =>
      e.id !== ui.editingId &&
      ((draft.note.trim() && e.data.note.trim() === draft.note.trim()) ||
        (e.data.at === draft.at &&
          decimal(e.data.amount) === amount.value &&
          e.data.from === draft.from &&
          e.data.to === draft.to)),
  ),
);
const checksComplete = computed(
  () =>
    (!hasPreOpening.value || confirmOpening.value) && (!duplicates.value.length || confirmDuplicate.value),
);
function close() {
  if (keyboardOpen.value) {
    finishNote();
    return;
  }
  if (categoryPicker.value) {
    categoryPicker.value = false;
    return;
  }
  if (amount.value || draft.note || ui.editingId) ui.confirm = 'discard';
  else ui.editor = false;
}
async function createCategory() {
  if (!newCategory.value.trim()) return;
  await run(async () => {
    const e = await mutate((s) =>
      put(s, {
        kind: 'category',
        ledgerId: draft.ledgerId,
        type: draft.type === 'income' ? 'income' : 'expense',
        name: newCategory.value,
        group: '自定义',
        icon: 'receipt',
      }),
    );
    selectCategory(e.id);
    newCategory.value = '';
    categoryPicker.value = false;
  });
}
async function save(again = false) {
  error.value = '';
  if (composingNote.value) {
    error.value = '请先完成备注输入';
    return;
  }
  // 保存不能抢在延迟识别前落盘；先展示最新结果，继续走同一套采用/保留确认。
  if (recognitionQueued.value) parse();
  if (recognitionPending.value) {
    error.value = '请先确认采用或保留备注识别结果';
    finishNote();
    recognitionOpen.value = true;
    return;
  }
  if (duplicates.value.length && !confirmDuplicate.value) {
    error.value = '疑似重复，请打开原记录核对，或确认仍然保存';
    finishNote();
    checksOpen.value = true;
    return;
  }
  if (hasPreOpening.value && !confirmOpening.value) {
    error.value = '请确认早于期初的记录只用于历史查询';
    finishNote();
    checksOpen.value = true;
    return;
  }
  const ok = await run(async () => {
    if (autoRecognition.value && parsed.value) {
      const p = parsed.value;
      draft.recognition = { rawDate: p.rawDate, yearBasis: p.yearBasis, confirmed: true, balance: p.balance };
    }
    const data = {
      ...draft,
      amount: minor(amount.value),
      interest: ['repay', 'collect'].includes(draft.type) ? minor(interest.value || '0') : 0,
      at: draft.at.length === 16 ? `${draft.at}:00` : draft.at,
    };
    if (!['expense', 'income', 'refund'].includes(data.type)) data.categoryId = '';
    if (!['borrow', 'lend'].includes(data.type)) delete data.due;
    if (!data.due) delete data.due;
    await mutate((s) => {
      saveEntry(s, data, ui.editingId || undefined);
      for (const kind of ['income', 'expense'] as const)
        s.preferences.quick[`${draft.ledgerId}:${kind}`] = quickCategories(s, draft.ledgerId, kind);
    });
    ui.editor = false;
    ui.draft = undefined;
    ui.notice = '已安全保存在本机';
  });
  if (ok && (again || ui.smsQueue.length)) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const note = ui.smsQueue.shift();
    newEntry(note ? 'expense' : draft.type, note ? { note } : {});
  }
}
</script>
<template>
  <Modal
    class="entry-backdrop"
    :style="viewportStyle"
    :title="ui.editingId ? '编辑账目' : '记一笔'"
    page
    wide
    @close="close"
  >
    <form
      ref="entryForm"
      class="entry-form"
      :class="{ 'keyboard-open': keyboardOpen, 'note-editing': noteEditing }"
      @submit.prevent="save()"
    >
      <div class="entry-top">
        <div class="type-tabs">
          <button
            v-for="item in [
              { type: 'income', name: '收入' },
              { type: 'expense', name: '支出' },
              { type: 'transfer', name: '转账' },
              { type: 'loan', name: '借贷' },
            ]"
            :key="item.type"
            type="button"
            :class="{ active: tab === item.type }"
            :aria-pressed="tab === item.type"
            @click="switchType(item.type === 'loan' ? 'borrow' : (item.type as Entry['type']))"
          >
            {{ item.name }}</button
          ><button v-if="draft.type === 'refund'" type="button" class="active">退款</button>
        </div>
        <div class="entry-amount-card">
          <button
            class="selected-category"
            type="button"
            :disabled="twoAccounts"
            :aria-label="'当前分类：' + (category?.name || (twoAccounts ? typeLabels[draft.type] : '未选择'))"
            @click="categoryPicker = true"
          >
            <span class="entry-icon"><Icon :name="entryIcon(state!, draft)" :size="24" /></span>
            <strong aria-live="polite">{{
              category?.name ||
              (twoAccounts
                ? draft.type === 'transfer'
                  ? draft.behavior
                  : typeLabels[draft.type]
                : '选择分类')
            }}</strong>
            <Icon v-if="!twoAccounts" name="down" :size="13" />
          </button>
          <div class="entry-amount-value">
            <span>¥</span><label class="sr-only" for="entry-amount">金额</label
            ><input
              id="entry-amount"
              v-model="amount"
              inputmode="none"
              placeholder="0.00"
              autocomplete="off"
              required
              @focus="keypadTarget = 'amount'"
              @input="protectAmount"
            />
          </div>
        </div>
      </div>
      <div ref="choices" class="entry-choices" aria-label="分类与其他记账信息" tabindex="-1">
        <section v-if="categoryPicker" class="entry-all-categories" role="region" aria-label="全部分类">
          <button type="button" class="text-button category-return" @click="categoryPicker = false">
            <Icon name="left" :size="17" />返回常用分类
          </button>
          <input
            v-model="categorySearch"
            aria-label="搜索分类"
            @keydown.enter.prevent
            placeholder="搜索大类或分类"
          />
          <div class="category-groups">
            <section v-for="group in categoryGroups" :key="group">
              <button
                type="button"
                class="category-group-heading"
                :aria-expanded="expandedGroup === group || !!categorySearch || draft.type === 'income'"
                @click="expandedGroup = expandedGroup === group ? '' : group"
              >
                <span>{{ group }}</span
                ><Icon :name="expandedGroup === group ? 'chevron-up' : 'down'" :size="16" />
              </button>
              <div
                v-if="expandedGroup === group || categorySearch || draft.type === 'income'"
                class="all-categories"
              >
                <button
                  v-for="c in filteredCategories.filter((c) => c.group === group)"
                  :key="c.id"
                  type="button"
                  :aria-label="c.group + ' ' + c.name"
                  :aria-pressed="draft.categoryId === c.id"
                  :class="{ active: draft.categoryId === c.id }"
                  @click="
                    selectCategory(c.id);
                    categoryPicker = false;
                  "
                >
                  <Icon :name="c.icon" :size="21" />{{ c.name }}
                </button>
              </div>
            </section>
            <p v-if="!filteredCategories.length" class="hint">没有找到，可以在下方添加。</p>
          </div>
          <div class="inline-form">
            <input
              v-model="newCategory"
              aria-label="自定义分类名称"
              @keydown.enter.prevent="createCategory"
              placeholder="添加自定义分类"
              maxlength="100"
            /><button type="button" class="primary" :disabled="ui.busy" @click="createCategory">添加</button>
          </div>
        </section>
        <template v-else>
          <div v-if="draft.type === 'expense' || draft.type === 'income'" class="category-grid">
            <button
              v-for="c in quickItems"
              type="button"
              :class="{ active: draft.categoryId === c.id }"
              :aria-pressed="draft.categoryId === c.id"
              @click="selectCategory(c.id)"
            >
              <span><Icon :name="c.icon" /></span>{{ c.name }}</button
            ><button type="button" @click="categoryPicker = true">
              <span><Icon name="more" /></span>全部
            </button>
          </div>
          <div v-if="isLoan" class="behavior-grid">
            <button
              v-for="t in ['borrow', 'lend', 'repay', 'collect'] as Entry['type'][]"
              type="button"
              :class="{ active: draft.type === t }"
              :aria-pressed="draft.type === t"
              @click="switchType(t)"
            >
              <span><Icon :name="loanIcons[t]" /></span>{{ typeLabels[t] }}
            </button>
          </div>
          <div v-if="draft.type === 'transfer'" class="behavior-grid five">
            <button
              v-for="b in ['转账', '投资', '赎回', '存钱', '取钱']"
              type="button"
              :class="{ active: draft.behavior === b }"
              :aria-pressed="draft.behavior === b"
              @click="draft.behavior = b"
            >
              <span><Icon :name="transferIcons[b]" /></span>{{ b }}
            </button>
          </div>

          <div v-if="twoAccounts" ref="direction" class="account-direction">
            <button type="button" @click="accountPicker = 'from'">
              <small>{{ isLoan && counterpartSide === 'from' ? '往来方 · 应收应付' : '付款账户' }}</small
              ><strong>{{ accountName(draft.from) }}</strong></button
            ><button
              v-if="draft.type === 'transfer'"
              type="button"
              class="icon-button"
              aria-label="交换转账方向"
              @click="[draft.from, draft.to] = [draft.to, draft.from]"
            >
              <Icon name="transfer" /></button
            ><Icon v-else name="arrow" /><button type="button" @click="accountPicker = 'to'">
              <small>{{ isLoan && counterpartSide === 'to' ? '往来方 · 应收应付' : '收款账户' }}</small
              ><strong>{{ accountName(draft.to) }}</strong>
            </button>
          </div>

          <label v-if="draft.type === 'refund'"
            >关联原支出<select v-model="draft.originalId" required>
              <option :value="undefined">选择原支出</option>
              <option v-for="e in originals" :value="e.id">
                {{ e.data.at.slice(0, 10) }} · ¥{{ money(e.data.amount) }} · {{ e.data.note.slice(0, 20) }}
              </option>
            </select></label
          >
          <label v-if="['borrow', 'lend'].includes(draft.type)"
            >约定{{ draft.type === 'borrow' ? '还款' : '收回' }}日（可选）<input
              v-model="draft.due"
              type="date"
          /></label>
          <template v-if="['repay', 'collect'].includes(draft.type)"
            ><p v-if="interestSummary" class="hint">{{ interestSummary }}</p>
            <button
              type="button"
              class="text-button"
              @click="
                showInterest = !showInterest;
                keypadTarget = showInterest ? 'interest' : 'amount';
              "
            >
              包含利息{{ showInterest ? ' ▴' : ' ▾' }}</button
            ><label v-if="showInterest"
              >包含利息（已计入总额）<input
                v-model="interest"
                inputmode="none"
                @focus="keypadTarget = 'interest'"
            /></label>
            <p v-if="showInterest" class="hint">
              本金为总额减利息；只有利息计入收支。利息等于总额表示仅付息。
            </p></template
          >
        </template>
      </div>
      <div class="entry-dock">
        <div class="entry-note-tools">
          <button
            type="button"
            class="recognition-mode-switch"
            role="switch"
            aria-label="自动识别备注"
            aria-describedby="recognition-mode-hint"
            :aria-checked="autoRecognition"
            :disabled="ui.busy"
            @click="toggleRecognitionMode"
          >
            <span class="recognition-switch-track" aria-hidden="true"><span /></span>自动识别
            <small>{{ autoRecognition ? '开' : '关' }}</small>
          </button>
          <button
            v-if="draft.note.trim()"
            type="button"
            class="text-button"
            :disabled="composingNote || ui.busy"
            @click="parse(true)"
          >
            {{ autoRecognition ? '立即识别' : '识别备注' }}
          </button>
          <button v-if="noteEditing" type="button" class="text-button note-finish" @click="finishNote">
            完成备注
          </button>
          <button
            v-else
            type="button"
            class="icon-button note-expand"
            aria-label="展开备注"
            @click="focusNote"
          >
            <Icon name="edit" :size="17" />
          </button>
          <button
            type="button"
            class="icon-button recognition-help"
            aria-label="识别说明"
            @click="helpOpen = true"
          >
            <Icon name="help" :size="16" />
          </button>
        </div>
        <label class="entry-note"
          ><span class="sr-only">备注</span
          ><textarea
            ref="noteInput"
            v-model="draft.note"
            aria-label="备注"
            placeholder="备注，可粘贴交易短信"
            :rows="1"
            @focus="noteEditing = true"
            @compositionstart="compositionStart"
            @compositionend="compositionEnd"
          ></textarea>
        </label>
        <p id="recognition-mode-hint" class="sr-only">
          {{
            autoRecognition ? '明确的金额和分类直接填入，手动改过的会保留。' : '点击识别备注，再核对结果。'
          }}
        </p>
        <p v-if="modeNotRemembered" class="hint entry-mode-warning">
          本次可正常使用，当前环境无法记住识别开关。
        </p>
        <div
          v-if="parsed || recognitionQueued || hasPreOpening || duplicates.length"
          class="entry-feedback-strip"
        >
          <button
            v-if="parsed"
            type="button"
            class="recognition-summary"
            :class="{ pending: recognitionPending }"
            @click="
              finishNote();
              recognitionOpen = true;
            "
          >
            {{ recognitionPending ? '识别结果待核对' : automaticSummary }}<Icon name="right" :size="13" />
          </button>
          <span v-else-if="recognitionQueued" class="hint">识别中…</span>
          <button
            v-if="hasPreOpening || duplicates.length"
            type="button"
            class="entry-check-summary"
            @click="
              finishNote();
              checksOpen = true;
            "
          >
            {{ hasPreOpening ? '早于账户起算时间' : '疑似重复记录'
            }}{{ checksComplete ? ' · 已核对' : ' · 查看' }}<Icon name="right" :size="13" />
          </button>
        </div>
        <div class="entry-context">
          <div class="entry-chips">
            <button
              type="button"
              class="entry-chip"
              aria-label="修改发生时间"
              :title="draft.at.replace('T', ' ')"
              @click="openDate"
            >
              <Icon name="calendar" :size="15" /><span>{{ dateLabel }}</span>
            </button>
            <button
              v-if="!twoAccounts"
              type="button"
              class="entry-chip"
              :aria-label="
                draft.type === 'expense' ? '付款账户' : draft.type === 'refund' ? '退款入账账户' : '收款账户'
              "
              @click="accountPicker = draft.type === 'expense' ? 'from' : 'to'"
            >
              <Icon name="credit" :size="15" /><span>{{
                accountName(draft.type === 'expense' ? draft.from : draft.to)
              }}</span>
            </button>
          </div>

          <button
            v-if="twoAccounts"
            type="button"
            class="entry-chip direction-summary"
            aria-label="查看付款与收款账户"
            :title="accountName(draft.from) + ' → ' + accountName(draft.to)"
            @click="showDirection"
          >
            <Icon name="transfer" :size="15" /><span
              >{{ accountName(draft.from) }} → {{ accountName(draft.to) }}</span
            >
          </button>
        </div>
        <p
          v-if="(error || ui.error) && !recognitionOpen && !checksOpen"
          class="field-error entry-error"
          role="alert"
        >
          {{ error || ui.error }}
        </p>
        <div v-show="!keyboardOpen" class="entry-keypad-area">
          <p v-if="keypadTarget === 'interest' && showInterest" class="hint">
            利息 ¥ {{ interest || '0.00' }}
            <button type="button" class="text-button" @click="keypadTarget = 'amount'">完成</button>
          </p>
          <div class="entry-keypad" aria-label="金额键盘">
            <template
              v-for="key in [
                '7',
                '8',
                '9',
                'delete',
                '4',
                '5',
                '6',
                'again',
                '1',
                '2',
                '3',
                'save',
                '0',
                '.',
                '00',
              ]"
              :key="key"
            >
              <button
                v-if="key === 'save'"
                type="button"
                class="key-save"
                :disabled="ui.busy"
                aria-label="保存账目"
                @click="save()"
              >
                {{ ui.busy ? '保存中…' : '保存' }}
              </button>
              <button
                v-else-if="key === 'again'"
                type="button"
                class="key-again"
                :disabled="ui.busy"
                aria-label="保存并再记"
                @click="save(true)"
              >
                再记
              </button>
              <button
                v-else
                type="button"
                :aria-label="key === 'delete' ? '删除末位金额' : key"
                @click="keypress(key)"
              >
                <Icon v-if="key === 'delete'" name="backspace" /><template v-else>{{ key }}</template>
              </button>
            </template>
          </div>
        </div>
      </div>
    </form>
    <template #feedback
      ><div v-if="openingNotice && !checksOpen" class="entry-opening-toast" role="status">
        <Icon name="check" :size="18" /><span>{{ openingNotice }}</span>
      </div></template
    ></Modal
  >
  <RecognitionReview
    v-if="parsed && recognitionOpen"
    :result="parsed"
    :draft="draft"
    :amount="amount"
    :automatic="autoRecognition"
    :protected-fields="protectedFields"
    :state="state!"
    @close="finishRecognition"
    @keep="clearRecognition"
    @apply="applyRecognition"
    @add-account="
      ui.accountId = '';
      ui.accountForm = true;
    "
  />
  <Modal v-if="checksOpen" title="保存前核对" @close="checksOpen = false">
    <div v-if="duplicates.length" class="warning-panel">
      <p>发现 {{ duplicates.length }} 笔疑似重复记录</p>
      <button v-for="e in duplicates" type="button" class="text-button" @click="ui.detailId = e.id">
        查看 {{ e.data.at.replace('T', ' ') }} · ¥{{ money(e.data.amount) }}</button
      ><label class="checkbox"
        ><input v-model="confirmDuplicate" type="checkbox" />已核对，仍然保存本笔真实交易</label
      >
    </div>
    <div v-if="hasPreOpening" class="warning-panel opening-warning">
      <label class="checkbox"
        ><input
          v-model="confirmOpening"
          type="checkbox"
        />早于账户起算时间，本笔仅供历史查询，不改变期初之后的余额</label
      >
      <div class="opening-warning-actions">
        <button
          v-for="a in preOpeningAccounts"
          :key="a.id"
          type="button"
          class="text-button"
          :disabled="ui.busy"
          @click="openAccountOpening(a.id)"
        >
          <Icon name="calendar" :size="15" />{{
            preOpeningAccounts.length === 1 ? '调整起算时间' : `调整「${a.data.name}」起算时间`
          }}
        </button>
      </div>
    </div>

    <p v-if="!hasPreOpening && !duplicates.length" class="hint">当前没有需要额外核对的事项。</p>
    <p v-if="error || ui.error" class="field-error" role="alert">{{ error || ui.error }}</p>
    <button
      type="button"
      class="primary full"
      @click="
        checksOpen = false;
        error = '';
      "
    >
      返回记账
    </button>
    <template #feedback
      ><div v-if="openingNotice" class="entry-opening-toast" role="status">
        <Icon name="check" :size="18" /><span>{{ openingNotice }}</span>
      </div></template
    >
  </Modal>
  <Modal v-if="helpOpen" title="识别备注怎么用" @close="helpOpen = false"
    ><p>输入用途和金额，或粘贴交易短信。自动识别开启后，明确的金额和分类直接填入，手动改过的会保留。</p>
    <p>不确定的金额、分类、账户和年份需核对后再保存。备注只在本机识别。</p></Modal
  >

  <AccountOpeningDialog
    v-if="openingAccountId"
    :key="openingAccountId"
    :account-id="openingAccountId"
    :transaction-at="draft.at"
    @close="openingAccountId = ''"
    @applied="openingAdjusted"
  />

  <AccountPicker
    v-if="accountPicker"
    :title="accountPickerTitle"
    :accounts="availableAccounts"
    :state="state!"
    :selected="draft[accountPicker]"
    :empty-hint="
      isLoan && accountPicker === counterpartSide
        ? '先添加应收 / 应付账户，再选择往来方。'
        : '还没有资金账户，先添加一个吧。'
    "
    @close="accountPicker = ''"
    @select="pickedAccount"
    @add="
      ui.accountId = '';
      ui.accountForm = true;
    "
  />
  <EntryDateTimePicker v-if="datePicker" :value="draft.at" @confirm="setDate" @close="datePicker = false" />
</template>
<style scoped>
.selection-list button.active {
  background: var(--soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.recognition-mode-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0;
  font-size: 14px;
}
.recognition-switch-track {
  display: inline-flex;
  width: 40px;
  height: 24px;
  padding: 3px;
  border-radius: 20px;
  background: var(--line);
}
.recognition-switch-track > span {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 1px 3px #0002;
  transition: transform 140ms;
}
.recognition-mode-switch[aria-checked='true'] .recognition-switch-track {
  background: var(--accent);
}
.recognition-mode-switch[aria-checked='true'] .recognition-switch-track > span {
  transform: translateX(16px);
  background: var(--on-accent);
}
.recognition-candidates button {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.recognition-candidates button[aria-pressed='true'] {
  box-shadow: inset 0 0 0 1px var(--accent);
  font-weight: 700;
}
.recognition-panel .hint {
  overflow-wrap: anywhere;
}
.opening-warning .checkbox {
  margin: 0;
}
.opening-warning-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.opening-warning-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  overflow-wrap: anywhere;
}
.entry-opening-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
  padding: 14px 18px;
  border-radius: 12px;
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 8px 24px #0003;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.entry-opening-toast svg {
  flex-shrink: 0;
}
</style>
