<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { catchUp, refresh, restoreLogin, run, ui, vault } from '../store';
import { put } from '../../domain/model';
import Icon from './Icon.vue';
const exists = ref(false),
  loaded = ref(false),
  password = ref(''),
  bookName = ref('日常生活'),
  recovery = ref(''),
  confirmed = ref(false),
  restoring = ref(false),
  file = ref(''),
  credential = ref(''),
  recoveryMode = ref(false);
onMounted(async () => {
  exists.value = await vault.exists();
  loaded.value = true;
});
async function enter() {
  await run(async () => {
    if (restoring.value)
      await vault.restore(file.value, credential.value, password.value, recoveryMode.value);
    else if (exists.value) await vault.unlock(password.value);
    else {
      recovery.value = await vault.create(password.value);
      await vault.mutate((s) => {
        const book = put(s, { kind: 'ledger', name: bookName.value });
        s.preferences.currentLedger = book.id;
      });
      exists.value = true;
      return;
    }
    password.value = '';
    credential.value = '';
    await restoreLogin();
    refresh();
    await catchUp();
    void navigator.storage?.persist?.();
  });
}
async function finish() {
  if (confirmed.value) {
    recovery.value = '';
    password.value = '';
    await restoreLogin();
    refresh();
  }
}
async function previousVersion() {
  await run(async () => {
    await vault.recoverPrevious(password.value);
    await restoreLogin();
    refresh();
  });
}
async function choose(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0];
  if (selected) file.value = await selected.text();
}
</script>
<template>
  <main class="welcome">
    <div class="welcome-brand">
      <img src="/icon.svg" alt="" /><span>Bes记账<small>让每一笔，都心中有数。</small></span>
    </div>
    <section v-if="loaded" class="welcome-card">
      <template v-if="recovery"
        ><Icon name="shield" :size="36" />
        <h1>备份你的恢复密钥</h1>
        <p>请存入密码管理器或离线安全位置。忘记口令时，它是恢复本地备份与云端账本的凭据。</p>
        <code class="recovery-key">{{ recovery }}</code
        ><label class="checkbox"><input v-model="confirmed" type="checkbox" />我已独立保存恢复密钥</label
        ><button class="primary full" :disabled="!confirmed" @click="finish">进入账本</button></template
      >
      <form v-else @submit.prevent="enter">
        <p class="eyebrow">{{ restoring ? '找回自己的账本' : exists ? '欢迎回来' : '从这里开始' }}</p>
        <h1>{{ restoring ? '恢复加密备份' : exists ? '解锁 Bes记账' : '创建本地账本' }}</h1>
        <p>账目在设备上加密保存，不需要 GitHub 账号。解锁口令不会发送到服务器。</p>
        <label v-if="!exists && !restoring"
          >账本名称<input v-model="bookName" required maxlength="100" autocomplete="off"
        /></label>
        <template v-if="restoring"
          ><label>加密备份文件<input type="file" accept=".json,.besledger" @change="choose" /></label
          ><label class="checkbox"><input v-model="recoveryMode" type="checkbox" />使用恢复密钥</label
          ><label
            >{{ recoveryMode ? '恢复密钥' : '备份原口令'
            }}<input v-model="credential" type="password" autocomplete="off" required /></label
        ></template>
        <label
          >{{ restoring ? '新的解锁口令' : '解锁口令'
          }}<input
            v-model="password"
            type="password"
            :minlength="exists && !restoring ? undefined : 10"
            :autocomplete="exists && !restoring ? 'current-password' : 'new-password'"
            required
            placeholder="至少 10 个字符"
        /></label>
        <p v-if="ui.error" class="field-error" role="alert">{{ ui.error }}</p>
        <button class="primary full" :disabled="ui.busy">
          {{
            ui.busy ? '正在安全处理…' : restoring ? '校验并恢复' : exists ? '解锁账本' : '创建并继续'
          }}</button
        ><button
          type="button"
          class="text-button full"
          @click="
            restoring = !restoring;
            ui.error = '';
          "
        >
          {{ restoring ? '返回解锁' : '从备份恢复' }}
        </button>
        <button v-if="exists && !restoring" type="button" class="text-button full" @click="previousVersion">
          数据损坏时恢复上一版本
        </button>
      </form>
    </section>
    <p class="welcome-footer"><Icon name="lock" :size="14" />本地优先 · 客户端加密 · 数据由你掌握</p>
  </main>
</template>
