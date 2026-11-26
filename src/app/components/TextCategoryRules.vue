<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { categories } from '../../domain/categories';
import { list, type State, type TextCategoryRule } from '../../domain/model';
import { autoThreeMealsRuleTarget, validCategoryPattern } from '../../recognition/text-category-rules';
import { mutate, run, ui } from '../store';
import { useEntryViewport } from '../use-entry-viewport';
import Icon from './Icon.vue';
import Modal from './Modal.vue';

const props = defineProps<{ ledgerId: string; state: State }>();
const emit = defineEmits<{ close: []; saved: [] }>();
let nextKey = 0;
const rows = ref(
  (props.state.preferences.textCategoryRules?.[props.ledgerId] ?? []).map((rule) => ({
    ...rule,
    key: nextKey++,
  })),
);
const root = ref<HTMLElement>();
const { viewportStyle } = useEntryViewport(root);
const error = ref('');
const options = computed(() => [autoThreeMealsRuleTarget, ...categories(props.state, props.ledgerId)]);
const usesAutoThreeMeals = computed(() =>
  rows.value.some((row) => row.categoryId === autoThreeMealsRuleTarget.id),
);
const groups = computed(() => {
  const grouped = new Map<string, typeof options.value>();
  for (const category of options.value) {
    const label = category.type === 'income' ? '收入' : `支出 · ${category.group}`;
    const members = grouped.get(label) ?? [];
    members.push(category);
    grouped.set(label, members);
  }
  return [...grouped];
});

async function addRule() {
  const key = nextKey++;
  rows.value.push({ key, pattern: '', categoryId: '' });
  error.value = '';
  await nextTick();
  root.value?.querySelector<HTMLInputElement>(`[data-rule-key="${key}"]`)?.focus();
}
function moveRule(index: number, offset: -1 | 1) {
  const target = index + offset;
  if (target < 0 || target >= rows.value.length) return;
  [rows.value[index], rows.value[target]] = [rows.value[target], rows.value[index]];
  error.value = '';
}
function removeRule(index: number) {
  rows.value.splice(index, 1);
  error.value = '';
}
function close() {
  if (!ui.busy) emit('close');
}
function validationIssue(rules: TextCategoryRule[], state: State) {
  const available = new Set([
    autoThreeMealsRuleTarget.id,
    ...categories(state, props.ledgerId).map((category) => category.id),
  ]);
  for (const [index, rule] of rules.entries()) {
    if (!validCategoryPattern(rule.pattern)) return `请为第 ${index + 1} 条规则填写匹配文字`;
    if (!available.has(rule.categoryId)) return `请为第 ${index + 1} 条规则选择可用分类`;
  }
  return '';
}
async function save() {
  const rules = rows.value.map(({ pattern, categoryId }) => ({ pattern: pattern.trim(), categoryId }));
  error.value = validationIssue(rules, props.state);
  if (error.value) return;
  const saved = await run(async () => {
    await mutate((state) => {
      if (!list(state, 'ledger').some((ledger) => ledger.id === props.ledgerId))
        throw new Error('当前账本已不可用');
      const issue = validationIssue(rules, state);
      if (issue) throw new Error(issue);
      state.preferences.textCategoryRules = {
        ...state.preferences.textCategoryRules,
        [props.ledgerId]: rules,
      };
    });
  });
  if (saved) emit('saved');
  else if (ui.error) error.value = ui.error;
}
</script>

