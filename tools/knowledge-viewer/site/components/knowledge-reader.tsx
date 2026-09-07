"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleHelp, Clock3, Code2, Copy, FileText, Hash, List, Maximize2, Minimize2, PanelLeft, PanelLeftClose, RefreshCw, RotateCcw, Search, X, MapPin, AlignLeft, Minus, Plus, SlidersHorizontal, Delete } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildKnowledgeModel } from "@/lib/knowledge-model";
import { bulletTitle, followPanel, panelKey, readPanels, readingUrl, resultExcerpt, searchBullets, searchExcerpt, splitBulletContent } from "@/lib/reading-path";
import { ReadingDisclosure, ReadingViewProvider, useReadingView, type ReadingView } from "@/components/reading-view";
import { BulletBody, InlineTitle } from "@/components/reader-presentation/page-content/content";
import { PageBulletList } from "@/components/reader-presentation/page-content/block-list";
import { PageReferences } from "@/components/reader-presentation/page-content/reference-list";
import { ROOT_LABELS, type Navigate } from "@/components/reader-presentation/page-content/model";
import { IconButton } from "@/components/reader-presentation/icon-button";
import { readingFontSettings, readingSpineOffset, scrollReadingTarget } from "@/components/reader-presentation/metrics";
import { useReadingFont } from "@/components/reader-presentation/use-reading-font";
import type { Bullet, Fsrs, Panel, Review, Snapshot } from "@/lib/knowledge-types";

type Model = ReturnType<typeof buildKnowledgeModel>;
const FSRS_STATES = {1: "学习中", 2: "复习中", 3: "重新学习"};
const FSRS_RATINGS = {1: "Again · 忘记", 2: "Hard · 困难", 3: "Good · 良好", 4: "Easy · 容易"};

function rootLabel(bullet: Bullet) { return ROOT_LABELS[bullet.body.trim()] || bulletTitle(bullet.body); }
function dateText(value: string | null, withTime = false): string {
  if (!value) return "尚未复习";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "日期不可用";
  return date.toLocaleString("zh-CN", {year: "numeric", month: "2-digit", day: "2-digit", ...(withTime ? {hour: "2-digit", minute: "2-digit"} : {})});
}
function dueLabel(value: string, now: number): string {
  const delta = new Date(value).getTime() - now;
  const days = Math.ceil(Math.abs(delta) / 86400000);
  if (delta <= 0) return days <= 1 ? "已到期" : "已到期 " + Math.floor(Math.abs(delta) / 86400000) + " 天";
  if (days <= 1) return "24 小时内到期";
  return days === 1 ? "1 天后" : days + " 天后";
}
function pathLabel(model: Model, id: string): string {
  return model.getPath(id).slice(1, -1).map((part: {label: string}) => ROOT_LABELS[part.label] || part.label).join(" / ");
}
function panelTitle(panel: Panel, model: Model | null): string {
  if (panel.kind === "index") return "知识索引";
  if (panel.kind === "all") return "全部笔记";
  if (panel.kind === "memory") return "记忆与复习";
  if (panel.kind === "tag") return "#" + panel.tag;
  if (panel.kind === "fsrs") return "记忆对象 " + panel.id;
  const bullet = model?.bulletsById.get(panel.id);
  return bullet ? bulletTitle(bullet.body) : "笔记 " + panel.id;
}
function Highlight({text, query}: {text: string; query: string}) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map(term => term.replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&"));
  const expression = new RegExp("(" + escaped.join("|") + ")", "gi");
  const termSet = new Set(terms.map(t => t.toLowerCase()));
  return <>{text.split(expression).map((part, i) => termSet.has(part.toLowerCase()) ? <mark key={i}>{part}</mark> : part)}</>;
}
function EmptyState({title, children}: {title: string; children?: ReactNode}) {
  return <div className="empty-state"><BookOpen/><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
function KnowledgeLink({id, model, from, navigate, children, preview = true, className = "", highlight = ""}: {id: string; model: Model; from: number; navigate: Navigate; children?: ReactNode; preview?: boolean; className?: string; highlight?: string}) {
  const {nextPanel} = useReadingView();
  const bullet: Bullet | undefined = model.bulletsById.get(id);
  const target: Panel = {kind: "bullet", id, ...(highlight.trim() && highlight.trim().replace(/^#/, "") !== id ? {highlight: highlight.trim()} : {})};
  const selected = nextPanel?.kind === "bullet" && (nextPanel.id === id || nextPanel.focus === id);
  const link = <a href={readingUrl([target])} data-reading={selected || undefined} aria-current={selected ? "location" : undefined} className={"knowledge-link " + className} onClick={(event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); navigate(target, from);
  }}>{children || (bullet ? bulletTitle(bullet.body) : "笔记 " + id)}</a>;
  if (!preview || !bullet) return link;
  const sub: Bullet[] = model.getChildren(id);
  return <Tooltip delayDuration={450}><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="top" align="start" className="note-tooltip"><small>{pathLabel(model, id) || "知识库"} · #{id}</small><p className="preview-body">{searchExcerpt(bullet.body, "", 320)}</p>{!!sub.length && <ul className="preview-children">{sub.slice(0, 3).map(item => <li key={item.id}>{searchExcerpt(item.body, "", 90)}</li>)}</ul>}{selected && <span>已在后文打开</span>}</TooltipContent></Tooltip>;
}

function NavigationTree({bullet, model, navigate, activeId, depth = 0}: {bullet: Bullet; model: Model; navigate: Navigate; activeId?: string; depth?: number}) {
  const children: Bullet[] = model.getChildren(bullet.id);
  const [expanded, setExpanded] = useState(depth === 0);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeId && model.getPath(activeId).some((part: {id: string | null}) => part.id === bullet.id)) setExpanded(true);
  }, [activeId, bullet.id, model]);
  useEffect(() => {
    if (activeId !== bullet.id) return;
    const frame = requestAnimationFrame(() => rowRef.current?.scrollIntoView({block: "nearest", inline: "nearest", behavior: "instant"}));
    return () => cancelAnimationFrame(frame);
  }, [activeId, bullet.id]);
  return <li className="navigation-node">
    <div ref={rowRef} className="navigation-row" data-active={activeId === bullet.id} style={{"--tree-depth": depth} as CSSProperties}>
      {children.length ? <button className="tree-disclosure" onClick={() => setExpanded(!expanded)} aria-label={(expanded ? "折叠 " : "展开 ") + bulletTitle(bullet.body)} aria-expanded={expanded}>{expanded ? <ChevronDown/> : <ChevronRight/>}</button> : <span className="tree-dot" />}
      <button className="tree-label" aria-current={activeId === bullet.id ? "page" : undefined} onClick={() => navigate({kind: "bullet", id: bullet.id})} title={bulletTitle(bullet.body, 500)}>{depth === 0 ? rootLabel(bullet) : bulletTitle(bullet.body)}</button>
    </div>
    {expanded && !!children.length && <ul>{children.map(child => <NavigationTree key={child.id} bullet={child} model={model} navigate={navigate} activeId={activeId} depth={depth + 1}/>)}</ul>}
  </li>;
}

