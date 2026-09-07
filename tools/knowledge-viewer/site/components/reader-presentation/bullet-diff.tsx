"use client";

import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, CornerUpRight, Link2, Minus, Pencil, Plus } from "lucide-react";
import { useBulletReview } from "@/components/bullet-review-context";
import { bulletTitle, splitBulletContent } from "@/lib/reading-path";
import { draftChildren, type DraftDocument } from "@/lib/bullet-review";
import type { BulletChange } from "@/lib/bullet-diff";
import { BulletBody, InlineTitle } from "./page-content/content";
import type { Navigate } from "./page-content/model";

// Bullet diff：正文、关联、位置与目录状态的呈现统一由本模块维护。
const BULLET_DIFF_STATUS = {
  added: {label: "新增", Icon: Plus},
  deleted: {label: "删除", Icon: Minus},
  modified: {label: "修改", Icon: Pencil},
  moved: {label: "移动", Icon: CornerUpRight},
} as const;

function changeDescription(change: BulletChange): string {
  if (change.kind === "added" || change.kind === "deleted") return BULLET_DIFF_STATUS[change.kind].label;
  const fields = [change.bodyChanged && "正文", change.tagsChanged && "标签", change.referencesChanged && "引用"].filter(Boolean).join("、");
  return [change.moved && "位置已调整", fields && fields + "已修改"].filter(Boolean).join("；");
}

// 类似 Git 文件列表：名称颜色和固定位置的状态图标共同表达本条变更。
export function BulletDiffNavigationLabel({id, children}: {id: string; children: ReactNode}) {
  const context = useBulletReview();
  const change = context?.changes.get(id);
  const descendantChanged = context?.changedAncestors?.has(id);
  const status = change ? BULLET_DIFF_STATUS[change.kind] : null;
  const description = change ? changeDescription(change) : descendantChanged ? "下级有待提交变更" : undefined;
  return <span className="bullet-diff-navigation" data-change={change?.kind} data-descendant-change={!change && descendantChanged || undefined} title={description}>
    <span className="bullet-diff-navigation-label">{children}</span>
    {status ? <span className="bullet-diff-navigation-status" role="img" aria-label={description}><status.Icon aria-hidden="true"/></span>
      : descendantChanged ? <span className="bullet-diff-descendants" role="img" aria-label={description}/> : null}
  </span>;
}

function positionLabel(document: DraftDocument, id: string): string {
  const row = document[id];
  if (!row) return "";
  const parent = row.parent_id === null ? "根层级" : bulletTitle(document[row.parent_id]?.body || "");
  return parent + " · 第 " + (draftChildren(document, row.parent_id).findIndex(item => item.id === id) + 1) + " 项";
}

export function BulletDiffMark({id}: {id: string}) {
  const change = useBulletReview()?.changes.get(id);
  if (!change) return null;
  const description = changeDescription(change);
  return <span className="bullet-diff-mark" data-change={change.kind} aria-label={description} title={description}>{change.kind === "added" ? "+" : change.kind === "deleted" ? "−" : change.kind === "moved" ? <ArrowRight/> : "·"}</span>;
}

// 纯文本的局部替换嵌入原句；Markdown 块仍由原有渲染器完整呈现。
function InlineBodyDiff({before, after}: {before: string; after: string}) {
  const left = Array.from(before), right = Array.from(after);
  let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  while (end < left.length - start && end < right.length - start && left[left.length - end - 1] === right[right.length - end - 1]) end++;
  return <p className="bullet-diff-inline">{left.slice(0, start).join("")}<del aria-label="删除的原文">{left.slice(start, left.length - end).join("")}</del><ins aria-label="拟提交内容">{right.slice(start, right.length - end).join("")}</ins>{end ? left.slice(-end).join("") : ""}</p>;
}

export function BulletDiffContent({id, from, navigate, children, beforeOnly = false, opening = false}: {
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
  return <div className="bullet-diff" data-review-change={beforeOnly ? "moved-from" : change?.kind}>
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

export function BulletDiffMenu({navigate}: {navigate: Navigate}) {
  const context = useBulletReview();
  if (!context?.review.draft) return null;
  return <details className="bullet-diff-menu"><summary>待提交变更<ChevronDown/></summary><div>{[...context.changes.values()].map(change => <button key={change.id} onClick={() => navigate({kind: "bullet", id: change.id})}><BulletDiffMark id={change.id}/><span>{bulletTitle((change.after || change.before)!.body)}</span></button>)}</div></details>;
}
