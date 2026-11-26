<script setup lang="ts">
import { computed } from 'vue';
import { deleteEntry } from '../../domain/ledger';
import { money } from '../../domain/money';
import { categoryName } from '../../domain/categories';
import { entries, mutate, run, state, ui } from '../store';
import Modal from './Modal.vue';

const props = defineProps<{ id: string }>();
const entry = computed(() => entries.value.find((record) => record.id === props.id)?.data);

function close() {
  if (ui.busy) return;
  ui.deletingEntryId = '';
  ui.error = '';
}

async function remove() {
  const id = props.id;
  const ok = await run(async () => {
    await mutate((s) => deleteEntry(s, id));
    if (ui.detailId === id) ui.detailId = '';
    ui.notice = '账目已移入回收站，可在“我的”中找回';
  });
  if (ok) close();
}
</script>

<template>
  <Modal title="删除账目" @close="close">
    <p v-if="entry">
      <strong>{{ entry.at.slice(0, 16).replace('T', ' ') }} · ¥ {{ money(entry.amount) }}</strong>
      <span v-if="entry.categoryId"> · {{ categoryName(state!, entry.ledgerId, entry.categoryId) }}</span>
    </p>
    <p>将这笔账移入回收站？余额和统计会随之更新，可在“我的 → 回收站”找回。</p>
    <p v-if="ui.error" class="field-error" role="alert">{{ ui.error }}</p>
    <div class="actions">
      <button type="button" class="secondary" :disabled="ui.busy" @click="close">取消</button>
      <button type="button" class="danger" :disabled="ui.busy || !entry" @click="remove">确认删除</button>
    </div>
  </Modal>
</template>
