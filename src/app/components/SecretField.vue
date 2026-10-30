<script setup lang="ts">
import { ref, watch } from 'vue';
import Icon from './Icon.vue';
const value = defineModel<string>({ required: true });
const props = defineProps<{
  id: string;
  label: string;
  autocomplete?: string;
  placeholder?: string;
  disabled?: boolean;
  minlength?: number;
  reset?: number;
}>();
const visible = ref(false);
watch(
  () => props.reset,
  () => {
    visible.value = false;
  },
);
</script>
<template>
  <div class="secret-field">
    <label :for="id">{{ label }}</label>
    <div class="welcome-password">
      <input
        :id="id"
        v-model="value"
        :type="visible ? 'text' : 'password'"
        :autocomplete="autocomplete || 'off'"
        :placeholder="placeholder"
        :disabled="disabled"
        :minlength="minlength"
        required
      />
      <button
        type="button"
        class="icon-button"
        :disabled="disabled"
        :aria-label="`${visible ? '隐藏' : '显示'}${label}`"
        :aria-pressed="visible"
        @click="visible = !visible"
      >
        <Icon :name="visible ? 'eye-off' : 'eye'" />
      </button>
    </div>
  </div>
</template>
<style scoped>
.secret-field {
  margin-bottom: 16px;
}
</style>
