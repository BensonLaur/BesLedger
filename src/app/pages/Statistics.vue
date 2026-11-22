<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { accounts, currentEntries, currentLedger, currentLedgerId, state, ui } from '../store';
import { categories } from '../../domain/categories';
import { filterEntries, effectiveCategory } from '../../domain/reports';
import { totals } from '../../domain/ledger';
import { money, sum } from '../../domain/money';
import { dayAdd, today } from '../../domain/time';
import {
  statisticRange,
  statisticRows,
  statisticIdentity,
  statisticValue,
  statisticShares,
  statisticAverage,
  type StatisticMetric,
  type StatisticView,
  type StatisticPeriod,
} from '../../domain/statistics';
import EntryList from '../components/EntryList.vue';
import MonthInput from '../components/MonthInput.vue';
import Modal from '../components/Modal.vue';
import Icon from '../components/Icon.vue';
import StatisticsChart from '../components/StatisticsChart.vue';

const period = ref<StatisticPeriod>('month');
const year = ref(ui.month.slice(0, 4));
const custom = ref({ from: `${ui.month}-01`, through: today() });
const rangeDraft = ref({ ...custom.value });
const rangeOpen = ref(false),
  rangeError = ref(''),
  filtersOpen = ref(false);
const account = ref(''),
  category = ref(''),
  major = ref('');
const metric = ref<StatisticMetric>('expense');
const dimension = ref<StatisticView>('trend');
const expanded = ref(false),
  point = ref('');
const drillIds = ref<string[]>([]),
  drillTitle = ref(''),
  detailLimit = ref(50);
