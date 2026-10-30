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
import { accountIcon } from '../account-presentation';
import AccountOpeningDialog from './AccountOpeningDialog.vue';
const draft = reactive(structuredClone(toRaw(ui.draft!)));
const amount = ref(draft.amount ? decimal(draft.amount) : ''),
  interest = ref(decimal(draft.interest));
const tab = ref(
  ['borrow', 'lend', 'repay', 'collect'].includes(draft.type)
    ? 'loan'
    : draft.type === 'refund'
      ? 'refund'
      : draft.type,
);
const datePicker = ref(false),
  dateInput = ref(draft.at),
  expandedGroup = ref('餐饮');
const keypadTarget = ref<'amount' | 'interest'>('amount');
function keypress(key: string) {
  const target = keypadTarget.value === 'interest' ? interest : amount;
  let value = target.value;
  if (key === 'delete') value = value.slice(0, -1);
  else if (key === '.') {
    if (!value.includes('.')) value = (value || '0') + '.';
  } else value = value === '0' ? key : value + key;
  if (/^\d{0,12}(?:\.\d{0,2})?$/.test(value)) target.value = value;
}
const showInterest = ref(draft.interest > 0),
  categoryPicker = ref(false),
  categorySearch = ref(''),
  newCategory = ref('');
const accountPicker = ref<'from' | 'to' | ''>(''),
  parsed = ref<Recognition>(),
  confirmDuplicate = ref(false),
  confirmOpening = ref(false),
  recognitionPending = ref(false),
  error = ref('');
