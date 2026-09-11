// 阅读滚动只保留一个进行中的目标；再次导航从当前位置接续，手动操作立即接管。
type ScrollMotion = {cancel: () => void};
const scrollMotions = new WeakMap<HTMLElement, ScrollMotion>();

function interruptOnInput(element: HTMLElement, cancel: () => void) {
  for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) element.addEventListener(name, cancel, {passive: true});
  return () => {
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) element.removeEventListener(name, cancel);
  };
}

export function cancelReadingScroll(element: HTMLElement) {
  scrollMotions.get(element)?.cancel();
}

export function isReadingScrollActive(element: HTMLElement) {
  return scrollMotions.has(element);
}

export function scrollReadingTo(element: HTMLElement, position: {left?: number; top?: number}, instant = false) {
  // 先记录可见位置，再取消旧目标，避免恢复窄屏吸附时改变新动画的起点。
  const startLeft = element.scrollLeft;
  const startTop = element.scrollTop;
  cancelReadingScroll(element);
  const left = position.left === undefined ? startLeft : Math.max(0, Math.min(position.left, element.scrollWidth - element.clientWidth));
  const top = position.top === undefined ? startTop : Math.max(0, Math.min(position.top, element.scrollHeight - element.clientHeight));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const style = getComputedStyle(element);
  const duration = parseFloat(style.getPropertyValue("--reader-motion-scroll-duration"));
  const power = parseFloat(style.getPropertyValue("--reader-motion-scroll-power"));
  if (instant || reducedMotion.matches || !(duration > 0) || !(power > 0) || Math.max(Math.abs(left - startLeft), Math.abs(top - startTop)) < 1) {
    element.scrollTo({left, top, behavior: "instant"});
    return;
  }

  // 窄屏的原生滚动吸附在逐帧写入时会提前吸回旧页；结束后恢复原来的吸附规则。
  const snap = element.style.scrollSnapType;
  element.style.scrollSnapType = "none";
  element.scrollTo({left: startLeft, top: startTop, behavior: "instant"});
  const started = performance.now();
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    scrollMotions.delete(element);
    element.style.scrollSnapType = snap;
    removeInterrupts();
    reducedMotion.removeEventListener("change", finish);
  };
  const finish = () => {stop(); element.scrollTo({left, top, behavior: "instant"});};
  const tick = (time: number) => {
    if (!element.isConnected) {stop(); return;}
    const progress = Math.min(1, Math.max(0, (time - started) / duration));
    const eased = 1 - Math.pow(1 - progress, power);
    element.scrollTo({left: startLeft + (left - startLeft) * eased, top: startTop + (top - startTop) * eased, behavior: "instant"});
    if (progress < 1) frame = requestAnimationFrame(tick);
    else finish();
  };
  scrollMotions.set(element, {cancel: stop});
  const removeInterrupts = interruptOnInput(element, stop);
  reducedMotion.addEventListener("change", finish);
  frame = requestAnimationFrame(tick);
}

export function scrollReadingTarget(scroll: HTMLElement, target: HTMLElement) {
  cancelReadingScroll(scroll);
  const locate = () => {
    if (!scroll.isConnected || !target.isConnected) return;
    const inset = parseFloat(getComputedStyle(scroll).scrollPaddingTop) || 0;
    scrollReadingTo(scroll, {top: scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - inset});
  };
  // 自动展开祖先后，先等实际高度稳定再定位；期间的新跳转或手动操作会取消这次定位。
  const expanding = scroll.getAnimations({subtree: true}).filter(animation =>
    "animationName" in animation && ["reading-expand", "reading-collapse"].includes(String(animation.animationName)) ||
    "transitionProperty" in animation && animation.transitionProperty === "block-size");
  if (!expanding.length) {locate(); return;}
  const stop = () => {scrollMotions.delete(scroll); removeInterrupts();};
  const pending = {cancel: stop};
  const removeInterrupts = interruptOnInput(scroll, stop);
  scrollMotions.set(scroll, pending);
  void Promise.allSettled(expanding.map(animation => animation.finished)).then(() => {
    if (scrollMotions.get(scroll) !== pending) return;
    stop(); locate();
  });
}
