<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { StatisticRow } from '../../domain/statistics';
import { money } from '../../domain/money';
const props = defineProps<{
  rows: StatisticRow[];
  variant: 'trend' | 'donut';
  selected?: string;
  label: string;
  total: number;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const root = ref<HTMLElement>();
const width = ref(360);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    width.value = Math.max(240, entry.contentRect.width);
  });
  if (root.value) observer.observe(root.value);
});
onUnmounted(() => observer?.disconnect());
const colors = ['#436485', '#d88645', '#429886', '#8c79a8', '#b86c78', '#8b99a8'];
const geometry = computed(() => {
  const values = props.rows.map((row) => row.value);
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values);
  const plot = { left: 44, right: width.value - 10, top: 14, bottom: 158 };
  const y = (value: number) => plot.bottom - ((value - min) / (max - min)) * (plot.bottom - plot.top);
  const step = (plot.right - plot.left) / Math.max(1, props.rows.length);
  return { plot, min, max, y, step, zero: y(0) };
});
function axisLabel(value: number) {
  return Math.abs(value) >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}万`
    : (value / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
function tickLabel(id: string) {
  return id.length === 10
    ? `${Number(id.slice(5, 7))}/${Number(id.slice(8))}`
    : id.length === 7
      ? `${Number(id.slice(5))}月`
      : `${id}年`;
}
const ticks = computed(() =>
  [
    ...new Set([
      0,
      Math.floor(props.rows.length / 4),
      Math.floor(props.rows.length / 2),
      Math.floor((props.rows.length * 3) / 4),
      props.rows.length - 1,
    ]),
  ].filter((index) => index >= 0),
);
function pointer(event: PointerEvent) {
  if (event.type === 'pointermove' && !event.buttons) return;
  const box = (event.currentTarget as SVGElement).getBoundingClientRect();
  const x = ((event.clientX - box.left) * width.value) / box.width;
  const index = Math.max(
    0,
    Math.min(props.rows.length - 1, Math.floor((x - geometry.value.plot.left) / geometry.value.step)),
  );
  if (props.rows[index]) emit('select', props.rows[index].id);
}
function keyboard(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const current = Math.max(
    0,
    props.rows.findIndex((row) => row.id === props.selected),
  );
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.rows.length - 1
        : Math.max(0, Math.min(props.rows.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
  if (props.rows[index]) emit('select', props.rows[index].id);
}
const sectors = computed(() => {
  const total = props.rows.reduce((result, row) => result + row.value, 0);
  let start = -Math.PI / 2;
  return props.rows
    .filter((row) => row.value > 0)
    .map((row, index) => {
      const end = start + (row.value / total) * Math.PI * 2;
      const point = (radius: number, angle: number) =>
        `${120 + Math.cos(angle) * radius},${120 + Math.sin(angle) * radius}`;
      const path = `M ${point(102, start)} A 102,102 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(102, end)} L ${point(70, end)} A 70,70 0 ${end - start > Math.PI ? 1 : 0} 0 ${point(70, start)} Z`;
      start = end;
      return { ...row, path, color: colors[index % colors.length] };
    });
});
</script>
<template>
  <div ref="root" class="statistics-chart">
    <svg
      v-if="variant === 'trend'"
      class="trend-svg"
      :viewBox="`0 0 ${width} 190`"
      role="group"
      :aria-label="`${label}趋势，单位元；点击或使用左右键查看日期`"
      tabindex="0"
      @keydown="keyboard"
      @pointerdown="pointer"
      @pointermove="pointer"
    >
      <g v-for="value in [...new Set([geometry.min, 0, geometry.max])]" :key="value">
        <line
          :x1="geometry.plot.left"
          :x2="geometry.plot.right"
          :y1="geometry.y(value)"
          :y2="geometry.y(value)"
          class="grid-line"
          :class="{ 'zero-line': value === 0 }"
        />
        <text x="39" :y="Math.max(12, geometry.y(value) + 4)" text-anchor="end" class="axis-label">
          {{ axisLabel(value) }}
        </text>
      </g>
      <g v-for="(row, index) in rows" :key="row.id">
        <rect
          v-if="row.id === selected"
          :x="geometry.plot.left + index * geometry.step"
          :y="geometry.plot.top"
          :width="geometry.step"
          :height="geometry.plot.bottom - geometry.plot.top"
          class="point-highlight"
        />
        <rect
          v-if="row.value"
          :x="geometry.plot.left + index * geometry.step + geometry.step * 0.2"
          :y="Math.min(geometry.zero, geometry.y(row.value))"
          :width="Math.max(1, geometry.step * 0.6)"
          :height="Math.max(1, Math.abs(geometry.y(row.value) - geometry.zero))"
          rx="2"
          class="trend-bar"
          :class="{ negative: row.value < 0 }"
        />
        <rect
          :data-point="row.id"
          :x="geometry.plot.left + index * geometry.step"
          :y="geometry.plot.top"
          :width="geometry.step"
          :height="geometry.plot.bottom - geometry.plot.top"
          fill="transparent"
          role="button"
          tabindex="0"
          :aria-label="`${row.label}，${row.count ? `${money(row.value)}元，${row.count}笔` : '未记录'}`"
          :aria-pressed="row.id === selected"
          @click.stop="emit('select', row.id)"
          @keydown.enter.stop="emit('select', row.id)"
          @keydown.space.prevent.stop="emit('select', row.id)"
        />
      </g>
      <text
        v-for="index in ticks"
        :key="index"
        :x="geometry.plot.left + (index + 0.5) * geometry.step"
        y="180"
        :text-anchor="index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'"
        class="axis-label"
      >
        {{ tickLabel(rows[index].id) }}
      </text>
    </svg>
    <div v-else class="donut-layout">
      <svg
        class="donut-svg"
        viewBox="0 0 240 240"
        role="group"
        :aria-label="`${label}占比，合计${money(total)}元；点击分类查看`"
      >
        <path
          v-for="sector in sectors"
          :key="sector.id"
          :d="sector.path"
          :fill="sector.color"
          role="button"
          tabindex="0"
          :aria-label="`${sector.label}，${money(sector.value)}元，${sector.count}笔`"
          @click="emit('select', sector.id)"
          @keydown.enter="emit('select', sector.id)"
          @keydown.space.prevent="emit('select', sector.id)"
        />
        <text x="120" y="111" text-anchor="middle" class="donut-label">{{ label }}</text>
        <text
          x="120"
          y="140"
          text-anchor="middle"
          class="donut-total"
          :style="{
            fontSize: money(total).length > 11 ? '13px' : money(total).length > 8 ? '17px' : undefined,
          }"
        >
          {{ money(total) }}
        </text>
      </svg>
      <div class="donut-legend">
        <button v-for="sector in sectors" :key="sector.id" @click="emit('select', sector.id)">
          <i :style="{ background: sector.color }"></i><span>{{ sector.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.statistics-chart {
  width: 100%;
  min-width: 0;
}
.trend-svg {
  display: block;
  width: 100%;
  height: 190px;
  touch-action: pan-y;
}
.axis-label {
  fill: var(--muted);
  font-size: 11px;
}
.grid-line {
  stroke: var(--line);
  stroke-dasharray: 3 4;
}
.zero-line {
  stroke: var(--muted);
  stroke-dasharray: none;
}
.point-highlight {
  fill: var(--soft);
}
.trend-bar {
  fill: var(--accent);
  pointer-events: none;
}
.trend-bar.negative {
  fill: var(--green);
}
.donut-layout {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.donut-svg {
  width: 180px;
  height: 180px;
  flex-shrink: 0;
  overflow: visible;
}
.donut-svg path {
  cursor: pointer;
}
.donut-svg path:focus-visible {
  outline: none;
  stroke: var(--ink);
  stroke-width: 2px;
}
.donut-label {
  fill: var(--muted);
  font-size: 14px;
}
.donut-total {
  fill: var(--ink);
  font-weight: 650;
  font-size: 21px;
}
.donut-legend {
  display: grid;
  gap: 2px;
  min-width: 0;
  max-width: 160px;
}
.donut-legend button {
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.donut-legend i {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 3px;
}
.donut-legend span {
  min-width: 0;
  overflow-wrap: anywhere;
}
@media (max-width: 360px) {
  .donut-svg {
    width: 154px;
    height: 154px;
  }
  .donut-layout {
    gap: 6px;
  }
}
@media (min-width: 900px) {
  .trend-svg {
    height: 210px;
  }
  .donut-svg {
    width: 210px;
    height: 210px;
  }
}
</style>
