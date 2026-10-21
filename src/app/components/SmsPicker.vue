<script setup lang="ts">
import { ref } from 'vue';
import { registerPlugin } from '@capacitor/core';
import { dayAdd, today } from '../../domain/time';
import { newEntry, run, ui } from '../store';
import Modal from './Modal.vue';
type Message = { id: string; body: string; date: number };
const inbox = registerPlugin<{
  query(options: { start: number; end: number; sender: string }): Promise<{ messages: Message[] }>;
}>('SmsInbox');
const start = ref(dayAdd(today(), -7)),
  end = ref(today()),
  sender = ref('95588'),
  consent = ref(false),
  messages = ref<Message[]>([]),
  selected = ref<string[]>([]);
async function read() {
  await run(async () => {
    if (!consent.value) throw new Error('请先阅读并同意本次范围读取');
    const result = await inbox.query({
      start: Date.parse(`${start.value}T00:00:00+08:00`),
      end: Date.parse(`${end.value}T23:59:59+08:00`),
      sender: sender.value,
    });
    messages.value = result.messages;
    selected.value = [];
  });
}
function confirm() {
  ui.smsQueue = messages.value.filter((m) => selected.value.includes(m.id)).map((m) => m.body);
  const note = ui.smsQueue.shift();
  ui.smsPicker = false;
  if (note) newEntry('expense', { note });
}
</script>
<template>
  <Modal title="从银行短信导入" wide @close="ui.smsPicker = false"
    ><p>
      本次仅查询所选银行、日期内的收件箱候选。为展示列表会读取候选原文；未选内容不保存、不上传、不记录日志。
    </p>
    <div class="form-grid">
      <label>开始日期<input v-model="start" type="date" /></label
      ><label>结束日期<input v-model="end" type="date" /></label>
    </div>
    <label
      >银行发送方<select v-model="sender">
        <option value="95588">工商银行 95588</option>
        <option value="95533">建设银行 95533</option>
        <option value="95599">农业银行 95599</option>
        <option value="95566">中国银行 95566</option>
        <option value="95555">招商银行 95555</option>
        <option value="95559">交通银行 95559</option>
        <option value="95580">邮储银行 95580</option>
      </select></label
    ><label class="checkbox"
      ><input v-model="consent" type="checkbox" />同意本次在设备内读取上述范围，最多 31 天、200 条候选</label
    ><button class="secondary" :disabled="ui.busy || !consent" @click="read">请求权限并读取候选</button>
    <p class="hint">
      系统或安装渠道拒绝时，请继续粘贴记账。可随时在 Android
      设置中撤回短信权限。已保存且启用同步的账目备注会随账本加密上传。
    </p>
    <label v-for="m in messages" :key="m.id" class="checkbox sms-row"
      ><input v-model="selected" type="checkbox" :value="m.id" /><span>{{ m.body }}</span></label
    >
    <p v-if="ui.error" class="field-error">{{ ui.error }}</p>
    <button class="primary full" :disabled="!selected.length" @click="confirm">
      逐条核对 {{ selected.length }} 条短信
    </button></Modal
  >
</template>
