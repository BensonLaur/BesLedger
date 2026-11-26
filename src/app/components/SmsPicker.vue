<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { categories } from '../../domain/categories';
import { money } from '../../domain/money';
import {
  prepareSmsBatch,
  reviewSmsDraft,
  saveSmsBatch,
  smsReviewContext,
  smsTime,
  type SmsDraft,
  type SmsMessage,
} from '../../domain/sms-import';
import { dayAdd, today, validTime } from '../../domain/time';
import { accounts, currentLedger, mutate, newEntry, state, ui } from '../store';
import Icon from './Icon.vue';
import Modal from './Modal.vue';

const inbox = registerPlugin<{
  query(options: { start: number; end: number; sender: string }): Promise<{ messages: SmsMessage[] }>;
}>('SmsInbox');
const banks = {
  '95588': '工商银行',
  '95533': '建设银行',
  '95599': '农业银行',
  '95566': '中国银行',
  '95555': '招商银行',
  '95559': '交通银行',
  '95580': '邮储银行',
};
const senderPreference = 'besledger.sms-bank';
function lastSender() {
  try {
    const saved = localStorage.getItem(senderPreference);
    if (saved && Object.hasOwn(banks, saved)) return saved;
  } catch {
    // 本机偏好不可用时仍允许本次查询。
  }
  return '95588';
}
const android = Capacitor.getPlatform() === 'android';
const ledgerId = currentLedger.value?.id ?? '';
const source = ref<'inbox' | 'paste'>(android ? 'inbox' : 'paste');
const sender = ref(lastSender());
const start = ref(dayAdd(today(), -6));
const end = ref(today());
const consent = ref(false);
const paste = ref('');
const rows = ref<SmsDraft[]>([]);
const selected = ref<string[]>([]);
const editing = ref('');
const busy = ref(false);
const searched = ref(false);
const error = ref('');
const notice = ref('');
const reviewError = ref('');
const section = ref<'ready' | 'review' | 'done'>('ready');
let active = true;
let beforeEdit: SmsDraft | undefined;
onBeforeUnmount(() => {
  active = false;
});

const accountOptions = computed(() => accounts.value.filter((account) => account.data.type !== 'receivable'));
const categoryOptions = computed(() => (state.value ? categories(state.value, ledgerId) : []));
const sections = computed(() => {
  const groups: Record<typeof section.value, Array<ReturnType<typeof summarize>>> = {
    ready: [],
    review: [],
    done: [],
  };
  if (!state.value) return groups;
  const context = smsReviewContext(state.value, ledgerId, undefined, rows.value);
  for (const row of rows.value) {
    const review = reviewSmsDraft(row, context);
    const group = review.existing ? 'done' : review.issue || editing.value === row.id ? 'review' : 'ready';
    groups[group].push(summarize(row, review));
  }
  return groups;
});
function summarize(row: SmsDraft, review: ReturnType<typeof reviewSmsDraft>) {
  const saved = review.existing?.data;
  return {
    row,
    review,
    at: saved?.at ?? row.at,
    type: saved?.type ?? row.type,
    amount: saved?.amount ?? review.amount,
    accountId: saved ? saved.from || saved.to : row.accountId,
    categoryId: saved?.categoryId ?? row.categoryId,
  };
}
const visible = computed(() => [...sections.value[section.value]].sort((a, b) => b.at.localeCompare(a.at)));
const selectedRows = computed(() =>
  sections.value.ready.filter(({ row }) => selected.value.includes(row.id)).map(({ row }) => row),
);
const tabs = [
  { key: 'ready', label: '可保存' },
  { key: 'review', label: '待核对' },
  { key: 'done', label: '已记账' },
] as const;

function close() {
  if (!busy.value) ui.smsPicker = false;
}

