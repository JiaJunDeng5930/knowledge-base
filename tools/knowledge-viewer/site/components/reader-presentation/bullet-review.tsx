"use client";

import { useRef, useState, type ReactNode } from "react";
import { MessageSquare, MessageSquarePlus, RefreshCw, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useBulletReview } from "@/components/bullet-review-context";
import { bulletTitle } from "@/lib/reading-path";
import { draftChildren, type DraftDocument } from "@/lib/bullet-review";
import { BulletBody } from "./page-content/content";
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
  return <span className="review-change-mark" data-change={change.kind} aria-label={labels[change.kind]} title={labels[change.kind]}>{change.kind === "added" ? "+" : change.kind === "deleted" ? "−" : change.kind === "moved" ? "↪" : "±"}</span>;
}

export function ReviewBulletContent({id, from, navigate, children, beforeOnly = false, selectable = true}: {
  id: string; from: number; navigate: Navigate; children: ReactNode; beforeOnly?: boolean; selectable?: boolean;
}) {
  const review = useBulletReview();
  if (!review?.review.draft) return <>{children}</>;
  const {draft, comments} = review.review;
  const change = review.changes.get(id);
  const before = draft.base[id], after = draft.proposed[id];
  if (!before && !after) return <>{children}</>;
  const commentCount = comments.filter(comment => comment.bullet_ids.includes(id)).length;
  const selected = review.selected.includes(id);
  const title = bulletTitle((after || before).body);
  const toggle = () => review.setSelected(selected ? review.selected.filter(value => value !== id) : [...review.selected, id]);
  const variant = (side: "before" | "after", body: string) => <div className={"bullet-diff-line bullet-diff-line--" + side}>
    <span className="bullet-diff-sign" aria-label={side === "before" ? "删除的原文" : "拟提交内容"}>{side === "before" ? "−" : "+"}</span>
    <BulletBody {...{body, from, navigate}}/>
  </div>;
  return <div className="review-bullet" data-review-change={beforeOnly ? "moved-from" : change?.kind} data-comment-selected={selected || undefined}>
    {selectable && <div className="review-bullet-actions">
      <input type="checkbox" className="review-bullet-select" checked={selected} onChange={toggle} aria-label={"选择批注内容：" + title}/>
      <IconButton label={"批注：" + title} onClick={() => {review.setSelected([id]); review.setCommentsOpen(true);}}><MessageSquarePlus/></IconButton>
      {!!commentCount && <button className="review-comment-count" onClick={() => {review.setSelected([]); review.setCommentsOpen(true);}} aria-label={title + "有 " + commentCount + " 条待处理批注"}>{commentCount}</button>}
    </div>}
    {beforeOnly ? <><span className="bullet-diff-caption">↪ 原位置</span>{variant("before", before.body)}</>
      : change?.bodyChanged ? <>{before && variant("before", before.body)}{after && variant("after", after.body)}</>
      : children}
    {!beforeOnly && change?.moved && <div className="bullet-diff-metadata"><span className="bullet-diff-before">− {positionLabel(draft.base, id)}</span><span className="bullet-diff-after">+ {positionLabel(draft.proposed, id)}</span></div>}
    {!beforeOnly && change?.tagsChanged && <div className="bullet-diff-metadata" aria-label="直接标签变更"><span className="bullet-diff-before">− 标签：{before?.tags.map(tag => "#" + tag).join("、") || "无"}</span><span className="bullet-diff-after">+ 标签：{after?.tags.map(tag => "#" + tag).join("、") || "无"}</span></div>}
    {!beforeOnly && change?.referencesChanged && <div className="bullet-diff-metadata" aria-label="引用变更">{(["before", "after"] as const).map(side => {
      const targets = (side === "before" ? before : after)?.references || [];
      return <span key={side} className={"bullet-diff-" + side}>{side === "before" ? "−" : "+"} 引用：{targets.length ? targets.map(target => <button key={target} onClick={() => navigate({kind: "bullet", id: target}, from)}>{bulletTitle((draft.proposed[target] || draft.base[target]).body)}</button>) : "无"}</span>;
    })}</div>}
  </div>;
}

