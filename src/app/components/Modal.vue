<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import Icon from './Icon.vue';
import { registerModal } from '../modal-stack';
defineProps<{ title: string; wide?: boolean; page?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const root = ref<HTMLElement>();
const previous = document.activeElement as HTMLElement | null;
let unregister: (() => void) | undefined;
const backdropPressed = ref(false);
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
  if (root.value) unregister = registerModal(root.value, () => emit('close'));
  root.value?.focus();
});
onUnmounted(() => {
  unregister?.();
  if (previous?.isConnected) previous.focus();
});
</script>
<template>
  <div
    class="modal-backdrop"
    :class="{ 'page-backdrop': page }"
    @pointerdown="backdropPressed = $event.target === $event.currentTarget"
    @pointercancel="backdropPressed = false"
    @click.self="backdropPressed && emit('close')"
  >
    <section
      ref="root"
      class="modal"
      :class="{ wide, 'page-dialog': page }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
      @keydown="keyboard"
    >
      <header class="modal-header">
        <button v-if="page" class="icon-button page-back" aria-label="返回" @click="emit('close')">
          <Icon name="left" />
        </button>
        <h2>{{ title }}</h2>
        <button v-if="!page" class="icon-button" aria-label="关闭" @click="emit('close')">
          <Icon name="close" />
        </button>
      </header>
      <div class="modal-content"><slot /></div>
    </section>
  </div>
</template>
