<script setup lang="ts">
import { computed, ref } from 'vue';
import { editEntry, entries, mutate, newEntry, run, state, ui } from '../store';
import { categoryName } from '../../domain/categories';
import { money, sum } from '../../domain/money';
import { deleteEntry } from '../../domain/ledger';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
const deleting = ref(false);
const entity = computed(() => entries.value.find((e) => e.id === ui.detailId));
const refunds = computed(() => entries.value.filter((e) => e.data.originalId === ui.detailId));
const refundTotal = computed(() => sum(refunds.value.map((e) => e.data.amount)));
const labels = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  borrow: '借入',
  lend: '借出',
  repay: '还款',
  collect: '收款',
  refund: '退款',
};
function account(id: string) {
  const e = state.value?.entities[id];
  return e?.data.kind === 'account' ? e.data.name : '—';
}
function addRefund() {
  const e = entity.value!;
  ui.detailId = '';
  newEntry('refund', { originalId: e.id, categoryId: e.data.categoryId, to: e.data.from });
}
async function remove() {
  await run(async () => {
    await mutate((s) => deleteEntry(s, ui.detailId));
    ui.detailId = '';
    ui.notice = '账目已删除，删除标记已保留';
  });
}
</script>
<template>
  <Modal v-if="entity" title="账目详情" @close="ui.detailId = ''"
    ><div class="detail-hero">
      <span class="entry-icon"><Icon name="receipt" :size="26" /></span>
      <p>
        {{ labels[entity.data.type] }} ·
        {{ categoryName(state!, entity.data.ledgerId, entity.data.categoryId) }}
      </p>
      <strong>¥ {{ money(entity.data.amount) }}</strong>
    </div>
    <dl class="detail-fields">
      <div>
        <dt>发生时间</dt>
        <dd>{{ entity.data.at.replace('T', ' ') }}</dd>
      </div>
      <div>
        <dt>记录创建</dt>
        <dd>{{ entity.data.createdAt.replace('T', ' ') }}</dd>
      </div>
      <div v-if="entity.data.from">
        <dt>转出账户</dt>
        <dd>{{ account(entity.data.from) }}</dd>
      </div>
      <div v-if="entity.data.to">
        <dt>{{ entity.data.type === 'refund' ? '退款入账账户' : '转入账户' }}</dt>
        <dd>{{ account(entity.data.to) }}</dd>
      </div>
      <div v-if="entity.data.interest">
        <dt>包含利息</dt>
        <dd>
          {{ money(entity.data.interest) }}（本金 {{ money(entity.data.amount - entity.data.interest) }}）
        </dd>
      </div>
      <div v-if="entity.data.due">
        <dt>约定日期</dt>
        <dd>{{ entity.data.due }} · 待核对</dd>
      </div>
      <div v-if="entity.data.source">
        <dt>周期来源</dt>
        <dd>
          <button
            class="text-button"
            @click="
              ui.ruleId = entity.data.source!.ruleId;
              ui.ruleForm = true;
            "
          >
            查看规则 · {{ entity.data.source.occurrence }}
          </button>
        </dd>
      </div>
    </dl>
    <p v-if="entity.data.note" class="detail-note">{{ entity.data.note }}</p>
    <button v-if="entity.data.originalId" class="text-button" @click="ui.detailId = entity.data.originalId!">
      ← 查看原支出
    </button>
    <section v-if="entity.data.type === 'expense'" class="refund-section">
      <div class="section-heading">
        <h3>关联退款 {{ refunds.length }} 笔</h3>
        <button class="text-button" @click="addRefund">＋ 添加退款</button>
      </div>
      <p>累计退款 ¥{{ money(refundTotal) }} · 净成本 ¥{{ money(entity.data.amount - refundTotal) }}</p>
      <button v-for="refund in refunds" class="refund-row" @click="ui.detailId = refund.id">
        {{ refund.data.at.slice(0, 10) }}<span>+ {{ money(refund.data.amount) }} →</span>
      </button>
    </section>
    <p v-if="ui.error" class="field-error">{{ ui.error }}</p>
    <div v-if="!deleting" class="actions">
      <button class="danger-outline" @click="deleting = true"><Icon name="delete" />删除</button
      ><button class="primary" @click="editEntry(entity.id)"><Icon name="edit" />编辑账目</button>
    </div>
    <div v-else class="warning-panel">
      <p>确认删除本笔？余额和统计会同步更新；可从备份恢复。</p>
      <div class="actions">
        <button class="secondary" @click="deleting = false">取消</button
        ><button class="danger" :disabled="ui.busy" @click="remove">确认删除</button>
      </div>
    </div></Modal
  >
</template>
