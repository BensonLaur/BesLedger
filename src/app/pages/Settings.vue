<script setup lang="ts">
import { computed, ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { restoreEntity } from '../../domain/ledger';
import { list } from '../../domain/model';
import { lock, refresh, restoreLogin, run, ui, vault, state, mutate } from '../store';
import { saveFile } from '../../inputs/files';
import { today } from '../../domain/time';
import GitHubConnection from '../components/GitHubConnection.vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import SupportPanel from '../components/SupportPanel.vue';
import brandIcon from '../../assets/brand.svg?no-inline';
const supportOpen = ref(false);
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
  useRecovery = ref(false),
  preview = ref(''),
  consent = ref(false);
async function exportBackup() {
  await run(async () => {
    await saveFile(`BesLedger-${today()}.besledger`, await vault.exportBackup());
    ui.notice = '已导出加密完整备份，请独立保存恢复密钥';
  });
}
async function readFile(event: Event) {
  const f = (event.target as HTMLInputElement).files?.[0];
  if (f) {
    file.value = await f.text();
    preview.value = '';
  }
}
async function inspect() {
  await run(async () => {
    const verified = await vault.inspectBackup(file.value, credential.value, useRecovery.value);
    preview.value = `${list(verified.state, 'ledger').length} 本账本、${list(verified.state, 'account').length} 个账户、${list(verified.state, 'entry').length} 笔记录；含完整删除标记和周期来源。`;
  });
}
async function restore() {
  if (!consent.value || !preview.value) return;
  await run(async () => {
    await vault.restore(file.value, credential.value, password.value, useRecovery.value);
    await restoreLogin();
    refresh();
    restoreOpen.value = false;
    credential.value = '';
    password.value = '';
    ui.notice = '备份恢复成功；原版本仍保留为上一版本';
  });
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">你的账目，你来掌握</p>
      <h1>我的</h1>
    </div>
    <button class="secondary" @click="lock"><Icon name="lock" />锁定</button>
  </div>
  <div class="settings-profile">
    <img class="settings-brand-icon" :src="brandIcon" alt="Bes记账钱包图标" width="48" height="48" />
    <div>
      <h2>Bes记账</h2>
      <p>本地已解锁 · 只在本机记账也可以</p>
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
    <section class="card settings-sync-group">
      <h2>数据与同步</h2>
      <div class="settings-actions">
        <RouterLink to="/books"
          ><Icon name="book" /><span>账本管理<small>选择上传、下载或同步哪本账</small></span
          ><Icon name="right"
        /></RouterLink>
      </div>
      <GitHubConnection compact />
    </section>
    <section class="card">
      <h2>数据保护</h2>
      <p class="hint">备份和恢复密钥请分别保存在应用之外。</p>
      <div class="settings-actions">
        <button @click="exportBackup">
          <Icon name="download" /><span>导出完整加密备份<small>账户、账目、退款和周期账一起备份</small></span
          ><Icon name="right" /></button
        ><button @click="restoreOpen = true">
          <Icon name="upload" /><span>校验并恢复备份<small>先检查备份内容，再确认恢复</small></span
          ><Icon name="right" /></button
        ><button @click="recovery = vault.recovery">
          <Icon name="shield" /><span>查看本机恢复密钥<small>用于恢复这台设备的本地空间</small></span
          ><Icon name="right" />
        </button>
      </div>
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
          锁定本地空间后需输入解锁密码，GitHub 登录和已记住的同步密钥仍会保留。退出 GitHub
          只退出登录；忘记某本账的同步密钥也不会删除账目。
        </p>
        <p>记住登录和密钥不会自动上传。修改后点击账本的“同步”，另一设备再同步获取更新。</p>
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
  <Modal v-if="recovery" title="本机恢复密钥" @close="recovery = ''"
    ><p>
      这是当前设备本地空间的恢复密钥，请独立保存。它不一定能解密从其他设备下载的账本；那些账本需要各自原设备的同步恢复密钥。
    </p>
    <code class="recovery-key">{{ recovery }}</code
    ><button class="primary full" @click="recovery = ''">我已妥善保存</button></Modal
  >
  <Modal v-if="restoreOpen" title="恢复完整备份" @close="restoreOpen = false"
    ><label>加密备份文件<input type="file" accept=".besledger,.json" @change="readFile" /></label
    ><label class="checkbox"
      ><input v-model="useRecovery" type="checkbox" @change="preview = ''" />使用恢复密钥</label
    ><label
      >{{ useRecovery ? '恢复密钥' : '备份原密码'
      }}<input v-model="credential" type="password" autocomplete="off" @input="preview = ''" /></label
    ><button class="secondary" :disabled="ui.busy || !file" @click="inspect">先校验备份</button
    ><template v-if="preview"
      ><p class="success-panel">{{ preview }}</p>
      <label
        >恢复后的解锁密码<input
          v-model="password"
          type="password"
          minlength="10"
          autocomplete="new-password" /></label
      ><label class="checkbox"
        ><input
          v-model="consent"
          type="checkbox"
        />确认用该备份替换本机空间，未备份的新修改会离开当前版本</label
      ><button class="primary full" :disabled="ui.busy || !consent || password.length < 10" @click="restore">
        恢复已验证备份
      </button></template
    >
    <p v-if="ui.error" class="field-error">{{ ui.error }}</p></Modal
  >
</template>
