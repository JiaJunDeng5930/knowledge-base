"use client";

import { useMemo, type CSSProperties } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useReadingView } from "@/components/reading-view";
import { useBulletReview } from "@/components/bullet-review-context";
import { ReviewBulletContent } from "../bullet-review";
import { BulletBody, PageLink } from "./content";
import { blockExpansionKey, buildPageBlocks, type BlockSurface, type KnowledgeModel, type Navigate, type PageBlock } from "./model";

export function PageBlockList({blocks, surface, from, navigate, depth = 0}: {
  blocks: PageBlock[]; surface: BlockSurface; from: number; navigate: Navigate; depth?: number;
}) {
  return <ul className="page-block-list" style={{"--page-block-depth": depth} as CSSProperties}>{blocks.map(block =>
    <BlockRow key={(block.reviewSide || "after") + ":" + block.id} {...{block, surface, from, navigate, depth}}/>
  )}</ul>;
}

function BlockRow({block, surface, from, navigate, depth}: {block: PageBlock; surface: BlockSurface; from: number; navigate: Navigate; depth: number}) {
  const {view, updateView, nextPanel} = useReadingView();
  const inBody = surface.kind === "body";
  const stateKey = blockExpansionKey(surface, block.id) + (block.reviewSide ? ":before" : "");
  const expanded = inBody ? view.expanded[stateKey] ?? true : view.details[stateKey] ?? false;
  const hasChildren = block.children.length > 0;
  const query = inBody ? view.highlight : "";
  const toggle = () => updateView(current => inBody
    ? {expanded: {...current.expanded, [stateKey]: !expanded}}
    : {details: {...current.details, [stateKey]: !expanded}});
  return <li className="page-block" data-bullet-id={inBody && !block.reviewSide ? block.id : undefined}
    data-before-bullet-id={block.reviewSide ? block.id : undefined}
    data-reference-bullet-id={!inBody ? block.id : undefined}
    data-located={inBody && view.focusedId === block.id || undefined}
    data-linked={nextPanel?.kind === "bullet" && nextPanel.id === block.id || undefined}>
    <div className="page-block-row">
      {hasChildren ? <button className="page-block-toggle" aria-expanded={expanded} onClick={toggle}
        aria-label={(expanded ? "折叠下级：" : "展开下级：") + block.title}
        title={expanded ? "折叠下级" : "展开下级"}>{expanded ? <ChevronDown aria-hidden="true"/> : <ChevronRight aria-hidden="true"/>}</button>
        : <span className="page-block-toggle-space" aria-hidden="true"/>}
      {block.available ? <PageLink target={{kind: "bullet", id: block.id}} {...{from, navigate}}
        appearance="bullet" label={"打开内容：" + block.title}
        title={hasChildren && !expanded ? "在后文打开此内容 · 下级已折叠" : "在后文打开此内容"} collapsed={hasChildren && !expanded}>
        <span className="page-block-dot" aria-hidden="true"/>
      </PageLink> : <span className="page-block-unavailable-dot" aria-hidden="true"><span className="page-block-dot"/></span>}
      <div className="page-block-content">
        <ReviewBulletContent id={block.id} beforeOnly={block.reviewSide === "before"} selectable={inBody} {...{from, navigate}}>
        {block.heading && <div className="page-block-heading"><BulletBody body={block.heading} {...{from, navigate, query}}/></div>}
        {block.content && <BulletBody body={block.content} {...{from, navigate, query}}/>}
        {!block.available && <p className="page-block-unavailable">{block.title} 暂不可用</p>}
        </ReviewBulletContent>
      </div>
    </div>
    {hasChildren && expanded && <PageBlockList blocks={block.children} {...{surface, from, navigate}} depth={depth + 1}/>}
  </li>;
}

export function PageBulletList({parentId, model, from, navigate}: {parentId: string; model: KnowledgeModel; from: number; navigate: Navigate}) {
  const review = useBulletReview();
  const draft = review?.review.draft;
  const blocks = useMemo(() => buildPageBlocks(model, parentId, draft), [model, parentId, draft]);
  return <PageBlockList blocks={blocks} surface={{kind: "body"}} {...{from, navigate}}/>;
}
