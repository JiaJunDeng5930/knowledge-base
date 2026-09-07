"use client";

import { useEffect, useState } from "react";
import { readingFontSettings } from "./metrics";

// 字号偏好同时作用于书页和通过 Portal 打开的预览，CSS 负责实际字号与比例。
export function useReadingFont() {
  const [font, setFont] = useState<ReturnType<typeof readingFontSettings> | null>(null);
  const [fontSize, setFontSize] = useState<number | null>(null);
  useEffect(() => {
    const settings = readingFontSettings(document.documentElement);
    setFont(settings);
    let size = settings.defaultSize;
    try {
      const stored = Number(localStorage.getItem("knowledge-reader-font-size"));
      if (stored >= settings.min && stored <= settings.max) size = stored;
    } catch {}
    setFontSize(size);
  }, []);
  useEffect(() => {
    if (fontSize === null) return;
    const style = document.documentElement.style;
    const previous = style.getPropertyValue("--reader-font-selected");
    style.setProperty("--reader-font-selected", String(fontSize));
    return () => {
      if (previous) style.setProperty("--reader-font-selected", previous);
      else style.removeProperty("--reader-font-selected");
    };
  }, [fontSize]);
  const changeSize = (size: number) => {
    if (!font || size < font.min || size > font.max) return;
    setFontSize(size);
    try {localStorage.setItem("knowledge-reader-font-size", String(size));} catch {}
  };
  return {font, fontSize, changeSize};
}
