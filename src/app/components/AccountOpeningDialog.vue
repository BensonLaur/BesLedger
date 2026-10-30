<script setup lang="ts">
import { computed, ref } from 'vue';
import { state, ui, mutate, run } from '../store';
import { changeAccountOpeningTime } from '../../domain/ledger';
import { money } from '../../domain/money';
import { validTime } from '../../domain/time';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
const props = defineProps<{ accountId: string; transactionAt: string }>();
const emit = defineEmits<{ close: []; applied: [message: string] }>();
const snapshot = structuredClone(state.value!.entities[props.accountId]);
const original = snapshot?.data.kind === 'account' ? snapshot.data : undefined;
const openedAt = ref(original?.openedAt || ''),
  error = ref('');
const normalize = (value: string) => (value.length === 16 ? `${value}:00` : value);
const display = (value: string) => normalize(value).replace('T', ' ').replace(/:00$/, '');
const recommendation = computed(() =>
  validTime(normalize(props.transactionAt)) ? `${props.transactionAt.slice(0, 10)}T00:00:00` : '',
);
const changed = computed(() => !!original && normalize(openedAt.value) !== original.openedAt);
const stillEarlier = computed(
  () => changed.value && normalize(openedAt.value) > normalize(props.transactionAt),
);
function close() {
  if (!ui.busy) emit('close');
}
async function save() {
  error.value = '';
  const value = normalize(openedAt.value);
  if (!validTime(value)) {
    error.value = '请填写有效的起算日期和时间';
    return;
  }
  const okay = await run(async () => {
    await mutate((s) => changeAccountOpeningTime(s, props.accountId, value, snapshot.clock));
  });
  if (okay) emit('applied', `「${original!.name}」起算时间已调整为 ${display(value)}`);
  else error.value = ui.error;
}
</script>
<template>
  <Modal title="调整账户起算时间" @close="close">
    <template v-if="original">
      <h3 class="opening-account-name">{{ original.name }}</h3>
      <p class="hint">当前起算时间：{{ display(original.openedAt) }}</p>
      <form @submit.prevent="save">
        <label
          >起算时间<input
            v-model="openedAt"
            type="datetime-local"
            step="1"
            required
            :disabled="ui.busy"
            @input="error = ''"
        /></label>
        <button
          v-if="recommendation"
          type="button"
          class="opening-recommendation"
          :aria-label="`使用推荐时间：${display(recommendation)}`"
          :aria-pressed="normalize(openedAt) === recommendation"
          :disabled="ui.busy"
          @click="
            openedAt = recommendation;
            error = '';
          "
        >
          <Icon name="calendar" /><span
            ><small>按这笔账的日期推荐</small><strong>{{ display(recommendation) }}</strong
            ><small>点击使用当天 00:00</small></span
          ><Icon v-if="normalize(openedAt) === recommendation" name="check" />
        </button>
        <p class="hint">
          起始金额 ¥
          {{ money(original.opening) }}
          保持不变。相关账目会按新时间重新计入余额，请确认起始金额也适用于这个时间。
        </p>
        <p v-if="stillEarlier" class="hint">所选时间仍晚于这笔账的发生时间，确认后历史记录提示仍会保留。</p>
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
        <div class="actions">
          <button type="button" class="secondary" :disabled="ui.busy" @click="close">取消</button
          ><button class="primary" :disabled="ui.busy || !changed">
            {{ ui.busy ? '正在调整…' : '确认调整' }}
          </button>
        </div>
      </form>
    </template>
    <p v-else class="field-error">这个账户已不可用，请返回重新选择。</p>
  </Modal>
</template>
<style scoped>
.opening-account-name {
  overflow-wrap: anywhere;
}
.opening-recommendation {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  text-align: left;
  margin: 16px 0;
  background: var(--soft);
}
.opening-recommendation[aria-pressed='true'] {
  border-color: var(--accent);
}
.opening-recommendation > span {
  flex: 1;
  min-width: 0;
}
.opening-recommendation small,
.opening-recommendation strong {
  display: block;
  line-height: 1.6;
}
.opening-recommendation small {
  font-size: 12px;
  color: var(--muted);
}
.opening-recommendation strong {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}
.actions > button {
  flex: 1;
}
</style>
