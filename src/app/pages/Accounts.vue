<script setup lang="ts">
import { computed, ref } from 'vue';
import { accounts, entries, state, ui, newEntry } from '../store';
import { accountBalance } from '../../domain/ledger';
import { money, sum } from '../../domain/money';
import { accountIcon, accountKind, accountKinds, balanceLabel } from '../account-presentation';
import { accountAmountsHidden as hidden, toggleAccountAmounts } from '../account-privacy';
import Icon from '../components/Icon.vue';
import EntryList from '../components/EntryList.vue';
import Modal from '../components/Modal.vue';
import { filterEntries } from '../../domain/reports';
const selected = ref('');
const explanation = ref(false);
// 仅保存列表展开偏好，不写入账本，也不参与云端同步。
function readGroups(): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem('besledger.account-groups') || '{}');
    return Object.fromEntries(
      Object.entries(value).filter(([key, item]) => key in accountKinds && typeof item === 'boolean'),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}
const collapsed = ref(readGroups());
function isCollapsed(kind: string) {
  return collapsed.value[kind] ?? accounts.value.length > 4;
}
function toggleGroup(kind: string) {
  collapsed.value[kind] = !isCollapsed(kind);
  try {
    localStorage.setItem('besledger.account-groups', JSON.stringify(collapsed.value));
  } catch {
    /* 存储不可用时，本次展开仍可正常使用。 */
  }
}
const values = computed(() =>
  accounts.value.map((account) => ({ account, balance: accountBalance(state.value!, account) })),
);
const assets = computed(() => sum(values.value.filter((a) => a.balance >= 0).map((a) => a.balance)));
const debt = computed(() => sum(values.value.filter((a) => a.balance < 0).map((a) => -a.balance)));
const current = computed(() => values.value.find((a) => a.account.id === selected.value));
const groups = computed(() =>
  Object.entries(accountKinds)
    .map(([kind, info]) => ({
      kind,
      info,
      items: values.value.filter((a) => accountKind(a.account.data) === kind),
    }))
    .filter((g) => g.items.length),
);
function groupSummary(group: (typeof groups.value)[number]) {
  const owed = sum(group.items.filter((item) => item.balance < 0).map((item) => -item.balance));
  const positive = sum(group.items.filter((item) => item.balance > 0).map((item) => item.balance));
  // 待还款与卡内余款分别显示，避免多张卡互相抵消欠款。
  if (group.kind === 'credit') return `待还 ${show(owed)}${positive ? ` · 余款 ${show(positive)}` : ''}`;
  return show(sum(group.items.map((item) => item.balance)));
}
function show(amount: number) {
  return hidden.value ? '••••••' : money(amount);
}
</script>
<template>
  <div class="page-heading">
    <div class="page-heading-title">
      <button v-if="current" class="icon-button" aria-label="返回账户列表" @click="selected = ''">
        <Icon name="left" />
      </button>
      <h1>{{ current ? current.account.data.name : '账户' }}</h1>
    </div>
    <button
      v-if="!current"
      class="icon-button"
      aria-label="添加账户"
      @click="
        ui.accountId = '';
        ui.accountForm = true;
      "
    >
      <Icon name="plus" :size="24" />
    </button>
    <button
      v-else
      class="icon-button"
      :aria-label="'编辑' + current.account.data.name"
      @click="
        ui.accountId = current.account.id;
        ui.accountForm = true;
      "
    >
      <Icon name="edit" />
    </button>
  </div>
  <div class="accounts-layout">
    <div>
      <section class="assets-hero">
        <div class="section-heading">
          <span class="assets-title"
            >{{ current ? balanceLabel(current.account.data, current.balance) : '净资产'
            }}<button class="icon-button assets-help" aria-label="余额说明" @click="explanation = true">
              <Icon name="shield" :size="16" /></button></span
          ><button
            class="icon-button"
            :aria-label="hidden ? '显示金额' : '隐藏金额'"
            :aria-pressed="hidden"
            @click="toggleAccountAmounts"
          >
            <Icon :name="hidden ? 'eye-off' : 'eye'" />
          </button>
        </div>
        <div class="assets-total">
          <small>¥</small>{{ show(current ? Math.abs(current.balance) : assets - debt) }}
        </div>
        <div v-if="!current" class="assets-secondary">
          <div>
            <small>总资产</small><strong>{{ show(assets) }}</strong>
          </div>
          <div>
            <small>总负债</small><strong>{{ show(debt) }}</strong>
          </div>
        </div>
        <p v-else>
          {{ accountKinds[accountKind(current.account.data)].name
          }}{{ current.account.data.tail ? ' · 尾号 ' + current.account.data.tail : '' }}
        </p>
      </section>
      <div v-if="current" class="actions">
        <button class="primary" @click="newEntry('expense', { from: current.account.id })">
          <Icon name="plus" />记一笔</button
        ><button
          class="secondary"
          @click="
            ui.accountId = current.account.id;
            ui.accountForm = true;
          "
        >
          编辑账户
        </button>
      </div>
    </div>
    <div v-if="!current" class="account-groups">
      <section v-for="group in groups" :key="group.kind" class="account-group">
        <button
          class="account-group-heading"
          :aria-expanded="!isCollapsed(group.kind)"
          :aria-controls="`accounts-${group.kind}`"
          @click="toggleGroup(group.kind)"
        >
          <span
            >{{ group.info.name }} <small>({{ group.items.length }})</small></span
          ><strong>{{ groupSummary(group) }}</strong
          ><Icon :name="isCollapsed(group.kind) ? 'down' : 'chevron-up'" :size="16" />
        </button>
        <div v-show="!isCollapsed(group.kind)" :id="`accounts-${group.kind}`" class="account-list">
          <div v-for="{ account, balance } in group.items" :key="account.id" class="account-list-row">
            <button
              class="account-row"
              :aria-label="
                account.data.name +
                '，' +
                balanceLabel(account.data, balance) +
                ' ¥ ' +
                show(Math.abs(balance))
              "
              @click="selected = account.id"
            >
              <span class="entry-icon" :class="'account-tone-' + accountKind(account.data)"
                ><Icon :name="accountIcon(account.data)"
              /></span>
              <span class="account-row-name"
                ><strong>{{ account.data.name }}</strong
                ><small>{{
                  account.data.tail
                    ? '尾号 ' + account.data.tail
                    : accountKinds[accountKind(account.data)].hint
                }}</small></span
              >
              <span class="account-row-value"
                ><strong>{{ show(Math.abs(balance)) }}</strong
                ><small>{{ balanceLabel(account.data, balance) }}</small></span
              ><Icon name="right" :size="16" />
            </button>
            <button
              class="account-edit icon-button"
              :aria-label="'编辑' + account.data.name"
              @click="
                ui.accountId = account.id;
                ui.accountForm = true;
              "
            >
              <Icon name="edit" :size="16" />
            </button>
          </div>
        </div>
      </section>
      <div v-if="!accounts.length" class="empty-state">
        <Icon name="wallet" :size="42" />
        <h3>先添加一个资金账户</h3>
        <p>现金、银行卡或微信零钱，从常用的开始。</p>
        <button
          class="secondary"
          @click="
            ui.accountId = '';
            ui.accountForm = true;
          "
        >
          添加第一个账户
        </button>
      </div>
    </div>
    <section v-else class="account-transactions">
      <div class="section-heading">
        <h2>账户流水</h2>
        <small>本机所有账本</small>
      </div>
      <p v-if="hidden" class="hint">流水金额与备注已隐藏，打开单笔详情可查看。</p>
      <EntryList :items="filterEntries(entries, { accountId: selected })" :hide-amounts="hidden" />
    </section>
  </div>
  <Modal v-if="explanation" title="余额说明" @close="explanation = false"
    ><p>资金账户在本机多个账本间共用。</p>
    <p>余额根据开始记账时的金额，以及本机已保存、已下载的账目计算。其他设备尚未同步的记录不会计入。</p>
    <p>总资产汇总正余额，总负债汇总欠款；净资产为两者之差。信用卡待还款和卡内余款分开显示。</p></Modal
  >
</template>
