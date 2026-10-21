<script setup lang="ts">
import { computed, ref } from 'vue';
import { accounts, entries, state, ui } from '../store';
import { accountBalance } from '../../domain/ledger';
import { money, sum } from '../../domain/money';
import Icon from '../components/Icon.vue';
import EntryList from '../components/EntryList.vue';
import { filterEntries } from '../../domain/reports';
const selected = ref('');
const values = computed(() =>
  accounts.value.map((a) => ({ account: a, balance: accountBalance(state.value!, a) })),
);
const assets = computed(() => sum(values.value.filter((a) => a.balance >= 0).map((a) => a.balance)));
const debt = computed(() => sum(values.value.filter((a) => a.balance < 0).map((a) => -a.balance)));
const labels = {
  cash: '现金',
  bank: '储蓄卡',
  wallet: '网络钱包',
  credit: '信用卡',
  receivable: '应收应付',
  asset: '自定义资产',
  liability: '自定义负债',
};
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">每一份资产，清晰有据</p>
      <h1>共用账户</h1>
    </div>
    <button
      class="primary"
      @click="
        ui.accountId = '';
        ui.accountForm = true;
      "
    >
      <Icon name="plus" />添加账户
    </button>
  </div>
  <div class="summary-grid">
    <div class="card">
      <small>本机已知资产</small><strong>¥ {{ money(assets) }}</strong>
    </div>
    <div class="card">
      <small>本机已知欠款</small><strong>¥ {{ money(debt) }}</strong>
    </div>
    <div class="card">
      <small>本机已知净资产</small><strong>¥ {{ money(assets - debt) }}</strong>
    </div>
  </div>
  <p class="scope-note">
    余额范围：共用账户期初 +
    本机已下载账本起算后的流水。其他设备的仅本地账、未下载账本及未同步修改不在此范围内。
  </p>
  <div class="account-grid">
    <article
      v-for="{ account, balance } in values"
      :key="account.id"
      class="account-card"
      :class="{ selected: selected === account.id }"
    >
      <div class="section-heading">
        <span class="entry-icon"
          ><Icon
            :name="
              account.data.type === 'credit'
                ? 'credit'
                : account.data.type === 'receivable'
                  ? 'users'
                  : 'wallet'
            " /></span
        ><button
          class="icon-button"
          :aria-label="'编辑' + account.data.name"
          @click="
            ui.accountId = account.id;
            ui.accountForm = true;
          "
        >
          <Icon name="edit" :size="17" />
        </button>
      </div>
      <button class="account-card-main" @click="selected = selected === account.id ? '' : account.id">
        <strong>{{ account.data.name }}</strong
        ><small
          >{{ labels[account.data.type] }} {{ account.data.tail ? '· 尾号 ' + account.data.tail : '' }}</small
        ><span class="balance"
          >{{ balance < 0 ? '欠款 ' : account.data.type === 'credit' && balance > 0 ? '溢缴款 ' : '余额 ' }}¥
          {{ money(Math.abs(balance)) }}</span
        ><small>起算于 {{ account.data.openedAt.replace('T', ' ') }}</small>
      </button>
    </article>
  </div>
  <div v-if="!accounts.length" class="empty-state">
    <Icon name="wallet" :size="42" />
    <h3>先添加一个资金账户</h3>
    <p>多个账本共用同一账户，不会重复计算期初。</p>
  </div>
  <section v-if="selected" class="section">
    <div class="section-heading">
      <h2>账户流水 · 全部本机账本</h2>
      <button class="text-button" @click="selected = ''">收起</button>
    </div>
    <EntryList :items="filterEntries(entries, { accountId: selected })" />
  </section>
</template>