function ReaderNavigation({model, panels, active, navigate}: {model: Model | null; panels: Panel[]; active: number; navigate: Navigate}) {
  const {setOpenMobile, isMobile} = useSidebar();
  const open: Navigate = panel => {navigate(panel); if (isMobile) setOpenMobile(false);};
  const activePanel = panels[active];
  const tags = useMemo(() => {
    const values = new Set<string>();
    if (model) for (const tags of model.tagsById.values()) for (const tag of tags) values.add(tag);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [model]);
  return <Sidebar className="reader-sidebar">
    <SidebarHeader className="navigation-header"><h2>目录</h2>{isMobile && <IconButton label="收起目录" onClick={() => setOpenMobile(false)}><X/></IconButton>}</SidebarHeader>
    <SidebarContent className="navigation-content"><nav aria-label="知识库浏览">
      <div className="navigation-section navigation-indexes">
        <button className="nav-item" data-active={activePanel?.kind === "all"} onClick={() => open({kind: "all"})}><List/><span>全部笔记</span></button>
        <button className="nav-item" data-active={activePanel?.kind === "memory" || activePanel?.kind === "fsrs"} onClick={() => open({kind: "memory"})}><Clock3/><span>记忆</span></button>
      </div>
      <div className="navigation-section">
        {model ? <ul className="navigation-tree">{model.rootBullets.map((bullet: Bullet) => <NavigationTree key={bullet.id} bullet={bullet} model={model} navigate={open} activeId={activePanel?.kind === "bullet" ? activePanel.id : undefined}/>)}</ul> : <div className="navigation-skeleton"><Skeleton/><Skeleton/><Skeleton/></div>}
      </div>
      {!!tags.length && <div className="navigation-section"><h2>标签</h2>{tags.map(tag => <button key={tag} className="nav-item tag-nav" data-active={activePanel?.kind === "tag" && activePanel.tag === tag} onClick={() => open({kind: "tag", tag})}><Hash/><span>{tag}</span></button>)}</div>}
    </nav></SidebarContent>
  </Sidebar>;
}

function ReadingHeader({panels, active, model, activate, navigate, search, font, size, changeSize, focused, setFocused, copy, copied, refresh, refreshing, fetchedAt, error, help}: {
  panels: Panel[]; active: number; model: Model | null; activate: (index: number) => void; navigate: Navigate; search: () => void;
  font: ReturnType<typeof readingFontSettings> | null; size: number | null; changeSize: (size: number) => void;
  focused: boolean; setFocused: (focused: boolean) => void; copy: () => void; copied: boolean;
  refresh: () => void; refreshing: boolean; fetchedAt?: string; error: string | null; help: () => void;
}) {
  const {toggleSidebar, open, isMobile, openMobile} = useSidebar();
  const [pathOpen, setPathOpen] = useState(false);
  const sidebarVisible = isMobile ? openMobile : open;
  return <header className="reading-header" data-focus={focused}>
    <div className="header-primary">
      <IconButton label={sidebarVisible ? "收起目录" : "展开目录"} aria-expanded={sidebarVisible} onClick={toggleSidebar}>{sidebarVisible ? <PanelLeftClose/> : <PanelLeft/>}</IconButton>
      <a className="reader-home" href={readingUrl([{kind: "index"}])} onClick={event => {if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); navigate({kind: "index"});}}>知识库</a>
      <div className="header-actions">
        {focused && <IconButton label="返回并排阅读" aria-pressed={true} onClick={() => setFocused(false)}><Minimize2/></IconButton>}
        <IconButton label="搜索知识库 · ⌘ / Ctrl K" onClick={search}><Search/></IconButton>
        <Popover><PopoverTrigger asChild><button className="icon-button" aria-label="阅读设置" title="阅读设置"><SlidersHorizontal/></button></PopoverTrigger><PopoverContent className="reading-preferences" align="end">
          <div className="font-control"><span>Aa</span><output aria-label="当前字号">{size ?? font?.defaultSize}</output><IconButton label="缩小字号" disabled={!font || size === null || size <= font.min} onClick={() => size !== null && changeSize(size - 1)}><Minus/></IconButton><IconButton label="恢复默认字号" disabled={!font || size === font.defaultSize} onClick={() => font && changeSize(font.defaultSize)}><RotateCcw/></IconButton><IconButton label="放大字号" disabled={!font || size === null || size >= font.max} onClick={() => size !== null && changeSize(size + 1)}><Plus/></IconButton></div>
          <div className="preference-actions"><IconButton label={copied ? "已复制阅读路径" : "复制到当前篇的阅读路径"} onClick={copy}>{copied ? <Check/> : <Copy/>}</IconButton>{!focused && <IconButton label="专注阅读当前篇" onClick={() => setFocused(true)}><Maximize2/></IconButton>}<IconButton label="刷新知识库" onClick={refresh} disabled={refreshing}><RefreshCw/></IconButton><IconButton label="阅读帮助与快捷键" onClick={help}><CircleHelp/></IconButton></div>
          <small className="connection-status" role="status">{error ? "连接暂不可用" : refreshing ? "正在读取…" : fetchedAt ? "更新于 " + dateText(fetchedAt, true) : "尚未连接"}</small>
        </PopoverContent></Popover>
      </div>
    </div>
    {panels.length > 1 && <nav className="reading-path-navigation" aria-label="已打开的阅读路径">
      <IconButton label="前一篇" disabled={active === 0} onClick={() => activate(active - 1)}><ArrowLeft/></IconButton>
      <Popover open={pathOpen} onOpenChange={setPathOpen}><PopoverTrigger asChild><button className="path-picker" aria-label="选择已打开的笔记"><span>{panelTitle(panels[active], model)}</span><small>{active + 1} / {panels.length}</small><ChevronDown/></button></PopoverTrigger><PopoverContent className="path-popover" align="start"><nav aria-label="阅读路径">{panels.map((panel, index) => <button key={index + panelKey(panel)} aria-current={index === active ? "page" : undefined} onClick={() => {activate(index); setPathOpen(false);}}><small>{index + 1}</small><span>{panelTitle(panel, model)}</span>{index === active && <Check/>}</button>)}</nav></PopoverContent></Popover>
      <IconButton label="后一篇" disabled={active === panels.length - 1} onClick={() => activate(active + 1)}><ArrowRight/></IconButton>
    </nav>}
  </header>;
}

