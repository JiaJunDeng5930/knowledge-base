"use client";

import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { ArrowUp, LoaderCircle, MessageSquare, RefreshCw, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useBulletReview } from "@/components/bullet-review-context";
import { bulletTitle } from "@/lib/reading-path";
import { createReviewCommentId } from "@/lib/bullet-review";
import type { Navigate } from "./page-content/model";
import { IconButton } from "./icon-button";

// Bullet 批注：选择热区、选择反馈、批注入口与浮层统一由本模块维护。
// 热区止于本条正文；下级列表和折叠按钮保留各自的操作。
export function useBulletAnnotation(id: string, enabled = true): HTMLAttributes<HTMLElement> & {"data-annotation-target"?: string; "data-comment-selected"?: boolean} {
  const context = useBulletReview();
  if (!enabled || !context?.review.draft) return {};
  const active = context.annotationMode;
  const choose = (element: HTMLElement, multiple: boolean) => {
    if (context.savingComment) return;
    const selected = multiple ? context.selected.includes(id) ? context.selected.filter(value => value !== id) : [...context.selected, id] : [id];
    context.setSelected(selected);
    if (!multiple || !context.commentsOpen) context.setAnchor(element);
    else if (!selected.includes(context.anchor?.getAttribute("data-annotation-target") || "")) {
      context.setAnchor(selected.length ? document.querySelector<HTMLElement>('[data-annotation-target="' + selected[0] + '"]') : null);
    }
    context.setFocusComment(!multiple);
    context.setCommentsOpen(selected.length > 0);
  };
  const title = bulletTitle((context.review.draft.proposed[id] || context.review.draft.base[id])?.body || "");
  const ignored = (target: EventTarget) => target instanceof Element && !!target.closest(".page-block-toggle, .bullet-comment-pin");
  return {
    "data-annotation-target": id,
    "data-comment-selected": active && context.selected.includes(id) || undefined,
    tabIndex: active ? 0 : undefined,
    role: active ? "button" : undefined,
    "aria-label": active ? "批注：" + title : undefined,
    "aria-pressed": active ? context.selected.includes(id) : undefined,
    onClickCapture: event => {
      if (!active || ignored(event.target)) return;
      event.preventDefault(); event.stopPropagation(); choose(event.currentTarget, event.ctrlKey || event.metaKey);
    },
    onKeyDownCapture: event => {
      if (!active || !["Enter", " "].includes(event.key) || ignored(event.target)) return;
      event.preventDefault(); event.stopPropagation(); choose(event.currentTarget, event.ctrlKey || event.metaKey);
    },
  };
}

export function BulletCommentPin({id}: {id: string}) {
  const context = useBulletReview();
  const count = context?.review.comments.filter(comment => comment.bullet_ids.includes(id)).length || 0;
  if (!context || !count) return null;
  return <IconButton className="bullet-comment-pin" disabled={context.savingComment} label={"查看批注 · " + count} onClick={event => {
    context.setAnnotationMode(true); context.setSelected([id]);
    context.setAnchor(event.currentTarget.closest<HTMLElement>("[data-annotation-target]"));
    context.setFocusComment(false); context.setCommentsOpen(true);
  }}><MessageSquare/></IconButton>;
}

export function BulletAnnotationControl({navigate, compact = false}: {navigate: Navigate; compact?: boolean}) {
  const context = useBulletReview();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!context?.annotationMode) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || context.savingComment) return;
      event.preventDefault();
      if (context.commentsOpen) context.setCommentsOpen(false);
      else {context.setAnnotationMode(false); context.setSelected([]); button.current?.focus();}
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [context]);
  if (!context || (!context.review.draft && !context.error)) return null;
  return <>
    <button ref={button} type="button" className="icon-button bullet-annotation-control" disabled={context.savingComment} aria-label={context.annotationMode ? "退出批注模式" : "批注"} title={context.error || (context.annotationMode ? "退出批注模式 · Esc" : "批注")} aria-pressed={context.annotationMode} data-pending={!!context.review.comments.length || undefined} data-error={!!context.error || undefined} onClick={() => {
      if (!context.review.draft) {void context.refresh(); return;}
      const active = !context.annotationMode;
      context.setAnnotationMode(active); context.setFocusComment(false); context.setAnchor(button.current);
      context.setSelected([]); context.setCommentsOpen(active && !!context.review.comments.length);
    }}><MessageSquare/></button>
    <BulletCommentPopover key={context.review.draft?.id || "none"} {...{navigate, compact}}/>
  </>;
}

