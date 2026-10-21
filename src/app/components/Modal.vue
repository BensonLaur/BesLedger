<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import Icon from './Icon.vue';
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const root = ref<HTMLElement>();
const previous = document.activeElement as HTMLElement | null;
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
  }
  if (event.key !== 'Tab' || !root.value) return;
  const items = [
    ...root.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]',
    ),
  ].filter((e) => e.offsetParent !== null);
  if (!items.length) return;
  if (event.shiftKey && document.activeElement === items[0]) {
    event.preventDefault();
    items.at(-1)!.focus();
  }
  if (!event.shiftKey && document.activeElement === items.at(-1)) {
    event.preventDefault();
    items[0].focus();
  }
}
onMounted(() => {
  root.value?.focus();
});
onUnmounted(() => previous?.focus());
</script>
<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section
      ref="root"
      class="modal"
      :class="{ wide }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
      @keydown="keyboard"
    >
      <header class="modal-header">
        <h2>{{ title }}</h2>
        <button class="icon-button" aria-label="关闭" @click="emit('close')"><Icon name="close" /></button>
      </header>
      <div class="modal-content"><slot /></div>
    </section>
  </div>
</template>
