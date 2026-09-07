"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Panel } from "@/lib/knowledge-types";

export type ReadingView = {
  scrollTop: number;
  expanded: Record<string, boolean>;
  raw: boolean;
  query: string;
  limit: number;
  memoryFilter: string;
  historyLimit: number;
  focusedId: string | null;
  highlight: string;
  matchIndex: number;
  details: Record<string, boolean>;
};
type ViewPatch = Partial<ReadingView> | ((view: ReadingView) => Partial<ReadingView>);
type ReadingContextValue = {
  view: ReadingView;
  updateView: (patch: ViewPatch) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  nextPanel?: Panel;
};
const ReadingContext = createContext<ReadingContextValue | null>(null);
const emptyView = (): ReadingView => ({scrollTop: 0, expanded: {}, raw: false, query: "", limit: 60, memoryFilter: "all", historyLimit: 30, focusedId: null, highlight: "", matchIndex: 0, details: {}});

export function useReadingView() {
  const context = useContext(ReadingContext);
  if (!context) throw new Error("Reading view requires its pane provider");
  return context;
}

// 会话内按路径前缀保存视图；数据刷新、切换分支、浏览器返回均不重置已读位置。
export function ReadingViewProvider({viewKey, cache, nextPanel, children, visible = true}: {viewKey: string; cache: Map<string, ReadingView>; nextPanel?: Panel; children: ReactNode; visible?: boolean}) {
  const [view, setView] = useState<ReadingView>(() => cache.get(viewKey) || emptyView());
  const scrollRef = useRef<HTMLDivElement>(null);
  const updateView = useCallback((patch: ViewPatch) => {
    setView(current => {
      const latest = {...current, scrollTop: cache.get(viewKey)?.scrollTop ?? current.scrollTop};
      const next = {...latest, ...(typeof patch === "function" ? patch(latest) : patch)};
      cache.set(viewKey, next);
      return next;
    });
  }, [cache, viewKey]);
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && visible) node.scrollTop = cache.get(viewKey)?.scrollTop || 0;
  }, [cache, viewKey, visible]);
  return <ReadingContext.Provider value={{view, updateView, scrollRef, nextPanel}}>
    <div className="sheet-scroll" ref={scrollRef} tabIndex={-1} onScroll={event => {
      if (!visible) return;
      cache.set(viewKey, {...(cache.get(viewKey) || view), scrollTop: event.currentTarget.scrollTop});
    }}><div className="sheet-content">{children}</div></div>
  </ReadingContext.Provider>;
}

export function ReadingDisclosure({id, title, children, initiallyOpen = false, className = ""}: {id: string; title: ReactNode; children: ReactNode; initiallyOpen?: boolean; className?: string}) {
  const {view, updateView} = useReadingView();
  const open = view.details[id] ?? initiallyOpen;
  return <details className={className} open={open} onToggle={event => {
    const next = event.currentTarget.open;
    if (next !== open) updateView(current => ({details: {...current.details, [id]: next}}));
  }}><summary>{title}</summary>{children}</details>;
}
