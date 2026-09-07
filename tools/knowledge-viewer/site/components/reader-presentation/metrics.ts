// 阅读呈现的唯一数值来源是 reader.css；行为代码只读取布局结果，不另存一套断点或尺寸。
export function readingFontSettings(element: HTMLElement) {
  const style = getComputedStyle(element);
  return {
    defaultSize: Number(style.getPropertyValue("--reader-font-default")),
    min: Number(style.getPropertyValue("--reader-font-min")),
    max: Number(style.getPropertyValue("--reader-font-max")),
  };
}

export function readingSpineOffset(stack: HTMLElement, index: number) {
  const style = getComputedStyle(stack);
  return Math.min(index, Number(style.getPropertyValue("--reader-spine-limit"))) * parseFloat(style.getPropertyValue("--reader-spine-width"));
}

export function scrollReadingTarget(scroll: HTMLElement, target: HTMLElement) {
  const inset = parseFloat(getComputedStyle(scroll).scrollPaddingTop) || 0;
  scroll.scrollTo({top: scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - inset, behavior: "instant"});
}
