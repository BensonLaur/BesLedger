<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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
  file = ref(''),
  credential = ref(''),
  recoveryMode = ref(false),
  confirmation = ref(''),
  showPassword = ref(false),
  showConfirmation = ref(false),
  mode = ref<'default' | 'backup' | 'reset' | 'previous'>('default');
const restoring = computed(() => mode.value === 'backup');
const resetting = computed(() => mode.value === 'reset');
const repairing = computed(() => mode.value === 'previous');
const newPassword = computed(() => restoring.value || resetting.value || !exists.value);
const passwordLabel = computed(() => (restoring.value || resetting.value ? '新的解锁密码' : '解锁密码'));
let recoveryAttempt: AbortController | undefined;
onBeforeUnmount(() => {
  recoveryAttempt?.abort();
  credential.value = password.value = confirmation.value = '';
});
function changeMode(next: typeof mode.value) {
  if (ui.busy) return;
  mode.value = next;
  credential.value = password.value = confirmation.value = file.value = '';
  showPassword.value = showConfirmation.value = recoveryMode.value = false;
  ui.error = '';
}
function back(): boolean {
  if (mode.value === 'default') return false;
  changeMode('default');
  return true;
}
defineExpose({ back });
onMounted(async () => {
  exists.value = await vault.exists();
  loaded.value = true;
});
async function enter() {
  // 提交或切换流程后重新隐藏密码，避免错误提示出现时仍显示明文。
  showPassword.value = showConfirmation.value = false;
  await run(async () => {
    const reset = resetting.value;
    if (reset) {
      if (password.value !== confirmation.value) throw new Error('两次新密码不一致，请重新确认');
      recoveryAttempt = new AbortController();
      try {
        await vault.resetPasswordWithRecovery(credential.value, password.value, recoveryAttempt.signal);
      } finally {
        recoveryAttempt = undefined;
      }
    } else if (restoring.value) {
      if (!file.value) throw new Error('请先选择加密备份文件');
      await vault.restore(file.value, credential.value, password.value, recoveryMode.value);
    } else if (repairing.value) await vault.recoverPrevious(password.value);
    else if (exists.value) {
      try {
        await vault.unlock(password.value);
      } catch (error) {
        if (error instanceof Error && error.message === '密钥不匹配或数据已损坏，原数据未改动')
          throw new Error('未能打开账本，请检查解锁密码后重试。原有账目未改动。');
        throw error;
      }
    } else {
      recovery.value = await vault.create(password.value);
      await vault.mutate((s) => {
        const book = put(s, { kind: 'ledger', name: bookName.value });
        s.preferences.currentLedger = book.id;
      });
      password.value = '';
      exists.value = true;
      return;
    }
    password.value = credential.value = confirmation.value = '';
    await restoreLogin();
    refresh();
    await catchUp();
    if (reset) ui.notice = '密码已重设，原有账本和账目已保留';
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
async function choose(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0];
  file.value = selected ? await selected.text() : '';
}
</script>
<template>
  <main class="welcome">
    <div class="welcome-brand">
      <img :src="brandIcon" alt="Bes记账钱包图标" /><span>Bes记账<small>让每一笔，都心中有数。</small></span>
    </div>
    <section v-if="loaded" class="welcome-card" aria-labelledby="welcome-title">
      <template v-if="recovery">
        <Icon name="shield" :size="30" />
        <h1 id="welcome-title">保存恢复密钥</h1>
        <p>忘记解锁密码时，用它找回账本。请存入密码管理器，或抄写后妥善保管，不要只留在应用里。</p>
        <code class="recovery-key">{{ recovery }}</code>
        <label class="checkbox"><input v-model="confirmed" type="checkbox" />我已独立保存恢复密钥</label>
        <button class="primary full" :disabled="!confirmed" @click="finish">进入账本</button>
      </template>
      <form v-else :aria-busy="ui.busy" @submit.prevent="enter" @keydown.esc="back">
        <button
          v-if="mode !== 'default'"
          type="button"
          class="text-button welcome-back"
          :disabled="ui.busy"
          @click="changeMode('default')"
        >
          <Icon name="left" :size="16" />{{ exists ? '返回解锁' : '返回开始' }}
        </button>
        <h1 id="welcome-title">
          {{
            resetting
              ? '重设解锁密码'
              : restoring
                ? '从备份恢复'
                : repairing
                  ? '恢复上一版本'
                  : exists
                    ? '欢迎回来'
                    : '开始记账'
          }}
        </h1>
        <p v-if="resetting">输入本机恢复密钥，设置新的解锁密码。原有账本和账目都会保留。</p>
        <p v-else-if="restoring">选择之前导出的加密备份，再为恢复后的账本设置解锁密码。</p>
        <p v-else-if="repairing">
          仅在账本无法正常打开时使用。将恢复上一次保存的内容，最近一次改动可能丢失；忘记密码请返回选择“忘记密码？”。
        </p>
        <p v-else-if="exists">此设备已保存账本，输入密码继续记账。</p>
        <p v-else>给账本起个名字，再设置解锁密码。以后用这个密码打开账本。</p>
        <p v-if="restoring && exists" class="welcome-warning">
          恢复会替换此设备现有的账本，请确认备份无误后继续。
        </p>
        <label v-if="!exists && mode === 'default'" for="welcome-book">
          账本名称<input
            id="welcome-book"
            v-model="bookName"
            required
            maxlength="100"
            autocomplete="off"
            :disabled="ui.busy"
          />
        </label>
        <template v-if="restoring">
          <label
            >加密备份文件<input
              type="file"
              accept=".json,.besledger"
              required
              :disabled="ui.busy"
              @change="choose"
          /></label>
          <label class="checkbox"
            ><input v-model="recoveryMode" type="checkbox" :disabled="ui.busy" />使用恢复密钥</label
          >
          <label
            >{{ recoveryMode ? '恢复密钥' : '备份原密码'
            }}<input v-model="credential" type="password" autocomplete="off" :disabled="ui.busy" required
          /></label>
        </template>
        <label v-if="resetting">
          恢复密钥<input
            v-model="credential"
            type="password"
            autocomplete="off"
            autocapitalize="off"
            :spellcheck="false"
            :disabled="ui.busy"
            maxlength="200"
            required
          />
        </label>
        <div class="welcome-field">
          <div class="welcome-field-heading">
            <label for="welcome-password">{{ passwordLabel }}</label>
            <button
              v-if="exists && mode === 'default'"
              type="button"
              class="text-button"
              :disabled="ui.busy"
              @click="changeMode('reset')"
            >
              忘记密码？
            </button>
          </div>
          <div class="welcome-password">
            <input
              id="welcome-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :minlength="newPassword ? 10 : undefined"
              :autocomplete="newPassword ? 'new-password' : 'current-password'"
              :disabled="ui.busy"
              :placeholder="newPassword ? '设置一个你记得住的密码' : '请输入解锁密码'"
              :aria-describedby="newPassword ? 'welcome-password-hint' : undefined"
              autocapitalize="off"
              :spellcheck="false"
              required
            />
            <button
              type="button"
              :aria-label="`${showPassword ? '隐藏' : '显示'}${passwordLabel}`"
              :aria-pressed="showPassword"
              aria-controls="welcome-password"
              :disabled="ui.busy"
              @click="showPassword = !showPassword"
            >
              <Icon :name="showPassword ? 'eye-off' : 'eye'" />
            </button>
          </div>
          <p v-if="newPassword" id="welcome-password-hint" class="welcome-hint">
            至少 10 个字符，可以用一句容易记住的话。
          </p>
        </div>
        <div v-if="resetting" class="welcome-field">
          <label for="welcome-confirmation">再次输入新密码</label>
          <div class="welcome-password">
            <input
              id="welcome-confirmation"
              v-model="confirmation"
              :type="showConfirmation ? 'text' : 'password'"
              autocomplete="new-password"
              minlength="10"
              :disabled="ui.busy"
              required
            />
            <button
              type="button"
              :aria-label="showConfirmation ? '隐藏确认密码' : '显示确认密码'"
              :aria-pressed="showConfirmation"
              aria-controls="welcome-confirmation"
              :disabled="ui.busy"
              @click="showConfirmation = !showConfirmation"
            >
              <Icon :name="showConfirmation ? 'eye-off' : 'eye'" />
            </button>
          </div>
        </div>
        <p v-if="ui.error" class="field-error" role="alert">{{ ui.error }}</p>
        <button class="primary full welcome-submit" :disabled="ui.busy">
          {{
            ui.busy
              ? '正在处理…'
              : resetting
                ? '重设密码并打开'
                : restoring
                  ? '确认恢复备份'
                  : repairing
                    ? '确认恢复上一版本'
                    : exists
                      ? '打开账本'
                      : '创建账本'
          }}
        </button>
        <details v-if="mode === 'default'" class="welcome-options">
          <summary>{{ exists ? '其他恢复方式' : '已有备份？' }}<Icon name="down" :size="16" /></summary>
          <button type="button" class="welcome-option" :disabled="ui.busy" @click="changeMode('backup')">
            <Icon name="upload" /><span>从备份恢复<small>使用之前导出的加密备份</small></span
            ><Icon name="right" :size="16" />
          </button>
          <button
            v-if="exists"
            type="button"
            class="welcome-option"
            :disabled="ui.busy"
            @click="changeMode('previous')"
          >
            <Icon name="repeat" /><span>账本打不开？<small>尝试恢复上一次保存的内容</small></span
            ><Icon name="right" :size="16" />
          </button>
        </details>
      </form>
    </section>
    <details class="welcome-privacy">
      <summary><Icon name="lock" :size="14" />账目在本机加密保存<Icon name="down" :size="14" /></summary>
      <p>解锁密码不会发送到服务器。无需 GitHub 账号也能记账，跨设备同步可以稍后设置。</p>
    </details>
  </main>
</template>
