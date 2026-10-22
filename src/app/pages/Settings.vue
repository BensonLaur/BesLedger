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
  <div class="settings-grid">
    <GitHubConnection />
    <section class="card">
      <h2>数据保护</h2>
      <p>本机只保存加密账目。浏览器清理、设备损坏或忘记口令都可能造成数据不可用，请定期备份。</p>
      <div class="settings-actions">
        <button @click="exportBackup">
          <Icon name="download" /><span
            >导出完整加密备份<small>包含账户期初、关联退款、周期规则和删除标记</small></span
          ><Icon name="right" /></button
        ><button @click="restoreOpen = true">
          <Icon name="upload" /><span>校验并恢复备份<small>先验证内容，再确认替换当前本机空间</small></span
          ><Icon name="right" /></button
        ><button @click="recovery = vault.recovery">
          <Icon name="shield" /><span>查看恢复密钥<small>请与备份文件分开保存</small></span
          ><Icon name="right" /></button
        ><RouterLink to="/books"
          ><Icon name="book" /><span>账本管理<small>本地账本与可选云端同步</small></span
          ><Icon name="right"
        /></RouterLink>
      </div>
    </section>
    <section class="card">
      <h2>记账与隐私</h2>
      <button v-if="Capacitor.isNativePlatform()" class="secondary" @click="ui.smsPicker = true">
        从银行短信导入</button
      ><button class="text-button full" @click="recycleOpen = true">回收站 · 显式恢复已删除记录</button>
      <p>所有短信在本机识别。账户余额为本机已知范围；GitHub 连接不等于账本同步。</p>
      <p>日期使用中国标准时间。周期账在打开应用时补生成，不承诺关闭应用后准时推送。</p>
      <p>Android 可按日期和银行范围申请短信读取；系统拒绝时继续使用备注粘贴。此权限未获应用商店审核批准。</p>
      <p class="hint">BesLedger 0.1.1 · 人民币 · 本地加密</p>
      <a
        href="https://github.com/BensonLaur/BesLedger"
        target="_blank"
        rel="noopener noreferrer"
        class="text-button"
        >源码与使用说明</a
      >
    </section>
  </div>
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
  <Modal v-if="recovery" title="恢复密钥" @close="recovery = ''"
    ><p>这串字符能够解密你的账目。请保存到独立的密码管理器或离线介质。</p>
    <code class="recovery-key">{{ recovery }}</code
    ><button class="primary full" @click="recovery = ''">我已妥善保存</button></Modal
  >
  <Modal v-if="restoreOpen" title="恢复完整备份" @close="restoreOpen = false"
    ><label>加密备份文件<input type="file" accept=".besledger,.json" @change="readFile" /></label
    ><label class="checkbox"
      ><input v-model="useRecovery" type="checkbox" @change="preview = ''" />使用恢复密钥</label
    ><label
      >{{ useRecovery ? '恢复密钥' : '原备份口令'
      }}<input v-model="credential" type="password" autocomplete="off" @input="preview = ''" /></label
    ><button class="secondary" :disabled="ui.busy || !file" @click="inspect">先校验备份</button
    ><template v-if="preview"
      ><p class="success-panel">{{ preview }}</p>
      <label
        >恢复后的解锁口令<input
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
