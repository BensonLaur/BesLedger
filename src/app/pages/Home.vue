<script setup lang="ts">
import { computed, ref } from 'vue';
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
const route = useRoute();
const filters = ref(false),
  search = ref(''),
  category = ref(''),
  account = ref(String(route.query.account || '')),
  from = ref(''),
  through = ref('');
const metric = ref<'income' | 'expense'>('expense'),
  collapsed = ref(false),
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
        ><input
          type="month"
          v-model="ui.month"
          aria-label="查看月份"
          @change="
            ui.allTime = false;
            ui.selectedDay = '';
          "
        /><button class="icon-button" aria-label="下个月" @click="shift(1)"><Icon name="right" /></button>
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
                  :aria-label="`${day} ${day > today() ? '未发生' : money(value(day)) + '元'}`"
                  :aria-pressed="ui.selectedDay === day"
                  @click="ui.selectedDay = ui.selectedDay === day ? '' : day"
                >
                  <span class="date-watermark">{{ Number(day.slice(8)) }}</span
                  ><span
                    v-if="day <= today() && value(day)"
                    class="day-bar"
                    :class="{ broken: Math.abs(value(day)) > scale }"
                    :style="{
                      height: Math.max(2, 24 * Math.min(Math.abs(value(day)) / (scale || 1), 1)) + 'px',
                    }"
                  ></span
                  ><small>{{
                    day > today() ? '' : days[day] ? money(value(day)).replace('.00', '') : '—'
                  }}</small>
                </button></template
              >
            </div>
            <div class="calendar-legend">
              <span>{{ scale ? '日常刻度 ¥' + money(scale) + '，超出折断' : '记账后生成日常刻度' }}</span
              ><button class="text-button" @click="ui.selectedDay = ''">查看整月</button>
            </div></template
          >
        </section>
      </section>
      <section class="details-column">
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
          <button class="icon-button" aria-label="搜索与筛选" @click="filters = !filters">
            <Icon name="search" />
          </button>
        </div>
        <div v-if="filters" class="filter-panel">
          <input v-model="search" aria-label="关键词搜索" placeholder="搜索备注 / 短信" /><select
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
          ><button
            class="text-button"
            @click="
              search = '';
              account = '';
              category = '';
              from = '';
              through = '';
            "
          >
            清除筛选
          </button>
        </div>
        <EntryList :items="visible" /><button v-if="!visible.length" class="text-button" @click="newEntry()">
          ＋ 记一笔
        </button>
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
