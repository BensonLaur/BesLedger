<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { restoreEntity } from '../../domain/ledger';
import { list } from '../../domain/model';
import {
  lock,
  requestPasswordRecovery,
  refresh,
  restoreLogin,
  run,
  ui,
  vault,
  state,
  mutate,
} from '../store';
import { saveFile } from '../../inputs/files';
import { today } from '../../domain/time';
import GitHubConnection from '../components/GitHubConnection.vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import SupportPanel from '../components/SupportPanel.vue';
import { getLocalSpace } from '../local-space';
import { backupError } from '../backup-error';
import RecoveryKey from '../components/RecoveryKey.vue';
import SecretField from '../components/SecretField.vue';
import brandIcon from '../../assets/brand.svg?no-inline';
const localSpace = getLocalSpace();
const supportOpen = ref(false);
const passwordOpen = ref(false),
  currentPassword = ref(''),
  newPassword = ref(''),
  confirmPassword = ref('');
const passwordHelp = ref(false);
const secretReset = ref(0);
let passwordAttempt: AbortController | undefined;
onBeforeUnmount(() => {
  passwordAttempt?.abort();
  currentPassword.value = newPassword.value = confirmPassword.value = '';
  recovery.value = credential.value = password.value = passwordConfirmation.value = '';
});
function openPassword() {
  ui.error = '';
  currentPassword.value = newPassword.value = confirmPassword.value = '';
  secretReset.value++;
  passwordHelp.value = false;
  passwordOpen.value = true;
}
function closePassword() {
  if (ui.busy) return;
  currentPassword.value = newPassword.value = confirmPassword.value = '';
  passwordOpen.value = false;
  ui.error = '';
}
function forgotPassword() {
  if (ui.busy) return;
  closePassword();
  requestPasswordRecovery();
}
function explainPasswordRecovery() {
  currentPassword.value = newPassword.value = confirmPassword.value = '';
  ui.error = '';
  passwordHelp.value = true;
}
function saveRecoveryFirst() {
  closePassword();
  openRecovery();
}
async function changePassword() {
  secretReset.value++;
  passwordAttempt = new AbortController();
  const success = await run(async () => {
    if (newPassword.value !== confirmPassword.value) throw new Error('两次新密码不一致，请重新确认');
    await vault.changePassword(currentPassword.value, newPassword.value, passwordAttempt!.signal);
    ui.notice = '解锁密码已修改，原有账本和账目已保留。下次打开请使用新密码。';
  });
  if (success) closePassword();
  else {
    await nextTick();
    const input = document.getElementById(
      newPassword.value !== confirmPassword.value ? 'change-confirm' : 'change-current',
    ) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }
}
function openRecovery() {
  ui.error = '';
  recovery.value = vault.recovery;
}
function openSupport(event: MouseEvent) {
  // Safari 的触摸点击不一定聚焦按钮；显式记录入口，关闭面板后可回到原位置。
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  supportOpen.value = true;
}
const deleted = computed(() =>
  Object.values(state.value!.entities).filter((e) => e.deleted && ['ledger', 'entry'].includes(e.data.kind)),
);
const recycleOpen = ref(false);
async function restoreDeleted(id: string) {
  await run(async () => {
    await mutate((s) => restoreEntity(s, id));
    ui.notice = '已恢复，请同步新的恢复版本';
  });
}
const recovery = ref(''),
  restoreOpen = ref(false),
  file = ref(''),
  credential = ref(''),
  password = ref(''),
  passwordConfirmation = ref(''),
  useRecovery = ref(false),
  preview = ref(''),
  previewRevision = ref<number>(),
  consent = ref(false);
