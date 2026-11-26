<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Entity, Entry } from '../../domain/model';
import { contribution, totals } from '../../domain/ledger';
import { categoryName } from '../../domain/categories';
import { money } from '../../domain/money';
import { copyEntry, editEntry, state, ui } from '../store';
import Icon from './Icon.vue';
import { entryIcon } from '../entry-presentation';
const props = defineProps<{
  items: Entity<Entry>[];
  summaryItems?: Entity<Entry>[];
  statistical?: boolean;
  hideAmounts?: boolean;
  quickActions?: boolean;
}>();
const openId = ref('');
const draggingId = ref('');
const dragOffset = ref(0);
let openRow: HTMLElement | null = null;
let suppressClickId = '';
let swipe: {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  width: number;
  wasOpen: boolean;
  row: HTMLElement;
} | null = null;

function closeActions() {
  if (openRow && openRow.querySelector('.entry-swipe-actions')?.contains(document.activeElement))
    openRow.querySelector<HTMLButtonElement>('.entry-swipe-toggle')?.focus({ preventScroll: true });
  openId.value = '';
  openRow = null;
}
function openActions(id: string, row: HTMLElement) {
  openId.value = id;
  openRow = row;
}
function toggleActions(event: MouseEvent, id: string) {
  if (openId.value === id) closeActions();
  else openActions(id, (event.currentTarget as HTMLElement).closest<HTMLElement>('.entry-swipe-row')!);
}
function dismissOutside(event: PointerEvent) {
  if (openRow && !openRow.contains(event.target as Node)) closeActions();
}
onMounted(() => {
  if (!props.quickActions) return;
  document.addEventListener('pointerdown', dismissOutside, true);
  document.addEventListener('wheel', closeActions, { passive: true });
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', dismissOutside, true);
  document.removeEventListener('wheel', closeActions);
});
watch(() => props.items, closeActions);