export function BulletReviewBar({navigate}: {navigate: Navigate}) {
  const context = useBulletReview();
  if (!context) return null;
  const {review, error, selected, setSelected, setCommentsOpen, refresh} = context;
  if (!review.draft && !error) return null;
  return <div className="bullet-review-bar" role="region" aria-label="变更预览">
    {review.draft && <><strong>待提交变更</strong><span className="bullet-review-legend"><span>− 原内容</span><span>+ 拟提交</span><span>↪ 移动</span></span>
      <details className="bullet-review-changes"><summary>定位变更</summary><div>{[...context.changes.values()].map(change => <button key={change.id} onClick={() => navigate({kind: "bullet", id: change.id})}><span>{change.kind === "added" ? "+" : change.kind === "deleted" ? "−" : change.moved ? "↪" : "±"}</span>{bulletTitle((change.after || change.before)!.body)}</button>)}{!context.changes.size && <span>尚无内容变更</span>}</div></details>
      <button className="review-open-comments" onClick={() => setCommentsOpen(true)}><MessageSquare/>{selected.length ? "批注所选内容（" + selected.length + "）" : "批注"}</button>
      {!!selected.length && <IconButton label="取消选择" onClick={() => setSelected([])}><X/></IconButton>}
    </>}
    {error && <span className="bullet-review-error" role="status">{error}</span>}
    <IconButton label="刷新预览与批注" onClick={() => void refresh()}><RefreshCw/></IconButton>
    <BulletCommentsDialog key={review.draft?.id || "none"} {...{navigate}}/>
  </div>;
}

function BulletCommentsDialog({navigate}: {navigate: Navigate}) {
  const context = useBulletReview()!;
  const {review, selected, setSelected, commentsOpen, setCommentsOpen, saveComment} = context;
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const draft = review.draft;
  const validSelected = selected.filter(id => draft && (draft.base[id] || draft.proposed[id]));
  if (!draft) return null;
  const title = (id: string) => bulletTitle((draft.proposed[id] || draft.base[id])?.body || "已从草稿移除的内容 #" + id);
  const save = async () => {
    if (saving || !validSelected.length || !body.trim()) return;
    setSaving(true); setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      await saveComment({id: requestId.current, draft_id: draft.id, bullet_ids: validSelected, body});
      setBody(""); requestId.current = null;
    } catch (reason) {setError(reason instanceof Error ? reason.message : "暂时无法保存，请重试。");}
    finally {setSaving(false);}
  };
  return <Dialog open={commentsOpen} onOpenChange={open => {if (!saving) setCommentsOpen(open);}}><DialogContent className="bullet-comments-dialog">
    <DialogTitle>批注</DialogTitle><DialogDescription>保存后，在对话中告诉 agent 处理批注。</DialogDescription>
    {!!validSelected.length && <form className="bullet-comment-form" onSubmit={event => {event.preventDefault(); void save();}}>
      <div className="bullet-comment-targets" aria-label="本次批注的内容">{validSelected.map(id => <span key={id}>{title(id)}<IconButton label={"取消选择：" + title(id)} disabled={saving} onClick={() => {setSelected(selected.filter(value => value !== id)); requestId.current = null;}}><X/></IconButton></span>)}</div>
      <label htmlFor="bullet-comment-body">你的意见</label><textarea id="bullet-comment-body" autoFocus value={body} maxLength={4000} disabled={saving} onChange={event => {setBody(event.target.value); requestId.current = null;}}/>
      {error && <p role="alert">{error}</p>}<button className="bullet-comment-submit" type="submit" disabled={saving || !body.trim()}>{saving ? "正在保存…" : "保存批注"}</button>
    </form>}
    <div className="bullet-pending-comments">{review.comments.map(comment => <article key={comment.id} className="bullet-comment">
      <div className="bullet-comment-targets">{comment.bullet_ids.map(id => <button key={id} onClick={() => {navigate({kind: "bullet", id}); setCommentsOpen(false);}}>{title(id)}</button>)}</div>
      <p>{comment.body}</p>
    </article>)}{!review.comments.length && <p className="bullet-comments-empty">暂无待处理批注。可在正文旁选择一条或多条内容后添加。</p>}</div>
  </DialogContent></Dialog>;
}