<template>
  <Modal title="自定义分类规则" class="recognition-review-backdrop" :style="viewportStyle" @close="close">
    <div ref="root" class="text-rules">
      <p class="rules-mode">文字匹配</p>
      <p class="hint">
        备注包含指定文字时命中。<code>*</code>
        可代替任意文字，例如「示例小区*停车」。从上往下使用第一条匹配的规则。
      </p>
      <p class="hint">规则仅在本机当前账本使用。</p>
      <template v-if="rows.length">
        <div class="rule-pair rule-labels" aria-hidden="true"><span>匹配文字</span><span>匹配分类</span></div>
        <ol class="rule-list" aria-label="分类规则列表">
          <li v-for="(row, index) in rows" :key="row.key" class="rule-row">
            <div class="rule-pair">
              <input
                v-model="row.pattern"
                :aria-label="`第 ${index + 1} 条匹配文字`"
                :data-rule-key="row.key"
                maxlength="120"
                placeholder="输入文字"
                :disabled="ui.busy"
                @input="error = ''"
              />
              <select
                v-model="row.categoryId"
                :aria-label="`第 ${index + 1} 条匹配分类`"
                :disabled="ui.busy"
                @change="error = ''"
              >
                <option value="" disabled>选择分类</option>
                <option
                  v-if="row.categoryId && !options.some((option) => option.id === row.categoryId)"
                  :value="row.categoryId"
                  disabled
                >
                  原分类已不可用
                </option>
                <optgroup v-for="[group, members] in groups" :key="group" :label="group">
                  <option v-for="category in members" :key="category.id" :value="category.id">
                    {{ category.name }}
                  </option>
                </optgroup>
              </select>
            </div>
            <div class="rule-controls">
              <button
                type="button"
                class="icon-button"
                :aria-label="`上移第 ${index + 1} 条规则`"
                :disabled="ui.busy || index === 0"
                @click="moveRule(index, -1)"
              >
                <Icon name="chevron-up" :size="17" />
              </button>
              <button
                type="button"
                class="icon-button"
                :aria-label="`下移第 ${index + 1} 条规则`"
                :disabled="ui.busy || index === rows.length - 1"
                @click="moveRule(index, 1)"
              >
                <Icon name="down" :size="17" />
              </button>
              <button
                type="button"
                class="icon-button"
                :aria-label="`删除第 ${index + 1} 条规则`"
                :disabled="ui.busy"
                @click="removeRule(index)"
              >
                <Icon name="delete" :size="16" />
              </button>
            </div>
          </li>
        </ol>
        <p v-if="usesAutoThreeMeals" class="hint">
          「三餐*自动」按备注里的餐次或交易时间归类，无法判断时由你选择。
        </p>
      </template>
      <button type="button" class="text-button add-rule" :disabled="ui.busy" @click="addRule">
        <Icon name="plus" :size="16" />添加规则
      </button>
    </div>
    <template #footer>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="review-actions">
        <button type="button" class="secondary" :disabled="ui.busy" @click="close">取消</button>
        <button type="button" class="primary" :disabled="ui.busy" @click="save">保存规则</button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.text-rules {
  padding: 0 0 8px;
}
.rules-mode {
  margin: 4px 0 6px;
  font-weight: 600;
  font-size: 14px;
}
.text-rules .hint {
  margin: 4px 0;
  font-size: 12px;
}
.rule-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rule-pair {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 8px;
}
.rule-labels {
  padding: 0 8px;
  margin: 14px 0 2px;
  font-size: 12px;
  color: var(--muted);
}
.rule-row {
  padding: 8px 0 2px;
  border-bottom: 1px solid var(--line);
}
.rule-pair input,
.rule-pair select {
  width: 100%;
  min-width: 0;
  min-height: 40px;
  padding: 6px 8px;
  font-size: 14px;
}
@supports (-webkit-touch-callout: none) {
  /* 避免 iOS 聚焦短规则输入框时自动放大整个弹层。 */
  .rule-pair input,
  .rule-pair select {
    font-size: 16px;
  }
}
.rule-controls {
  display: flex;
  justify-content: flex-end;
}
.rule-controls button {
  min-width: 42px;
  min-height: 38px;
  color: var(--muted);
}
.rule-controls button:disabled {
  opacity: 0.35;
}
.add-rule {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  padding-inline: 0;
}
</style>