function startSwipe(event: PointerEvent, id: string) {
  if (!props.quickActions || !event.isPrimary || event.button !== 0) return;
  suppressClickId = '';
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('.entry-swipe-row')!;
  swipe = {
    id,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    width: row.querySelector<HTMLElement>('.entry-swipe-actions')!.offsetWidth,
    wasOpen: openId.value === id,
    row,
  };
}
function moveSwipe(event: PointerEvent) {
  if (swipe?.pointerId !== event.pointerId) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  if (!draggingId.value) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
    // 先判断方向再捕获横向手势，纵向滚动继续交给浏览器。
    if (Math.abs(dx) <= Math.abs(dy) * 1.25) {
      suppressClickId = swipe.id;
      swipe = null;
      closeActions();
      return;
    }
    const target = event.currentTarget as HTMLElement;
    // 触摸初始捕获可能属于行内文字。转交给整行时，只处理整行自己的捕获丢失事件。
    target.setPointerCapture(event.pointerId);
    draggingId.value = swipe.id;
    suppressClickId = swipe.id;
  }
  dragOffset.value = Math.min(0, Math.max(-swipe.width, (swipe.wasOpen ? -swipe.width : 0) + dx));
}
function endSwipe(event: PointerEvent, cancelled = false) {
  if (swipe?.pointerId !== event.pointerId) return;
  if (!cancelled && draggingId.value) {
    const dx = event.clientX - swipe.x;
    if (swipe.wasOpen ? dx < 32 : dx < -36) openActions(swipe.id, swipe.row);
    else closeActions();
  }
  draggingId.value = '';
  dragOffset.value = 0;
  swipe = null;
}
function showDetail(event: MouseEvent, id: string) {
  if (suppressClickId === id && event.detail > 0) {
    suppressClickId = '';
    return;
  }
  if (openId.value === id) closeActions();
  else ui.detailId = id;
}
function shortcut(action: 'edit' | 'copy' | 'delete', id: string) {
  closeActions();
  if (action === 'edit') editEntry(id);
  else if (action === 'copy') copyEntry(id);
  else {
    ui.error = '';
    ui.deletingEntryId = id;
  }
}
function escapeActions(event: KeyboardEvent, id: string) {
  if (openId.value !== id) return;
  event.stopPropagation();
  closeActions();
}
const labels: Record<Entry['type'], string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  borrow: '借入',
  lend: '借出',
  repay: '还款',
  collect: '收款',
  refund: '退款',
};
const summaryGroups = computed(() => {
  const result: Record<string, Entry[]> = {};
  for (const e of props.summaryItems || props.items) (result[e.data.at.slice(0, 10)] ??= []).push(e.data);
  return result;
});
const groups = computed(() => {
  const result: Record<string, Entity<Entry>[]> = {};
  for (const e of props.items) (result[e.data.at.slice(0, 10)] ??= []).push(e);
  return (
    Object.entries(result)
      .sort(([a], [b]) => b.localeCompare(a))
      // 分批显示时，日期小计仍取完整筛选结果，不能把首批误报为当天总额。
      .map(([day, items]) => ({ day, items, totals: totals(summaryGroups.value[day]) }))
  );
});
function name(e: Entry) {
  if (props.statistical && ['repay', 'collect'].includes(e.type)) return `${labels[e.type]}利息`;
  return ['expense', 'income', 'refund'].includes(e.type)
    ? categoryName(state.value!, e.ledgerId, e.categoryId)
    : labels[e.type];
}
function account(id: string) {
  const a = state.value?.entities[id];
  return a?.data.kind === 'account' ? a.data.name : '';
}
</script>
<template>
  <div v-if="!items.length" class="empty-state">
    <Icon name="receipt" :size="36" />
    <h3>这里还没有记录</h3>
    <p>记下第一笔，或调整筛选范围。</p>
  </div>
  <section v-for="group in groups" :key="group.day" class="day-group">
    <div class="section-heading">
      <h3>{{ group.day.replaceAll('-', ' / ') }}</h3>
      <small>{{
        hideAmounts ? '金额已隐藏' : `支 ${money(group.totals.expense)} · 收 ${money(group.totals.income)}`
      }}</small>
    </div>
    <div class="entry-list">
      <div
        v-for="e in group.items"
        :key="e.id"
        class="entry-swipe-row"
        @keydown.esc="escapeActions($event, e.id)"
      >
        <div
          class="entry-swipe-surface"
          :class="{ 'is-open': openId === e.id, 'is-dragging': draggingId === e.id }"
          :style="draggingId === e.id ? { transform: `translateX(${dragOffset}px)` } : undefined"
        >
          <button
            type="button"
            class="entry-row"
            :class="{ 'can-swipe': quickActions }"
            @pointerdown="startSwipe($event, e.id)"
            @pointermove="moveSwipe"
            @pointerup="endSwipe($event)"
            @pointercancel="endSwipe($event, true)"
            @lostpointercapture.self="endSwipe($event, true)"
            @click="showDetail($event, e.id)"
          >
            <span
              class="entry-icon"
              :class="{ inflow: contribution(e.data).income || e.data.type === 'refund' }"
              ><Icon :name="entryIcon(state!, e.data)" /></span
            ><span class="entry-main"
              ><strong
                >{{ name(e.data) }} <em v-if="e.data.type === 'refund'">退款</em
                ><em v-if="e.data.source">周期</em></strong
              ><small
                >{{ e.data.at.slice(11, 16) }} · {{ account(e.data.from)
                }}{{ e.data.from && e.data.to ? ' → ' : '' }}{{ account(e.data.to) }}</small
              ><small v-if="e.data.note && !hideAmounts" class="note-preview">{{ e.data.note }}</small></span
            ><span
              class="entry-value"
              :class="{ positive: ['income', 'refund', 'collect', 'borrow'].includes(e.data.type) }"
              >{{
                hideAmounts
                  ? ''
                  : ['expense', 'repay', 'lend'].includes(e.data.type)
                    ? '−'
                    : ['income', 'refund', 'collect', 'borrow'].includes(e.data.type)
                      ? '+'
                      : ''
              }}{{
                hideAmounts
                  ? '••••••'
                  : money(
                      statistical && ['repay', 'collect'].includes(e.data.type)
                        ? e.data.interest
                        : e.data.amount,
                    )
              }}<small v-if="e.data.interest && !hideAmounts">{{
                statistical ? '业务总额 ' + money(e.data.amount) : '含利息 ' + money(e.data.interest)
              }}</small></span
            >
          </button>
          <button
            v-if="quickActions"
            type="button"
            class="entry-swipe-toggle"
            aria-label="账目操作"
            :aria-expanded="openId === e.id"
            @click="toggleActions($event, e.id)"
          >
            <Icon name="more" :size="18" />
          </button>
        </div>
        <div
          v-if="quickActions"
          class="entry-swipe-actions"
          :inert="openId !== e.id"
          :aria-hidden="openId !== e.id"
          role="group"
          aria-label="快捷操作"
        >
          <button type="button" @click="shortcut('edit', e.id)"><Icon name="edit" :size="17" />编辑</button>
          <button type="button" @click="shortcut('copy', e.id)"><Icon name="copy" :size="17" />复制</button>
          <button type="button" class="swipe-delete" @click="shortcut('delete', e.id)">
            <Icon name="delete" :size="17" />删除
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.entry-swipe-row {
  --swipe-width: min(174px, 72%);
  position: relative;
  overflow: hidden;
}
.entry-swipe-row + .entry-swipe-row {
  border-top: 1px solid var(--line);
}
.entry-swipe-surface {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--surface);
  z-index: 1;
  transition: transform 160ms ease-out;
}
.entry-swipe-surface.is-open {
  transform: translateX(calc(0px - var(--swipe-width)));
}
.entry-swipe-surface.is-dragging {
  transition: none;
}
.entry-swipe-surface > .entry-row {
  flex: 1;
  min-width: 0;
  border: 0;
}
.entry-row.can-swipe {
  touch-action: pan-y pinch-zoom;
  user-select: none;
}
.entry-swipe-toggle {
  flex: 0 0 38px;
  min-height: 44px;
  display: grid;
  place-items: center;
  color: var(--muted);
  border-radius: 8px;
}
.entry-swipe-toggle:hover,
.entry-swipe-toggle[aria-expanded='true'] {
  background: var(--soft);
}
.entry-swipe-actions {
  position: absolute;
  inset: 0 0 0 auto;
  width: var(--swipe-width);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  color: var(--accent);
  background: var(--soft);
  font-size: 12px;
}
.entry-swipe-actions > button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: inherit;
  border-inline-start: 1px solid var(--line);
}
.entry-swipe-actions > .swipe-delete {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 11%, var(--surface));
}
.entry-swipe-row :focus-visible {
  outline-offset: -2px;
}
@media (prefers-reduced-motion: reduce) {
  .entry-swipe-surface {
    transition: none;
  }
}
</style>