function BulletCommentPopover({navigate, compact}: {navigate: Navigate; compact: boolean}) {
  const context = useBulletReview()!;
  const {review, selected, setSelected, commentsOpen, setCommentsOpen, anchor, focusComment, savingComment: saving, saveComment} = context;
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const virtualAnchor = useMemo(() => anchor ? {getBoundingClientRect: () => anchor.getBoundingClientRect(), contextElement: anchor} : null, [anchor]);
  useEffect(() => {requestId.current = null;}, [selected]);
  useEffect(() => {if (commentsOpen && focusComment) textarea.current?.focus();}, [commentsOpen, focusComment, selected]);
  useEffect(() => {if (commentsOpen && anchor && !anchor.isConnected) setCommentsOpen(false);}, [review.draft, anchor, commentsOpen, setCommentsOpen]);
  const draft = review.draft;
  if (!draft) return null;
  const validSelected = selected.filter(id => draft.base[id] || draft.proposed[id]);
  const pending = review.comments.filter(comment => !validSelected.length || comment.bullet_ids.some(id => validSelected.includes(id)));
  const title = (id: string) => bulletTitle((draft.proposed[id] || draft.base[id])?.body || "已移除的内容");
  const save = async () => {
    if (saving || !validSelected.length || !body.trim()) return;
    setError("");
    try {
      requestId.current ||= createReviewCommentId();
      await saveComment({id: requestId.current, draft_id: draft.id, bullet_ids: validSelected, body});
      setBody(""); requestId.current = null; setCommentsOpen(false); anchor?.focus({preventScroll: true});
    } catch (reason) {setError(reason instanceof Error ? reason.message : "暂时无法保存，请重试。");}
  };
  return <Popover open={commentsOpen && !!anchor} onOpenChange={open => {if (!saving) setCommentsOpen(open);}}>
    <PopoverAnchor virtualRef={{current: virtualAnchor}}/>
    <PopoverContent className="bullet-comment-popover" aria-label="批注" side={validSelected.length && !compact ? "right" : "bottom"} align={compact ? "end" : "start"} sideOffset={12} collisionPadding={16} collisionBoundary={anchor?.ownerDocument.documentElement}
      onOpenAutoFocus={event => {event.preventDefault(); if (focusComment) textarea.current?.focus();}}
      onCloseAutoFocus={event => event.preventDefault()}
      onEscapeKeyDown={event => {event.preventDefault(); event.stopPropagation(); if (!saving) {setCommentsOpen(false); anchor?.focus({preventScroll: true});}}}
      onInteractOutside={event => {if (saving || event.target instanceof Element && event.target.closest("[data-annotation-target], .bullet-annotation-control")) event.preventDefault();}}>
      <div className="bullet-comment-heading"><MessageSquare aria-hidden="true"/><span>{validSelected.length > 1 ? validSelected.length + " 处内容" : validSelected.length ? title(validSelected[0]) : "批注"}</span><IconButton label="关闭批注" disabled={saving} onClick={() => setCommentsOpen(false)}><X/></IconButton></div>
      {validSelected.length > 1 && <div className="bullet-comment-targets" aria-label="本次批注的内容">{validSelected.map(id => <div key={id}><span>{title(id)}</span><IconButton label={"取消选择：" + title(id)} disabled={saving} onClick={() => setSelected(selected.filter(value => value !== id))}><X/></IconButton></div>)}</div>}
      {!!pending.length && <div className="bullet-pending-comments">{pending.map(comment => <article key={comment.id} className="bullet-comment">
        {(!validSelected.length || comment.bullet_ids.length > 1) && <div className="bullet-comment-links">{comment.bullet_ids.map(id => <button key={id} onClick={() => {navigate({kind: "bullet", id}); setCommentsOpen(false);}}>{title(id)}</button>)}</div>}
        <p>{comment.body}</p>
      </article>)}</div>}
      {!!validSelected.length && <form className="bullet-comment-form" onSubmit={event => {event.preventDefault(); void save();}}>
        <textarea ref={textarea} aria-label="批注内容" placeholder="添加批注…" value={body} maxLength={4000} disabled={saving} onChange={event => {setBody(event.target.value); requestId.current = null;}} onKeyDown={event => {if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {event.preventDefault(); void save();}}}/>
        <div className="bullet-comment-footer">{error && <p role="alert">{error}</p>}<button className="bullet-comment-submit" type="submit" aria-label={saving ? "正在保存批注" : "保存批注"} title="保存批注 · ⌘ / Ctrl Enter" disabled={saving || !body.trim()}>{saving ? <LoaderCircle className="annotation-saving"/> : <ArrowUp/>}</button></div>
      </form>}
      {context.error && <div className="bullet-comment-error" role="status"><span>{context.error}</span><IconButton label="刷新预览与批注" onClick={() => void context.refresh()}><RefreshCw/></IconButton></div>}
    </PopoverContent>
  </Popover>;
}