function NoteRelations({bullet, model, from, navigate}: {bullet: Bullet; model: Model; from: number; navigate: Navigate}) {
  const outgoing: string[] = model.outgoingById.get(bullet.id) || [];
  const incoming: string[] = model.incomingById.get(bullet.id) || [];
  const memories: string[] = model.fsrsByBullet.get(bullet.id) || [];
  const {view, updateView} = useReadingView();
  if (!outgoing.length && !incoming.length && !memories.length) return null;
  const expandedMemories = view.details["all-memories"] ?? false;
  return <aside className="note-relations" aria-label="这条笔记的关联">
    <PageReferences id={bullet.id} {...{model, from, navigate}}/>
    {!!memories.length && <ReadingDisclosure id="memory-relations" className="memory-relations" title={<><Clock3/><span>记忆</span><ChevronDown/></>}>
      <div className="memory-relation-list">{memories.slice(0, expandedMemories ? undefined : 5).map(id => {
        const memory: Fsrs | undefined = model.fsrsById.get(id);
        return <button key={id} className="memory-relation" onClick={() => navigate({kind: "fsrs", id}, from)}><span>{memoryTitle(id, model)}<small>#{id} · {memory ? FSRS_STATES[memory.state] : "暂不可用"}</small></span><ArrowUpRight/></button>;
      })}</div>
      {memories.length > 5 && <button className="text-link relation-more" onClick={() => updateView(current => ({details: {...current.details, "all-memories": !expandedMemories}}))}>{expandedMemories ? "收起列表" : "显示更多"}</button>}
    </ReadingDisclosure>}
  </aside>;
}