function invalidatePreview() {
  preview.value = '';
  previewRevision.value = undefined;
  consent.value = false;
  password.value = passwordConfirmation.value = '';
  secretReset.value++;
  ui.error = '';
}
function openRestore() {
  invalidatePreview();
  file.value = credential.value = '';
  useRecovery.value = false;
  restoreOpen.value = true;
}
function closeRestore() {
  if (ui.busy) return;
  invalidatePreview();
  file.value = credential.value = '';
  restoreOpen.value = false;
}
async function exportBackup() {
  await run(async () => {
    await saveFile(`BesLedger-${today()}.besledger`, await vault.exportBackup());
    ui.notice = '已导出加密备份，请保存好文件。恢复时可使用导出时的密码或对应恢复密钥。';
  });
}
async function readFile(event: Event) {
  invalidatePreview();
  file.value = '';
  const f = (event.target as HTMLInputElement).files?.[0];
  if (f) {
    await run(async () => {
      if (f.size > 50_000_000) throw new Error('备份文件超过 50 MB，请选择较小的备份');
      file.value = await f.text();
      if (!file.value) throw new Error('备份文件为空，请重新选择');
    });
  }
}
async function inspect() {
  invalidatePreview();
  await run(async () => {
    let verified;
    try {
      verified = await vault.previewRestore(file.value, credential.value, useRecovery.value);
    } catch (error) {
      throw backupError(error, useRecovery.value);
    }
    previewRevision.value = verified.revision;
    preview.value = `${list(verified.state, 'ledger').length} 本账本、${list(verified.state, 'account').length} 个账户、${list(verified.state, 'entry').length} 笔账目`;
  });
}
async function restore() {
  if (!consent.value || !preview.value || previewRevision.value === undefined) return;
  secretReset.value++;
  passwordAttempt = new AbortController();
  const succeeded = await run(async () => {
    if (password.value !== passwordConfirmation.value) throw new Error('两次新密码不一致，请重新确认');
    await vault.restore(file.value, credential.value, password.value, useRecovery.value, {
      expectedRevision: previewRevision.value,
      signal: passwordAttempt!.signal,
    });
    await restoreLogin();
    refresh();
    restoreOpen.value = false;
    credential.value = '';
    password.value = passwordConfirmation.value = '';
    ui.notice = '账本已从备份恢复，下次打开请使用新密码。';
  });
  if (!succeeded && password.value === passwordConfirmation.value) {
    const error = ui.error;
    invalidatePreview();
    ui.error = error;
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">你的账目，你来掌握</p>
      <h1>我的</h1>
    </div>
    <div class="settings-lock-action">
      <button class="secondary" :disabled="ui.busy" @click="lock"><Icon name="lock" />锁定账本</button>
      <small class="hint">下次打开需输入解锁密码</small>
    </div>
  </div>
  <div class="settings-profile">
    <img class="settings-brand-icon" :src="brandIcon" alt="Bes记账钱包图标" width="48" height="48" />
    <div>
      <h2>账本已打开</h2>
      <p>账目在{{ localSpace.place }}加密保存</p>
    </div>
  </div>
  <section class="settings-shortcuts">
    <h2>日常记账</h2>
    <div class="settings-actions">
      <RouterLink to="/accounts"
        ><Icon name="wallet" /><span>账户管理<small>现金、银行卡和往来款</small></span
        ><Icon name="right" /></RouterLink
      ><RouterLink to="/events"
        ><Icon name="events" /><span>事件与周期账<small>还款日期和固定收支</small></span
        ><Icon name="right"
      /></RouterLink>
    </div>
  </section>
  <div class="settings-grid my-groups">
    <section class="card">
      <h2>密码与保护</h2>
      <div class="settings-actions">
        <button :disabled="ui.busy" @click="openPassword">
          <Icon name="lock" /><span>修改解锁密码<small>更换打开账本时使用的密码</small></span
          ><Icon name="right" />
        </button>
        <button :disabled="ui.busy" @click="openRecovery">
          <Icon name="shield" /><span>查看与保存恢复密钥<small>忘记解锁密码时，用它设置新密码</small></span
          ><Icon name="right" />
        </button>
      </div>
    </section>
    <section class="card">
      <h2>备份与恢复</h2>
      <div class="settings-actions">
        <button :disabled="ui.busy" @click="exportBackup">
          <Icon name="download" /><span>导出账本备份<small>将全部本地账本保存为加密文件</small></span
          ><Icon name="right" />
        </button>
        <button :disabled="ui.busy" @click="openRestore">
          <Icon name="upload" /><span>从备份恢复账本<small>先检查内容，由你确认后恢复</small></span
          ><Icon name="right" />
        </button>
      </div>
      <p class="hint">备份文件保存账目，恢复密钥用于重设密码。请分别妥善保存。</p>
    </section>
    <section class="card settings-sync-group">
      <h2>跨设备同步</h2>
      <div class="settings-actions">
        <RouterLink to="/books"
          ><Icon name="book" /><span>账本管理<small>选择上传、下载或同步哪本账</small></span
          ><Icon name="right"
        /></RouterLink>
      </div>
      <GitHubConnection compact />
    </section>
    <section class="card">
      <h2>隐私与帮助</h2>
      <div class="settings-actions">
        <button @click="recycleOpen = true">
          <Icon name="delete" /><span>回收站<small>找回已删除的账目</small></span
          ><Icon name="right" /></button
        ><button v-if="Capacitor.isNativePlatform()" @click="ui.smsPicker = true">
          <Icon name="receipt" /><span>从银行短信导入<small>勾选后识别，再由你确认</small></span
          ><Icon name="right" />
        </button>
      </div>
      <details class="help-details">
        <summary>记账、登录与同步有什么区别？</summary>
        <p>资金账户是现金、银行卡等；账本用来整理账目；GitHub 账号只提供可选同步。</p>
        <p>
          锁定账本后需输入解锁密码，GitHub 登录和已记住的同步密钥仍会保留。退出 GitHub
          只退出登录；忘记某本账的同步密钥也不会删除账目。
        </p>
        <p>记住登录和密钥不会自动上传。修改后点击账本的“同步”，另一设备再同步获取更新。</p>
      </details>
      <details class="help-details">
        <summary>账目保存在哪里？</summary>
        <p>{{ localSpace.detail }}</p>
      </details>
      <details class="help-details">
        <summary>短信与数据保护</summary>
        <p>所有短信在本机识别。读取权限被拒绝时，可继续在备注粘贴。原始短信不会发送给登录服务。</p>
        <p>账户余额只包含本机已有账目。周期账在打开应用时补生成，关闭后的准时提醒尚不支持。</p>
        <p>
          卸载、清除应用或站点数据会丢失本地账目，请先导出备份并独立保存恢复密钥。系统权限与安装渠道可能不同，尚未完成应用商店审核。
        </p>
      </details>
    </section>
    <section class="support-entry-section">
      <button class="support-entry" aria-haspopup="dialog" :aria-expanded="supportOpen" @click="openSupport">
        <img :src="brandIcon" alt="" width="44" height="44" />
        <span><strong>支持 Bes记账</strong><small>一起把记账做得更顺手</small></span>
        <Icon name="right" />
      </button>
    </section>
    <section class="settings-version">
      <p class="hint">BesLedger 0.1.4 · 人民币 · 本地加密</p>
      <a
        href="https://github.com/BensonLaur/BesLedger"
        target="_blank"
        rel="noopener noreferrer"
        class="text-button"
        >源码与使用说明</a
      >
    </section>
  </div>
  <SupportPanel v-if="supportOpen" @close="supportOpen = false" />
  <Modal v-if="recycleOpen" title="回收站" @close="recycleOpen = false"
    ><p>
      恢复会形成新版本；需先恢复所属账本和退款原单。恢复整本账时，先恢复账本，再选择需要的流水，不自动复活此前已删除的记录。
    </p>
    <div v-for="e in deleted" :key="e.id" class="rule-card">
      <span class="entry-main">{{
        e.data.kind === 'ledger'
          ? e.data.name
          : e.data.kind === 'entry'
            ? e.data.at + ' · ' + e.data.note.slice(0, 30)
            : ''
      }}</span
      ><button class="secondary" :disabled="ui.busy" @click="restoreDeleted(e.id)">恢复</button>
    </div>
    <p v-if="ui.error" class="field-error">{{ ui.error }}</p></Modal
  >
  <Modal v-if="passwordOpen" title="修改解锁密码" @close="closePassword">
    <template v-if="passwordHelp">
      <p>可以用恢复密钥设置新密码，已有账本和账目会保留。</p>
      <p>继续后会锁定账本并进入“忘记密码”页面。请先确认已保存恢复密钥。</p>
      <button class="secondary full" @click="saveRecoveryFirst">先查看与保存恢复密钥</button>
      <button class="primary full" @click="forgotPassword">前往重设密码</button>
      <button class="text-button" @click="openPassword">返回修改密码</button>
    </template>
    <p v-else>修改后，已有账本和账目都会保留，下次打开请使用新密码。</p>
    <form v-if="!passwordHelp" @submit.prevent="changePassword" @input="ui.error = ''">
      <SecretField
        id="change-current"
        v-model="currentPassword"
        label="原解锁密码"
        autocomplete="current-password"
        :disabled="ui.busy"
        :reset="secretReset"
      />
      <button type="button" class="text-button" :disabled="ui.busy" @click="explainPasswordRecovery">
        忘记密码？
      </button>
      <SecretField
        id="change-new"
        v-model="newPassword"
        label="新的解锁密码"
        autocomplete="new-password"
        :minlength="10"
        :disabled="ui.busy"
        :reset="secretReset"
      />
      <p class="hint">至少 10 个字符，可使用字母、数字或汉字。</p>
      <SecretField
        id="change-confirm"
        v-model="confirmPassword"
        label="再次输入新密码"
        autocomplete="new-password"
        :minlength="10"
        :disabled="ui.busy"
        :reset="secretReset"
      />
      <p v-if="ui.error" class="field-error" role="alert">{{ ui.error }}</p>
      <button class="primary full" :disabled="ui.busy">{{ ui.busy ? '正在修改…' : '保存新密码' }}</button>
    </form>
    <p class="hint">修改密码不会更换恢复密钥，也不会退出 GitHub。</p>
  </Modal>
  <Modal v-if="recovery" title="查看与保存恢复密钥" @close="recovery = ''">
    <p>忘记解锁密码时，在打开账本的页面点击“忘记密码？”，用这份密钥设置新密码，原有账目会保留。</p>
    <p class="hint">请存入密码管理器，或抄写后妥善保管，不要只留在应用里。</p>
    <RecoveryKey :value="recovery" />
    <details class="help-details">
      <summary>这份密钥适用于哪些账本？</summary>
      <p>
        这是{{
          localSpace.place
        }}的恢复密钥，用于重设这里的解锁密码。它不一定能解密从其他设备下载的账本；那些账本需要各自原设备的同步恢复密钥。
      </p>
    </details>
    <button class="primary full" @click="recovery = ''">完成</button>
  </Modal>
  <Modal v-if="restoreOpen" title="从备份恢复账本" @close="closeRestore">
    <p>选择之前导出的加密备份，先检查内容。检查不会改动已有账本。</p>
    <label
      >加密备份文件<input type="file" accept=".besledger,.json" :disabled="ui.busy" @change="readFile"
    /></label>
    <label class="checkbox"
      ><input
        v-model="useRecovery"
        type="checkbox"
        :disabled="ui.busy"
        @change="
          credential = '';
          invalidatePreview();
        "
      />使用恢复密钥</label
    >
    <SecretField
      id="restore-credential"
      v-model="credential"
      :label="useRecovery ? '恢复密钥' : '备份原密码'"
      :disabled="ui.busy"
      :reset="secretReset"
      @update:model-value="invalidatePreview"
    />
    <p v-if="!useRecovery" class="hint">填写导出这份备份时使用的解锁密码，之后修改的密码不适用。</p>
    <button
      v-if="!preview"
      class="secondary full"
      :disabled="ui.busy || !file || !credential"
      @click="inspect"
    >
      校验备份
    </button>
    <form v-if="preview" @submit.prevent="restore" @input="ui.error = ''">
      <p class="success-panel" role="status"><strong>备份已校验</strong><br />{{ preview }}</p>
      <p>
        备份只包含导出时已有的账目。恢复会替换{{
          localSpace.place
        }}的全部本地账本，未备份的新账目不会出现在恢复后的账本中。
      </p>
      <SecretField
        id="restore-new"
        v-model="password"
        label="新的解锁密码"
        autocomplete="new-password"
        :minlength="10"
        :disabled="ui.busy"
        :reset="secretReset"
      />
      <p class="hint">至少 10 个字符，用于恢复后打开账本。</p>
      <SecretField
        id="restore-confirm"
        v-model="passwordConfirmation"
        label="再次输入新密码"
        autocomplete="new-password"
        :minlength="10"
        :disabled="ui.busy"
        :reset="secretReset"
      />
      <label class="checkbox"
        ><input
          v-model="consent"
          type="checkbox"
          :disabled="ui.busy"
        />我确认用这份备份替换当前全部本地账本</label
      >
      <button class="primary full" :disabled="ui.busy || !consent">
        {{ ui.busy ? '正在恢复…' : '确认恢复备份' }}
      </button>
    </form>
    <p v-if="ui.error" class="field-error" role="alert">{{ ui.error }}</p>
  </Modal>
</template>
<style scoped>
.settings-lock-action {
  display: grid;
  justify-items: end;
  gap: 6px;
}
.settings-lock-action small {
  text-align: right;
  font-size: 11px;
  white-space: nowrap;
}
</style>
