<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ amount: number; ceiling: number }>();
const shape = computed(() => {
  const ratio = props.ceiling > 0 ? Math.min(Math.abs(props.amount) / props.ceiling, 1) : 0;
  // 沿用原型的 40×34 画布与 22px 柱高；三面共用顶点，避免硬阴影产生错位叠片。
  const h = ratio * 22,
    negative = props.amount < 0;
  const base = negative ? 8 : 28,
    dy = h * (negative ? -1 : 1),
    dx = h * 0.18;
  return {
    ratio,
    cut: props.ceiling > 0 && Math.abs(props.amount) > props.ceiling,
    plane: `9,${base} 22,${base} 30,${base - 4} 17,${base - 4}`,
    front: `12,${base} 23,${base} ${23 + dx},${base - dy} ${12 + dx},${base - dy}`,
    side: `23,${base} 28,${base - 3} ${28 + dx},${base - 3 - dy} ${23 + dx},${base - dy}`,
    top: `${12 + dx},${base - dy} ${23 + dx},${base - dy} ${28 + dx},${base - 3 - dy} ${17 + dx},${base - 3 - dy}`,
  };
});
</script>
<template>
  <svg
    class="calendar-bar"
    :class="{ 'is-negative': amount < 0 }"
    viewBox="0 0 40 34"
    aria-hidden="true"
    focusable="false"
    :data-cut="shape.cut"
    :data-ratio="shape.ratio"
  >
    <polygon :points="shape.plane" fill="var(--bar-plane)" />
    <polygon :points="shape.front" fill="var(--bar-front)" />
    <polygon :points="shape.side" fill="var(--bar-side)" />
    <polygon :points="shape.top" fill="var(--bar-top)" />
    <template v-if="shape.cut">
      <path d="M12 19 L21 14 M20 19 L29 14" stroke="var(--bar-paper)" stroke-width="3.5" />
      <path d="M12 19 L21 14 M20 19 L29 14" stroke="var(--bar-cut)" stroke-width="1.3" />
    </template>
  </svg>
</template>
<style scoped>
.calendar-bar {
  --bar-front: #385978;
  --bar-side: #2c4662;
  --bar-top: #7d9bb5;
  --bar-plane: #e5ebf0;
  --bar-paper: #ffffff;
  --bar-cut: #974726;
  --bar-green: #286b50;
  position: absolute;
  top: 3px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
  width: 40px;
  max-width: 100%;
  height: 34px;
  display: block;
  overflow: hidden;
  pointer-events: none;
}
@media (prefers-color-scheme: dark) {
  .calendar-bar {
    --bar-front: #a6c6e8;
    --bar-side: #7699ba;
    --bar-top: #cce2f5;
    --bar-plane: #3b4b5c;
    --bar-paper: #222f3d;
    --bar-cut: #ffc2a3;
    --bar-green: #a5d8b9;
  }
}
.calendar-bar.is-negative {
  --bar-front: var(--bar-green);
  --bar-side: var(--bar-green);
  --bar-top: var(--bar-green);
}
</style>
