<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { accounts, currentEntries, currentLedgerId, mutate, newEntry, state, ui } from '../store';
import { list, put } from '../../domain/model';
import { totals } from '../../domain/ledger';
import { calendarScale, dailyTotals, filterEntries } from '../../domain/reports';
import { categories } from '../../domain/categories';
import { decimal, minor, money } from '../../domain/money';
import { today } from '../../domain/time';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import EntryList from '../components/EntryList.vue';
import CalendarBar from '../components/CalendarBar.vue';
const route = useRoute();
const filters = ref(false),
  search = ref(''),
  category = ref(''),
  account = ref(String(route.query.account || '')),
  from = ref(''),
  through = ref('');
const metric = ref<'income' | 'expense'>('expense'),
  collapsed = ref(!currentEntries.value.length),
  budgetOpen = ref(false),
  budgetInput = ref(''),
  budgetError = ref('');
const monthEntries = computed(() =>
  currentEntries.value.filter((e) => ui.allTime || e.data.at.startsWith(ui.month)),
);
const total = computed(() => totals(monthEntries.value.map((e) => e.data)));
const days = computed(() => dailyTotals(currentEntries.value.map((e) => e.data)));
const scale = computed(() =>
  calendarScale(
    currentEntries.value.map((e) => e.data),
    ui.month,
    metric.value,
    today(),
  ),
);
const cells = computed(() => {
  const [y, m] = ui.month.split('-').map(Number),
    first = new Date(y, m - 1, 1).getDay();
  return [
    ...Array((first + 6) % 7).fill(''),
    ...Array.from(
      { length: new Date(y, m, 0).getDate() },
      (_, n) => `${ui.month}-${String(n + 1).padStart(2, '0')}`,
    ),
  ];
});
const visible = computed(() =>
  filterEntries(currentEntries.value, {
    month: ui.allTime ? undefined : ui.month,
    day: ui.selectedDay || undefined,
    keyword: search.value,
    categoryId: category.value,
    accountId: account.value,
    from: from.value,
    through: through.value,
  }),
);
const options = computed(() => categories(state.value!, currentLedgerId.value));
const details = ref<HTMLElement>();
const shown = ref(50);
const activeFilters = computed(() => [
  ...(search.value ? [{ key: 'search', label: `备注：${search.value}` }] : []),
  ...(account.value
    ? [{ key: 'account', label: accounts.value.find((a) => a.id === account.value)?.data.name || '指定账户' }]
    : []),
  ...(category.value
    ? [{ key: 'category', label: options.value.find((c) => c.id === category.value)?.name || '指定分类' }]
    : []),
  ...(from.value ? [{ key: 'from', label: `从 ${from.value}` }] : []),
  ...(through.value ? [{ key: 'through', label: `至 ${through.value}` }] : []),
]);
const selectedEntries = computed(() =>
  currentEntries.value.filter((e) => e.data.at.startsWith(ui.selectedDay)),
);
const selectedTotal = computed(() => totals(selectedEntries.value.map((e) => e.data)));
const emptyTitle = computed(() =>
  activeFilters.value.length
    ? '没有找到符合条件的账目'
    : ui.selectedDay
      ? '这一天还没有记账'
      : currentEntries.value.length
        ? '这个月还没有记录'
        : '从第一笔开始',
);
function clearFilter(key?: string) {
  if (!key || key === 'search') search.value = '';
  if (!key || key === 'account') account.value = '';
  if (!key || key === 'category') category.value = '';
  if (!key || key === 'from') from.value = '';
  if (!key || key === 'through') through.value = '';
}
// 只分批绘制，统计及筛选始终使用完整记录；切换范围时恢复首批。
watch(
  [() => ui.month, () => ui.selectedDay, () => ui.allTime, search, category, account, from, through],
  () => {
    shown.value = 50;
  },
);
watch(
  () => route.query.account,
  (id) => {
    account.value = typeof id === 'string' ? id : '';
  },
);
watch(currentLedgerId, () => {
  clearFilter();
  shown.value = 50;
});
async function viewDetails() {
  await nextTick();
  details.value?.focus({ preventScroll: true });
  details.value?.scrollIntoView({ behavior: 'instant', block: 'start' });
}
function changeMonth(event: Event) {
  const input = event.target as HTMLInputElement;
  if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(input.value)) {
    ui.month = input.value;
    ui.allTime = false;
    ui.selectedDay = '';
  } else input.value = ui.month;
}
const budget = computed(() =>
  list(state.value!, 'budget').find(
    (e) => e.data.ledgerId === currentLedgerId.value && e.data.month === ui.month,
  ),
);
function shift(delta: number) {
  const [y, m] = ui.month.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  ui.month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  ui.selectedDay = '';
  ui.allTime = false;
}
function value(day: string) {
  return days.value[day]?.[metric.value] ?? 0;
}
async function toggleBudget() {
  if (budget.value?.data.enabled)
    await mutate((s) => put(s, { ...budget.value!.data, enabled: false }, budget.value!.id));
  else {
    budgetInput.value = budget.value ? decimal(budget.value.data.amount) : '';
    budgetError.value = '';
    budgetOpen.value = true;
  }
}
async function saveBudget() {
  try {
    const amount = minor(budgetInput.value);
    if (amount <= 0) throw new Error('预算应大于零');
    await mutate((s) =>
      put(
        s,
        { kind: 'budget', ledgerId: currentLedgerId.value, month: ui.month, amount, enabled: true },
        budget.value?.id || `budget:${currentLedgerId.value}:${ui.month}`,
      ),
    );
    budgetOpen.value = false;
  } catch (e) {
    budgetError.value = (e as Error).message;
  }
}
</script>
<template>
  <div v-if="!currentLedgerId" class="empty-state">
    <h1>开始自己的第一本账</h1>
    <RouterLink class="primary" to="/books">创建账本</RouterLink>
  </div>
  <template v-else>
    <div class="period-toolbar">
      <div class="month-picker">
        <button class="icon-button" aria-label="上个月" @click="shift(-1)"><Icon name="left" /></button
        ><input type="month" :value="ui.month" aria-label="查看月份" @change="changeMonth" /><button
          class="icon-button"
          aria-label="下个月"
          @click="shift(1)"
        >
          <Icon name="right" />
        </button>
      </div>
      <button
        class="home-current-month"
        @click="
          ui.month = today().slice(0, 7);
          ui.allTime = false;
          ui.selectedDay = '';
        "
      >
        本月
      </button>
    </div>
    <section v-if="!accounts.length" class="home-first-step">
      <Icon name="wallet" :size="28" />
      <div>
        <strong>先添加常用的资金账户</strong>
        <p>现金、银行卡或微信零钱，选一个就能开始记账。</p>
      </div>
      <button
        class="primary"
        @click="
          ui.accountId = '';
          ui.accountForm = true;
        "
      >
        添加账户
      </button>
    </section>
    <div class="home-columns">
      <section class="overview-column">
        <div class="overview">
          <div class="overview-top">
            <span
              >{{ ui.allTime ? '全部时间' : ui.month.replace('-', ' 年 ') + ' 月' }}净支出 · 已抵减退款</span
            ><button
              v-if="!ui.allTime"
              class="budget-toggle"
              :aria-label="budget?.data.enabled ? '预算 开' : '预算 关'"
              :aria-pressed="!!budget?.data.enabled"
              @click="toggleBudget"
            >
              <span>预算</span><span class="budget-switch" :class="{ on: budget?.data.enabled }"></span
              ><span class="sr-only">{{ budget?.data.enabled ? '开' : '关' }}</span>
            </button>
          </div>
          <div class="hero-amount" :class="{ budgeted: budget?.data.enabled && !ui.allTime }">
            <div
              v-if="budget?.data.enabled && !ui.allTime"
              class="budget-watermark"
              :style="{ width: Math.max(0, Math.min(100, (total.expense / budget.data.amount) * 100)) + '%' }"
            ></div>
            <span><small>¥</small>{{ money(total.expense) }}</span>
          </div>
          <div v-if="budget?.data.enabled && !ui.allTime" class="budget-caption">
            <button
              @click="
                budgetInput = decimal(budget.data.amount);
                budgetOpen = true;
              "
            >
              预算 {{ money(budget.data.amount) }}</button
            ><span
              >{{ total.expense > budget.data.amount ? '超额' : '剩余' }}
              {{ money(Math.abs(budget.data.amount - total.expense)) }}</span
            >
          </div>
          <div class="overview-bottom">
            <div>
              <small>收入</small><strong>{{ money(total.income) }}</strong>
            </div>
            <div>
              <small>收支结余</small><strong>{{ money(total.net) }}</strong>
            </div>
          </div>
        </div>
        <section v-if="!ui.allTime" class="calendar-card">
          <div class="calendar-toolbar">
            <div class="pills">
              <button
                :class="{ active: metric === 'expense' }"
                :aria-pressed="metric === 'expense'"
                @click="metric = 'expense'"
              >
                净支出</button
              ><button
                :class="{ active: metric === 'income' }"
                :aria-pressed="metric === 'income'"
                @click="metric = 'income'"
              >
                收入
              </button>
            </div>
            <button class="text-button" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
              {{ collapsed ? '展开日历' : '收起日历' }}
            </button>
          </div>
          <div v-if="ui.selectedDay" class="selected-day-summary" role="status">
            <span
              ><strong>{{ ui.selectedDay.replaceAll('-', ' / ') }}</strong
              ><small
                >已记 {{ selectedEntries.length }} 笔 · {{ metric === 'expense' ? '净支出' : '收入' }} ¥{{
                  money(selectedTotal[metric])
                }}</small
              ></span
            >
            <button class="text-button" @click="viewDetails">查看当天明细</button>
            <button class="icon-button" aria-label="取消日期选择" @click="ui.selectedDay = ''">
              <Icon name="close" :size="18" />
            </button>
          </div>
          <template v-if="!collapsed"
            ><div class="calendar-week">
              <span v-for="day in ['一', '二', '三', '四', '五', '六', '日']">{{ day }}</span>
            </div>
            <div class="calendar-grid">
              <template v-for="(day, index) in cells" :key="day || index"
                ><div v-if="!day"></div>
                <button
                  v-else
                  class="calendar-cell"
                  :class="{
                    selected: ui.selectedDay === day,
                    future: day > today(),
                    negative: value(day) < 0,
                    today: day === today(),
                  }"
                  :aria-label="`${day} ${day > today() ? '未发生' : !days[day] ? '暂无记录' : (metric === 'expense' ? '净支出 ' : '收入 ') + money(value(day)) + '元'}`"
                  :aria-pressed="ui.selectedDay === day"
                  @click="ui.selectedDay = ui.selectedDay === day ? '' : day"
                >
                  <span class="date-watermark">{{ Number(day.slice(8)) }}</span
                  ><CalendarBar v-if="day <= today() && value(day)" :amount="value(day)" :ceiling="scale" />
                  <small>{{
                    day > today() ? '' : days[day] ? money(value(day)).replace('.00', '') : '—'
                  }}</small>
                </button></template
              >
            </div>
            <div class="calendar-legend">
              <details>
                <summary>{{ scale ? '日常刻度 ¥' + money(scale) : '日历怎么看？' }}</summary>
                <p>柱体越高，金额越多；超出刻度用折断标记。横线表示还没有记录，不代表没有花钱。</p>
              </details>
              <button class="text-button" @click="ui.selectedDay = ''">查看整月</button>
            </div></template
          >
          <button v-if="!ui.selectedDay" class="calendar-to-details text-button" @click="viewDetails">
            查看明细 · {{ visible.length }} 笔 <Icon name="down" :size="16" />
          </button>
        </section>
      </section>
      <section ref="details" class="details-column" tabindex="-1" aria-label="账目明细">
        <div class="home-scope">
          <button
            :aria-pressed="!ui.allTime && !ui.selectedDay"
            @click="
              ui.allTime = false;
              ui.selectedDay = '';
            "
          >
            整月</button
          ><button
            :aria-pressed="ui.allTime"
            @click="
              ui.allTime = true;
              ui.selectedDay = '';
            "
          >
            全部时间</button
          ><span v-if="ui.selectedDay">已选择 {{ ui.selectedDay }}</span>
        </div>
        <div class="section-heading details-heading">
          <h2>{{ ui.selectedDay || (ui.allTime ? '全部时间' : ui.month) }} 明细</h2>
          <button
            class="icon-button"
            aria-label="搜索与筛选"
            :aria-expanded="filters"
            :class="{ 'filters-active': activeFilters.length }"
            @click="filters = !filters"
          >
            <Icon name="search" />
          </button>
        </div>
        <div v-if="filters" class="filter-panel">
          <input v-model="search" type="search" aria-label="关键词搜索" placeholder="搜索备注或用途" /><select
            v-model="account"
            aria-label="账户筛选"
          >
            <option value="">全部账户</option>
            <option v-for="a in accounts" :value="a.id">{{ a.data.name }}</option></select
          ><select v-model="category" aria-label="分类筛选">
            <option value="">全部分类</option>
            <option v-for="c in options" :value="c.id">{{ c.name }}</option></select
          ><label>起始<input v-model="from" type="date" /></label
          ><label>截止<input v-model="through" type="date" /></label
          ><button class="text-button" @click="clearFilter()">清除筛选</button>
        </div>
        <div v-if="activeFilters.length" class="active-filter-list" aria-label="已启用的筛选">
          <button
            v-for="filter in activeFilters"
            :key="filter.key"
            :aria-label="`移除筛选：${filter.label}`"
            @click="clearFilter(filter.key)"
          >
            <span>{{ filter.label }}</span
            ><Icon name="close" :size="14" />
          </button>
          <button class="text-button" @click="clearFilter()">全部清除</button>
        </div>
        <p v-if="from && through && from > through" class="field-error" role="alert">
          截止日期应在起始日期之后，请调整筛选日期。
        </p>
        <p v-if="activeFilters.length" class="hint" role="status">
          找到 {{ visible.length }} 笔；上方概览仍为{{ ui.allTime ? '全部时间' : '整月' }}收支。
        </p>
        <EntryList v-if="visible.length" :items="visible.slice(0, shown)" :summary-items="visible" />
        <div v-else class="empty-state home-empty">
          <Icon :name="activeFilters.length ? 'search' : 'receipt'" :size="32" />
          <h3>{{ emptyTitle }}</h3>
          <p>
            {{
              activeFilters.length
                ? '试试其他关键词，或清除筛选再看看。'
                : !accounts.length
                  ? '添加资金账户后，就可以记下第一笔。'
                  : '只显示已保存的账目，未记账不代表没有花钱。'
            }}
          </p>
          <button v-if="activeFilters.length" class="secondary" @click="clearFilter()">清除筛选</button>
          <button v-else-if="accounts.length" class="primary" @click="newEntry()">＋ 记一笔</button>
          <button
            v-if="!activeFilters.length && currentEntries.length && !ui.allTime"
            class="text-button"
            @click="
              ui.allTime = true;
              ui.selectedDay = '';
            "
          >
            查看全部时间
          </button>
        </div>
        <div v-if="visible.length > shown" class="load-more">
          <p class="hint">已显示 {{ shown }} / {{ visible.length }} 笔</p>
          <button class="secondary" @click="shown += 50">加载更多账目</button>
        </div>
      </section>
    </div>
    <Modal v-if="budgetOpen" title="本月预算" @close="budgetOpen = false"
      ><p>仅用于当前账本 {{ ui.month }}。关闭后保留设置，取消不会修改预算。</p>
      <form @submit.prevent="saveBudget">
        <label>预算金额（元）<input v-model="budgetInput" inputmode="decimal" required /></label>
        <p class="field-error">{{ budgetError }}</p>
        <div class="actions">
          <button type="button" class="secondary" @click="budgetOpen = false">取消</button
          ><button class="primary">启用预算</button>
        </div>
      </form></Modal
    >
  </template>
