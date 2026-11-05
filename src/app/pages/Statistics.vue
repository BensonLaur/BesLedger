<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { accounts, currentEntries, currentLedgerId, state, ui } from '../store';
import { categoryName } from '../../domain/categories';
import { groupReport, filterEntries } from '../../domain/reports';
import { totals, contribution } from '../../domain/ledger';
import { money } from '../../domain/money';
import EntryList from '../components/EntryList.vue';
import MonthInput from '../components/MonthInput.vue';
const filtersOpen = ref(false);
const dimension = ref<'category' | 'account' | 'month'>('category'),
  selected = ref(''),
  account = ref(''),
  start = ref(''),
  end = ref('');
const hasFilters = computed(() => !!(account.value || start.value || end.value));
const filterDescription = computed(() =>
  [
    account.value ? accounts.value.find((a) => a.id === account.value)?.data.name || '指定账户' : '',
    start.value ? `从 ${start.value}` : '',
    end.value ? `至 ${end.value}` : '',
  ]
    .filter(Boolean)
    .join(' · '),
);
function clearFilters() {
  account.value = start.value = end.value = '';
}
watch([account, start, end, () => ui.month, () => ui.allTime, currentLedgerId], () => {
  selected.value = '';
});
watch(currentLedgerId, clearFilters);
const filtered = computed(() =>
  filterEntries(currentEntries.value, {
    month: ui.allTime ? undefined : ui.month,
    accountId: account.value,
    from: start.value,
    through: end.value,
  }),
);
const summary = computed(() => totals(filtered.value.map((x) => x.data)));
const groups = computed(() =>
  groupReport(
    filtered.value.map((x) => x.data),
    dimension.value,
  ).sort((a, b) =>
    dimension.value === 'month' ? a.id.localeCompare(b.id) : Math.abs(b.expense) - Math.abs(a.expense),
  ),
);
const max = computed(() =>
  Math.max(1, ...groups.value.flatMap((g) => [Math.abs(g.expense), Math.abs(g.income)])),
);
const drill = computed(() =>
  filtered.value.filter(
    (e) =>
      (contribution(e.data).income !== 0 || contribution(e.data).expense !== 0) &&
      (!selected.value ||
        (dimension.value === 'month'
          ? e.data.at.startsWith(selected.value)
          : dimension.value === 'account'
            ? (e.data.type === 'income' || e.data.type === 'collect' || e.data.type === 'refund'
                ? e.data.to
                : e.data.from) === selected.value
            : (e.data.type === 'repay'
                ? 'expense.investment.001'
                : e.data.type === 'collect'
                  ? 'income.011'
                  : e.data.categoryId) === selected.value)),
  ),
);
function label(id: string) {
  return dimension.value === 'month'
    ? id
    : dimension.value === 'account'
      ? accounts.value.find((a) => a.id === id)?.data.name || '未知账户'
      : categoryName(state.value!, currentLedgerId.value, id);
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">从记录里，看见自己的生活</p>
      <h1>统计</h1>
    </div>
    <select v-model="ui.allTime" aria-label="统计时间范围">
      <option :value="false">选择月份</option>
      <option :value="true">全部时间</option>
    </select>
  </div>
  <div class="report-period">
    <MonthInput
      v-if="!ui.allTime"
      v-model="ui.month"
      label="统计月份"
      @update:model-value="ui.selectedDay = ''"
    /><span v-else>全部记录</span
    ><button class="text-button" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen">
      {{ hasFilters ? '筛选 · 已启用' : '筛选' }}
    </button>
  </div>
  <div v-if="filtersOpen" class="filter-panel">
    <select v-model="account" aria-label="统计账户">
      <option value="">全部账户</option>
      <option v-for="a in accounts" :value="a.id">{{ a.data.name }}</option></select
    ><label>起始<input v-model="start" type="date" /></label
    ><label>截止<input v-model="end" type="date" /></label>
  </div>
  <div v-if="hasFilters" class="report-filter-summary" role="status">
    <span>{{ filterDescription }}</span
    ><button class="text-button" @click="clearFilters">清除筛选</button>
  </div>
  <p v-if="start && end && start > end" class="field-error" role="alert">
    截止日期应在起始日期之后，请调整筛选日期。
  </p>
  <div class="summary-grid report-summary">
    <div class="card">
      <small>净支出</small><strong>¥ {{ money(summary.expense) }}</strong>
    </div>
    <div class="card">
      <small>收入</small><strong class="positive">¥ {{ money(summary.income) }}</strong>
    </div>
    <div class="card">
      <small>收支结余</small><strong>¥ {{ money(summary.net) }}</strong>
    </div>
  </div>
  <details class="scope-note">
    <summary>统计范围与计算方式</summary>
    <p>
      当前账本已保存记录。转账和借贷本金不计收支；利息单独计算，退款按实际发生日抵减支出。账户维度按实际资金流向归属。
    </p>
  </details>
  <div class="pills wide-pills">
    <button
      :class="{ active: dimension === 'category' }"
      :aria-pressed="dimension === 'category'"
      @click="
        dimension = 'category';
        selected = '';
      "
    >
      分类</button
    ><button
      :class="{ active: dimension === 'account' }"
      :aria-pressed="dimension === 'account'"
      @click="
        dimension = 'account';
        selected = '';
      "
    >
      账户</button
    ><button
      :class="{ active: dimension === 'month' }"
      :aria-pressed="dimension === 'month'"
      @click="
        dimension = 'month';
        selected = '';
      "
    >
      收支趋势
    </button>
  </div>
  <section class="chart-card">
    <p class="hint">蓝色为净支出，绿色为收入。负数保留符号；点击任一项查看明细。</p>
    <button
      v-for="group in groups"
      class="chart-row"
      :class="{ selected: selected === group.id }"
      :aria-pressed="selected === group.id"
      @click="selected = selected === group.id ? '' : group.id"
    >
      <span>{{ label(group.id) }}</span>
      <div class="chart-tracks">
        <div v-if="group.expense || !group.income" class="chart-track">
          <i
            :style="{ width: (Math.abs(group.expense) / max) * 100 + '%' }"
            :class="{ negative: group.expense < 0 }"
          ></i
          ><small>支 {{ money(group.expense) }}</small>
        </div>
        <div v-if="group.income" class="chart-track income-track">
          <i :style="{ width: (Math.abs(group.income) / max) * 100 + '%' }"></i
          ><small>收 {{ money(group.income) }}</small>
        </div>
      </div>
    </button>
    <div v-if="!groups.length" class="empty-state">
      <h3>当前范围暂无收支记录</h3>
      <p>试试清除筛选，或查看其他月份；转账本金不计入收支。</p>
      <button v-if="hasFilters" class="secondary" @click="clearFilters">清除筛选</button>
    </div>
  </section>
  <section class="section">
    <div class="section-heading">
      <h2>{{ selected ? label(selected) : '当前范围' }} · 明细</h2>
      <button v-if="selected" class="text-button" @click="selected = ''">清除选择</button>
    </div>
    <EntryList :items="drill" statistical />
  </section>
</template>
<style scoped>
.report-filter-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 10px 14px;
  margin: 12px 0;
  border-radius: 12px;
  background: var(--soft);
  color: var(--accent);
  font-size: 12px;
}
.report-filter-summary > span {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}
.scope-note summary {
  cursor: pointer;
  min-height: 32px;
}
.chart-row > span {
  overflow-wrap: anywhere;
  min-width: 0;
  text-align: left;
}
.chart-tracks {
  min-width: 0;
}
</style>
