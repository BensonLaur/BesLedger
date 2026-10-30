<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import Icon from './Icon.vue';
const props = defineProps<{ value: string }>();
const copying = ref(false),
  message = ref('');
let active = true;
onBeforeUnmount(() => {
  active = false;
});
async function copy() {
  if (copying.value) return;
  copying.value = true;
  message.value = '';
  try {
    await navigator.clipboard.writeText(props.value);
    if (active) message.value = '已复制。请粘贴到密码管理器或其他安全位置，并确认保存。';
  } catch {
    if (active) message.value = '未能自动复制。请长按或选中上方密钥后复制，再妥善保存。';
  } finally {
    if (active) copying.value = false;
  }
}
</script>
<template>
  <code class="recovery-key">{{ value }}</code>
  <button class="secondary full" :disabled="copying" @click="copy">
    <Icon name="copy" />{{ copying ? '正在复制…' : '复制恢复密钥' }}
  </button>
  <p v-if="message" class="hint" role="status">{{ message }}</p>
</template>
