type Layer = { element: HTMLElement; close: () => void };
const layers: Layer[] = [];
let previousOverflow = '';
let inertElements: [HTMLElement, boolean][] = [];
function refresh() {
  for (const [element, inert] of inertElements) element.inert = inert;
  inertElements = [];
  let active = layers.at(-1)?.element.parentElement;
  // 浮层可以继续打开选择器；只让最上层接收点击、焦点和系统返回。
  while (active && active !== document.body) {
    for (const sibling of active.parentElement?.children || []) {
      if (
        sibling !== active &&
        sibling instanceof HTMLElement &&
        !['SCRIPT', 'STYLE'].includes(sibling.tagName)
      ) {
        inertElements.push([sibling, sibling.inert]);
        sibling.inert = true;
      }
    }
    active = active.parentElement;
  }
}
export function closeTopModal(): boolean {
  const top = layers.at(-1);
  if (!top) return false;
  top.close();
  return true;
}
export function registerModal(element: HTMLElement, close: () => void): () => void {
  if (!layers.length) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  const layer = { element, close };
  layers.push(layer);
  refresh();
  return () => {
    layers.splice(layers.indexOf(layer), 1);
    refresh();
    if (!layers.length) document.body.style.overflow = previousOverflow;
  };
}
