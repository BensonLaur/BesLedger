<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { auth, catchUp, currentLedger, lock, newEntry, state, ui, run } from './store';
import Icon from './components/Icon.vue';
import Unlock from './components/Unlock.vue';
import EntryEditor from './components/EntryEditor.vue';
import EntryDetail from './components/EntryDetail.vue';
import AccountForm from './components/AccountForm.vue';
import RuleForm from './components/RuleForm.vue';
import Modal from './components/Modal.vue';
import SmsPicker from './components/SmsPicker.vue';
const offline = ref(!navigator.onLine);
const navigation = [
  { path: '/', name: '明细', icon: 'book' },
  { path: '/accounts', name: '账户', icon: 'wallet' },
  { path: '/events', name: '事件', icon: 'calendar' },
  { path: '/statistics', name: '统计', icon: 'chart' },
  { path: '/settings', name: '我的', icon: 'settings' },
];
const { needRefresh, updateServiceWorker } = useRegisterSW({ immediate: true });
onMounted(() => {
  window.addEventListener('online', () => {
    offline.value = false;
  });
  window.addEventListener('offline', () => {
    offline.value = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.value) void run(catchUp);
  });
  if (Capacitor.isNativePlatform()) {
    void NativeApp.addListener('backButton', () => {
      if (ui.editor) ui.confirm = 'discard';
      else if (ui.detailId) ui.detailId = '';
      else if (ui.accountForm) ui.accountForm = false;
      else if (ui.ruleForm) ui.ruleForm = false;
      else if (location.hash && location.hash !== '#/') history.back();
      else void NativeApp.minimizeApp();
    });
  }
});
</script>
<template>
  <Unlock v-if="!state" />
  <div v-else class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/"
        ><img src="/icon.svg" alt="" /><span>Bes记账<small>BesLedger</small></span></RouterLink
      >
      <nav>
        <RouterLink v-for="item in navigation" :key="item.path" :to="item.path"
          ><Icon :name="item.icon" />{{ item.name }}</RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <Icon name="shield" /><span
          >账目在本机加密保存<br /><small>{{ auth ? '已连接 GitHub' : '本地优先 · 自在记账' }}</small></span
        ><button class="icon-button" aria-label="锁定账本" @click="lock"><Icon name="lock" /></button>
      </div>
    </aside>
    <div class="app-main">
      <header class="topbar">
        <RouterLink to="/books" class="book-title"
          ><small>我的账本</small
          ><span>{{ currentLedger?.data.name || '创建第一本账' }}<Icon name="down" :size="16" /></span
        ></RouterLink>
        <div class="top-actions">
          <span v-if="offline" class="tag">离线可用</span
          ><button class="subtle" @click="ui.quick = true">快捷<Icon name="more" /></button
          ><button class="primary desktop-add" @click="newEntry()"><Icon name="plus" />记一笔</button>
        </div>
      </header>
      <div v-if="needRefresh" class="banner">
        新版本已准备好，请先保存当前草稿。<button @click="!ui.editor && updateServiceWorker(true)">
          重新加载更新
        </button>
      </div>
      <div v-if="ui.error" class="banner error" role="alert">
        <span>{{ ui.error }}</span
        ><button aria-label="关闭错误提示" @click="ui.error = ''"><Icon name="close" /></button>
      </div>
      <div v-if="ui.notice" class="banner" role="status">
        <span>{{ ui.notice }}</span
        ><button aria-label="关闭提示" @click="ui.notice = ''"><Icon name="close" /></button>
      </div>
      <main class="page"><RouterView /></main>
    </div>
    <nav class="bottom-nav">
      <RouterLink v-for="item in navigation.slice(0, 2)" :key="item.path" :to="item.path"
        ><Icon :name="item.icon" /><span>{{ item.name }}</span></RouterLink
      ><button class="fab" aria-label="记一笔" @click="newEntry()"><Icon name="plus" :size="26" /></button
      ><RouterLink v-for="item in navigation.slice(2, 4)" :key="item.path" :to="item.path"
        ><Icon :name="item.icon" /><span>{{ item.name }}</span></RouterLink
      ><RouterLink class="mobile-settings" to="/settings" aria-label="我的"
        ><Icon name="settings"
      /></RouterLink>
    </nav>
    <EntryEditor v-if="ui.editor && ui.draft" :key="ui.editingId || ui.draft.createdAt" />
    <EntryDetail v-if="ui.detailId" />
    <AccountForm v-if="ui.accountForm" />
    <RuleForm v-if="ui.ruleForm" />
    <SmsPicker v-if="ui.smsPicker" />
    <Modal v-if="ui.quick" title="快捷记账" @close="ui.quick = false"
      ><div class="quick-grid">
        <button @click="newEntry()"><Icon name="receipt" :size="28" />短信记账</button
        ><button @click="newEntry('borrow')"><Icon name="users" :size="28" />借贷</button
        ><button
          @click="
            ui.quick = false;
            ui.ruleId = '';
            ui.ruleForm = true;
          "
        >
          <Icon name="repeat" :size="28" />周期账</button
        ><RouterLink to="/settings" @click="ui.quick = false"
          ><Icon name="more" :size="28" />更多功能</RouterLink
        >
      </div></Modal
    >
    <Modal v-if="ui.confirm === 'discard'" title="保留未保存草稿？" @close="ui.confirm = ''"
      ><p>返回后，本笔未保存的金额和备注将被丢弃。</p>
      <div class="actions">
        <button class="secondary" @click="ui.confirm = ''">继续填写</button
        ><button
          class="danger"
          @click="
            ui.editor = false;
            ui.draft = undefined;
            ui.confirm = '';
          "
        >
          放弃草稿
        </button>
      </div></Modal
    >
  </div>
</template>
