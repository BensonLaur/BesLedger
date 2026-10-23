<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import brandIcon from '../../assets/brand.svg?no-inline';
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
  recoveryMode = ref(false),
  resetting = ref(false),
  confirmation = ref('');
let recoveryAttempt: AbortController | undefined;
onBeforeUnmount(() => {
  recoveryAttempt?.abort();
  credential.value = password.value = confirmation.value = '';
});
function changeMode(mode: 'unlock' | 'backup' | 'reset') {
  if (ui.busy) return;
  restoring.value = mode === 'backup';
  resetting.value = mode === 'reset';
  credential.value = password.value = confirmation.value = file.value = '';
  recoveryMode.value = false;
  ui.error = '';
}
function back(): boolean {
  if (!restoring.value && !resetting.value) return false;
  changeMode('unlock');
  return true;
}
defineExpose({ back });
onMounted(async () => {
  exists.value = await vault.exists();
  loaded.value = true;
});
async function enter() {
  await run(async () => {
    const reset = resetting.value;
    if (reset) {
      if (password.value !== confirmation.value) throw new Error('两次新口令不一致，请重新确认');
      recoveryAttempt = new AbortController();
      try {
        await vault.resetPasswordWithRecovery(credential.value, password.value, recoveryAttempt.signal);
      } finally {
        recoveryAttempt = undefined;
      }
    } else if (restoring.value)
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
    confirmation.value = '';
    await restoreLogin();
    refresh();
    await catchUp();
    if (reset) ui.notice = '口令已重设，原有账本和账目已保留';
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
      <img :src="brandIcon" alt="Bes记账钱包图标" /><span>Bes记账<small>让每一笔，都心中有数。</small></span>
    </div>
    <section v-if="loaded" class="welcome-card">
      <template v-if="recovery"
        ><Icon name="shield" :size="36" />
        <h1>备份你的恢复密钥</h1>
        <p>
          请存入密码管理器或离线安全位置。忘记口令时，可用它重设口令并保留本机账目；恢复备份或首次跨端下载时也可能需要。
        </p>
        <code class="recovery-key">{{ recovery }}</code
        ><label class="checkbox"><input v-model="confirmed" type="checkbox" />我已独立保存恢复密钥</label
        ><button class="primary full" :disabled="!confirmed" @click="finish">进入账本</button></template
      >
      <form v-else @submit.prevent="enter" @keydown.esc="back">
        <p class="eyebrow">
          {{ resetting || restoring ? '找回自己的账本' : exists ? '欢迎回来' : '从这里开始' }}
        </p>
        <h1>
          {{
            resetting ? '重设解锁口令' : restoring ? '恢复加密备份' : exists ? '解锁 Bes记账' : '创建本地账本'
          }}
        </h1>
        <p v-if="resetting">
          输入这台设备的恢复密钥，设置新的解锁口令。原有账本和账目会保留，无需备份文件，也不需要联网。
        </p>
        <p v-else>账目在设备上加密保存，不需要 GitHub 账号。解锁口令不会发送到服务器。</p>
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
        <label v-if="resetting"
          >恢复密钥<input
            v-model="credential"
            type="password"
            autocomplete="off"
            autocapitalize="off"
            :spellcheck="false"
            :disabled="ui.busy"
            maxlength="200"
            required
        /></label>
        <label
          >{{ resetting || restoring ? '新的解锁口令' : '解锁口令'
          }}<input
            v-model="password"
            type="password"
            :minlength="exists && !restoring && !resetting ? undefined : 10"
            :autocomplete="exists && !restoring && !resetting ? 'current-password' : 'new-password'"
            :disabled="ui.busy"
            required
            placeholder="至少 10 个字符"
        /></label>
        <label v-if="resetting"
          >再次输入新口令<input
            v-model="confirmation"
            type="password"
            autocomplete="new-password"
            minlength="10"
            :disabled="ui.busy"
            required
        /></label>
        <p v-if="ui.error" class="field-error" role="alert">{{ ui.error }}</p>
        <button class="primary full" :disabled="ui.busy">
          {{
            ui.busy
              ? '正在安全处理…'
              : resetting
                ? '重设口令并解锁'
                : restoring
                  ? '校验并恢复'
                  : exists
                    ? '解锁账本'
                    : '创建并继续'
          }}</button
        ><button
          v-if="exists && !restoring && !resetting"
          type="button"
          class="text-button full"
          :disabled="ui.busy"
          @click="changeMode('reset')"
        >
          忘记口令？
        </button>
        <button
          type="button"
          class="text-button full"
          :disabled="ui.busy"
          @click="changeMode(resetting || restoring ? 'unlock' : 'backup')"
        >
          {{ resetting || restoring ? '返回解锁' : '从备份恢复' }}
        </button>
        <button
          v-if="exists && !restoring && !resetting"
          type="button"
          class="text-button full"
          :disabled="ui.busy"
          @click="previousVersion"
        >
          数据损坏时恢复上一版本
        </button>
      </form>
    </section>
    <p class="welcome-footer"><Icon name="lock" :size="14" />本地优先 · 客户端加密 · 数据由你掌握</p>
  </main>
</template>
