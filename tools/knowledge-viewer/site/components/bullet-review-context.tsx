"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bulletChanges, parseBulletDraft, type BulletReview, type ReviewComment } from "@/lib/bullet-review";

export type BulletReviewContextValue = {
  review: BulletReview; changes: ReturnType<typeof bulletChanges>; error: string | null;
  selected: string[]; setSelected: (ids: string[]) => void;
  commentsOpen: boolean; setCommentsOpen: (open: boolean) => void;
  refresh: () => Promise<void>; saveComment: (comment: Omit<ReviewComment, "created_at">) => Promise<void>;
};
export const BulletReviewContext = createContext<BulletReviewContextValue | null>(null);
export const useBulletReview = () => useContext(BulletReviewContext);

export function BulletReviewProvider({children}: {children: ReactNode}) {
  const [review, setReview] = useState<BulletReview>({draft: null, comments: []});
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const sequence = useRef(0);
  const apply = useCallback((next: BulletReview) => {
    if (next.draft) next.draft = parseBulletDraft(next.draft);
    if (!Array.isArray(next.comments)) throw new Error("Bullet comments invalid response");
    setReview(current => ({
      draft: current.draft?.id === next.draft?.id && current.draft?.updated_at === next.draft?.updated_at ? current.draft : next.draft,
      comments: JSON.stringify(current.comments) === JSON.stringify(next.comments) ? current.comments : next.comments,
    }));
    setError(null);
  }, []);
  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const request = ++sequence.current;
    const pending = (async () => {
      try {
        const response = await fetch("/api/bullet-review", {cache: "no-store", signal: AbortSignal.timeout(25000)});
        if (!response.ok) throw new Error("Bullet review unavailable");
        const next = await response.json() as BulletReview;
        if (request === sequence.current) apply(next);
      } catch {
        if (request === sequence.current) setError("预览与批注暂时无法更新，已显示的内容仍会保留。");
      } finally { inFlight.current = null; }
    })();
    inFlight.current = pending;
    return pending;
  }, [apply]);
  useEffect(() => {
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(visibleRefresh, 8000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {window.clearInterval(interval); window.removeEventListener("focus", visibleRefresh); document.removeEventListener("visibilitychange", visibleRefresh); sequence.current++;};
  }, [refresh]);
  useEffect(() => {setSelected([]); setCommentsOpen(false);}, [review.draft?.id]);
  const saveComment = useCallback(async (comment: Omit<ReviewComment, "created_at">) => {
    const response = await fetch("/api/bullet-review/comments", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(comment), signal: AbortSignal.timeout(30000)});
    const next = await response.json() as BulletReview & {error?: string};
    if (!response.ok) throw new Error(next.error || "批注保存失败，请重试。");
    sequence.current++;
    apply(next);
    setSelected([]);
  }, [apply]);
  const changes = useMemo(() => review.draft ? bulletChanges(review.draft) : new Map(), [review.draft]);
  return <BulletReviewContext.Provider value={{review, changes, error, selected, setSelected, commentsOpen, setCommentsOpen, refresh, saveComment}}>{children}</BulletReviewContext.Provider>;
}
