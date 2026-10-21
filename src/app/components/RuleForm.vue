<script setup lang="ts">
import { computed, ref } from 'vue';
import { accounts, currentLedgerId, entries, mutate, run, state, ui } from '../store';
import { type Entry, type Rule } from '../../domain/model';
import { saveRule, generateDue } from '../../domain/recurring';
import { categories } from '../../domain/categories';
import { decimal, minor } from '../../domain/money';
import { localTime, today } from '../../domain/time';
import { validateEntry } from '../../domain/ledger';
import Modal from './Modal.vue';
import EntryList from './EntryList.vue';
const entity = ui.ruleId ? state.value!.entities[ui.ruleId] : undefined;
const old = entity?.data.kind === 'rule' ? entity.data : undefined;
const name = ref(old?.name || ''),
  start = ref(old?.start || today()),
  end = ref(old?.end || ''),
  frequency = ref<Rule['frequency']>(old?.frequency || 'monthly'),
  time = ref(old?.time || '12:00'),
  type = ref<Entry['type']>(old?.template.type || 'expense'),
  amount = ref(old ? decimal(old.template.amount) : ''),
  interest = ref(old ? decimal(old.template.interest) : '0'),
  from = ref(old?.template.from || ''),
  to = ref(old?.template.to || ''),
  categoryId = ref(old?.template.categoryId || ''),
  note = ref(old?.template.note || ''),
  paused = ref(old?.paused || false),
  showHistory = ref(false);
const options = computed(() =>
  categories(state.value!, currentLedgerId.value).filter(
    (c) => c.type === (type.value === 'income' ? 'income' : 'expense'),
  ),
);
const history = computed(() =>
  entries.value
    .filter((e) => e.data.source?.ruleId === ui.ruleId)
    .sort((a, b) => b.data.at.localeCompare(a.data.at)),
);
async function save() {
  await run(async () => {
    const template: Entry = {
      kind: 'entry',
      ledgerId: currentLedgerId.value,
      type: type.value,
      amount: minor(amount.value),
      interest: ['repay', 'collect'].includes(type.value) ? minor(interest.value || '0') : 0,
      from: from.value,
      to: to.value,
      categoryId: categoryId.value,
      at: `${start.value}T${time.value}:00`,
      createdAt: localTime(),
      note: note.value,
      behavior: '转账',
    };
    await mutate((s) => {
      validateEntry(s, template);
      if (end.value && end.value < start.value) throw new Error('结束日期不能早于开始日期');
      saveRule(
        s,
        {
          kind: 'rule',
          ledgerId: currentLedgerId.value,
          name: name.value,
          start: start.value,
          ...(end.value ? { end: end.value } : {}),
          cursor: old?.cursor || start.value,
          frequency: frequency.value,
          time: time.value,
          paused: paused.value,
          template,
        },
        ui.ruleId || undefined,
      );
      generateDue(s);
    });
    ui.ruleForm = false;
    ui.notice = '周期规则已保存，到期期次已按规则补齐';
  });
}
</script>
<template>
  <Modal :title="old ? '周期规则 · 未来生效' : '创建周期账'" wide @close="ui.ruleForm = false"
    ><p class="hint">
      打开应用时补齐到期记录。修改前先按旧规则补齐；已经生成的账目保持原样。暂停期间不生成，也不在恢复后追补。
    </p>
    <form @submit.prevent="save">
      <label>规则名称<input v-model="name" maxlength="100" required /></label>
      <div class="form-grid">
        <label
          >业务类型<select v-model="type">
            <option value="expense">支出</option>
            <option value="income">收入</option>
            <option value="transfer">转账</option>
            <option value="borrow">借入</option>
            <option value="lend">借出</option>
            <option value="repay">还款</option>
            <option value="collect">收款</option>
          </select></label
        ><label>每期总额（元）<input v-model="amount" inputmode="decimal" required /></label
        ><label v-if="type !== 'income'"
          >转出账户<select v-model="from" required>
            <option value="">请选择</option>
            <option v-for="a in accounts" :value="a.id">{{ a.data.name }}</option>
          </select></label
        ><label v-if="type !== 'expense'"
          >转入账户<select v-model="to" required>
            <option value="">请选择</option>
            <option v-for="a in accounts" :value="a.id">{{ a.data.name }}</option>
          </select></label
        ><label v-if="['income', 'expense'].includes(type)"
          >分类<select v-model="categoryId">
            <option value="">待分类</option>
            <option v-for="c in options" :value="c.id">{{ c.group }} · {{ c.name }}</option>
          </select></label
        ><label v-if="['repay', 'collect'].includes(type)"
          >包含利息<input v-model="interest" inputmode="decimal" /></label
        ><label
          >频率<select v-model="frequency">
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="yearly">每年</option>
          </select></label
        ><label>开始日期<input v-model="start" type="date" required :disabled="!!old" /></label
        ><label>结束日期（可选）<input v-model="end" type="date" /></label
        ><label>计划入账时间<input v-model="time" type="time" required /></label>
      </div>
      <label>备注<textarea v-model="note" rows="2"></textarea></label
      ><label class="checkbox"><input v-model="paused" type="checkbox" />暂停规则</label>
      <p v-if="ui.error" class="field-error">{{ ui.error }}</p>
      <button class="primary full" :disabled="ui.busy">保存规则</button>
    </form>
    <template v-if="old"
      ><button class="text-button" @click="showHistory = !showHistory">
        历史生成记录（{{ history.length }}）</button
      ><EntryList v-if="showHistory" :items="history" /></template
  ></Modal>
</template>
