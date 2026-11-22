<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import {
  changePickerDate,
  daysInPickerMonth,
  nearbyPickerDays,
  numberOptions,
  pickerDate,
  pickerValue,
  type PickerDate,
} from '../date-time-picker';
import { localTime } from '../../domain/time';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
import WheelColumn from './WheelColumn.vue';

const props = defineProps<{ value: string }>();
const emit = defineEmits<{ confirm: [value: string]; close: [] }>();
const date = reactive(pickerDate(props.value));
const mode = ref<'time' | 'date'>('time');
const wheels = ref<InstanceType<typeof WheelColumn>[]>([]);
const dayCenter = ref(pickerValue(date).slice(0, 10));
const minYear = ref(Math.max(1, Math.min(1900, date.year - 100)));
const maxYear = ref(Math.min(9999, Math.max(2100, date.year + 100)));
const years = computed(() => numberOptions(minYear.value, maxYear.value, '年'));
const months = numberOptions(1, 12, '月');
const hours = numberOptions(0, 23, '', true),
  minutes = numberOptions(0, 59, '', true);
const days = computed(() => numberOptions(1, daysInPickerMonth(date.year, date.month), '日'));
const nearby = computed(() => nearbyPickerDays(dayCenter.value));
const value = computed(() => pickerValue(date));
const columns = computed(() =>
  mode.value === 'time'
    ? [
        {
          part: 'nearby',
          label: '日期',
          value: value.value.slice(0, 10),
          options: nearby.value,
          loop: false,
        },
        { part: 'hour', label: '小时', value: String(date.hour), options: hours, loop: true },
        { part: 'minute', label: '分钟', value: String(date.minute), options: minutes, loop: true },
      ]
    : [
        { part: 'year', label: '年', value: String(date.year), options: years.value, loop: false },
        { part: 'month', label: '月', value: String(date.month), options: months, loop: true },
        { part: 'day', label: '日', value: String(date.day), options: days.value, loop: false },
      ],
);
function update(part: string, value: string) {
  if (part === 'nearby') {
    const [year, month, day] = value.split('-').map(Number);
    Object.assign(date, { year, month, day });
  } else Object.assign(date, changePickerDate(date, part as keyof PickerDate, Number(value)));
}
watch(
  () => date.year,
  (year) => {
    // 到边缘时扩展年份范围，既不渲染近万项，也不把旧账限制在固定世纪。
    if (year - minYear.value < 5) minYear.value = Math.max(1, minYear.value - 100);
    if (maxYear.value - year < 5) maxYear.value = Math.min(9999, maxYear.value + 100);
  },
);
async function switchMode(next: 'time' | 'date') {
  wheels.value.forEach((wheel) => wheel.settle());
  await nextTick();
  dayCenter.value = value.value.slice(0, 10);
  mode.value = next;
}
async function confirm() {
  // 快速滑动后立即确定，也取停下前最接近中央的一项。
  wheels.value.forEach((wheel) => wheel.settle());
  await nextTick();
  emit('confirm', value.value);
}
function now() {
  Object.assign(date, pickerDate(localTime()));
  dayCenter.value = value.value.slice(0, 10);
}
</script>

<template>
  <Modal title="发生时间" class="entry-date-backdrop" @close="emit('close')">
    <template #header>
      <h2 class="sr-only">发生时间</h2>
      <button class="icon-button" aria-label="关闭时间选择" @click="emit('close')">
        <Icon name="down" />
      </button>
      <div class="entry-date-tabs" role="tablist" aria-label="选择时间或日期">
        <button role="tab" :aria-selected="mode === 'time'" @click="switchMode('time')">时间</button>
        <button role="tab" :aria-selected="mode === 'date'" @click="switchMode('date')">日期</button>
      </div>
      <span class="entry-date-header-spacer" aria-hidden="true"></span>
    </template>
    <div
      :key="mode"
      class="entry-date-wheels"
      :class="mode"
      role="group"
      :aria-label="mode === 'time' ? '滑动选择时间' : '滑动选择日期'"
    >
      <div class="wheel-selection" aria-hidden="true"></div>
      <WheelColumn
        v-for="column in columns"
        ref="wheels"
        :key="column.part"
        :label="column.label"
        :model-value="column.value"
        :options="column.options"
        :loop="column.loop"
        @update:model-value="update(column.part, $event)"
      />
    </div>
    <div class="entry-date-current">
      <output aria-label="已选时间">{{ value.slice(0, 16).replace('T', ' ') }}</output>
      <button class="text-button" @click="now">现在</button>
    </div>
    <div class="entry-date-actions">
      <button class="secondary" @click="emit('close')">取消</button>
      <button class="primary" @click="confirm">确定</button>
    </div>
  </Modal>
</template>
