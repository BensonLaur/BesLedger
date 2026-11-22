import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/** 只约束记账面板；软件键盘缩小时使用可见视口，硬件键盘不隐藏数字键盘。 */
export function useEntryViewport(form: Ref<HTMLElement | undefined>) {
  const height = ref(window.innerHeight),
    top = ref(0),
    keyboardOpen = ref(false);
  let baseline = window.innerHeight,
    lastWidth = window.innerWidth,
    frame = 0;
  function measure() {
    const viewport = window.visualViewport;
    // 用户主动缩放时保留布局，不把缩放误认成输入法。
    const visible = viewport?.scale === 1 ? viewport.height : window.innerHeight;
    const active = document.activeElement;
    const typing =
      !!active &&
      !!form.value?.contains(active) &&
      (active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLInputElement &&
          active.inputMode !== 'none' &&
          !['checkbox', 'date', 'datetime-local'].includes(active.type)));
    if (Math.abs(window.innerWidth - lastWidth) > 60) {
      const keyboardHeight = keyboardOpen.value ? Math.max(0, baseline - height.value) : 0;
      baseline = Math.max(window.innerHeight, visible + keyboardHeight);
      lastWidth = window.innerWidth;
    }
    if (!typing) baseline = visible;
    else baseline = Math.max(baseline, visible);
    keyboardOpen.value = typing && baseline - visible > 100;
    height.value = visible;
    top.value = viewport?.scale === 1 ? viewport.offsetTop : 0;
  }
  function queue() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }
  onMounted(() => {
    measure();
    window.addEventListener('resize', queue);
    window.visualViewport?.addEventListener('resize', queue);
    window.visualViewport?.addEventListener('scroll', queue);
    document.addEventListener('focusin', queue);
    document.addEventListener('focusout', queue);
  });
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', queue);
    window.visualViewport?.removeEventListener('resize', queue);
    window.visualViewport?.removeEventListener('scroll', queue);
    document.removeEventListener('focusin', queue);
    document.removeEventListener('focusout', queue);
  });
  return {
    keyboardOpen,
    viewportStyle: computed(() => ({
      '--entry-viewport-height': `${height.value}px`,
      '--entry-viewport-top': `${top.value}px`,
    })),
  };
}
