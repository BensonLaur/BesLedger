<script setup lang="ts">
import { computed, ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import brandIcon from '../../assets/brand.svg?no-inline';
import wechatImage from '../../assets/support/wechat.webp?no-inline';
import alipayImage from '../../assets/support/alipay.webp?no-inline';
import { saveSupportImage } from '../../inputs/support-image';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
const emit = defineEmits<{ close: [] }>();
const methods = {
  wechat: { label: '微信', payee: 'Benson(**城)', image: wechatImage, width: 1266, height: 1749 },
  alipay: { label: '支付宝', payee: 'Bes软件', image: alipayImage, width: 1080, height: 1680 },
};
const method = ref<keyof typeof methods>('wechat');
const selected = computed(() => methods[method.value]);
const enlarged = ref(false),
  busy = ref(false),
  error = ref('');
const native = Capacitor.isNativePlatform();
function openLarge(event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  enlarged.value = true;
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    await saveSupportImage(selected.value.image, `BesLedger-${method.value}.png`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/cancel|取消/i.test(message)) error.value = '暂时无法保存图片，请稍后重试，或打开大图。';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Modal title="让记账更顺手" wide class="support-dialog" @close="emit('close')">
    <div class="support-layout">
      <div class="support-copy">
        <div class="support-intro">
          <img class="support-wallet" :src="brandIcon" alt="" width="58" height="58" />
          <div>
            <span class="support-kicker">自愿支持 · Bes记账</span><strong>把每一笔，都记得更轻松</strong>
          </div>
        </div>
        <p>
          Bes记账开源<span class="support-source"
            >（<a href="https://github.com/BensonLaur/BesLedger" target="_blank" rel="noopener noreferrer"
              >查看 GitHub 源代码 ↗</a
            >）</span
          >、免费、无广告。如果它让你补账少费一点力，把每一笔看得更清楚，欢迎自愿支持后续打磨。
        </p>
        <p class="support-voluntary">金额由你决定；使用、分享和认真反馈，也都是支持。</p>
        <div class="support-methods" role="group" aria-label="选择收款方式">
          <button
            v-for="(item, key) in methods"
            :key="key"
            :aria-pressed="method === key"
            :class="{ active: method === key }"
            @click="
              method = key;
              error = '';
            "
          >
            {{ item.label }}
          </button>
        </div>
        <p class="support-payee" aria-live="polite">
          {{ selected.label }} · 收款人：<strong>{{ selected.payee }}</strong>
        </p>
        <div class="support-actions">
          <button class="primary" :disabled="busy" @click="save">
            <Icon name="download" />{{ busy ? '正在准备图片…' : native ? '保存 / 分享收款码' : '保存收款码' }}
          </button>
          <button class="secondary" @click="openLarge">查看大图</button>
        </div>
        <p class="support-instruction">
          电脑上用手机扫码；手机上保存图片，再在微信或支付宝的“扫一扫”中从相册识别。付款前请核对收款人。
        </p>
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      </div>
      <figure class="support-payment">
        <img
          :src="selected.image"
          :width="selected.width"
          :height="selected.height"
          :alt="`${selected.label}收款码，收款人 ${selected.payee}`"
        />
        <figcaption>随心支持，感谢有你</figcaption>
      </figure>
    </div>
  </Modal>
  <Modal
    v-if="enlarged"
    :title="`${selected.label}收款码大图`"
    class="support-image-dialog"
    @close="enlarged = false"
  >
    <p class="hint">收款人：{{ selected.payee }} · 可放大核对后保存</p>
    <img
      class="support-original"
      :src="selected.image"
      :width="selected.width"
      :height="selected.height"
      :alt="`${selected.label}完整收款图片`"
    />
    <button class="primary full" :disabled="busy" @click="save">
      {{ native ? '保存 / 分享收款码' : '保存收款码' }}
    </button>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
  </Modal>
</template>
<style scoped>
.support-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.85fr);
  gap: 28px;
  align-items: center;
}
.support-intro {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.support-intro strong {
  display: block;
  margin-top: 5px;
  font-size: 16px;
}
.support-kicker {
  color: var(--muted);
  font-size: 12px;
}
.support-wallet {
  flex-shrink: 0;
  border-radius: 15px;
  animation: wallet-open 0.45s ease-out both;
}
@keyframes wallet-open {
  from {
    transform: translateY(5px) rotate(-7deg);
    opacity: 0.7;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
.support-copy > p {
  line-height: 1.8;
  font-size: 14px;
}
.support-source {
  white-space: nowrap;
  font-size: 12px;
}
.support-source a {
  color: var(--accent);
  text-underline-offset: 3px;
}
.support-voluntary {
  color: var(--muted);
}
.support-methods {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 22px;
}
.support-methods button {
  text-align: center;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--muted);
}
.support-methods button.active {
  background: var(--soft);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 650;
  box-shadow: inset 0 0 0 1px var(--accent);
}
.support-payee {
  margin: 14px 0;
  color: var(--muted);
}
.support-payee strong {
  color: var(--ink);
}
.support-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.support-actions button {
  min-height: 44px;
}
.support-copy .support-instruction {
  margin-top: 16px;
  font-size: 12px;
  color: var(--muted);
}
.support-payment {
  margin: 0;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  text-align: center;
}
.support-payment img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 480px;
  object-fit: contain;
}
.support-payment figcaption {
  color: #65768a;
  font-size: 11px;
  margin-top: 10px;
}
.support-original {
  display: block;
  width: 100%;
  height: auto;
  margin-bottom: 16px;
}
@media (max-width: 699px) {
  .support-layout {
    display: block;
  }
  .support-intro {
    margin-bottom: 12px;
  }
  .support-intro strong {
    font-size: 15px;
  }
  .support-wallet {
    width: 48px;
    height: 48px;
  }
  .support-copy > p {
    font-size: 13px;
  }
  .support-methods {
    margin-top: 16px;
  }
  .support-payment {
    margin-top: 18px;
  }
  .support-payment img {
    max-height: 400px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .support-wallet {
    animation: none;
  }
}
</style>
