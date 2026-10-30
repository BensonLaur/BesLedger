<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { getLocalSpace } from '../local-space';
import { backupError } from '../backup-error';
import RecoveryKey from './RecoveryKey.vue';
import brandIcon from '../../assets/brand.svg?no-inline';
import { catchUp, refresh, restoreLogin, run, ui, vault } from '../store';
import { list, put } from '../../domain/model';
import { LocalDataUnreadable } from '../../storage/vault';
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
  showCredential = ref(false),
  backupPreview = ref<{ summary: string; revision: number }>(),
  replaceConfirmed = ref(false),
  repairPreview = ref<{ summary: string; revision: number }>(),
  repairConfirmed = ref(false),
  mode = ref<'default' | 'backup' | 'reset' | 'previous'>('default');
const passwordInput = ref<HTMLInputElement>();
const credentialInput = ref<HTMLInputElement>();
const confirmationInput = ref<HTMLInputElement>();
const title = ref<HTMLElement>();
const localSpace = getLocalSpace();
const restoring = computed(() => mode.value === 'backup');
const resetting = computed(() => mode.value === 'reset');
const repairing = computed(() => mode.value === 'previous');
const newPassword = computed(() => restoring.value || resetting.value || !exists.value);
const passwordLabel = computed(() => (restoring.value || resetting.value ? '新的解锁密码' : '解锁密码'));
let operationAttempt: AbortController | undefined;
onBeforeUnmount(() => {
  operationAttempt?.abort();
  credential.value = password.value = confirmation.value = '';
});
function changeMode(next: typeof mode.value) {
  if (ui.busy) return;
  if (next === 'previous' && !repairPreview.value) return;
  const repairPassword = next === 'previous' ? password.value : '';
  mode.value = next;
  credential.value = password.value = confirmation.value = file.value = '';
  resetBackupPreview();
  password.value = repairPassword;
  repairConfirmed.value = false;
  if (next !== 'previous') repairPreview.value = undefined;
  showCredential.value = recoveryMode.value = false;
  ui.error = '';
  void nextTick(() => title.value?.focus({ preventScroll: true }));
}
function editPassword() {
  ui.error = '';
  if (mode.value === 'default') repairPreview.value = undefined;
}
function hasPendingInput() {
  return Boolean(
    password.value ||
    confirmation.value ||
    credential.value ||
    recovery.value ||
    file.value ||
    mode.value !== 'default' ||
    (!exists.value && bookName.value !== '日常生活'),
  );
}
function resetBackupPreview() {
  backupPreview.value = undefined;
  replaceConfirmed.value = false;
  password.value = confirmation.value = '';
  showPassword.value = showConfirmation.value = false;
}
function editCredential() {
  if (restoring.value) resetBackupPreview();
  ui.error = '';
}
function back(): boolean {
  if (mode.value === 'default') return false;
  changeMode('default');
  return true;
}
defineExpose({ back, hasPendingInput });
onMounted(async () => {
  exists.value = await vault.exists();
  if (exists.value && ui.passwordRecoveryRequested) mode.value = 'reset';
  ui.passwordRecoveryRequested = false;
  loaded.value = true;
});
async function enter() {
  // 提交或切换流程后重新隐藏密码，避免错误提示出现时仍显示明文。
  showPassword.value = showConfirmation.value = showCredential.value = false;
  const succeeded = await run(async () => {
    const reset = resetting.value;
    if (reset) {
      if (password.value !== confirmation.value) throw new Error('两次新密码不一致，请重新确认');
      operationAttempt = new AbortController();
      try {
        await vault.resetPasswordWithRecovery(credential.value, password.value, operationAttempt.signal);
      } catch (error) {
        if (error instanceof Error && error.message === '恢复密钥必须是完整的 64 位字符')
          throw new Error('恢复密钥不完整，请完整粘贴创建账本时保存的内容。');
        throw error;
      } finally {
        operationAttempt = undefined;
      }
    } else if (restoring.value) {
      if (!file.value) throw new Error('请先选择加密备份文件');
      if (!backupPreview.value) {
        try {
          const verified = await vault.previewRestore(file.value, credential.value, recoveryMode.value);
          backupPreview.value = {
            summary: `${list(verified.state, 'ledger').length} 本账本、${list(verified.state, 'account').length} 个账户、${list(verified.state, 'entry').length} 笔账目`,
            revision: verified.revision,
          };
          return;
        } catch (error) {
          throw backupError(error, recoveryMode.value);
        }
      }
      if (exists.value && !replaceConfirmed.value) throw new Error('请先确认是否用备份替换当前账本');
      if (password.value !== confirmation.value) throw new Error('两次新密码不一致，请重新确认');
      operationAttempt = new AbortController();
      try {
        await vault.restore(file.value, credential.value, password.value, recoveryMode.value, {
          expectedRevision: backupPreview.value.revision,
          signal: operationAttempt.signal,
        });
      } catch (error) {
        resetBackupPreview();
        throw error;
      } finally {
        operationAttempt = undefined;
      }
    } else if (repairing.value) {
      if (!repairPreview.value || !repairConfirmed.value) throw new Error('请先核对备用副本并确认恢复');
      operationAttempt = new AbortController();
      try {
        await vault.recoverPrevious(password.value, {
          expectedRevision: repairPreview.value.revision,
          signal: operationAttempt.signal,
        });
      } catch (error) {
        repairPreview.value = undefined;
        repairConfirmed.value = false;
        mode.value = 'default';
        throw error;
      } finally {
        operationAttempt = undefined;
      }
    } else if (exists.value) {
      repairPreview.value = undefined;
      try {
        await vault.unlock(password.value);
      } catch (error) {
        if (error instanceof LocalDataUnreadable) {
          try {
            const verified = await vault.previewPrevious(password.value);
            repairPreview.value = {
              summary: `${list(verified.state, 'ledger').length} 本账本、${list(verified.state, 'account').length} 个账户、${list(verified.state, 'entry').length} 笔账目`,
              revision: verified.revision,
            };
          } catch {
            /* 备用副本未验证通过时，不展示修复入口，也不写入数据。 */
          }
          throw new Error(
            repairPreview.value
              ? '当前账目读取异常，已找到一份可读取的本地备用副本。原数据未改动。'
              : '当前账目无法完整读取。请保留现有数据，并尝试从加密备份找回账本。',
          );
        }
        if (error instanceof Error && error.message === '密钥不匹配或数据已损坏，原数据未改动')
          throw new Error('未能打开账本，请检查解锁密码后重试。原有账目未改动。');
        throw error;
      }
    } else {
      if (password.value !== confirmation.value) throw new Error('两次密码不一致，请重新确认');
      recovery.value = await vault.create(password.value);
      await vault.mutate((s) => {
        const book = put(s, { kind: 'ledger', name: bookName.value });
        s.preferences.currentLedger = book.id;
      });
      password.value = confirmation.value = '';
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
  if (!succeeded) {
    await nextTick();
    const input = ui.error.includes('两次')
      ? confirmationInput.value
      : resetting.value || (restoring.value && !backupPreview.value)
        ? credentialInput.value
        : passwordInput.value;
    input?.focus();
    input?.select();
  } else if (restoring.value && backupPreview.value) {
    await nextTick();
    passwordInput.value?.focus();
  }
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
  file.value = '';
  resetBackupPreview();
  if (!selected) return;
  await run(async () => {
    if (selected.size > 50_000_000) throw new Error('备份文件超过 50 MB，请选择较小的备份');
    file.value = await selected.text();
    if (!file.value) throw new Error('备份文件为空，请重新选择');
  });
}
</script>
<template>
  <main class="welcome">
    <div class="welcome-brand">
      <img :src="brandIcon" alt="Bes记账钱包图标" /><span>Bes记账<small>让每一笔，都心中有数。</small></span>
    </div>
    <slot name="update" />
    <section v-if="loaded" class="welcome-card" aria-labelledby="welcome-title">
      <template v-if="recovery">
        <Icon name="shield" :size="30" />
        <h1 id="welcome-title">保存恢复密钥</h1>
        <p>忘记解锁密码时，用它找回账本。请存入密码管理器，或抄写后妥善保管，不要只留在应用里。</p>
        <RecoveryKey :value="recovery" />
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
        <h1 id="welcome-title" ref="title" tabindex="-1">
          {{
            resetting
              ? '重设解锁密码'
              : restoring
                ? '从备份恢复账本'
                : repairing
                  ? '从本地备用副本恢复'
                  : exists
                    ? '欢迎回来'
                    : '开始记账'
          }}
        </h1>
        <p v-if="resetting">输入创建账本时保存的恢复密钥，设置新密码。当前全部本地账本和账目都会保留。</p>
        <p v-else-if="restoring">
          {{
            backupPreview
              ? '核对备份内容，再设置恢复后的解锁密码。'
              : '选择之前导出的加密备份，先校验内容。校验不会改动已有账本。'
          }}
        </p>
        <p v-else-if="repairing">
          这份副本保存的是最近一次本地保存之前的内容。恢复会替换当前全部本地账本，近期修改可能不在其中。
        </p>
        <p v-else-if="exists">{{ localSpace.existing }}。<br />输入你设置的解锁密码，继续记账。</p>
        <p v-else>给账本起个名字，再设置解锁密码。以后用这个密码打开账本。</p>
        <div v-if="repairing && repairPreview" class="welcome-backup-preview">
          <strong>可读取的备用副本</strong>
          <p>{{ repairPreview.summary }}</p>
        </div>
        <div v-if="restoring && backupPreview" class="welcome-backup-preview" role="status">
          <strong>备份已校验</strong>
          <p>{{ backupPreview.summary }}</p>
          <button type="button" class="text-button" :disabled="ui.busy" @click="changeMode('backup')">
            重新选择备份
          </button>
        </div>
        <p v-if="restoring && backupPreview && exists" class="welcome-warning">
          恢复会替换{{ localSpace.place }}的全部本地账本。未备份的新账目不会出现在恢复后的账本中。
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
        <template v-if="restoring && !backupPreview">
          <label
            >加密备份文件<input
              type="file"
              accept=".json,.besledger"
              required
              :disabled="ui.busy"
              @change="choose"
          /></label>
          <label class="checkbox"
            ><input
              v-model="recoveryMode"
              type="checkbox"
              :disabled="ui.busy"
              @change="
                credential = '';
                editCredential();
              "
            />使用恢复密钥</label
          >
        </template>
        <div v-if="resetting || (restoring && !backupPreview)" class="welcome-field">
          <label for="welcome-credential">{{ resetting || recoveryMode ? '恢复密钥' : '备份原密码' }}</label>
          <div class="welcome-password">
            <input
              id="welcome-credential"
              ref="credentialInput"
              v-model="credential"
              :type="showCredential ? 'text' : 'password'"
              autocomplete="off"
              autocapitalize="off"
              :spellcheck="false"
              :disabled="ui.busy"
              :maxlength="resetting || recoveryMode ? 200 : undefined"
              required
              @input="editCredential"
            />
            <button
              type="button"
              :aria-label="`${showCredential ? '隐藏' : '显示'}${resetting || recoveryMode ? '恢复密钥' : '备份原密码'}`"
              :aria-pressed="showCredential"
              aria-controls="welcome-credential"
              :disabled="ui.busy"
              @click="showCredential = !showCredential"
            >
              <Icon :name="showCredential ? 'eye-off' : 'eye'" />
            </button>
          </div>
          <p v-if="restoring && !recoveryMode" class="welcome-hint">
            填写导出这份备份时使用的解锁密码，之后修改的密码不适用。
          </p>
        </div>
        <details v-if="resetting" class="welcome-help">
          <summary>恢复密钥在哪里？</summary>
          <p>创建账本时，应用曾显示一串恢复密钥。请查找当时保存在密码管理器、纸张或其他安全位置的记录。</p>
          <p>这份密钥需要对应当前本地账本空间，其他设备新建的恢复密钥不能通用。</p>
        </details>
        <div v-if="!restoring || backupPreview" class="welcome-field">
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
              ref="passwordInput"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :minlength="newPassword ? 10 : undefined"
              :autocomplete="newPassword ? 'new-password' : 'current-password'"
              :disabled="ui.busy"
              :placeholder="newPassword ? '设置一个你记得住的密码' : '请输入解锁密码'"
              :aria-describedby="
                [newPassword ? 'welcome-password-hint' : '', ui.error ? 'welcome-error' : '']
                  .filter(Boolean)
                  .join(' ') || undefined
              "
              autocapitalize="off"
              :spellcheck="false"
              required
              @input="editPassword"
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
        <div
          v-if="(!exists && mode === 'default') || resetting || (restoring && backupPreview)"
          class="welcome-field"
        >
          <label for="welcome-confirmation">{{
            !exists && mode === 'default' ? '再次输入密码' : '再次输入新密码'
          }}</label>
          <div class="welcome-password">
            <input
              id="welcome-confirmation"
              ref="confirmationInput"
              v-model="confirmation"
              :type="showConfirmation ? 'text' : 'password'"
              autocomplete="new-password"
              minlength="10"
              :disabled="ui.busy"
              required
              @input="ui.error = ''"
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
        <label v-if="restoring && backupPreview && exists" class="checkbox"
          ><input
            v-model="replaceConfirmed"
            type="checkbox"
            required
            :disabled="ui.busy"
          />我确认用这份备份替换当前全部本地账本</label
        >
        <p v-if="ui.error" id="welcome-error" class="field-error" role="alert">{{ ui.error }}</p>
        <label v-if="repairing && repairPreview" class="checkbox"
          ><input
            v-model="repairConfirmed"
            type="checkbox"
            required
            :disabled="ui.busy"
          />我确认使用这份本地备用副本恢复</label
        >
        <button class="primary full welcome-submit" :disabled="ui.busy">
          {{
            ui.busy
              ? '正在处理…'
              : resetting
                ? '重设密码并打开'
                : restoring
                  ? backupPreview
                    ? '确认恢复备份'
                    : '校验备份'
                  : repairing
                    ? '确认使用备用副本'
                    : exists
                      ? '打开账本'
                      : '创建账本'
          }}
        </button>
        <button
          v-if="mode === 'default'"
          type="button"
          class="text-button full welcome-backup-link"
          :disabled="ui.busy"
          @click="changeMode('backup')"
        >
          <Icon name="upload" :size="16" />从备份恢复账本
        </button>
        <div v-if="mode === 'default' && repairPreview" class="welcome-backup-preview">
          <p>已找到可读取的备用副本，可先查看内容，再决定是否恢复。</p>
          <button type="button" class="text-button" :disabled="ui.busy" @click="changeMode('previous')">
            查看本地备用副本<Icon name="right" :size="16" />
          </button>
        </div>
        <details v-if="resetting" class="welcome-help welcome-help-after">
          <summary>没保存恢复密钥怎么办？</summary>
          <p>如果还有加密备份，并记得导出时的密码，可以找回备份中的账目。</p>
          <button type="button" class="text-button" :disabled="ui.busy" @click="changeMode('backup')">
            从备份恢复账本<Icon name="right" :size="16" />
          </button>
          <p>
            密码和恢复密钥都找不到时，无法直接解开当前账目。请先保留现有数据，再查找可用备份或仍能打开账本的副本。
          </p>
        </details>
      </form>
    </section>
    <details class="welcome-privacy">
      <summary>
        <Icon name="lock" :size="14" />账目在{{ localSpace.place }}加密保存<Icon name="down" :size="14" />
      </summary>
      <p>{{ localSpace.detail }}</p>
      <p>解锁密码不会发送到服务器。无需 GitHub 账号也能记账，跨设备同步可以稍后设置。</p>
    </details>
  </main>
</template>