const metricLabels = { expense: '净支出', income: '收入', net: '收支结余' };
const viewLabels = { trend: '趋势', group: '大类', category: '小类', account: '账户' };
const options = computed(() => categories(state.value!, currentLedgerId.value));
const accountNames = computed(() => Object.fromEntries(accounts.value.map((a) => [a.id, a.data.name])));
const range = computed(() =>
  statisticRange(period.value, ui.month, year.value, custom.value, currentEntries.value, today()),
);
const rangeLabel = computed(() => `${range.value.from} 至 ${range.value.through}`);
const filtered = computed(() =>
  filterEntries(currentEntries.value, {
    accountId: account.value,
    from: range.value.from,
    through: range.value.through,
  }).filter((e) => !category.value || effectiveCategory(e.data) === category.value),
);
const summary = computed(() => totals(filtered.value.map((e) => e.data)));
const relevant = computed(() =>
  filtered.value.filter((e) =>
    metric.value === 'net'
      ? statisticValue(e.data, 'income') !== 0 || statisticValue(e.data, 'expense') !== 0
      : statisticValue(e.data, metric.value) !== 0,
  ),
);
const visibleEntries = computed(() =>
  major.value && dimension.value === 'category'
    ? relevant.value.filter(
        (e) => statisticIdentity(e.data, 'group', range.value.grain, options.value) === major.value,
      )
    : relevant.value,
);
const rows = computed(() =>
  statisticRows(
    visibleEntries.value,
    range.value,
    dimension.value,
    metric.value,
    options.value,
    accountNames.value,
  ),
);
const chartTotal = computed(() => sum(visibleEntries.value.map((e) => statisticValue(e.data, metric.value))));
const shares = computed(() => (metric.value === 'net' ? undefined : statisticShares(rows.value)));
const donut = computed(
  () => dimension.value !== 'trend' && !!shares.value && rows.value.filter((r) => r.value > 0).length > 1,
);
const donutRows = computed(() => {
  const positive = rows.value.filter((r) => r.value > 0);
  if (positive.length <= 6) return positive;
  const other = positive.slice(5);
  return [
    ...positive.slice(0, 5),
    {
      id: '@other',
      label: '其他',
      value: sum(other.map((r) => r.value)),
      count: other.reduce((n, r) => n + r.count, 0),
      income: 0,
      expense: 0,
      net: 0,
    },
  ];
});
const ranked = computed(() =>
  dimension.value === 'trend'
    ? rows.value
        .filter((r) => r.count)
        .slice()
        .reverse()
    : rows.value,
);
const listed = computed(() => (expanded.value ? ranked.value : ranked.value.slice(0, 5)));
const selectedPoint = computed(
  () => rows.value.find((r) => r.id === point.value) || rows.value.findLast((r) => r.count),
);
const maxValue = computed(() => Math.max(1, ...rows.value.map((r) => Math.abs(r.value))));
const signed = computed(() => metric.value === 'net' || rows.value.some((r) => r.value < 0));
const filterDescription = computed(() =>
  [
    account.value ? accountNames.value[account.value] : '',
    category.value ? options.value.find((c) => c.id === category.value)?.name : '',
  ]
    .filter(Boolean)
    .join(' · '),
);
const drill = computed(() =>
  visibleEntries.value.filter((e) =>
    drillIds.value.includes(statisticIdentity(e.data, dimension.value, range.value.grain, options.value)),
  ),
);
watch(
  [period, year, custom, account, category, major, dimension, metric, () => ui.month, currentLedgerId],
  () => {
    expanded.value = false;
    point.value = '';
    drillIds.value = [];
  },
);
watch(currentLedgerId, () => {
  account.value = category.value = major.value = '';
});
watch(
  () => ui.month,
  () => {
    // 月份与首页共用；切到另一个月时，不能留下旧月份的选中日。
    ui.selectedDay = '';
  },
);
function clearFilters() {
  account.value = category.value = '';
}
function chooseView(view: StatisticView) {
  dimension.value = view;
  major.value = '';
}
function openRange() {
  rangeDraft.value = { from: range.value.from, through: range.value.through };
  rangeError.value = '';
  rangeOpen.value = true;
}
function applyRange() {
  try {
    statisticRange('custom', ui.month, year.value, rangeDraft.value, [], today());
    custom.value = { ...rangeDraft.value };
    period.value = 'custom';
    rangeOpen.value = false;
  } catch (error) {
    rangeError.value = (error as Error).message;
  }
}
function recent(days: number) {
  rangeDraft.value = { from: dayAdd(today(), 1 - days), through: today() };
  applyRange();
}
function step(delta: number) {
  if (period.value === 'year')
    setYear(String(Math.min(9999, Math.max(1, Number(year.value) + delta))).padStart(4, '0'));
  else {
    const index = Number(ui.month.slice(0, 4)) * 12 + Number(ui.month.slice(5)) - 1 + delta;
    if (index < 12 || index > 9999 * 12 + 11) return;
    ui.month = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
  }
}
function validateYear(event: Event) {
  const input = event.target as HTMLInputElement;
  setYear(input.value);
  input.value = year.value;
}
function setYear(value: string) {
  try {
    // 与日期领域层使用相同的有效范围，避免手动清空或不支持的年份破坏图表。
    statisticRange('year', ui.month, value, custom.value, [], today());
    year.value = value;
  } catch {
    /* 无效输入恢复到上次有效年份。 */
  }
}
function activate(id: string) {
  if (dimension.value === 'group' && id !== '@other') {
    major.value = id;
    dimension.value = 'category';
    return;
  }
  // 图表与明细复用同一身份映射；退款和利息不会在钻取时换口径。
  drillIds.value =
    id === '@other'
      ? rows.value
          .filter((r) => r.value > 0)
          .slice(5)
          .map((r) => r.id)
      : [id];
  drillTitle.value = id === '@other' ? '其他' : rows.value.find((r) => r.id === id)?.label || '';
  detailLimit.value = 50;
}
function share(index: number) {
  return shares.value ? `${(shares.value[index] / 100).toFixed(2)}%` : '';
}
</script>
<template>
  <div class="page-heading statistics-heading">
    <h1>统计</h1>
    <RouterLink to="/books" class="text-button statistic-book"
      >{{ currentLedger?.data.name }}<Icon name="down" :size="14"
    /></RouterLink>
  </div>
  <div class="pills statistic-periods" aria-label="统计时间范围">
    <button
      :class="{ active: period === 'month' }"
      :aria-pressed="period === 'month'"
      @click="period = 'month'"
    >
      月
    </button>
    <button
      :class="{ active: period === 'year' }"
      :aria-pressed="period === 'year'"
      @click="
        year = ui.month.slice(0, 4);
        period = 'year';
      "
    >
      年
    </button>
    <button :class="{ active: period === 'all' }" :aria-pressed="period === 'all'" @click="period = 'all'">
      全部
    </button>
    <button :class="{ active: period === 'custom' }" :aria-pressed="period === 'custom'" @click="openRange">
      {{ period === 'custom' ? '自选日期' : '更多' }}<Icon name="down" :size="14" />
    </button>
  </div>
  <div class="statistic-period-row">
    <button
      v-if="period === 'month' || period === 'year'"
      class="icon-button"
      aria-label="上一个统计周期"
      @click="step(-1)"
    >
      <Icon name="left" />
    </button>
    <MonthInput v-if="period === 'month'" v-model="ui.month" label="统计月份" />
    <label v-else-if="period === 'year'" class="statistic-year"
      ><input
        :value="year"
        aria-label="统计年份"
        inputmode="numeric"
        maxlength="4"
        @change="validateYear"
      />年</label
    >
    <button v-else class="text-button statistic-range" @click="openRange">
      {{ period === 'all' ? '全部记录' : rangeLabel }}
    </button>
    <button
      v-if="period === 'month' || period === 'year'"
      class="icon-button"
      aria-label="下一个统计周期"
      @click="step(1)"
    >
      <Icon name="right" />
    </button>
    <button
      class="text-button statistic-filter"
      :aria-expanded="filtersOpen"
      @click="filtersOpen = !filtersOpen"
    >
      <Icon name="sliders-horizontal" :size="17" />{{ filterDescription ? '筛选 · 已启用' : '筛选' }}
    </button>
  </div>
  <div v-if="filtersOpen" class="filter-panel statistic-filters">
    <label
      >资金账户<select v-model="account" aria-label="统计账户">
        <option value="">全部账户</option>
        <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.data.name }}</option>
      </select></label
    ><label
      >分类<select v-model="category" aria-label="统计分类">
        <option value="">全部分类</option>
        <option v-for="c in options" :key="c.id" :value="c.id">{{ c.group }} · {{ c.name }}</option>
      </select></label
    >
  </div>
  <div v-if="filterDescription" class="report-filter-summary" role="status">
    <span>{{ filterDescription }}</span
    ><button class="text-button" @click="clearFilters">清除筛选</button>
  </div>
  <div class="report-summary statistic-metrics">
    <button
      v-for="key in ['expense', 'income', 'net'] as const"
      :key="key"
      :class="{ active: metric === key }"
      :aria-pressed="metric === key"
      :aria-label="`查看${metricLabels[key]}`"
      @click="metric = key"
    >
      <small>{{ metricLabels[key] }}</small
      ><strong :class="{ positive: key === 'income' }">{{ money(summary[key]) }}</strong>
    </button>
  </div>
  <div class="statistic-tabs" aria-label="统计维度">
    <button
      v-for="key in ['trend', 'group', 'category', 'account'] as const"
      :key="key"
      :class="{ active: dimension === key }"
      :aria-pressed="dimension === key"
      @click="chooseView(key)"
    >
      {{ viewLabels[key] }}
    </button>
  </div>
  <div v-if="major" class="statistic-major">
    <span>{{ major.slice(6) }} · 小类</span
    ><button class="text-button" @click="major = ''">查看全部小类</button>
  </div>
  <section class="statistic-card">
    <div class="statistic-card-heading">
      <h2>
        {{ metricLabels[metric]
        }}{{
          dimension === 'trend' ? '趋势' : dimension === 'group' || dimension === 'category' ? '分类' : '账户'
        }}
      </h2>
      <small>{{ visibleEntries.length }} 笔</small>
    </div>
    <p class="statistic-caption">
      合计 <strong>{{ money(chartTotal) }}</strong> 元<span
        >区间日均 {{ money(statisticAverage(chartTotal, range.days)) }} 元</span
      >
    </p>
    <template v-if="visibleEntries.length">
      <template v-if="dimension === 'trend' && visibleEntries.length > 1"
        ><StatisticsChart
          :rows="rows"
          variant="trend"
          :selected="selectedPoint?.id"
          :label="metricLabels[metric]"
          :total="chartTotal"
          @select="point = $event" />
        <div v-if="selectedPoint" class="statistic-point" aria-live="polite">
          <div>
            <strong>{{ selectedPoint.label }}</strong
            ><span>{{
              selectedPoint.count
                ? `${money(selectedPoint.value)} 元 · ${selectedPoint.count} 笔`
                : '这段时间没有记录'
            }}</span>
          </div>
          <button class="text-button" :disabled="!selectedPoint.count" @click="activate(selectedPoint.id)">
            查看明细<Icon name="right" :size="14" />
          </button></div
      ></template>
      <StatisticsChart
        v-else-if="donut"
        :rows="donutRows"
        variant="donut"
        :label="metricLabels[metric]"
        :total="chartTotal"
        @select="activate"
      />
      <p v-else-if="dimension === 'trend'" class="hint statistic-explanation">
        当前只有一笔记录，点击下方查看；记录更多后显示趋势。
      </p>
      <p v-else-if="signed" class="hint statistic-explanation">
        {{ metric === 'net' ? '正数为结余，负数为超支。' : '退款抵减后含负数，使用正负条形图展示。' }}
      </p>
      <div class="statistic-ranking">
        <button
          v-for="(row, index) in listed"
          :key="row.id"
          class="statistic-rank-row"
          @click="activate(row.id)"
        >
          <span class="statistic-rank-name"
            >{{ row.label
            }}<small
              >{{ row.count }} 笔{{ dimension !== 'trend' && shares ? ` · ${share(index)}` : '' }}</small
            ></span
          ><span class="statistic-rank-number"
            >{{ money(row.value)
            }}<span v-if="dimension !== 'trend'" class="statistic-track" :class="{ signed }"
              ><i
                :class="{ negative: row.value < 0 }"
                :style="{
                  width: `${(Math.abs(row.value) / maxValue) * (signed ? 50 : 100)}%`,
                  left: signed
                    ? row.value < 0
                      ? `${50 - (Math.abs(row.value) / maxValue) * 50}%`
                      : '50%'
                    : '0',
                }"
              ></i></span></span
          ><Icon name="right" :size="14" />
        </button>
      </div>
      <button
        v-if="ranked.length > 5"
        class="text-button statistic-expand"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起列表' : `展开全部 ${ranked.length} 项`
        }}<Icon :name="expanded ? 'chevron-up' : 'down'" :size="15" />
      </button>
    </template>
    <div v-else class="empty-state statistic-empty">
      <Icon name="chart" :size="30" />
      <h3>当前范围暂无{{ metricLabels[metric] }}记录</h3>
      <p>试试其他时间或指标；转账本金不计收支。</p>
      <button v-if="filterDescription" class="secondary" @click="clearFilters">清除筛选</button>
    </div>
  </section>
  <details class="scope-note statistic-scope">
    <summary>统计范围与计算方式</summary>
    <p>
      {{ rangeLabel }}，共
      {{ range.days }} 天。仅统计当前账本已保存记录，未记录不代表没有消费。区间日均按所选范围的自然天数计算。
    </p>
    <p>
      金额单位为元。转账和借贷本金不计收支；利息单独计算，退款按实际发生日抵减支出。账户维度按实际资金流向归属。
    </p>
  </details>
  <Modal v-if="rangeOpen" title="选择时间范围" @close="rangeOpen = false"
    ><div class="actions">
      <button class="secondary" @click="recent(7)">近 7 天</button
      ><button class="secondary" @click="recent(30)">近 30 天</button>
    </div>
    <form @submit.prevent="applyRange">
      <label>开始日期<input v-model="rangeDraft.from" type="date" required /></label
      ><label>结束日期<input v-model="rangeDraft.through" type="date" required /></label>
      <p v-if="rangeError" class="field-error" role="alert">{{ rangeError }}</p>
      <button class="primary full">查看统计</button>
    </form></Modal
  >
  <Modal v-if="drillIds.length" title="统计明细" page wide @close="drillIds = []"
    ><div class="statistic-detail-summary">
      <h3>{{ drillTitle }} · {{ metricLabels[metric] }}</h3>
      <p>
        {{ rangeLabel }} · {{ drill.length }} 笔 · 合计
        {{ money(sum(drill.map((e) => statisticValue(e.data, metric)))) }} 元
      </p>
    </div>
    <EntryList :items="drill.slice(0, detailLimit)" :summary-items="drill" statistical /><button
      v-if="drill.length > detailLimit"
      class="secondary full"
      @click="detailLimit += 50"
    >
      再显示 50 笔
    </button></Modal
  >
