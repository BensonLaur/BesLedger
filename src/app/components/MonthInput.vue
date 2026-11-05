<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from './Icon.vue';
const props = defineProps<{ modelValue: string; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const nativeMonth = ref(true);
onMounted(() => {
  const probe = document.createElement('input');
  probe.type = 'month';
  nativeMonth.value = probe.type === 'month';
});
const display = computed(() => `${props.modelValue.slice(0, 4)}年${Number(props.modelValue.slice(5))}月`);
function change(event: Event) {
  const input = event.target as HTMLInputElement;
  if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(input.value)) emit('update:modelValue', input.value);
  else input.value = props.modelValue;
}
</script>
<template>
  <span class="month-input" :class="{ 'month-fallback': !nativeMonth }">
    <span v-if="nativeMonth" aria-hidden="true">{{ display }} <Icon name="calendar" :size="17" /></span>
    <!-- 保留系统月份选择与键盘操作，只统一可见文字，避免中文应用受系统语言影响显示英文月份。 -->
    <input type="month" :value="modelValue" :aria-label="label" placeholder="YYYY-MM" @change="change" />
  </span>
</template>
<style scoped>
.month-input {
  display: inline-flex;
  position: relative;
  min-width: 0;
  border-radius: 8px;
}
.month-input > span {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 4px 8px;
  color: var(--ink);
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
}
.month-input input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
}
.month-input:focus-within {
  outline: 2px solid var(--orange);
  outline-offset: 2px;
}
/* 不支持原生月份控件的内核仍显示可编辑文本，避免透明输入挡住键盘录入。 */
.month-fallback input {
  position: static;
  opacity: 1;
  width: 144px;
  min-height: 44px;
}
</style>
