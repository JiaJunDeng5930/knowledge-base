"use client";

import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight } from "lucide-react";
import { useReadingView } from "@/components/reading-view";
import { readingHighlightPlugin } from "@/lib/reading-highlight";
import { readingUrl } from "@/lib/reading-path";
import type { Panel } from "@/lib/knowledge-types";
import type { Navigate } from "./model";

export function PageLink({target, from, navigate, children, appearance = "inline", label, title, collapsed}: {
  target: Panel; from: number; navigate: Navigate; children: ReactNode;
  appearance?: "inline" | "context" | "bullet"; label?: string; title?: string; collapsed?: boolean;
}) {
  const {nextPanel} = useReadingView();
  const selected = (target.kind === "bullet" && nextPanel?.kind === "bullet" && (nextPanel.id === target.id || nextPanel.focus === target.id))
    || (target.kind === "fsrs" && nextPanel?.kind === "fsrs" && nextPanel.id === target.id);
  return <a className={"page-link page-link--" + appearance} href={readingUrl([target])}
    aria-label={label} title={title} aria-current={selected ? "location" : undefined}
    data-reading={selected || undefined} data-collapsed={collapsed || undefined}
    onClick={event => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault(); navigate(target, from);
    }}>{children}</a>;
}

function ContentLink({href, children, from, navigate}: {href?: string; children: ReactNode; from: number; navigate?: Navigate}) {
  const internal = href?.match(/^\/(bullet|fsrs)\/(-?\d+)\/?$/);
  if (internal && navigate) return <PageLink target={{kind: internal[1] as "bullet" | "fsrs", id: internal[2]}} {...{from, navigate}} title="在后文打开">{children}</PageLink>;
  return <a className="page-external-link" href={href} target="_blank" rel="noopener noreferrer" title="在新标签页打开">{children}<ArrowUpRight aria-hidden="true"/></a>;
}

export function BulletBody({body, from, navigate, raw = false, query = ""}: {body: string; from: number; navigate: Navigate; raw?: boolean; query?: string}) {
  if (!body) return null;
  if (raw) return <pre className="raw-body">{body}</pre>;
  return <div className="prose-note"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={query ? [readingHighlightPlugin(query)] : []} components={{
    a: ({href, children}) => <ContentLink {...{href, children, from, navigate}}/>,
    table: ({children}) => <div className="markdown-table-wrap"><table>{children}</table></div>,
    img: ({src, alt}) => typeof src === "string" ? <a className="image-source" href={src} target="_blank" rel="noopener noreferrer">查看图片：{alt || "图片"} <ArrowUpRight aria-hidden="true"/></a> : null,
  }}>{body}</Markdown></div>;
}

export function InlineTitle({text, query = "", insideLink = false, from = 0, navigate}: {text: string; query?: string; insideLink?: boolean; from?: number; navigate?: Navigate}) {
  return <Markdown rehypePlugins={query ? [readingHighlightPlugin(query)] : []} components={{p: ({children}) => <>{children}</>, a: ({href, children}) => insideLink ? <>{children}</> : <ContentLink {...{href, children, from, navigate}}/>}}>{text}</Markdown>;
}