function NoteOutline({id, model, jump}: {id: string; model: Model; jump: (id: string) => void}) {
  const [open, setOpen] = useState(false);
  const parent: Bullet | undefined = model.bulletsById.get(id);
  const items: Bullet[] = model.getSubtree(id);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button className="icon-button" aria-label="本篇目录" title="本篇目录"><AlignLeft/></button></PopoverTrigger><PopoverContent className="note-outline" align="start"><h2>跳到内容</h2><nav aria-label="本篇目录">{items.map(item => <button key={item.id} style={{"--tree-depth": Math.max(0, item.depth - (parent?.depth || 0) - 1)} as CSSProperties} onClick={() => {jump(item.id); setOpen(false);}}><span>{bulletTitle(item.body, 160)}</span><small>#{item.id}</small></button>)}</nav></PopoverContent></Popover>;
}

function BulletPage({panel, model, from, navigate, restorePosition = false}: {panel: Extract<Panel, {kind: "bullet"}>; model: Model; from: number; navigate: Navigate; restorePosition?: boolean}) {
  const {id} = panel;
  const bullet: Bullet | undefined = model.bulletsById.get(id);
  const {view, updateView, scrollRef} = useReadingView();
  const [focusError, setFocusError] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const jumpFrame = useRef<number | null>(null);
  const moveToMatch = useCallback((requestedIndex: number) => {
    const scroll = scrollRef.current;
    const matches = scroll?.querySelectorAll<HTMLElement>('[data-knowledge-match="true"]');
    if (!scroll || !matches?.length) return;
    const index = (requestedIndex + matches.length) % matches.length;
    matches.forEach((mark, i) => mark.toggleAttribute("data-current-match", i === index));
    updateView({matchIndex: index});
    scrollReadingTarget(scroll, matches[index]);
  }, [scrollRef, updateView]);
  const jump = useCallback((targetId: string) => {
    const path: {id: string | null}[] = model.getPath(targetId);
    if (!path.some(part => part.id === id)) {setFocusError("定位的内容已不在本篇中。下方仍显示当前笔记。"); return;}
    setFocusError("");
    updateView(current => ({focusedId: targetId, expanded: {...current.expanded, ...Object.fromEntries(path.filter(part => part.id).map(part => [part.id, true]))}}));
    if (jumpFrame.current !== null) cancelAnimationFrame(jumpFrame.current);
    jumpFrame.current = requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      const target = scroll?.querySelector<HTMLElement>('[data-bullet-id="' + targetId + '"]');
      if (scroll && target) scrollReadingTarget(scroll, target);
    });
  }, [id, model, scrollRef, updateView]);
  const jumpRef = useRef(jump);
  const matchRef = useRef(moveToMatch);
  const restoreRef = useRef(restorePosition);
  jumpRef.current = jump;
  matchRef.current = moveToMatch;
  restoreRef.current = restorePosition;
  useEffect(() => {
    if (restoreRef.current) return;
    if (panel.highlight) {
      updateView({highlight: panel.highlight, matchIndex: 0});
      if (!panel.focus) jumpFrame.current = requestAnimationFrame(() => matchRef.current(0));
    }
    if (panel.focus) jumpRef.current(panel.focus);
  }, [panel, updateView]);
  useEffect(() => {
    const marks = scrollRef.current?.querySelectorAll<HTMLElement>('[data-knowledge-match="true"]');
    setMatchCount(marks?.length || 0);
    marks?.forEach((mark, index) => mark.toggleAttribute("data-current-match", index === view.matchIndex));
  }, [view.highlight, view.expanded, view.matchIndex, model, scrollRef]);
  useEffect(() => () => {if (jumpFrame.current !== null) cancelAnimationFrame(jumpFrame.current);}, []);
  if (!bullet) return <EmptyState title="这条笔记已不在知识库中">可以从目录重新定位，或刷新知识库。</EmptyState>;
  const children: Bullet[] = model.getChildren(id);
  const subtree: Bullet[] = model.getSubtree(id);
  const tags: string[] = model.tagsById.get(id) || [];
  const path: {id: string | null; label: string}[] = model.getPath(id).slice(1, -1);
  const {heading, content} = splitBulletContent(bullet.body);
  const siblings: Bullet[] = model.getChildren(bullet.parent_id);
  const siblingIndex = siblings.findIndex(item => item.id === id);
  const allCollapsed = children.every(child => view.expanded[child.id] === false);
  return <>
    <div className="note-context-header">
      <nav className="breadcrumbs" aria-label="笔记所在位置">{path.map((part, index) => <span key={part.id}>{index > 0 && <ChevronRight/>}<button title={"在「" + (ROOT_LABELS[part.label] || part.label) + "」中定位当前笔记"} onClick={() => navigate({kind: "bullet", id: part.id!, focus: id}, from)}>{ROOT_LABELS[part.label] || part.label}</button></span>)}</nav>
      {!!children.length && <div className="note-tools"><NoteOutline {...{id, model, jump}}/><IconButton label={allCollapsed ? "展开全部下级内容" : "收起全部下级内容"} aria-expanded={!allCollapsed} onClick={() => updateView(current => ({expanded: {...current.expanded, ...Object.fromEntries(subtree.map(item => [item.id, allCollapsed]))}}))}>{allCollapsed ? <ChevronsUpDown/> : <ChevronsDownUp/>}</IconButton></div>}
    </div>
    {focusError && <p role="status" className="location-message">{focusError}</p>}
    {view.highlight && <div className="search-match-bar" role="region" aria-label="搜索命中"><span title={view.highlight}>“{view.highlight}”</span><small role="status">{matchCount ? Math.min(view.matchIndex + 1, matchCount) + " / " + matchCount : "当前展开内容无匹配"}</small><IconButton label="上一个命中" disabled={!matchCount} onClick={() => moveToMatch(view.matchIndex - 1)}><ArrowLeft/></IconButton><IconButton label="下一个命中" disabled={!matchCount} onClick={() => moveToMatch(view.matchIndex + 1)}><ArrowRight/></IconButton><IconButton label="清除搜索高亮" onClick={() => updateView({highlight: "", matchIndex: 0})}><X/></IconButton></div>}
    <div data-bullet-id={id} className="note-opening" data-located={view.focusedId === id}>
      {heading ? <h1 className="note-title"><InlineTitle text={heading} query={view.highlight} {...{from, navigate}}/></h1> : <h1 className="sr-only">{bulletTitle(bullet.body, 140)}</h1>}
      <BulletBody body={content} {...{from, navigate}} query={view.highlight}/>
    </div>
    {!!tags.length && <div className="note-tags" aria-label="有效标签，包含从祖先继承的标签">{tags.map(tag => <button key={tag} title="包含直接与继承标签" onClick={() => navigate({kind: "tag", tag}, from)}>#{tag}</button>)}</div>}
    {!!children.length && <section className="child-notes">
      {view.focusedId && view.focusedId !== id && <div className="location-message" role="status"><MapPin/><span>原文位置</span><IconButton label="清除定位标记" onClick={() => updateView({focusedId: null})}><X/></IconButton></div>}
      <PageBulletList parentId={id} {...{model, from, navigate}}/>
    </section>}
    <NoteRelations {...{bullet, model, from, navigate}}/>
    <div className="note-end"><span>笔记 #{id}</span><IconButton label={view.raw ? "收起原文" : "查看原文"} onClick={() => updateView({raw: !view.raw})} aria-expanded={view.raw} aria-pressed={view.raw}><Code2/></IconButton></div>
    {view.raw && <BulletBody body={bullet.body} {...{from, navigate}} raw/>}
    {siblings.length > 1 && <nav className="sibling-navigation" aria-label="同级内容"><div>{siblings[siblingIndex - 1] && <button aria-label={"上一条：" + bulletTitle(siblings[siblingIndex - 1].body)} onClick={() => navigate({kind: "bullet", id: siblings[siblingIndex - 1].id}, from - 1)}><ArrowLeft/><span>{bulletTitle(siblings[siblingIndex - 1].body, 95)}</span></button>}</div><div>{siblings[siblingIndex + 1] && <button aria-label={"下一条：" + bulletTitle(siblings[siblingIndex + 1].body)} onClick={() => navigate({kind: "bullet", id: siblings[siblingIndex + 1].id}, from - 1)}><ArrowRight/><span>{bulletTitle(siblings[siblingIndex + 1].body, 95)}</span></button>}</div></nav>}
  </>;
}

function IndexPage({model, from, navigate}: {model: Model; from: number; navigate: Navigate}) {
  const roots: Bullet[] = model.rootBullets;
  return <><h1 className="index-title">知识索引</h1>
    {!roots.length && <EmptyState title="知识库还没有内容">已有内容会在这里按原有结构呈现。</EmptyState>}
    {roots.map(root => {
      const children: Bullet[] = model.getChildren(root.id);
      return <section key={root.id} className="index-group"><div className="section-caption"><h2><KnowledgeLink id={root.id} {...{model, from, navigate}} preview={false}>{rootLabel(root)}</KnowledgeLink></h2></div>
        {children.length ? children.map(child => {
          const sub: Bullet[] = model.getChildren(child.id);
          return <article className="topic-entry" key={child.id}><div><div className="topic-heading"><KnowledgeLink id={child.id} {...{model, from, navigate}} className="topic-title" preview={false}/></div>
            <div className="topic-children">{sub.map(item => {
              const items: Bullet[] = model.getChildren(item.id);
              return <div key={item.id}><KnowledgeLink id={item.id} {...{model, from, navigate}}>{bulletTitle(item.body, 100)}</KnowledgeLink>{!!items.length && <p>{items.slice(0, 5).map(note => bulletTitle(note.body, 35)).join(" · ")}{items.length > 5 ? " …" : ""}</p>}</div>;
            })}</div></div></article>;
        }) : null}
      </section>;
    })}

  </>;
}

function resultText(bullet: Bullet, query: string) {
  const {heading} = splitBulletContent(bullet.body);
  return {title: heading ? bulletTitle(heading, 180) : searchExcerpt(bullet.body, query, 240), excerpt: heading ? resultExcerpt(bullet.body, query) : ""};
}

function BulletListPage({model, from, navigate, tag}: {model: Model; from: number; navigate: Navigate; tag?: string}) {
  const {view, updateView} = useReadingView();
  const {query, limit} = view;
  const deferredQuery = useDeferredValue(query);
  const candidates = useMemo(() => {
    const ordered: Bullet[] = model.getSubtree(null);
    // 缺失父节点的记录仍可检索，不能因目录不可达而隐藏数据。
    const seen = new Set(ordered.map(item => item.id));
    const all = [...ordered, ...model.bullets.filter((item: Bullet) => !seen.has(item.id))];
    return tag ? all.filter((b: Bullet) => (model.tagsById.get(b.id) || []).includes(tag)) : all;
  }, [model, tag]);
  const results: Bullet[] = useMemo(() => searchBullets(candidates, deferredQuery), [candidates, deferredQuery]);
  return <><h1 className="index-title">{tag ? "#" + tag : "全部笔记"}</h1>{tag && <p className="index-intro">直接标签与继承标签。</p>}
    <label className="inline-search"><Search/><input aria-label={tag ? "在此标签中搜索" : "筛选全部笔记"} placeholder="搜索内容或 #编号…" value={query} onChange={event => updateView({query: event.target.value, limit: 60})}/>{query && <IconButton label="清除筛选" onClick={() => updateView({query: "", limit: 60})}><X/></IconButton>}</label>
    <div className="result-count" role="status">{query ? results.length + " 条匹配 · “" + query + "”" : "按目录顺序"}</div>
    <div className="note-results">{results.slice(0, limit).map(bullet => {
      const {title, excerpt} = resultText(bullet, query);
      const context: Panel | null = bullet.parent_id ? {kind: "bullet", id: bullet.parent_id, focus: bullet.id, ...(query.trim() ? {highlight: query.trim()} : {})} : null;
      return <article key={bullet.id} className="note-result"><div className="result-path">{context ? <a href={readingUrl([context])} title="在父级中定位此笔记" onClick={event => {if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); navigate(context, from);}}>{pathLabel(model, bullet.id) || (model.bulletsById.has(bullet.parent_id!) ? rootLabel(model.bulletsById.get(bullet.parent_id!)!) : "父级笔记")}<ChevronRight/></a> : <span>根笔记</span>}<small>#{bullet.id}</small></div><KnowledgeLink id={bullet.id} {...{model, from, navigate}} preview={false} highlight={query}><Highlight text={title} query={query}/></KnowledgeLink>{excerpt && <p><Highlight text={excerpt} query={query}/></p>}</article>;

    })}</div>
    {!results.length && <EmptyState title="没有找到匹配的笔记">试试更短的关键词，或清除筛选。</EmptyState>}
    {results.length > limit && <button className="load-more" onClick={() => updateView({limit: limit + 60})}>继续显示</button>}
  </>;
}

function memoryTitle(fsrsId: string, model: Model): string {
  const memory: Fsrs | undefined = model.fsrsById.get(fsrsId);
  // 固定前缀不承担对象识别；完整 cue 仍在对象页原样呈现。
  return memory?.cue ? bulletTitle(memory.cue.replace(/^场景等价类(?:（[^）]*）)?[：:]\s*/, ""), 230) : "记忆对象 #" + fsrsId;
}

function MemoryListPage({model, from, navigate, now}: {model: Model; from: number; navigate: Navigate; now: number}) {
  const {view, updateView} = useReadingView();
  const {memoryFilter: filter, query, limit} = view;
  const all: Fsrs[] = Array.from(model.fsrsById.values());
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = all.filter(item => (filter !== "due" || new Date(item.due_at).getTime() <= now) && (
    (terms.length === 1 && terms[0].replace(/^#/, "") === item.id) ||
    terms.every(term => item.cue.toLowerCase().includes(term) || (model.bulletsByFsrs.get(item.id) || []).some((id: string) => model.bulletsById.get(id)?.body.toLowerCase().includes(term)))
  )).sort((a, b) => a.due_at.localeCompare(b.due_at));
  return <><h1 className="index-title">记忆与复习</h1>
    <Tabs value={filter} onValueChange={value => updateView({memoryFilter: value, limit: 60})} className="memory-tabs"><TabsList><TabsTrigger value="all">全部</TabsTrigger><TabsTrigger value="due">已到期</TabsTrigger></TabsList></Tabs>
    <label className="inline-search"><Search/><input aria-label="搜索记忆对象" placeholder="搜索复习线索、关联内容或 #编号…" value={query} onChange={e => updateView({query: e.target.value, limit: 60})}/>{query && <IconButton label="清除记忆筛选" onClick={() => updateView({query: "", limit: 60})}><X/></IconButton>}</label>
    <div className="result-count" role="status">{query ? rows.length + " 条匹配 · " : ""}按到期时间排列</div>
    <Table className="memory-table"><TableHeader><TableRow><TableHead>复习线索</TableHead><TableHead>状态与到期</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, limit).map(item => <TableRow key={item.id}><TableCell><button className="memory-title" onClick={() => navigate({kind: "fsrs", id: item.id}, from)}><Highlight text={memoryTitle(item.id, model)} query={query}/></button><small>#{item.id}</small></TableCell><TableCell><span className="state-label">{FSRS_STATES[item.state]}</span><small className={new Date(item.due_at).getTime() <= now ? "due-text" : ""} title={dateText(item.due_at, true)}>{dueLabel(item.due_at, now)}</small><time dateTime={item.due_at}>{dateText(item.due_at)}</time></TableCell></TableRow>)}</TableBody></Table>
    {!rows.length && <EmptyState title={all.length ? "没有匹配的记忆对象" : "还没有记忆对象"}>{all.length ? "调整筛选，查看其他对象。" : "创建后的记忆对象、知识关联与复习历史会显示在这里。"}</EmptyState>}
    {rows.length > limit && <button className="load-more" onClick={() => updateView({limit: limit + 60})}>继续显示</button>}
  </>;
}

function MemoryPage({id, model, from, navigate, now}: {id: string; model: Model; from: number; navigate: Navigate; now: number}) {
  const {view, updateView} = useReadingView();
  const memory: Fsrs | undefined = model.fsrsById.get(id);
  if (!memory) return <EmptyState title="找不到这个记忆对象">它可能已经从知识库中移除。</EmptyState>;
  const bulletIds: string[] = model.bulletsByFsrs.get(id) || [];
  const selected = new Set(bulletIds);
  const ordered: Bullet[] = model.getSubtree(null).filter((bullet: Bullet) => selected.has(bullet.id));
  const seen = new Set(ordered.map(bullet => bullet.id));
  for (const bulletId of bulletIds) if (!seen.has(bulletId) && model.bulletsById.has(bulletId)) ordered.push(model.bulletsById.get(bulletId));
  const reviews: Review[] = [...(model.reviewsByFsrs.get(id) || [])].reverse();
  const config = model.schedulerConfigsById.get(memory.scheduler_config_id);
  return <><nav className="breadcrumbs"><button onClick={() => navigate({kind: "memory"}, from)}>记忆与复习</button><ChevronRight/><span>#{id}</span></nav>
    <div className="note-meta"><span>记忆对象 #{id}</span><span>{FSRS_STATES[memory.state]}</span></div><h1 className="note-title memory-page-title">复习线索</h1>
    <section className="memory-cue" aria-label="完整 cue"><BulletBody body={memory.cue} {...{from, navigate}}/></section>
    <div className="memory-status-line"><Clock3/><strong>{dueLabel(memory.due_at, now)}</strong><time dateTime={memory.due_at}>{dateText(memory.due_at, true)}</time></div>
    <section className="memory-knowledge"><div className="section-caption"><h2>关联知识</h2></div>{ordered.map(bullet => {
      const {heading, content} = splitBulletContent(bullet.body);
      const level = model.getPath(bullet.id).slice(1, -1).filter((part: {id: string | null}) => part.id !== null && selected.has(part.id)).length;
      return <div className="memory-bullet" key={bullet.id} style={{"--tree-depth": level} as CSSProperties}>
        {!selected.has(bullet.parent_id || "") && <small>{pathLabel(model, bullet.id)}</small>}
        <div className="memory-bullet-heading">{heading && <KnowledgeLink id={bullet.id} {...{model, from, navigate}}><InlineTitle text={heading} insideLink/></KnowledgeLink>}{!heading && <KnowledgeLink id={bullet.id} {...{model, from, navigate}} preview={false} className="association-open"><ArrowUpRight/><span className="sr-only">打开笔记 #{bullet.id}</span></KnowledgeLink>}</div>
        {content && <BulletBody body={content} {...{from, navigate}}/>}
      </div>;
    })}{bulletIds.filter(bulletId => !model.bulletsById.has(bulletId)).map(bulletId => <p className="quiet-empty" key={bulletId}>关联笔记 #{bulletId} 暂不可用</p>)}</section>
    <ReadingDisclosure id="memory-state" className="memory-state-details" title={<><span>记忆状态</span><ChevronDown/></>}>
      <dl className="memory-facts"><div><dt>稳定性</dt><dd>{memory.stability_days === null ? "尚未估计" : memory.stability_days.toFixed(2) + " 天"}</dd><small>回忆概率下降到 90% 所需的时间</small></div><div><dt>难度</dt><dd>{memory.difficulty === null ? "尚未估计" : memory.difficulty.toFixed(2) + " / 10"}</dd><small>由复习表现估计，范围 1–10</small></div><div><dt>上次复习</dt><dd>{dateText(memory.last_review_at, true)}</dd></div><div><dt>学习步骤</dt><dd>{memory.step === null ? "不适用" : "第 " + (memory.step + 1) + " 步"}</dd></div></dl>
    </ReadingDisclosure>
    <ReadingDisclosure id="review-history" className="review-history" initiallyOpen={reviews.length > 0} title={<><span>复习历史 <small>{reviews.length}</small></span><ChevronDown/></>}>
      {reviews.length ? <ol>{reviews.slice(0, view.historyLimit).map(review => <li key={review.id}><span className="history-mark" data-rating={review.rating}/><div><strong>{FSRS_RATINGS[review.rating]}</strong><span>{dateText(review.review_datetime, true)}</span></div><small>{review.review_duration === null ? "未记录耗时" : (Number(review.review_duration) / 1000).toFixed(1) + " 秒"}</small></li>)}</ol> : <p className="quiet-empty">尚未产生复习记录。</p>}
      {reviews.length > view.historyLimit && <button className="load-more" onClick={() => updateView({historyLimit: view.historyLimit + 30})}>显示更早的记录 · 还有 {reviews.length - view.historyLimit} 条</button>}
    </ReadingDisclosure>
    <ReadingDisclosure id="scheduler" className="scheduler-details" title={<>调度配置 <span>#{memory.scheduler_config_id}</span><ChevronDown/></>}>{config ? <><dl><div><dt>期望保留率</dt><dd>{Number(config.scheduler.desired_retention) * 100}%</dd></div><div><dt>最大间隔</dt><dd>{String(config.scheduler.maximum_interval)} 天</dd></div><div><dt>随机扰动</dt><dd>{config.scheduler.enable_fuzzing ? "启用" : "关闭"}</dd></div><div><dt>学习步骤</dt><dd>{(config.scheduler.learning_steps as number[]).join("、") || "无"} 秒</dd></div><div><dt>重新学习步骤</dt><dd>{(config.scheduler.relearning_steps as number[]).join("、") || "无"} 秒</dd></div></dl><ReadingDisclosure id="scheduler-raw" title="完整配置与 21 个模型参数"><pre>{JSON.stringify(config.scheduler, null, 2)}</pre></ReadingDisclosure></> : <p className="quiet-empty">配置暂不可用。</p>}</ReadingDisclosure>
  </>;
}

function SearchDialog({open, setOpen, model, navigate, active}: {open: boolean; setOpen: (open: boolean) => void; model: Model | null; navigate: Navigate; active: number}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(40);
  const [selection, setSelection] = useState("");
  const deferred = useDeferredValue(query);
  const matches: Bullet[] = useMemo(() => model ? searchBullets(model.bullets, deferred) : [], [model, deferred]);
  const memoryMatches: Fsrs[] = useMemo(() => {
    const terms = deferred.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!model) return [];
    if (!terms.length) return filter === "memory" ? Array.from(model.fsrsById.values()) : [];
    return (Array.from(model.fsrsById.values()) as Fsrs[]).filter(item => terms.every(term => item.cue.toLowerCase().includes(term)) || (terms.length === 1 && terms[0].replace(/^#/, "") === item.id));
  }, [model, deferred, filter]);
  const changeQuery = (value: string) => {setQuery(value); setLimit(40); setSelection("");};
  const selectResult = (panel: Panel) => {navigate(panel, active); setOpen(false);};
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="search-dialog" showCloseButton={false}>
    <DialogTitle className="sr-only">搜索整个知识库</DialogTitle><DialogDescription className="sr-only">查找内容、复习线索或编号。上下方向键选择，回车打开；已输入的关键词会保留。</DialogDescription>
    <Command value={selection} onValueChange={setSelection} shouldFilter={false} className="knowledge-command"><div className="command-input-row"><CommandInput value={query} onValueChange={changeQuery} placeholder="搜索内容或 #编号…"/>{query && <IconButton label="清除搜索词" onClick={() => changeQuery("")}><Delete/></IconButton>}<IconButton label="关闭搜索" onClick={() => setOpen(false)}><X/></IconButton></div>
      <Tabs value={filter} onValueChange={value => {setFilter(value); setLimit(40); setSelection("");}} className="search-tabs"><TabsList><TabsTrigger value="all">全部</TabsTrigger><TabsTrigger value="notes">笔记</TabsTrigger><TabsTrigger value="memory">记忆对象</TabsTrigger></TabsList></Tabs>
      <div className="command-caption" role="status">{query ? (filter === "memory" ? memoryMatches.length : filter === "notes" ? matches.length : matches.length + memoryMatches.length) + " 条匹配" : "多个关键词用空格分开；输入 #编号可直接定位"}</div>
      <CommandList className="knowledge-command-list"><CommandEmpty>没有找到匹配的内容，试试更短的关键词。</CommandEmpty>
        {filter !== "memory" && !!matches.length && <CommandGroup heading={filter === "all" && memoryMatches.length ? "笔记" : undefined}>{matches.slice(0, limit).map(bullet => {
          const {title, excerpt} = resultText(bullet, deferred);
          return <CommandItem key={bullet.id} value={"b:" + bullet.id} onSelect={() => selectResult({kind: "bullet", id: bullet.id, ...(deferred.trim() && deferred.trim().replace(/^#/, "") !== bullet.id ? {highlight: deferred.trim()} : {})})} className="search-result"><FileText/><div><small>{pathLabel(model!, bullet.id) || "根笔记"} · #{bullet.id}</small><strong><Highlight text={title} query={deferred}/></strong>{excerpt && <p><Highlight text={excerpt} query={deferred}/></p>}</div><ArrowUpRight/></CommandItem>;
        })}</CommandGroup>}
        {filter !== "notes" && !!memoryMatches.length && <CommandGroup heading={filter === "all" ? "记忆对象" : undefined}>{memoryMatches.slice(0, limit).map(memory => <CommandItem key={memory.id} value={"f:" + memory.id} onSelect={() => selectResult({kind: "fsrs", id: memory.id})} className="search-result"><Clock3/><div><small>记忆对象 #{memory.id} · {FSRS_STATES[memory.state]}</small><strong><Highlight text={memoryTitle(memory.id, model!)} query={deferred}/></strong>{query && !memoryTitle(memory.id, model!).toLowerCase().includes(query.trim().toLowerCase()) && <p><Highlight text={searchExcerpt(memory.cue, deferred)} query={deferred}/></p>}</div><ArrowUpRight/></CommandItem>)}</CommandGroup>}
        {((filter !== "memory" && matches.length > limit) || (filter !== "notes" && memoryMatches.length > limit)) && <CommandItem value="load-more" onSelect={() => setLimit(limit + 40)} className="command-more">显示更多结果</CommandItem>}
      </CommandList><div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开阅读</span></div>
    </Command>
  </DialogContent></Dialog>;
}

function HelpDialog({open, setOpen}: {open: boolean; setOpen: (open: boolean) => void}) {
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="help-dialog"><DialogTitle>阅读与导航</DialogTitle><DialogDescription>知识库只读。浏览不会修改内容或记录复习。</DialogDescription><div className="help-content"><p>蓝色链接在后面打开一页，前文保留。来源链接会有蓝色标记；点击左侧书脊可以返回；窄屏或专注时使用上方路径与方向键。</p><p>点击笔记上方或搜索结果中的父级路径，可在上下文中定位原文。圆点在后文独立打开内容块，旁边的三角只展开或收起下级；圆点外的淡色圆环表示下级已折叠。引用与反向引用保留来源路径和完整原文，点击路径可回到上下文。目录图标跳到下级内容，双箭头统一展开或收起。</p><p>专注阅读只隐藏其他页面，退出后路径不变。浏览器后退会恢复之前的阅读分支、展开状态和位置。</p><dl><div><dt>搜索整个知识库</dt><dd><kbd>⌘ / Ctrl</kbd> <kbd>K</kbd></dd></div><div><dt>显示或隐藏目录</dt><dd><kbd>⌘ / Ctrl</kbd> <kbd>B</kbd></dd></div><div><dt>前一篇 / 后一篇</dt><dd><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>← / →</kbd></dd></div><div><dt>退出专注阅读 / 关闭浮层</dt><dd><kbd>Esc</kbd></dd></div><div><dt>打开这份说明</dt><dd><kbd>?</kbd></dd></div></dl><p className="help-footnote">右上角阅读设置可调整字号、复制路径、进入专注阅读和刷新知识库。字号只保存在当前设备。阅读位置与展开状态保留到本次会话结束。复制阅读路径可以重新打开同一组笔记，访问仍受私有权限保护。</p></div></DialogContent></Dialog>;
}

function ReaderWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panels, setPanels] = useState<Panel[]>([{kind: "index"}]);
  const [active, setActive] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const {font, fontSize, changeSize} = useReadingFont();
  const [copied, setCopied] = useState<number | null>(null);
  const [focused, setFocusState] = useState(false);
  const [restoringPath, setRestoringPath] = useState(true);
  const [stacked, setStacked] = useState<number[]>([]);
  const [now, setNow] = useState(0);
  const {open: sidebarOpen, setOpen: setSidebarOpen} = useSidebar();
  const sidebarBeforeFocus = useRef(true);
  const panelsRef = useRef(panels);
  const activeRef = useRef(active);
  const readingViews = useRef(new Map<string, ReadingView>());
  const scrollFrame = useRef<number | null>(null);
  const requestNumber = useRef(0);
  const stackRef = useRef<HTMLDivElement>(null);
  const sheetRefs = useRef(new Map<number, HTMLElement>());
  const model = useMemo(() => snapshot ? buildKnowledgeModel(snapshot) : null, [snapshot]);
  panelsRef.current = panels;
  activeRef.current = active;

  const setFocused = useCallback((value: boolean) => {
    if (value && !focused) {sidebarBeforeFocus.current = sidebarOpen; setSidebarOpen(false);}
    if (!value && focused) setSidebarOpen(sidebarBeforeFocus.current);
    setFocusState(value);
  }, [focused, sidebarOpen, setSidebarOpen]);

  const rememberActive = useCallback((index: number) => {
    activeRef.current = index; setActive(index);
    window.history.replaceState({...window.history.state, knowledgeReader: {active: index}}, "", window.location.href);
  }, []);

  const syncStackGeometry = useCallback(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const bounds = stack.getBoundingClientRect();
    const sheets = [...sheetRefs.current.entries()].sort((a, b) => a[0] - b[0]);
    const collapsed: number[] = [];
    let nextActive = activeRef.current;
    let greatestVisible = 0;
    const visibleWidths = new Map<number, number>();
    for (let i = 0; i < sheets.length; i++) {
      const [index, sheet] = sheets[i];
      if (sheet.offsetWidth === 0) continue;
      const rect = sheet.getBoundingClientRect();
      const next = sheets[i + 1]?.[1];
      const nextLeft = next?.offsetWidth ? next.getBoundingClientRect().left : bounds.right;
      const visible = Math.max(0, Math.min(rect.right, bounds.right, nextLeft) - Math.max(rect.left, bounds.left));
      visibleWidths.set(index, visible);
      if (!focused && getComputedStyle(sheet).position === "sticky" && visible <= readingSpineOffset(stack, 1) + 1 && rect.left < bounds.right && rect.right > bounds.left) collapsed.push(index);
      if (visible > greatestVisible) {greatestVisible = visible; nextActive = index;}
    }
    setStacked(current => current.join(",") === collapsed.join(",") ? current : collapsed);
    // 两页同时可读时保留用户选择，不让滚动事件抢走当前页。
    const current = sheetRefs.current.get(activeRef.current);
    if (current && (visibleWidths.get(activeRef.current) || 0) >= Math.min(current.offsetWidth, stack.clientWidth) - 3) return;
    if (greatestVisible > stack.clientWidth / 2 && nextActive !== activeRef.current) rememberActive(nextActive);
  }, [focused, rememberActive]);

  const activate = useCallback((index: number) => {
    if (index < 0 || index >= panelsRef.current.length) return;
    rememberActive(index);
    const stack = stackRef.current;
    const sheet = sheetRefs.current.get(index);
    if (!stack || !sheet || focused) return;
    // sticky 面板的 offsetLeft 随滚动变化；使用自然排列位置计算目标。
    let left = 0;
    for (let i = 0; i < index; i++) left += sheetRefs.current.get(i)?.offsetWidth || 0;
    const pinned = readingSpineOffset(stack, index);
    const right = left + sheet.offsetWidth;
    if (left < stack.scrollLeft + pinned) stack.scrollTo({left: Math.max(0, left - pinned), behavior: "instant"});
    else if (right > stack.scrollLeft + stack.clientWidth) stack.scrollTo({left: right - stack.clientWidth, behavior: "instant"});
  }, [focused, rememberActive]);

  const refresh = useCallback(async () => {
    const requestId = ++requestNumber.current;
    setRefreshing(true); setError(null);
    try {
      const response = await fetch("/api/snapshot", {cache: "no-store", signal: AbortSignal.timeout(90000)});
      if (!response.ok) throw new Error("无法读取知识库");
      const next: Snapshot = await response.json();
      if (!Array.isArray(next.bullets) || !Array.isArray(next.fsrs) || !Array.isArray(next.references)) throw new Error("知识数据不可用");
      if (requestId !== requestNumber.current) return;
      setSnapshot(next); setNow(Date.now());
    } catch {
      if (requestId === requestNumber.current) setError("暂时无法读取知识库。已打开的内容仍可阅读，请稍后重试。");
    } finally {
      if (requestId === requestNumber.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const restorePath = () => {
      setRestoringPath(true);
      const restored = readPanels(new URL(window.location.href));
      const savedActive = window.history.state?.knowledgeReader?.active;
      const index = Number.isInteger(savedActive) && savedActive >= 0 && savedActive < restored.length ? savedActive : restored.length - 1;
      panelsRef.current = restored; activeRef.current = index;
      setPanels(restored); setActive(index);
    };
    restorePath();

    const scrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    void refresh();
    window.addEventListener("popstate", restorePath);
    const updateClock = () => {if (document.visibilityState === "visible") setNow(Date.now());};
    document.addEventListener("visibilitychange", updateClock);
    const clock = window.setInterval(updateClock, 60000);
    return () => {
      window.removeEventListener("popstate", restorePath); document.removeEventListener("visibilitychange", updateClock);
      window.clearInterval(clock); window.history.scrollRestoration = scrollRestoration; requestNumber.current++;
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, [refresh]);

  const commitPath = useCallback((next: Panel[], index: number) => {
    setRestoringPath(false);
    panelsRef.current = next; activeRef.current = index;
    setPanels(next); setActive(index);
    window.history.pushState({...window.history.state, knowledgeReader: {active: index}}, "", readingUrl(next));
  }, []);

  const navigate: Navigate = useCallback((target, from) => {
    if (from === undefined) {
      const existing = panelsRef.current.findIndex(panel => panelKey(panel) === panelKey(target));
      if (existing >= 0) {activate(existing); return;}
      commitPath([target], 0);
      return;
    }
    const next = followPanel(panelsRef.current, from, target);
    if (next.panels !== panelsRef.current) commitPath(next.panels, next.active);
    else activate(next.active);
  }, [activate, commitPath]);

  const closePanel = useCallback((index: number) => {
    const next = panelsRef.current.slice(0, index);
    if (!next.length) next.push({kind: "index"});
    commitPath(next, next.length - 1);
  }, [commitPath]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {activate(activeRef.current); syncStackGeometry();});
    return () => cancelAnimationFrame(frame);
  }, [panels, model, focused, activate, syncStackGeometry]);

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const observer = new ResizeObserver(() => {activate(activeRef.current); syncStackGeometry();});
    observer.observe(stack);
    return () => observer.disconnect();
  }, [activate, syncStackGeometry]);

  useEffect(() => {if (model && panels[active]) document.title = panelTitle(panels[active], model) + " · 知识库";}, [model, panels, active]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {event.preventDefault(); setSearchOpen(open => !open); return;}
      if (event.defaultPrevented || target.closest("input, textarea, [contenteditable=true], [role=dialog], [data-slot=popover-content]") || searchOpen || helpOpen) return;
      if (event.key === "?") {event.preventDefault(); setHelpOpen(true);}
      if (event.key === "Escape" && focused) {event.preventDefault(); setFocused(false);}
      if (event.ctrlKey && event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {event.preventDefault(); activate(active + (event.key === "ArrowLeft" ? -1 : 1));}
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, searchOpen, helpOpen, focused, setFocused, activate]);


  const copyLink = async (index: number) => {
    try {
      await navigator.clipboard.writeText(new URL(readingUrl(panels.slice(0, index + 1)), window.location.origin).href);
      setCopied(index); toast.success("已复制阅读路径", {description: "包含到这一篇为止的笔记，仍只有你能访问。"});
      window.setTimeout(() => setCopied(null), 2000);
    } catch {toast.error("无法自动复制", {description: "请复制浏览器地址栏中的地址。"});}
  };

  return <div className="knowledge-app">
    <a className="skip-link" href="#reading-content" onClick={event => {event.preventDefault(); sheetRefs.current.get(active)?.querySelector<HTMLElement>(".sheet-scroll")?.focus();}}>跳到阅读内容</a>
    <ReaderNavigation {...{model, panels, active, navigate}}/>
    <main className="reader-main" id="reading-content">
      <ReadingHeader {...{panels, active, model, activate, navigate, font, changeSize, focused, setFocused, refreshing, error}} search={() => setSearchOpen(true)} size={fontSize} copy={() => void copyLink(active)} copied={copied === active} refresh={() => void refresh()} fetchedAt={snapshot?.fetched_at} help={() => setHelpOpen(true)}/>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void refresh()} disabled={refreshing}>重新连接</button></div>}
      <div ref={stackRef} className="reading-stack" data-count={panels.length} data-focus={focused} onScroll={() => {
        if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = requestAnimationFrame(syncStackGeometry);
      }}>
        {!model ? <section className="initial-state">{refreshing ? <><h1>正在打开知识库…</h1><Skeleton className="loading-title"/><Skeleton/><Skeleton/><Skeleton className="loading-short"/></> : <EmptyState title="知识库暂时无法打开">请稍后重新连接。</EmptyState>}</section> : panels.map((panel, index) => {
          const viewKey = JSON.stringify(panels.slice(0, index + 1).map(panelKey));
          return <article key={viewKey} ref={element => {if (element) sheetRefs.current.set(index, element); else sheetRefs.current.delete(index);}} className="reading-sheet" data-active={index === active} data-stacked={stacked.includes(index)} aria-label={panelTitle(panel, model)} onPointerDown={() => {if (activeRef.current !== index) rememberActive(index);}} onFocusCapture={() => {if (activeRef.current !== index) rememberActive(index);}} style={{"--sheet-index": index} as CSSProperties}>
            <button className="sheet-spine" tabIndex={stacked.includes(index) ? 0 : -1} aria-hidden={!stacked.includes(index)} onClick={() => activate(index)} title={panelTitle(panel, model)}><span>{index + 1}</span><span>{panelTitle(panel, model)}</span></button>
            {index > 0 && <div className="sheet-actions"><IconButton label="收起此篇及后面的阅读分支" onClick={() => closePanel(index)}><X/></IconButton></div>}
            <ReadingViewProvider key={viewKey} viewKey={viewKey} cache={readingViews.current} nextPanel={panels[index + 1]} visible={!focused || index === active}>
              {panel.kind === "index" && <IndexPage {...{model, navigate}} from={index}/>}
              {panel.kind === "bullet" && <BulletPage panel={panel} {...{model, navigate}} restorePosition={restoringPath && readingViews.current.has(viewKey)} from={index}/>}
              {(panel.kind === "all" || panel.kind === "tag") && <BulletListPage {...{model, navigate}} from={index} tag={panel.kind === "tag" ? panel.tag : undefined}/>}
              {panel.kind === "memory" && <MemoryListPage {...{model, navigate, now}} from={index}/>}
              {panel.kind === "fsrs" && <MemoryPage id={panel.id} {...{model, navigate, now}} from={index}/>}
            </ReadingViewProvider>
          </article>;
        })}
      </div>

    </main>
    <SearchDialog open={searchOpen} setOpen={setSearchOpen} {...{model, navigate, active}}/>
    <HelpDialog open={helpOpen} setOpen={setHelpOpen}/>
    <Toaster position="bottom-center" theme="light"/>
  </div>;
}

export default function KnowledgeReader() {
  return <SidebarProvider defaultOpen={false} className="reader-provider"><ReaderWorkspace/></SidebarProvider>;
}
