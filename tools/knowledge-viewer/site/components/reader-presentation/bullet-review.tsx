"use client";

import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Link2, LoaderCircle, MessageSquare, RefreshCw, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useBulletReview } from "@/components/bullet-review-context";
import { bulletTitle, splitBulletContent } from "@/lib/reading-path";
import { createReviewCommentId, draftChildren, type DraftDocument } from "@/lib/bullet-review";
import { BulletBody, InlineTitle } from "./page-content/content";
import type { Navigate } from "./page-content/model";
import { IconButton } from "./icon-button";

function positionLabel(document: DraftDocument, id: string): string {
  const row = document[id];
  if (!row) return "";
  const parent = row.parent_id === null ? "根层级" : bulletTitle(document[row.parent_id]?.body || "");
  return parent + " · 第 " + (draftChildren(document, row.parent_id).findIndex(item => item.id === id) + 1) + " 项";
}

export function ReviewChangeMark({id}: {id: string}) {
  const change = useBulletReview()?.changes.get(id);
  if (!change) return null;
  const labels = {added: "新增", deleted: "删除", modified: "修改", moved: "移动"};
  return <span className="review-change-mark" data-change={change.kind} aria-label={labels[change.kind]} title={labels[change.kind]}>{change.kind === "added" ? "+" : change.kind === "deleted" ? "−" : change.kind === "moved" ? <ArrowRight/> : "·"}</span>;
}

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

// 纯文本的局部替换嵌入原句；Markdown 块仍由原有渲染器完整呈现。
function InlineBodyDiff({before, after}: {before: string; after: string}) {
  const left = Array.from(before), right = Array.from(after);
  let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  while (end < left.length - start && end < right.length - start && left[left.length - end - 1] === right[right.length - end - 1]) end++;
  return <p className="bullet-diff-inline">{left.slice(0, start).join("")}<del aria-label="删除的原文">{left.slice(start, left.length - end).join("")}</del><ins aria-label="拟提交内容">{right.slice(start, right.length - end).join("")}</ins>{end ? left.slice(-end).join("") : ""}</p>;
}

export function ReviewBulletContent({id, from, navigate, children, beforeOnly = false, opening = false}: {
  id: string; from: number; navigate: Navigate; children: ReactNode; beforeOnly?: boolean; opening?: boolean;
}) {
  const context = useBulletReview();
  if (!context?.review.draft) return <>{children}</>;
  const {draft} = context.review;
  const change = context.changes.get(id);
  const before = draft.base[id], after = draft.proposed[id];
  if (!before && !after) return <>{children}</>;
  const variant = (side: "before" | "after", body: string) => {
    const {heading, content} = splitBulletContent(body);
    return <div className={"bullet-diff-line bullet-diff-line--" + side}>
      <span className="bullet-diff-sign" aria-label={side === "before" ? "删除的原文" : "拟提交内容"}>{side === "before" ? "−" : "+"}</span>
      {heading ? <>{opening ? <h1 className="note-title"><InlineTitle text={heading} {...{from, navigate}}/></h1> : <div className="page-block-heading"><BulletBody body={heading} {...{from, navigate}}/></div>}<BulletBody body={content} {...{from, navigate}}/></> : <BulletBody {...{body, from, navigate}}/>}
    </div>;
  };
  const inline = !opening && before && after && !/[\n`*_#~\[\]<>\\]/.test(before.body + after.body);
  const removedTags = before?.tags.filter(tag => !after?.tags.includes(tag)) || [];
  const addedTags = after?.tags.filter(tag => !before?.tags.includes(tag)) || [];
  const removedReferences = before?.references.filter(target => !after?.references.includes(target)) || [];
  const addedReferences = after?.references.filter(target => !before?.references.includes(target)) || [];
  const destination = beforeOnly ? draft.proposed[id] : draft.base[id];
  const position = beforeOnly ? positionLabel(draft.proposed, id) : positionLabel(draft.base, id);
  return <div className="review-bullet" data-review-change={beforeOnly ? "moved-from" : change?.kind}>
    {beforeOnly ? <div className="bullet-diff-origin"><BulletBody body={before.body} {...{from, navigate}}/></div>
      : change?.bodyChanged ? inline ? <InlineBodyDiff before={before.body} after={after.body}/> : <>{before && variant("before", before.body)}{after && variant("after", after.body)}</>
      : children}
    {(beforeOnly || change?.moved) && destination && <span className="bullet-diff-position" data-with-body-change={!beforeOnly && change?.bodyChanged && !inline || undefined} aria-label={(beforeOnly ? "移至：" : "原位置：") + position} title={(beforeOnly ? "移至：" : "原位置：") + position}>{beforeOnly ? <ArrowRight/> : <ArrowLeft/>}</span>}
    {!beforeOnly && !!(removedTags.length + addedTags.length + removedReferences.length + addedReferences.length) && <div className="bullet-diff-metadata">
      {removedTags.map(tag => <del key={"before:" + tag} aria-label={"移除标签：" + tag}>#{tag}</del>)}
      {addedTags.map(tag => <ins key={"after:" + tag} aria-label={"添加标签：" + tag}>#{tag}</ins>)}
      {([removedReferences, addedReferences] as const).map((targets, index) => targets.map(target => {
        const title = bulletTitle((draft.proposed[target] || draft.base[target])?.body || target);
        const Tag = index ? "ins" : "del";
        return <Tag key={index + ":" + target}><button title={(index ? "添加引用：" : "移除引用：") + title} onClick={() => navigate({kind: "bullet", id: target}, from)}><Link2 aria-hidden="true"/>{title}</button></Tag>;
      }))}
    </div>}
  </div>;
}

export function ReviewChangesMenu({navigate}: {navigate: Navigate}) {
  const context = useBulletReview();
  if (!context?.review.draft) return null;
  return <details className="review-changes-menu"><summary>待提交变更<ChevronDown/></summary><div>{[...context.changes.values()].map(change => <button key={change.id} onClick={() => navigate({kind: "bullet", id: change.id})}><ReviewChangeMark id={change.id}/><span>{bulletTitle((change.after || change.before)!.body)}</span></button>)}</div></details>;
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
        <div className="bullet-comment-footer">{error && <p role="alert">{error}</p>}<button className="bullet-comment-submit" type="submit" aria-label={saving ? "正在保存批注" : "保存批注"} title="保存批注 · ⌘ / Ctrl Enter" disabled={saving || !body.trim()}>{saving ? <LoaderCircle className="review-saving"/> : <ArrowUp/>}</button></div>
      </form>}
      {context.error && <div className="bullet-comment-error" role="status"><span>{context.error}</span><IconButton label="刷新预览与批注" onClick={() => void context.refresh()}><RefreshCw/></IconButton></div>}
    </PopoverContent>
  </Popover>;
}
