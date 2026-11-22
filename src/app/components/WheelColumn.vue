<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, useId } from 'vue';
import type { WheelOption } from '../date-time-picker';

const props = defineProps<{ modelValue: string; options: WheelOption[]; label: string; loop?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const root = ref<HTMLElement>();
const id = useId();
const repeats = computed(() => (props.loop ? 5 : 1));
const rows = computed(() => Array.from({ length: repeats.value }, () => props.options).flat());
const activeIndex = ref(0);
let rowHeight = 36,
  ready = false,
  timer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
const selected = computed(() => props.options.findIndex((option) => option.value === props.modelValue));
function centeredIndex(index: number) {
  return index + (props.loop ? props.options.length * 2 : 0);
}
function align() {
  if (!root.value || !props.options.length) return;
  rowHeight = Number.parseFloat(getComputedStyle(root.value).getPropertyValue('--wheel-row')) || 36;
  activeIndex.value = centeredIndex(Math.max(0, selected.value));
  root.value.scrollTop = activeIndex.value * rowHeight;
}
function readPosition() {
  if (!root.value || !ready) return;
  const measured = Number.parseFloat(getComputedStyle(root.value).getPropertyValue('--wheel-row')) || 36;
  // 横竖屏改变行高时，浏览器可能先派发 scroll 再通知 ResizeObserver。
  // 此时按已选值对齐，不能把旧像素位置解释成新的日期或时间。
  if (measured !== rowHeight) {
    align();
    return;
  }
  const index = Math.max(0, Math.min(rows.value.length - 1, Math.round(root.value.scrollTop / rowHeight)));
  activeIndex.value = index;
  const option = rows.value[index];
  if (option && option.value !== props.modelValue) emit('update:modelValue', option.value);
}
function settle() {
  clearTimeout(timer);
  readPosition();
  if (!root.value || !props.options.length) return;
  // 惯性停止后回到中间副本，避免时分滚轮碰到边界；滚动中不重定位。
  if (props.loop) activeIndex.value = centeredIndex(activeIndex.value % props.options.length);
  root.value.scrollTop = activeIndex.value * rowHeight;
}
function scroll() {
  readPosition();
  clearTimeout(timer);
  timer = setTimeout(settle, 150);
}
function choose(index: number) {
  if (!root.value) return;
  clearTimeout(timer);
  activeIndex.value = Math.max(0, Math.min(rows.value.length - 1, index));
  // 点击和键盘直接落到一项，触摸与鼠标滚动交给浏览器的惯性和吸附处理。
  root.value.scrollTop = activeIndex.value * rowHeight;
  const option = rows.value[activeIndex.value];
  if (option) emit('update:modelValue', option.value);
}
function keydown(event: KeyboardEvent) {
  const deltas: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -7, PageDown: 7 };
  if (event.key in deltas) {
    event.preventDefault();
    choose(activeIndex.value + deltas[event.key]);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    choose(centeredIndex(event.key === 'Home' ? 0 : props.options.length - 1));
  }
}
watch(
  () => props.modelValue,
  () => {
    if (rows.value[activeIndex.value]?.value !== props.modelValue) align();
  },
);
watch(
  () => props.options,
  async () => {
    ready = false;
    await nextTick();
    align();
    ready = true;
  },
);
onMounted(() => {
  align();
  ready = true;
  observer = new ResizeObserver(align);
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => {
  ready = false;
  clearTimeout(timer);
  observer?.disconnect();
});
defineExpose({ settle });
</script>

<template>
  <div
    ref="root"
    class="wheel-column"
    role="spinbutton"
    tabindex="0"
    :aria-label="label"
    :aria-valuemin="0"
    :aria-valuemax="options.length - 1"
    :aria-valuenow="Math.max(0, selected)"
    :aria-valuetext="options[selected]?.label"
    :aria-describedby="`${id}-hint`"
    @scroll.passive="scroll"
    @keydown="keydown"
  >
    <span :id="`${id}-hint`" class="sr-only">上下滑动或按上下箭头选择</span>
    <div class="wheel-options" aria-hidden="true">
      <div
        v-for="(option, index) in rows"
        :key="`${index}-${option.value}`"
        class="wheel-option"
        :class="{ selected: index === activeIndex }"
        :data-value="option.value"
        @click="choose(index)"
      >
        {{ option.label }}
      </div>
    </div>
  </div>
</template>
