<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import brandIcon from '../assets/brand.svg?no-inline';
import { useRoute } from 'vue-router';
import { closeTopModal, modalCount } from './modal-stack';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { auth, catchUp, currentLedger, lock, newEntry, state, ui, run } from './store';
import Icon from './components/Icon.vue';
import Unlock from './components/Unlock.vue';
import UpdateNotice from './components/UpdateNotice.vue';
import EntryEditor from './components/EntryEditor.vue';
import EntryDetail from './components/EntryDetail.vue';
import AccountForm from './components/AccountForm.vue';
import RuleForm from './components/RuleForm.vue';
import Modal from './components/Modal.vue';
import { getLocalSpace } from './local-space';
import SmsPicker from './components/SmsPicker.vue';
const offline = ref(!navigator.onLine);
const unlockPage = ref<InstanceType<typeof Unlock>>();
const route = useRoute();
const localSpace = getLocalSpace();
const navigation = [
  { path: '/', name: '明细', icon: 'book' },
  { path: '/accounts', name: '账户', icon: 'wallet' },
  { path: '/events', name: '事件', icon: 'events' },
  { path: '/statistics', name: '统计', icon: 'statistics' },
  { path: '/settings', name: '我的', icon: 'user' },
];
let swRegistration: ServiceWorkerRegistration | undefined;
const updateBusy = ref(false),
  updateError = ref('');
const updateBlocked = computed(() =>
  Boolean(
    ui.busy ||
    ui.editor ||
    ui.accountForm ||
    ui.ruleForm ||
    modalCount.value ||
    unlockPage.value?.hasPendingInput(),
  ),
);
function checkUpdate() {
  if (!document.hidden && navigator.onLine) void swRegistration?.update().catch(() => undefined);
}
const { needRefresh, updateServiceWorker } = useRegisterSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    swRegistration = registration;
    checkUpdate();
  },
});
async function applyUpdate() {
  if (updateBlocked.value || updateBusy.value) return;
  updateBusy.value = true;
  ui.busy = true;
  updateError.value = '';
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await updateServiceWorker(true);
    // 首次打开的页面可能尚未受控，新 Worker 已激活时不会再触发 controlling 刷新。
    if (!navigator.serviceWorker?.controller && !registration?.waiting) window.location.reload();
  } catch {
    updateError.value = '暂时没有更新成功，请稍后重试。已保存的账目未改动。';
    updateBusy.value = false;
    ui.busy = false;
  }
}
function onVisibility() {
  checkUpdate();
  if (!document.hidden && state.value) void run(catchUp);
}
onUnmounted(() => {
  window.removeEventListener('focus', checkUpdate);
  document.removeEventListener('visibilitychange', onVisibility);
});
onMounted(() => {
  window.addEventListener('online', () => {
    offline.value = false;
  });
  window.addEventListener('offline', () => {
    offline.value = true;
  });
  window.addEventListener('focus', checkUpdate);
  document.addEventListener('visibilitychange', onVisibility);
  if (Capacitor.isNativePlatform()) {
    void NativeApp.addListener('backButton', () => {
      if (closeTopModal() || unlockPage.value?.back()) return;
      if (location.hash && location.hash !== '#/') history.back();
      else void NativeApp.minimizeApp();
    });
  }
});
</script>
<template>
  <Unlock v-if="!state" ref="unlockPage">
    <template #update
      ><UpdateNotice
        v-if="needRefresh"
        class="welcome-update"
        :blocked="updateBlocked"
        :busy="updateBusy"
        :error="updateError"
        @apply="applyUpdate"
    /></template>
  </Unlock>
  <div v-else class="app-shell" :class="{ 'is-home': route.path === '/' }">
    <aside class="sidebar">
      <RouterLink class="brand" to="/"
        ><img :src="brandIcon" alt="Bes记账钱包图标" /><span
          >Bes记账<small>BesLedger</small></span
        ></RouterLink
      >
      <nav>
        <RouterLink v-for="item in navigation" :key="item.path" :to="item.path"
          ><Icon :name="item.icon" />{{ item.name }}</RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <Icon name="shield" /><span
          >账目在{{ localSpace.place }}加密保存<br /><small>{{
            auth ? 'GitHub 登录已保存' : '本地优先 · 自在记账'
          }}</small></span
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
      <UpdateNotice
        v-if="needRefresh"
        class="app-update"
        :blocked="updateBlocked"
        :busy="updateBusy"
        :error="updateError"
        @apply="applyUpdate"
      />
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
    <nav class="bottom-nav" aria-label="底部导航">
      <RouterLink v-for="item in navigation.slice(1, 3)" :key="item.path" :to="item.path"
        ><Icon :name="item.icon" /><span>{{ item.name }}</span></RouterLink
      ><button v-if="route.path === '/'" class="fab" aria-label="记一笔" @click="newEntry()">
        <Icon name="plus" :size="26" /><span>记一笔</span>
      </button>
      <RouterLink v-else to="/" class="home-return"><Icon name="home" /><span>首页</span></RouterLink
      ><RouterLink v-for="item in navigation.slice(3)" :key="item.path" :to="item.path"
        ><Icon :name="item.icon" /><span>{{ item.name }}</span></RouterLink
      >
    </nav>
    <EntryEditor v-if="ui.editor && ui.draft" :key="ui.editingId || ui.draft.createdAt" />
    <EntryDetail v-if="ui.detailId" />
    <AccountForm v-if="ui.accountForm" />
    <RuleForm v-if="ui.ruleForm" />
    <SmsPicker v-if="ui.smsPicker" />
    <Modal v-if="ui.quick" class="quick-overlay" title="快捷记账" @close="ui.quick = false"
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