</template>
<style scoped>
.statistics-heading {
  margin-bottom: 10px;
}
.statistic-book {
  max-width: 64%;
  font-size: 13px;
  justify-content: flex-end;
  overflow-wrap: anywhere;
}
.statistic-periods {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}
.statistic-periods button {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.statistic-period-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 56px;
}
.statistic-period-row :deep(.month-input) {
  flex-shrink: 1;
  min-width: 0;
}
.statistic-filter {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.statistic-year {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 3px;
  margin: 0;
  font-size: 17px;
}
.statistic-year input {
  width: 76px;
  border: 0;
  padding: 4px;
  font-weight: 600;
  background: transparent;
}
.statistic-range {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.statistic-filters {
  padding: 10px;
  margin: 0 0 8px;
}
.statistic-filters label {
  flex: 1;
  margin: 0;
  min-width: 0;
}
.report-filter-summary,
.statistic-major {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  background: var(--soft);
  border-radius: 10px;
  font-size: 12px;
}
.report-filter-summary > span,
.statistic-major > span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.statistic-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  background: var(--surface);
  border-radius: 14px;
  padding: 5px;
  margin: 0;
}
.statistic-metrics button {
  padding: 9px 7px;
  border-radius: 10px;
  border: 1px solid transparent;
  min-width: 0;
}
.statistic-metrics button.active {
  background: var(--soft);
  border-color: var(--accent);
}
.statistic-metrics small,
.statistic-metrics strong {
  display: block;
}
.statistic-metrics small {
  font-size: 12px;
}
.statistic-metrics strong {
  font-size: 17px;
  font-weight: 650;
  overflow-wrap: anywhere;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.statistic-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin: 8px 0;
}
.statistic-tabs button {
  min-height: 44px;
  text-align: center;
  border-bottom: 3px solid transparent;
  color: var(--muted);
}
.statistic-tabs button.active {
  color: var(--accent);
  border-color: var(--orange);
  font-weight: 650;
}
.statistic-card {
  background: var(--surface);
  padding: 14px;
  border-radius: 16px;
}
.statistic-card-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.statistic-card-heading h2 {
  font-size: 16px;
}
.statistic-caption {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2px 12px;
  font-size: 12px;
  color: var(--muted);
  margin: 4px 0 8px;
}
.statistic-caption strong {
  color: var(--ink);
  font-size: 15px;
  overflow-wrap: anywhere;
}
.statistic-caption span {
  margin-left: auto;
}
.statistic-point {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  background: var(--soft);
  padding: 4px 10px;
  border-radius: 10px;
  margin: 4px 0;
}
.statistic-point > div {
  display: grid;
  min-width: 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.statistic-point .text-button {
  flex-shrink: 0;
  font-size: 12px;
}
.statistic-rank-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 60px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
}
.statistic-rank-row:last-child {
  border: 0;
}
.statistic-rank-row:active {
  background: var(--soft);
}
.statistic-rank-name {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
  font-size: 14px;
}
.statistic-rank-name small {
  display: block;
  font-size: 11px;
}
.statistic-rank-number {
  min-width: 0;
  max-width: 52%;
  width: 43%;
  text-align: right;
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.statistic-track {
  display: block;
  position: relative;
  height: 4px;
  background: var(--soft);
  border-radius: 4px;
  margin-top: 5px;
}
.statistic-track i {
  position: absolute;
  top: 0;
  height: 4px;
  border-radius: 4px;
  background: var(--accent);
}
.statistic-track i.negative {
  background: var(--green);
}
.statistic-track.signed:after {
  content: '';
  position: absolute;
  left: 50%;
  top: -2px;
  height: 8px;
  width: 1px;
  background: var(--muted);
}
.statistic-expand {
  width: 100%;
  justify-content: center;
  display: flex;
  align-items: center;
  gap: 6px;
}
.statistic-empty {
  padding: 22px 8px;
}
.statistic-explanation {
  margin: 8px 0;
}
.statistic-scope {
  margin: 12px 0 0;
}
.statistic-scope summary {
  min-height: 44px;
  cursor: pointer;
}
.statistic-detail-summary {
  margin-bottom: 12px;
}
.statistic-detail-summary p {
  font-size: 12px;
  color: var(--muted);
}
@media (min-width: 900px) {
  .statistic-card {
    padding: 18px 24px;
  }
  .statistic-metrics strong {
    font-size: 22px;
  }
}
</style>
