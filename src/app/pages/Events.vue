<script setup lang="ts">
import { computed, ref } from 'vue';
import { state, ui, mutate, run, newEntry, currentLedgerId } from '../store';
import { events, generateDue, saveRule, type FinancialEvent } from '../../domain/recurring';
import { list } from '../../domain/model';
import { today } from '../../domain/time';
import { money } from '../../domain/money';
import Icon from '../components/Icon.vue';
const tab = ref<'events' | 'rules'>('events');
const rules = computed(() =>
  list(state.value!, 'rule').filter((r) => r.data.ledgerId === currentLedgerId.value),
);
const all = computed(() =>
  events(state.value!).filter(
    (event) =>
      event.kind === 'account' ||
      ('ledgerId' in state.value!.entities[event.sourceId].data &&
        (state.value!.entities[event.sourceId].data as { ledgerId: string }).ledgerId ===
          currentLedgerId.value),
  ),
);
const sections = computed(() => [
  { title: '已过期 · 待核对', items: all.value.filter((e) => e.day < today()) },
  { title: '今天', items: all.value.filter((e) => e.day === today()) },
  { title: '即将到来', items: all.value.filter((e) => e.day > today()) },
]);
async function checkDue() {
  await run(async () => {
    const n = await mutate((s) => generateDue(s));
    ui.notice = String(n) + ' 个到期期次已补齐';
  });
}
function open(event: FinancialEvent) {
  const source = state.value!.entities[event.sourceId];
  if (source.data.kind === 'rule') {
    ui.ruleId = source.id;
    ui.ruleForm = true;
  } else if (source.data.kind === 'entry')
    newEntry(source.data.type === 'borrow' ? 'repay' : 'collect', {
      amount: event.amount || 0,
      from: source.data.to,
      to: source.data.from,
      settlesId: source.id,
    });
  else if (source.data.kind === 'account') newEntry('transfer', { to: source.id });
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">有日期的事，慢慢理清</p>
      <h1>事件</h1>
    </div>
    <button
      class="primary"
      @click="
        ui.ruleId = '';
        ui.ruleForm = true;
      "
    >
      <Icon name="plus" />周期账
    </button>
  </div>
  <div class="section-tabs">
    <button :aria-pressed="tab === 'events'" @click="tab = 'events'">事件</button
    ><button :aria-pressed="tab === 'rules'" @click="tab = 'rules'">周期账</button>
  </div>
  <template v-if="tab === 'events'">
    <p class="scope-note">有日期的财务事项，核对后再记下实际收支。</p>
    <section v-for="section in sections" :key="section.title" class="section">
      <h2>{{ section.title }}</h2>
      <div v-if="section.items.length" class="event-list">
        <button v-for="event in section.items" :key="event.id" class="event-card" @click="open(event)">
          <span class="event-date"
            ><strong>{{ event.day.slice(8) }}</strong
            ><small>{{ event.day.slice(0, 7) }}</small></span
          ><span class="entry-main"
            ><strong>{{ event.name }}</strong
            ><small>{{ event.kind === 'rule' ? '预计期次' : '核对后记入实际账目' }}</small></span
          ><span
            >{{ event.amount === undefined ? '待核对' : '¥ ' + money(event.amount)
            }}<Icon name="right" :size="16"
          /></span>
        </button>
      </div>
      <p v-else class="hint">暂无事项</p>
    </section>
  </template>
  <section v-else class="section">
    <div class="section-heading">
      <h2>周期规则</h2>
      <button class="text-button" :disabled="ui.busy" @click="checkDue">检查到期期次</button>
    </div>
    <article v-for="rule in rules" class="rule-card">
      <button
        class="entry-main"
        @click="
          ui.ruleId = rule.id;
          ui.ruleForm = true;
        "
      >
        <strong>{{ rule.data.name }}</strong
        ><small
          >¥ {{ money(rule.data.template.amount) }} ·
          {{ { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }[rule.data.frequency] }} ·
          {{ rule.data.paused ? '已暂停' : '生效中' }}</small
        ></button
      ><button
        class="secondary"
        :disabled="ui.busy"
        @click="
          run(async () => {
            await mutate((s) => saveRule(s, { ...rule.data, paused: !rule.data.paused }, rule.id));
          })
        "
      >
        {{ rule.data.paused ? '恢复' : '暂停' }}
      </button>
    </article>
    <p v-if="!rules.length" class="hint">固定收入、房租或账户划转，可以从一个周期规则开始。</p>
  </section>
</template>
