<script setup lang="ts">
import { ref } from 'vue';
import { state, ui, mutate, run } from '../store';
import { put, type Account } from '../../domain/model';
import { decimal, minor } from '../../domain/money';
import { localTime } from '../../domain/time';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
const existing = ui.accountId ? state.value?.entities[ui.accountId] : undefined;
const original = existing?.data.kind === 'account' ? existing.data : undefined;
const name = ref(original?.name || ''),
  type = ref<Account['type']>(original?.type || 'cash'),
  opening = ref(original ? decimal(original.opening) : '0'),
  openedAt = ref(original?.openedAt || localTime()),
  bank = ref(original?.bank || ''),
  tail = ref(original?.tail || ''),
  due = ref(original?.repaymentDay?.toString() || ''),
  debt = ref(false);
const types: { id: Account['type']; name: string; icon: string }[] = [
  { id: 'cash', name: '现金', icon: 'wallet' },
  { id: 'bank', name: '储蓄卡', icon: 'bank' },
  { id: 'wallet', name: '网络钱包', icon: 'wallet' },
  { id: 'credit', name: '信用卡', icon: 'credit' },
  { id: 'receivable', name: '应收应付', icon: 'users' },
  { id: 'asset', name: '自定义资产', icon: 'chart' },
  { id: 'liability', name: '自定义负债', icon: 'receipt' },
];
async function save() {
  await run(async () => {
    let amount = minor(opening.value);
    if (debt.value && amount > 0) amount = -amount;
    await mutate((s) =>
      put(
        s,
        {
          kind: 'account',
          name: name.value,
          type: type.value,
          opening: amount,
          openedAt: openedAt.value.length === 16 ? `${openedAt.value}:00` : openedAt.value,
          bank: bank.value,
          tail: tail.value,
          ...(due.value ? { repaymentDay: Number(due.value) } : {}),
        },
        ui.accountId || undefined,
      ),
    );
    ui.accountForm = false;
  });
}
</script>
<template>
  <Modal :title="original ? '编辑共用账户' : '添加共用账户'" @close="ui.accountForm = false"
    ><form @submit.prevent="save">
      <div class="account-types">
        <button v-for="t in types" type="button" :class="{ active: type === t.id }" @click="type = t.id">
          <Icon :name="t.icon" :size="24" />{{ t.name }}
        </button>
      </div>
      <label>账户名称<input v-model="name" required maxlength="100" placeholder="例如：日常银行卡" /></label>
      <div class="form-grid">
        <label>期初余额（元）<input v-model="opening" inputmode="decimal" required /></label
        ><label>起算日期时间<input v-model="openedAt" type="datetime-local" step="1" required /></label>
      </div>
      <label class="checkbox"><input v-model="debt" type="checkbox" />将正数作为期初欠款保存</label>
      <p class="hint">
        期初不计收入或支出；早于起算时间的流水不会重复叠加。负数表示欠款，信用卡正数表示溢缴款。
      </p>
      <template v-if="['bank', 'credit'].includes(type)"
        ><label>银行名称<input v-model="bank" placeholder="例如：工商银行" /></label
        ><label
          >卡尾号（可选，仅末四位）<input
            v-model="tail"
            maxlength="4"
            pattern="[0-9]{4}|"
            inputmode="numeric" /></label></template
      ><label v-if="['credit', 'liability'].includes(type)"
        >每月还款日（可选）<input v-model="due" type="number" min="1" max="31"
      /></label>
      <p v-if="ui.error" class="field-error">{{ ui.error }}</p>
      <button class="primary full" :disabled="ui.busy">保存账户</button>
    </form></Modal
  >
</template>
