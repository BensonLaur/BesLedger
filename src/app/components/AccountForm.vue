<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { state, ui, mutate, run } from '../store';
import { put } from '../../domain/model';
import { decimal, minor } from '../../domain/money';
import { localTime } from '../../domain/time';
import { accountKind, accountKinds, type AccountKind } from '../account-presentation';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
const existing = ui.accountId ? state.value?.entities[ui.accountId] : undefined;
const original = existing?.data.kind === 'account' ? existing.data : undefined;
const kind = ref<AccountKind>(original ? accountKind(original) : 'cash');
const choosing = ref(!original);
type Draft = {
  name: string;
  opening: string;
  openedAt: string;
  bank: string;
  tail: string;
  due: string;
  owes: boolean;
};
const drafts = reactive<Partial<Record<AccountKind, Draft>>>({});
function blank(selected: AccountKind): Draft {
  return {
    name: '',
    opening: '',
    openedAt: localTime(),
    bank: '',
    tail: '',
    due: '',
    owes: selected === 'credit',
  };
}
if (original)
  drafts[kind.value] = {
    name: original.name,
    opening: decimal(
      ['credit', 'receivable', 'liability'].includes(original.type) || kind.value === 'other'
        ? Math.abs(original.opening)
        : original.opening,
    ),
    openedAt: original.openedAt,
    bank: original.bank,
    tail: original.tail,
    due: original.repaymentDay?.toString() || '',
    owes:
      original.opening < 0 ||
      original.type === 'liability' ||
      (original.type === 'credit' && original.opening === 0),
  };
const draft = computed(() => drafts[kind.value] ?? (drafts[kind.value] = blank(kind.value)));
const info = computed(() => accountKinds[kind.value]);
const directional = computed(() => ['credit', 'receivable', 'other'].includes(kind.value));
const amountLabel = computed(() =>
  kind.value === 'credit'
    ? draft.value.owes
      ? '还欠多少钱（元）'
      : '卡里多存的钱（元）'
    : kind.value === 'receivable'
      ? draft.value.owes
        ? '我欠对方多少钱（元）'
        : '对方欠我多少钱（元）'
      : kind.value === 'other' && draft.value.owes
        ? '还欠多少钱（元）'
        : '账户里有多少钱（元）',
);
function choose(selected: AccountKind) {
  kind.value = selected;
  choosing.value = false;
}
async function save() {
  await run(async () => {
    const d = draft.value;
    let amount = minor(d.opening || '0');
    if (directional.value && amount < 0) throw new Error('只需填写金额大小，再选择是谁欠谁的钱。');
    // 用户只选择生活中的资金方向，保存时才转换为余额符号；编辑时不再次翻转。
    if (directional.value && d.owes) amount = -amount;
    await mutate((s) =>
      put(
        s,
        {
          kind: 'account',
          name: d.name.trim(),
          type: kind.value === 'other' && d.owes ? 'liability' : info.value.type,
          displayType: kind.value,
          opening: amount,
          openedAt: d.openedAt.length === 16 ? `${d.openedAt}:00` : d.openedAt,
          bank: ['bank', 'credit'].includes(kind.value) ? d.bank : '',
          tail: ['bank', 'credit'].includes(kind.value) ? d.tail : '',
          ...(['credit', 'other'].includes(kind.value) && d.due ? { repaymentDay: Number(d.due) } : {}),
        },
        ui.accountId || undefined,
      ),
    );
    ui.accountForm = false;
  });
}
</script>
<template>
  <Modal
    :title="choosing ? '选择账户类型' : original ? '编辑账户' : '添加账户'"
    page
    @close="choosing || original ? (ui.accountForm = false) : (choosing = true)"
  >
    <div class="account-flow">
      <template v-if="choosing">
        <p class="flow-caption">添加账户 · 先选择类型</p>
        <div class="account-type-list">
          <button v-for="(item, key) in accountKinds" :key="key" type="button" @click="choose(key)">
            <span class="entry-icon" :class="'account-tone-' + key"
              ><Icon :name="item.icon" :size="25"
            /></span>
            <span
              ><strong>{{ item.name }}</strong
              ><small>{{ item.hint }}</small></span
            ><Icon name="right" :size="18" />
          </button>
        </div>
      </template>
      <form v-else @submit.prevent="save">
        <p class="flow-caption">{{ original ? '编辑账户' : '添加账户 · 填写信息' }}</p>
        <div class="account-fields-card">
          <div class="chosen-account-kind">
            <span class="entry-icon"><Icon :name="info.icon" /></span><strong>{{ info.name }}</strong
            ><button class="text-button" type="button" @click="choosing = true">更换类型</button>
          </div>
          <label
            >{{ kind === 'receivable' ? '对方怎么称呼' : '账户名称'
            }}<input v-model="draft.name" required maxlength="100" :placeholder="info.placeholder"
          /></label>
          <fieldset v-if="directional" class="account-direction-choice">
            <legend>{{ kind === 'credit' ? '这张卡目前的情况' : '这笔钱的情况' }}</legend>
            <button type="button" :aria-pressed="draft.owes" @click="draft.owes = true">
              {{ kind === 'credit' ? '还有钱没还' : '我欠别人的钱' }}
            </button>
            <button type="button" :aria-pressed="!draft.owes" @click="draft.owes = false">
              {{
                kind === 'credit' ? '卡里有多存的钱' : kind === 'receivable' ? '别人欠我的钱' : '这是我的钱'
              }}
            </button>
          </fieldset>
          <div class="account-opening-fields">
            <label
              >{{ amountLabel }}<input v-model="draft.opening" inputmode="decimal" placeholder="0.00"
            /></label>
            <label
              >从什么时候开始记<input v-model="draft.openedAt" type="datetime-local" step="1" required
            /></label>
          </div>
          <p class="hint">
            填写开始记账时的金额，以后每笔收支会在此基础上增减。这笔起始金额不会算作收入或支出。
          </p>
          <template v-if="['bank', 'credit'].includes(kind)">
            <label>银行名称（选填）<input v-model="draft.bank" placeholder="例如：工商银行" /></label>
            <label
              >卡号后四位（选填）<input
                v-model="draft.tail"
                maxlength="4"
                pattern="[0-9]{4}|"
                inputmode="numeric"
                placeholder="用来匹配银行短信"
            /></label>
          </template>
          <label v-if="kind === 'credit' || (kind === 'other' && draft.owes)"
            >每月还款日（选填）<input
              v-model="draft.due"
              type="number"
              min="1"
              max="31"
              placeholder="例如：每月 10 日，填 10"
          /></label>
        </div>
        <p v-if="ui.error" class="field-error" role="alert">{{ ui.error }}</p>
        <button class="primary full account-save" :disabled="ui.busy">
          {{ ui.busy ? '保存中…' : '保存账户' }}
        </button>
      </form>
    </div>
  </Modal>
</template>
