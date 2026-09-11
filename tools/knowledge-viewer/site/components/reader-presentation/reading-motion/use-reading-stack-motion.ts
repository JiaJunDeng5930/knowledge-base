"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readingSpineOffset } from "../metrics";
import { cancelReadingScroll, isReadingScrollActive, scrollReadingTo } from "./scroll";

// 路径属于页面；该 hook 独立拥有阅读动画、可见书脊、布局测量和动画生命周期。
export function useReadingStackMotion({path, active, focused, ready, onActiveChange}: {
  path: readonly unknown[]; active: number; focused: boolean; ready: boolean; onActiveChange: (index: number) => void;
}) {
  const stackRef = useRef<HTMLDivElement>(null);
  const sheetRefs = useRef(new Map<number, HTMLElement>());
  const [stacked, setStacked] = useState<number[]>([]);
  const latest = useRef({count: path.length, active, focused, onActiveChange});
  latest.current = {count: path.length, active, focused, onActiveChange};
  const scrollFrame = useRef<number | null>(null);
  const positions = useRef<Map<HTMLElement, number> | null>(null);
  const animations = useRef<Animation[]>([]);
  const motionReady = useRef(false);

  const cancelSheetMotion = useCallback(() => {
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
  }, []);

  const prepareLayoutChange = useCallback(() => {
    positions.current = new Map(Array.from(sheetRefs.current.values())
      .filter(sheet => sheet.offsetWidth > 0)
      .map(sheet => [sheet, sheet.getBoundingClientRect().left]));
    cancelSheetMotion();
    if (stackRef.current) cancelReadingScroll(stackRef.current);
  }, [cancelSheetMotion]);

  const preparePathChange = useCallback((nextCount: number) => {
    // 删除书页会缩短滚动区域，浏览器会钳制 scrollLeft；在更新 DOM 前捕获原位置。
    if (nextCount < latest.current.count) prepareLayoutChange();
  }, [prepareLayoutChange]);

  const syncGeometry = useCallback(() => {
    const stack = stackRef.current;
    if (!stack || animations.current.length) return;
    const bounds = stack.getBoundingClientRect();
    const spine = readingSpineOffset(stack, 1);
    // 每帧集中读取一次几何信息，全部读完后才更新 React 状态。
    const sheets = [...sheetRefs.current.entries()].sort((a, b) => a[0] - b[0])
      .filter(([, sheet]) => sheet.offsetWidth > 0)
      .map(([index, sheet]) => ({index, sheet, rect: sheet.getBoundingClientRect()}));
    const collapsed: number[] = [];
    let nextActive = latest.current.active;
    let greatestVisible = 0;
    let activeWidth = 0;
    for (let i = 0; i < sheets.length; i++) {
      const {index, rect} = sheets[i];
      const nextLeft = sheets[i + 1]?.rect.left ?? bounds.right;
      const visible = Math.max(0, Math.min(rect.right, bounds.right, nextLeft) - Math.max(rect.left, bounds.left));
      if (index === latest.current.active) activeWidth = visible;
      if (!latest.current.focused && spine > 0 && visible <= spine + 1 && rect.left < bounds.right && rect.right > bounds.left) collapsed.push(index);
      if (visible > greatestVisible) {greatestVisible = visible; nextActive = index;}
    }
    setStacked(current => current.join(",") === collapsed.join(",") ? current : collapsed);
    // 自动滚动途中保持指定页；用户手动滚动后才按实际可见面积确定当前页。
    if (isReadingScrollActive(stack)) return;
    const current = sheetRefs.current.get(latest.current.active);
    if (current && activeWidth >= Math.min(current.offsetWidth, stack.clientWidth) - 3) return;
    if (greatestVisible > stack.clientWidth / 2 && nextActive !== latest.current.active) latest.current.onActiveChange(nextActive);
  }, []);

  const positionSheet = useCallback((index: number, instant = false) => {
    const stack = stackRef.current;
    const sheet = sheetRefs.current.get(index);
    if (!stack || !sheet) return;
    if (latest.current.focused) {cancelReadingScroll(stack); return;}
    // sticky 的 offsetLeft 随滚动变化，目标必须使用自然排列位置。
    let left = 0;
    for (let i = 0; i < index; i++) left += sheetRefs.current.get(i)?.offsetWidth || 0;
    const pinned = readingSpineOffset(stack, index);
    const right = left + sheet.offsetWidth;
    if (left < stack.scrollLeft + pinned) scrollReadingTo(stack, {left: Math.max(0, left - pinned)}, instant);
    else if (right > stack.scrollLeft + stack.clientWidth) scrollReadingTo(stack, {left: right - stack.clientWidth}, instant);
    else cancelReadingScroll(stack);
  }, []);

  const activate = useCallback((index: number) => {
    if (index < 0 || index >= latest.current.count) return;
    latest.current.active = index;
    latest.current.onActiveChange(index);
    cancelSheetMotion();
    positionSheet(index);
  }, [cancelSheetMotion, positionSheet]);

  const onStackScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {scrollFrame.current = null; syncGeometry();});
  }, [syncGeometry]);

  useLayoutEffect(() => {
    cancelSheetMotion();
    const before = positions.current;
    positions.current = null;
    positionSheet(latest.current.active, !motionReady.current || !!before);
    syncGeometry();
    motionReady.current = ready;
    if (!before || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const running: Animation[] = [];
    for (const [sheet, left] of before) {
      if (!sheet.isConnected || !sheet.offsetWidth) continue;
      const offset = left - sheet.getBoundingClientRect().left;
      if (Math.abs(offset) < 1) continue;
      const style = getComputedStyle(sheet);
      running.push(sheet.animate([{transform: `translateX(${offset}px)`}, {transform: "translateX(0)"}], {
        duration: parseFloat(style.getPropertyValue("--reader-motion-scroll-duration")),
        easing: style.getPropertyValue("--reader-motion-ease").trim(),
      }));
    }
    animations.current = running;
    void Promise.all(running.map(animation => animation.finished)).then(() => {
      if (animations.current !== running) return;
      animations.current = [];
      syncGeometry();
    }, () => {});
    return cancelSheetMotion;
  }, [path, focused, ready, cancelSheetMotion, positionSheet, syncGeometry]);

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    let width = stack.clientWidth;
    const observer = new ResizeObserver(() => {
      // 初次通知不打断导航；侧栏与视口改变宽度时立即按当前页重新对齐。
      if (width === stack.clientWidth) return;
      width = stack.clientWidth;
      cancelSheetMotion(); positionSheet(latest.current.active, true); syncGeometry();
    });
    observer.observe(stack);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => {if (reducedMotion.matches) cancelSheetMotion();};
    reducedMotion.addEventListener("change", reduce);
    stack.addEventListener("wheel", cancelSheetMotion, {passive: true});
    stack.addEventListener("touchstart", cancelSheetMotion, {passive: true});
    return () => {
      observer.disconnect(); cancelSheetMotion(); cancelReadingScroll(stack);
      reducedMotion.removeEventListener("change", reduce);
      stack.removeEventListener("wheel", cancelSheetMotion);
      stack.removeEventListener("touchstart", cancelSheetMotion);
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, [cancelSheetMotion, positionSheet, syncGeometry]);

  return {stackRef, sheetRefs, stacked, activate, preparePathChange, prepareLayoutChange, onStackScroll};
}