// 修改备注后旧识别预览立即失效，避免采用上一段文字的金额；不自动覆盖手动字段。
watch(
  () => draft.note,
  () => {
    parsed.value = undefined;
    recognitionPending.value = false;
  },
);
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
  parsed.value = undefined;
  recognitionPending.value = false;
}
function accountName(id: string) {
  return accounts.value.find((a) => a.id === id)?.data.name || '选择账户';
}
function parse() {
  parsed.value = recognize(draft.note, accounts.value);
  recognitionPending.value = true;
}
onMounted(() => {
  if (!ui.editingId && draft.note) parse();
});
function onPaste() {
  window.setTimeout(parse, 0);
}
function applyRecognition() {
  const p = parsed.value;
  if (!p) return;
  if (p.type && !twoAccounts.value) {
    draft.type = p.type;
    tab.value = p.type;
  }
  if (p.amount !== undefined) amount.value = decimal(p.amount);
  if (p.at) draft.at = p.at;
  if (p.accountIds.length === 1) {
    if (['income', 'refund', 'collect', 'borrow'].includes(draft.type)) draft.to = p.accountIds[0];
    else draft.from = p.accountIds[0];
  }
  if (p.categoryIds.length === 1) draft.categoryId = p.categoryIds[0];
  draft.recognition = { rawDate: p.rawDate, yearBasis: p.yearBasis, confirmed: true, balance: p.balance };
  recognitionPending.value = false;
  parsed.value = undefined;
}
const normalizedEntryTime = computed(() => (draft.at.length === 16 ? `${draft.at}:00` : draft.at));
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
function close() {
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
    draft.categoryId = e.id;
    newCategory.value = '';
    categoryPicker.value = false;
  });
}
async function save(again = false) {
  error.value = '';
  if (recognitionPending.value) {
    error.value = '请先确认采用或保留备注识别结果';
    return;
  }
  if (duplicates.value.length && !confirmDuplicate.value) {
    error.value = '疑似重复，请打开原记录核对，或确认仍然保存';
    return;
  }
  if (hasPreOpening.value && !confirmOpening.value) {
    error.value = '请确认早于期初的记录只用于历史查询';
    return;
  }
  const ok = await run(async () => {
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
  <Modal :title="ui.editingId ? '编辑账目' : '记一笔'" page wide @close="close"
    ><form class="entry-form" @submit.prevent="save()">
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
            (twoAccounts ? (draft.type === 'transfer' ? draft.behavior : typeLabels[draft.type]) : '选择分类')
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
          />
        </div>
      </div>
      <div v-if="draft.type === 'expense' || draft.type === 'income'" class="category-grid">
        <button
          v-for="c in quickItems"
          type="button"
          :class="{ active: draft.categoryId === c.id }"
          :aria-pressed="draft.categoryId === c.id"
          @click="draft.categoryId = c.id"
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
      <div v-if="twoAccounts" class="account-direction">
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
      <label
        >备注<textarea
          aria-label="备注"
          v-model="draft.note"
          placeholder="例如：停车费10块，也可以粘贴交易短信"
          rows="3"
          @paste="onPaste"
        ></textarea></label
      ><button v-if="draft.note.trim()" class="text-button" type="button" @click="parse">识别备注</button>
      <div v-if="parsed" class="recognition-panel">
        <strong>请核对识别结果</strong>
        <p>
          金额 {{ parsed.amount === undefined ? '未识别' : '¥ ' + money(parsed.amount) }} ·
          {{ parsed.type ? typeLabels[parsed.type] : '类型待确认' }}
        </p>
        <p v-if="parsed.amountSource" class="hint">金额依据：{{ parsed.amountSource }}</p>
        <div v-if="parsed.amountCandidates.length > 1" class="recognition-candidates">
          <small>金额候选 · 请选择本次实际金额</small>
          <button
            v-for="(candidate, index) in parsed.amountCandidates"
            :key="index"
            type="button"
            class="secondary"
            :aria-pressed="parsed.amountIndex === index"
            @click="
              parsed.amount = candidate.amount;
              parsed.amountSource = candidate.text;
              parsed.amountIndex = index;
            "
          >
            {{ candidate.text }} · ¥ {{ money(candidate.amount) }}
          </button>
        </div>
        <p>{{ parsed.at?.replace('T', ' ') || '保留当前时间' }}</p>
        <div v-if="parsed.categoryIds.length" class="recognition-candidates">
          <small>分类候选</small>
          <button
            v-for="id in parsed.categoryIds"
            :key="id"
            type="button"
            class="secondary"
            @click="draft.categoryId = id"
          >
            {{ categories(state!, draft.ledgerId).find((c) => c.id === id)?.name || id
            }}{{ draft.categoryId === id ? ' ✓' : '' }}
          </button>
        </div>
        <div v-if="parsed.accountIds.length" class="recognition-candidates">
          <small>账户候选</small>
          <button
            v-for="id in parsed.accountIds"
            :key="id"
            type="button"
            class="secondary"
            @click="
              ['income', 'refund', 'collect', 'borrow'].includes(parsed.type || draft.type)
                ? (draft.to = id)
                : (draft.from = id)
            "
          >
            {{ accountName(id) }}{{ [draft.from, draft.to].includes(id) ? ' ✓' : '' }}
          </button>
        </div>
        <p v-for="warning in parsed.warnings" class="hint">{{ warning }}</p>
        <p v-if="parsed.balance !== undefined" class="hint">
          备注中的余额 ¥ {{ money(parsed.balance) }} 仅供核对，不会覆盖账户余额。
        </p>
        <div class="actions">
          <button
            type="button"
            class="secondary"
            @click="
              parsed = undefined;
              recognitionPending = false;
            "
          >
            保留手动填写</button
          ><button type="button" class="primary" @click="applyRecognition">采用并继续核对</button>
        </div>
      </div>
      <div class="entry-chips">
        <button
          type="button"
          class="entry-chip"
          aria-label="修改发生时间"
          @click="
            dateInput = draft.at;
            datePicker = true;
          "
        >
          <Icon name="calendar" :size="15" />{{ draft.at.slice(0, 16).replace('T', ' ') }}
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
          <Icon name="credit" :size="15" />{{ accountName(draft.type === 'expense' ? draft.from : draft.to) }}
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
        >约定{{ draft.type === 'borrow' ? '还款' : '收回' }}日（可选）<input v-model="draft.due" type="date"
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
      <p v-if="error || ui.error" class="field-error" role="alert">{{ error || ui.error }}</p>
      <p v-if="keypadTarget === 'interest' && showInterest" class="hint">
        正在输入利息 <button type="button" class="text-button" @click="keypadTarget = 'amount'">完成</button>
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
          <button v-if="key === 'save'" class="key-save" :disabled="ui.busy" aria-label="保存账目">
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
    </form>
    <template #feedback
      ><div v-if="openingNotice" class="entry-opening-toast" role="status">
        <Icon name="check" :size="18" /><span>{{ openingNotice }}</span>
      </div></template
    ></Modal
  >
  <AccountOpeningDialog
    v-if="openingAccountId"
    :key="openingAccountId"
    :account-id="openingAccountId"
    :transaction-at="draft.at"
    @close="openingAccountId = ''"
    @applied="openingAdjusted"
  />
  <Modal v-if="categoryPicker" title="全部分类" page @close="categoryPicker = false"
    ><input v-model="categorySearch" aria-label="搜索分类" placeholder="搜索大类或分类" />
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
              draft.categoryId = c.id;
              categoryPicker = false;
            "
          >
            <Icon :name="c.icon" :size="21" />{{ c.name }}
          </button>
        </div>
      </section>
      <p v-if="!filteredCategories.length" class="hint">没有找到，可以在下方添加。</p>
    </div>
    <form class="inline-form" @submit.prevent="createCategory">
      <input
        v-model="newCategory"
        aria-label="自定义分类名称"
        placeholder="添加自定义分类"
        maxlength="100"
      /><button class="primary" :disabled="ui.busy">添加</button>
    </form></Modal
  >
  <Modal v-if="accountPicker" title="选择资金账户" @close="accountPicker = ''"
    ><div class="selection-list">
      <button
        v-for="a in availableAccounts"
        :key="a.id"
        @click="
          draft[accountPicker as 'from' | 'to'] = a.id;
          accountPicker = '';
        "
      >
        <Icon :name="accountIcon(a.data)" /><span
          >{{ a.data.name }}<small>{{ a.data.tail ? '尾号 ' + a.data.tail : '' }}</small></span
        ><Icon name="right" />
      </button>
    </div>
    <p v-if="!availableAccounts.length" class="hint">
      请先在账户页添加{{ isLoan && accountPicker === counterpartSide ? '应收应付' : '资金' }}账户。
    </p>
    <button
      class="text-button"
      @click="
        ui.accountId = '';
        ui.accountForm = true;
      "
    >
      ＋ 添加账户
    </button></Modal
  >
  <Modal v-if="datePicker" title="发生时间" @close="datePicker = false"
    ><form
      @submit.prevent="
        draft.at = dateInput;
        datePicker = false;
      "
    >
      <label>发生时间<input v-model="dateInput" type="datetime-local" step="1" required /></label>
      <p class="hint">按实际发生时间记账，补记旧账时请核对年份。</p>
      <button class="primary full">确定</button>
    </form></Modal
  >
</template>
<style scoped>
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
