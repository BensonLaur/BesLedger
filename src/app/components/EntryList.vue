<script setup lang="ts">
import { computed } from 'vue';
import type { Entity, Entry } from '../../domain/model';
import { contribution, totals } from '../../domain/ledger';
import { categoryName } from '../../domain/categories';
import { money } from '../../domain/money';
import { state, ui } from '../store';
import Icon from './Icon.vue';
import { entryIcon } from '../entry-presentation';
const props = defineProps<{ items: Entity<Entry>[]; statistical?: boolean }>();
const labels: Record<Entry['type'], string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  borrow: '借入',
  lend: '借出',
  repay: '还款',
  collect: '收款',
  refund: '退款',
};
const groups = computed(() => {
  const result: Record<string, Entity<Entry>[]> = {};
  for (const e of props.items) (result[e.data.at.slice(0, 10)] ??= []).push(e);
  return Object.entries(result)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, items]) => ({ day, items, totals: totals(items.map((x) => x.data)) }));
});
function name(e: Entry) {
  if (props.statistical && ['repay', 'collect'].includes(e.type)) return `${labels[e.type]}利息`;
  return ['expense', 'income', 'refund'].includes(e.type)
    ? categoryName(state.value!, e.ledgerId, e.categoryId)
    : labels[e.type];
}
function account(id: string) {
  const a = state.value?.entities[id];
  return a?.data.kind === 'account' ? a.data.name : '';
}
</script>
<template>
  <div v-if="!items.length" class="empty-state">
    <Icon name="receipt" :size="36" />
    <h3>这里还没有记录</h3>
    <p>记下第一笔，或调整筛选范围。</p>
  </div>
  <section v-for="group in groups" :key="group.day" class="day-group">
    <div class="section-heading">
      <h3>{{ group.day.replaceAll('-', ' / ') }}</h3>
      <small>支 {{ money(group.totals.expense) }} · 收 {{ money(group.totals.income) }}</small>
    </div>
    <div class="entry-list">
      <button v-for="e in group.items" :key="e.id" class="entry-row" @click="ui.detailId = e.id">
        <span class="entry-icon" :class="{ inflow: contribution(e.data).income || e.data.type === 'refund' }"
          ><Icon :name="entryIcon(state!, e.data)" /></span
        ><span class="entry-main"
          ><strong
            >{{ name(e.data) }} <em v-if="e.data.type === 'refund'">退款</em
            ><em v-if="e.data.source">周期</em></strong
          ><small
            >{{ e.data.at.slice(11, 16) }} · {{ account(e.data.from)
            }}{{ e.data.from && e.data.to ? ' → ' : '' }}{{ account(e.data.to) }}</small
          ><small v-if="e.data.note" class="note-preview">{{ e.data.note }}</small></span
        ><span
          class="entry-value"
          :class="{ positive: ['income', 'refund', 'collect', 'borrow'].includes(e.data.type) }"
          >{{
            ['expense', 'repay', 'lend'].includes(e.data.type)
              ? '−'
              : ['income', 'refund', 'collect', 'borrow'].includes(e.data.type)
                ? '+'
                : ''
          }}{{
            money(
              statistical && ['repay', 'collect'].includes(e.data.type) ? e.data.interest : e.data.amount,
            )
          }}<small v-if="e.data.interest">{{
            statistical ? '业务总额 ' + money(e.data.amount) : '含利息 ' + money(e.data.interest)
          }}</small></span
        >
      </button>
    </div>
  </section>
</template>