async function find() {
  if (busy.value || ui.busy) return;
  error.value = '';
  notice.value = '';
  if (!ledgerId || !state.value) {
    error.value = '请先选择或创建账本';
    return;
  }
  busy.value = true;
  try {
    let messages: SmsMessage[];
    if (source.value === 'inbox') {
      if (!consent.value) throw new Error('请先同意读取本次选定范围');
      if (
        !validTime(`${start.value}T00:00:00`) ||
        !validTime(`${end.value}T00:00:00`) ||
        start.value > end.value ||
        end.value > today() ||
        end.value > dayAdd(start.value, 30)
      )
        throw new Error('请选择不超过 31 天的有效日期范围');
      const result = await inbox.query({
        start: Date.parse(`${start.value}T00:00:00+08:00`),
        end: Date.parse(`${end.value}T23:59:59.999+08:00`),
        sender: sender.value,
      });
      messages = result.messages;
      try {
        localStorage.setItem(senderPreference, sender.value);
      } catch {
        /* 不影响本次查询。 */
      }
    } else {
      messages = paste.value
        .split(/\r?\n/)
        .map((body) => body.trim())
        .filter(Boolean)
        .map((body) => ({ body }));
      if (!messages.length) throw new Error('请粘贴银行交易短信');
      if (messages.length > 200 || paste.value.length > 200000)
        throw new Error('请分批粘贴，每次最多 200 条短信');
    }
    if (!active || !state.value) return;
    const prepared = await prepareSmsBatch(state.value, ledgerId, messages);
    if (!active) return;
    editing.value = '';
    beforeEdit = undefined;
    rows.value = prepared;
    searched.value = true;
    selected.value = sections.value.ready.map(({ row }) => row.id);
    section.value = sections.value.ready.length ? 'ready' : sections.value.review.length ? 'review' : 'done';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '查找交易失败，请重试或粘贴短信';
  } finally {
    busy.value = false;
  }
}

function edit(row: SmsDraft) {
  cancelEdit();
  reviewError.value = '';
  beforeEdit = { ...row };
  editing.value = row.id;
  section.value = 'review';
}

function cancelEdit() {
  const row = rows.value.find(({ id }) => id === editing.value);
  if (row && beforeEdit) Object.assign(row, beforeEdit);
  beforeEdit = undefined;
  editing.value = '';
  reviewError.value = '';
}

function confirm(row: SmsDraft) {
  if (!state.value) return;
  const context = smsReviewContext(state.value, ledgerId, undefined, rows.value);
  const review = reviewSmsDraft(row, context);
  if (review.validDate) row.confirmedAt = review.at;
  const checked = reviewSmsDraft(row, context);
  if (checked.existing || !checked.issue) {
    editing.value = '';
    beforeEdit = undefined;
    if (!checked.existing) {
      if (!selected.value.includes(row.id)) selected.value.push(row.id);
      if (!sections.value.review.length) section.value = 'ready';
    } else section.value = 'done';
    return;
  }
  reviewError.value = checked.issue;
}

function recordSeparately(row: SmsDraft) {
  if (row.recognition.type === 'refund') return;
  const type = row.recognition.warnings.some((warning) => warning.includes('转账或借还'))
    ? 'transfer'
    : 'expense';
  newEntry(type, {
    ledgerId,
    note: row.body,
    ...(row.recognition.at && row.confirmedAt ? { at: row.confirmedAt } : {}),
  });
}