</template>
<style scoped>
.home-first-step {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  background: var(--soft);
  padding: 16px;
  border-radius: 16px;
  margin-bottom: 14px;
}
.home-first-step > div {
  flex: 1;
  min-width: 170px;
}
.home-first-step p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.selected-day-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  background: var(--soft);
  border-radius: 12px;
  padding: 8px 10px;
  margin: 8px 0;
  font-size: 12px;
}
.selected-day-summary > span {
  flex: 1;
  min-width: 160px;
}
.selected-day-summary small {
  display: block;
  color: var(--muted);
}
.calendar-to-details {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 44px;
}
.calendar-legend details {
  flex: 1;
  min-width: 150px;
}
.calendar-legend summary {
  cursor: pointer;
}
.calendar-legend p {
  max-width: 30em;
}
.details-column {
  scroll-margin-top: 16px;
}
.details-column:focus {
  outline: none;
}
.filters-active {
  background: var(--soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.active-filter-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0;
}
.active-filter-list > button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  min-height: 40px;
  background: var(--soft);
  color: var(--accent);
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 12px;
}
.active-filter-list span {
  overflow-wrap: anywhere;
  min-width: 0;
}
.home-empty {
  padding: 30px 16px;
}
.home-empty .primary,
.home-empty .secondary {
  margin: 8px;
}
.load-more {
  text-align: center;
  padding: 12px;
}
</style>
