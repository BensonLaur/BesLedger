<script setup lang="ts">
import { computed } from 'vue';
import { type Entity, type State } from '../../domain/model';
import { type Conflict } from '../../sync/merge';
import { money } from '../../domain/money';
import Icon from './Icon.vue';
import { categoryName } from '../../domain/categories';
const props = defineProps<{
  conflict: Conflict;
  state: State;
  remote: Record<string, Entity>;
  choice?: 'local' | 'remote';
  disabled?: boolean;
}>();
const emit = defineEmits<{ choose: [choice: 'local' | 'remote'] }>();
const typeNames = {
  expense: '支出',
  income: '收入',
  refund: '退款',
  transfer: '转账',
  borrow: '借入',
  lend: '借出',
  repay: '还款',
  collect: '收款',
};
function fields(entity: Entity, remote: boolean): Record<string, string> {
  const d = entity.data;
  const context = remote
    ? { ...props.state, entities: { ...props.state.entities, ...props.remote } }
    : props.state;
  const name = (id: string) => {
    const data = context.entities[id]?.data;
    return data && 'name' in data ? data.name : id ? '未找到名称' : '无';
  };
  const reference = (id?: string) => {
    const item = id ? context.entities[id]?.data : undefined;
    return item?.kind === 'entry'
      ? `${item.at.replace('T', ' ')} · ¥ ${money(item.amount)} · ${item.note || '无备注'}`
      : id
        ? '关联记录尚未下载'
        : '无';
  };
  const status = { 记录状态: entity.deleted ? '已删除' : '保留' };
  if (d.kind === 'entry')
    return {
      ...status,
      类型: typeNames[d.type],
      日期: d.at.replace('T', ' '),
      金额: `¥ ${money(d.amount)}`,
      分类: d.categoryId ? categoryName(context, d.ledgerId, d.categoryId) : '无',
      付款账户: name(d.from),
      收款账户: name(d.to),
      ...(d.interest ? { 利息: `¥ ${money(d.interest)}` } : {}),
      备注: d.note || '无',
      关联原账目: reference(d.originalId),
      关联借贷: reference(d.settlesId),
      到期日期: d.due || '无',
      转账方式: d.behavior,
      记录创建时间: d.createdAt.replace('T', ' '),
      手动分类时间: d.manualCategoryAt?.replace('T', ' ') || '无',
      周期期次: d.source?.occurrence || '无',
      原始交易日期: d.recognition?.rawDate || '无',
      年份依据: d.recognition?.yearBasis || '无',
      日期已核对: d.recognition ? (d.recognition.confirmed ? '是' : '否') : '无需核对',
      短信余额: d.recognition?.balance === undefined ? '未记录' : `¥ ${money(d.recognition.balance)}`,
    };
  if (d.kind === 'ledger') return { ...status, 账本名称: d.name };
  if (d.kind === 'account')
    return {
      ...status,
      账户名称: d.name,
      账户类型: {
        cash: '现金',
        bank: '银行卡',
        wallet: '网络账户',
        credit: '信用卡',
        receivable: '应收应付',
        asset: '其他资产',
        liability: '其他欠款',
      }[d.type],
      展示类型: d.displayType
        ? {
            cash: '现金',
            credit: '信用卡',
            bank: '储蓄卡',
            wallet: '网络账户',
            investment: '投资账户',
            receivable: '应收应付',
            stored: '储值账户',
            other: '其他账户',
          }[d.displayType]
        : '默认',
      每月还款日: d.repaymentDay ? `${d.repaymentDay} 日` : '未设置',
      起始金额: `¥ ${money(d.opening)}`,
      开始记账时间: d.openedAt.replace('T', ' '),
      银行: d.bank || '无',
      卡号后四位: d.tail || '无',
    };
  if (d.kind === 'category')
    return {
      ...status,
      分类名称: d.name,
      所属分组: d.group,
      图标: d.icon,
      类型: d.type === 'expense' ? '支出' : '收入',
    };
  if (d.kind === 'budget')
    return { ...status, 月份: d.month, 预算: `¥ ${money(d.amount)}`, 预算状态: d.enabled ? '开启' : '关闭' };
  return {
    ...fields({ ...entity, data: d.template }, remote),
    ...status,
    周期账名称: d.name,
    开始日期: d.start,
    结束日期: d.end || '未设置',
    时间: d.time,
    重复方式: { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }[d.frequency],
    金额: `¥ ${money(d.template.amount)}`,
    生成进度: d.cursor,
    规则状态: d.paused ? '暂停' : '启用',
  };
}
const local = computed(() => fields(props.conflict.local, false));
const remote = computed(() => fields(props.conflict.remote, true));
const labels = computed(() => {
  const essential = new Set([
    '记录状态',
    '类型',
    '日期',
    '金额',
    '分类',
    '付款账户',
    '收款账户',
    '备注',
    '账本名称',
    '账户名称',
    '分类名称',
    '周期账名称',
  ]);
  return [...new Set([...Object.keys(local.value), ...Object.keys(remote.value)])].filter(
    (label) => essential.has(label) || local.value[label] !== remote.value[label],
  );
});
const reason = computed(() =>
  props.conflict.related?.length
    ? `一边删除了整本账，另一边还有 ${props.conflict.related.filter((e) => !e.deleted).length} 条未同步内容。选择删除会一并删除这些内容。`
    : props.conflict.local.deleted !== props.conflict.remote.deleted
      ? '一边删除了这条记录，另一边又修改了它。'
      : '两边都修改了这条记录，请核对不同之处。',
);
</script>
<template>
  <article class="conflict-card">
    <p>{{ reason }}</p>
    <div class="review-columns">
      <section v-for="side in ['local', 'remote'] as const" :key="side" :class="{ chosen: choice === side }">
        <h3>{{ side === 'local' ? '这里的内容' : '云端的内容' }}</h3>
        <dl>
          <template v-for="label in labels" :key="label"
            ><div :class="{ 'review-difference': local[label] !== remote[label] }">
              <dt>{{ label }}</dt>
              <dd>
                <Icon v-if="label === '图标'" :name="(side === 'local' ? local : remote)[label]" /><template
                  v-else
                  >{{ (side === 'local' ? local : remote)[label] || '无' }}</template
                >
              </dd>
            </div></template
          >
        </dl>
        <button
          class="secondary full"
          :disabled="disabled"
          :aria-pressed="choice === side"
          @click="emit('choose', side)"
        >
          {{ choice === side ? '已选择：' : '保留' }}{{ side === 'local' ? '这里的内容' : '云端的内容' }}
        </button>
      </section>
    </div>
  </article>
</template>
<style scoped>
.review-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
section {
  min-width: 0;
  border: 2px solid transparent;
  border-radius: 14px;
  padding: 12px;
  background: var(--surface);
}
section.chosen {
  border-color: var(--accent);
}
dl {
  font-size: 13px;
}
dl > div {
  padding: 8px;
  border-radius: 6px;
}
dt {
  color: var(--muted);
  font-size: 11px;
  margin-bottom: 4px;
}
dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.review-difference {
  background: var(--soft);
}
@media (max-width: 550px) {
  .review-columns {
    grid-template-columns: 1fr;
  }
}
</style>