async function save() {
  if (busy.value || ui.busy || !selectedRows.value.length) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  const batch = selectedRows.value;
  try {
    const count = await mutate((s) => saveSmsBatch(s, ledgerId, batch));
    const saved = new Set(batch.map(({ id }) => id));
    selected.value = selected.value.filter((id) => !saved.has(id));
    notice.value = count ? `已保存 ${count} 笔` : '所选交易已记账';
    if (!sections.value.ready.length) section.value = sections.value.review.length ? 'review' : 'done';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '批量保存失败，已保留本次核对结果';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal class="sms-import" title="短信记账" page wide @close="close">
    <form class="sms-sources" @submit.prevent="find">
      <p v-if="!ledgerId" class="field-error">请先选择或创建账本</p>
      <div v-else class="sms-source-heading">
        <span class="hint">{{ currentLedger?.data.name }}</span>
        <button
          v-if="android"
          type="button"
          class="text-button"
          :disabled="busy"
          @click="
            source = source === 'inbox' ? 'paste' : 'inbox';
            error = '';
          "
        >
          {{ source === 'inbox' ? '粘贴短信' : '从收件箱查找' }}
        </button>
      </div>
      <fieldset v-if="source === 'inbox'" :disabled="busy || !ledgerId">
        <label class="sms-bank"
          >银行发送方
          <select v-model="sender">
            <option v-for="(name, number) in banks" :key="number" :value="number">
              {{ name }} {{ number }}
            </option>
          </select>
        </label>
        <div class="sms-pair">
          <label>开始日期<input v-model="start" type="date" :max="today()" /></label>
          <label>结束日期<input v-model="end" type="date" :max="today()" /></label>
        </div>
        <label class="checkbox">
          <input v-model="consent" type="checkbox" />
          同意本次在手机上读取所选银行和日期内的候选短信
        </label>
        <small class="hint">为展示候选会读取原文。每次最多 31 天、200 条候选。</small>
      </fieldset>
      <label v-else class="sms-paste"
        >银行交易短信
        <textarea
          v-model="paste"
          rows="3"
          placeholder="可粘贴多条，每条短信占一行"
          :disabled="busy || !ledgerId"
        />
      </label>
      <div class="sms-search">
        <small class="hint">未保存的短信只在本次核对中使用。</small>
        <button type="submit" class="primary" :disabled="busy || !ledgerId">
          <Icon name="search" :size="17" />{{ busy && !searched ? '查找中…' : '查找交易' }}
        </button>
      </div>
    </form>
    <template v-if="searched">
      <p v-if="!rows.length" class="hint sms-empty">没有找到已发生的银行交易。</p>
      <template v-else>
        <nav class="sms-tabs" aria-label="交易状态">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            :disabled="busy"
            :aria-pressed="section === tab.key"
            @click="
              cancelEdit();
              section = tab.key;
            "
          >
            {{ tab.label }} {{ sections[tab.key].length }}
          </button>
        </nav>
        <p v-if="!visible.length" class="hint sms-empty">此处暂无交易。</p>
        <p v-else-if="section === 'ready'" class="sms-select-all">
          <button
            type="button"
            class="text-button"
            :disabled="busy"
            @click="
              selected =
                selectedRows.length === sections.ready.length ? [] : sections.ready.map(({ row }) => row.id)
            "
          >
            {{ selectedRows.length === sections.ready.length ? '取消全选' : '全选可保存' }}
          </button>
        </p>
        <template
          v-for="({ row, review, at, type, amount, accountId, categoryId }, i) in visible"
          :key="row.id"
        >
          <h3 v-if="i === 0 || at.slice(0, 10) !== visible[i - 1].at.slice(0, 10)" class="sms-day">
            {{ at.slice(0, 10) || '日期待核对' }}
          </h3>
          <article class="sms-transaction">
            <div class="sms-line">
              <input
                v-if="section === 'ready'"
                v-model="selected"
                type="checkbox"
                :disabled="busy"
                :value="row.id"
                :aria-label="`选择${row.summary} ${row.at.slice(11, 16)}`"
              />
              <div class="sms-description">
                <strong>{{ row.summary }}</strong>
                <small>
                  {{ at.slice(11, 16) || '时间待核对' }}
                  ·
                  {{ accountOptions.find((account) => account.id === accountId)?.data.name || '账户待核对' }}
                  ·
                  {{ categoryOptions.find((category) => category.id === categoryId)?.name || '分类待核对' }}
                </small>
              </div>
              <span class="sms-amount">{{
                amount ? (type === 'expense' ? '−' : '') + '¥' + money(amount) : '金额待核对'
              }}</span>
            </div>
            <div class="sms-actions">
              <template v-if="review.existing">
                <span v-if="review.existing.deleted" class="hint">已在回收站</span>
                <button v-else type="button" class="text-button" @click="ui.detailId = review.existing.id">
                  查看账目
                </button>
              </template>
              <button
                v-else-if="editing !== row.id"
                type="button"
                class="text-button"
                :disabled="busy"
                @click="edit(row)"
              >
                {{ review.issue || '修改' }}
              </button>
            </div>
            <template v-if="editing === row.id && !review.existing">
              <div v-if="row.type" class="sms-edit">
                <div class="sms-pair">
                  <label>交易金额（元）<input v-model="row.amount" inputmode="decimal" /></label>
                  <label>发生时间<input v-model="row.at" type="datetime-local" /></label>
                </div>
                <div class="sms-pair">
                  <label
                    >资金账户
                    <select v-model="row.accountId">
                      <option value="">选择账户</option>
                      <option v-for="account in accountOptions" :key="account.id" :value="account.id">
                        {{ account.data.name }}
                      </option>
                    </select>
                  </label>
                  <label
                    >交易分类
                    <select v-model="row.categoryId">
                      <option value="">选择分类</option>
                      <option
                        v-for="category in categoryOptions.filter((item) => item.type === row.type)"
                        :key="category.id"
                        :value="category.id"
                      >
                        {{ category.name }}
                      </option>
                    </select>
                  </label>
                </div>
                <label v-if="review.historyKey" class="checkbox">
                  <input
                    v-model="row.acceptedHistory"
                    type="checkbox"
                    :true-value="review.historyKey"
                    false-value=""
                  />
                  早于账户起算时间，只作为历史记录
                </label>
                <template v-if="review.duplicateKey">
                  <p v-if="review.earlierRow" class="hint">同批短信中还有一笔相同时间、金额和账户的交易。</p>
                  <button
                    v-for="duplicate in review.duplicates"
                    :key="duplicate.id"
                    type="button"
                    class="text-button"
                    @click="ui.detailId = duplicate.id"
                  >
                    查看疑似重复账目 {{ duplicate.data.at.slice(0, 16).replace('T', ' ') }}
                  </button>
                  <label class="checkbox">
                    <input
                      v-model="row.acceptedDuplicate"
                      type="checkbox"
                      :true-value="review.duplicateKey"
                      false-value=""
                    />
                    已核对，这是另一笔交易
                  </label>
                </template>
                <p v-if="reviewError" class="field-error" role="alert">{{ reviewError }}</p>
                <div class="actions">
                  <button type="button" class="text-button" @click="cancelEdit">取消修改</button>
                  <button type="button" class="secondary" @click="confirm(row)">确认本笔</button>
                </div>
              </div>
              <div v-else class="sms-edit">
                <p class="hint">
                  {{
                    row.recognition.type === 'refund'
                      ? '请在原支出详情中添加退款。'
                      : '这条短信无法批量入账，请逐笔核对。'
                  }}
                </p>
                <button
                  v-if="row.recognition.type !== 'refund'"
                  type="button"
                  class="secondary"
                  @click="recordSeparately(row)"
                >
                  记一笔
                </button>
              </div>
            </template>
            <details class="sms-original">
              <summary>短信原文</summary>
              <p>{{ row.body }}</p>
            </details>
          </article>
        </template>
      </template>
    </template>
    <template #footer>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="sms-footer">
        <span class="hint" role="status">{{ notice || `已选 ${selectedRows.length} 笔` }}</span>
        <button class="primary" :disabled="busy || !!editing || !selectedRows.length" @click="save">
          保存 {{ selectedRows.length }} 笔
        </button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.sms-import :deep(.modal-footer) {
  flex: none;
  padding: 8px 16px max(12px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: var(--surface);
}
.sms-source-heading,
.sms-search,
.sms-footer,
.sms-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sms-source-heading,
.sms-search,
.sms-footer {
  justify-content: space-between;
}
.sms-search {
  margin-block: 10px 16px;
}
.sms-search button,
.sms-footer button {
  flex: none;
}
.sms-sources fieldset {
  display: grid;
  gap: 8px;
  padding: 0;
  border: 0;
  min-width: 0;
}
.sms-pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.sms-pair label,
.sms-bank,
.sms-paste {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.sms-pair input,
.sms-pair select {
  width: 100%;
  min-width: 0;
}
.sms-paste textarea {
  min-height: 76px;
}
.sms-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--soft);
}
.sms-tabs button {
  flex: 1;
  min-width: 0;
  padding: 6px 0;
  border-radius: 8px;
  font-size: 13px;
}
.sms-tabs button[aria-pressed='true'] {
  background: var(--surface);
  color: var(--accent);
  font-weight: 650;
}
.sms-empty {
  padding: 12px 0;
}
.sms-select-all,
.sms-actions {
  display: flex;
  justify-content: flex-end;
  margin: 0;
}
.sms-day {
  font-size: 13px;
  color: var(--muted);
  margin: 12px 0 4px;
}
.sms-transaction {
  border-bottom: 1px solid var(--line);
  padding: 8px 0;
}
.sms-description {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.sms-description small {
  display: block;
  color: var(--muted);
}
.sms-amount {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.sms-edit {
  display: grid;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: var(--soft);
}
.sms-edit button {
  justify-self: start;
}
.sms-original {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}
.sms-original p {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
