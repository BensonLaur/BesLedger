<script setup lang="ts">
defineProps<{ blocked: boolean; busy: boolean; error: string }>();
defineEmits<{ apply: [] }>();
</script>
<template>
  <section class="update-notice" role="status" aria-label="应用更新">
    <strong>有新版本可以使用</strong>
    <p>更新后，已保存的账本和账目会保留。</p>
    <p v-if="blocked">请先完成当前操作，或返回并清空输入后更新。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button class="secondary" :disabled="blocked || busy" @click="$emit('apply')">
      {{ busy ? '正在更新…' : '更新并重新打开' }}
    </button>
  </section>
</template>
<style scoped>
.update-notice {
  padding: 14px 16px;
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 14px;
  font-size: 14px;
}
.update-notice p {
  font-size: 13px;
  margin: 6px 0 10px;
  color: var(--muted);
}
.update-notice [role='alert'] {
  color: var(--red);
}
.welcome-update {
  width: 100%;
  max-width: 420px;
  margin-bottom: 16px;
}
.app-update {
  margin: 0 20px 16px;
}
</style>
