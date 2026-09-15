"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, BrainCircuit, ChartNoAxesCombined, ChevronLeft, ChevronRight, FileText, Filter, Gauge, GitBranch, Hash, History, Layers3, RefreshCw, Timer, Type, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { IconButton } from "@/components/reader-presentation/icon-button";
import { ROOT_LABELS } from "@/components/reader-presentation/page-content/model";
import { useReadingView } from "@/components/reading-view";
import { bulletTitle, memoryCueTitle, readingUrl } from "@/lib/reading-path";
import type { Panel, Snapshot } from "@/lib/knowledge-types";
import { ALL_KNOWLEDGE, calendarDay, contentDistribution, frequentLapses, knowledgeTimeline, memoryDistribution, memoryStages, reviewCalendar, reviewBacklog, selectStatistics, type DistributionKind, type KnowledgeDay, type KnowledgeHistory, type ReviewDay, type StatisticsScope } from "./statistics-model";
import { parseStatisticsHistory } from "./statistics-history";
import { ChartSection, DailyLineChart, DistributionChart, ReviewHeatmap, formatCount, percentage } from "./statistics-charts";

export type StatisticsViewState = StatisticsScope & { distribution: DistributionKind; growth: "total" | "characters" | "changes"; content: "count" | "characters"; reviewYear?: number };
const initialView: StatisticsViewState = { ...ALL_KNOWLEDGE, distribution: "retrievability", growth: "total", content: "count" };
type Detail = { kind: "bullet" | "fsrs" | "review" | "calendar" | "tags" | "references" | "history"; title: string; ids: string[]; day?: KnowledgeDay; reviewDay?: ReviewDay };
const RATINGS = ["Again", "Hard", "Good", "Easy"];
const RATING_KEYS = ["again", "hard", "good", "easy"];
const DISTRIBUTIONS: { key: DistributionKind; title: string; icon: ReactNode; unit: string; help: string }[] = [
  { key: "retrievability", title: "可提取性", icon: <BrainCircuit />, unit: "%", help: "FSRS 估计的当前回忆概率。尚未首次复习的对象不参与估计；虚线表示累计对象比例。" },
  { key: "stability", title: "稳定性", icon: <Layers3 />, unit: "天", help: "回忆概率下降到 90% 所需的天数。区间左闭右开；最后一个区间包含所有更大值。" },
  { key: "difficulty", title: "难度", icon: <Gauge />, unit: "难度 1–10", help: "FSRS 估计的记忆难度，范围 1–10。较高难度通常意味着成功复习后稳定性增长较慢。" },
  { key: "interval", title: "调度间隔", icon: <Timer />, unit: "天", help: "当前到期时间与最后复习时间之间的间隔，包含学习和重新学习步骤。尚未首次复习的对象单独计数。" },
];

function SummaryValue({ icon, label, value, onClick, help }: { icon: ReactNode; label: string; value: number; onClick: () => void; help?: string }) {
  return <div className="statistics-summary-item"><dt>{icon}<span>{label}</span></dt><dd><button type="button" onClick={onClick} title={help || "查看" + label} aria-label={label + " " + formatCount(value) + "，查看明细"}>{formatCount(value)}</button></dd></div>;
}

export function StatisticsPage({ snapshot, now: suppliedNow, navigate, from }: {
  snapshot: Snapshot; now: number; navigate: (panel: Panel, from?: number) => void; from: number;
}) {
  const { view, updateView } = useReadingView();
  const settings = view.statistics || initialView;
  const change = (patch: Partial<StatisticsViewState>) => updateView({ statistics: { ...settings, ...patch } });
  const scope = useMemo<StatisticsScope>(() => ({ rootId: settings.rootId, tag: settings.tag }), [settings.rootId, settings.tag]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const now = suppliedNow || Date.parse(snapshot.fetched_at);
  const today = calendarDay(now, timeZone), currentYear = Number(today.slice(0, 4));
  const reviewYear = settings.reviewYear ?? currentYear;
  const [history, setHistory] = useState<KnowledgeHistory | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const selected = useMemo(() => selectStatistics(snapshot, scope), [snapshot, scope]);
  const groups = useMemo(() => contentDistribution(snapshot, scope).sort((a, b) => settings.content === "characters" ? b.characters - a.characters : b.count - a.count), [snapshot, scope, settings.content]);
  const recordedReviews = useMemo(() => selected.reviews.filter(review => Date.parse(review.review_datetime) <= now), [selected.reviews, now]);
  const calendar = useMemo(() => reviewCalendar(selected.reviews, selected.fsrs, now, timeZone, reviewYear), [selected.reviews, selected.fsrs, now, timeZone, reviewYear]);
  const backlog = useMemo(() => reviewBacklog(selected.fsrs, now, timeZone), [selected.fsrs, now, timeZone]);
  const stages = useMemo(() => memoryStages(selected.fsrs), [selected.fsrs]);
  const distribution = useMemo(() => memoryDistribution(selected.fsrs, snapshot.scheduler_configs, settings.distribution, now), [selected.fsrs, snapshot.scheduler_configs, settings.distribution, now]);
  const timeline = useMemo(() => history ? knowledgeTimeline(history, scope, timeZone) : [], [history, scope, timeZone]);
  const lapses = useMemo(() => frequentLapses(selected.fsrs, selected.reviews, now), [selected.fsrs, selected.reviews, now]);
  const bullets = useMemo(() => new Map(snapshot.bullets.map(bullet => [bullet.id, bullet])), [snapshot.bullets]);
  const cards = useMemo(() => new Map(snapshot.fsrs.map(card => [card.id, card])), [snapshot.fsrs]);
  const allTags = useMemo(() => [...new Set(snapshot.effective_tags.map(tag => tag.tag))].sort(), [snapshot.effective_tags]);
  const rootTitle = scope.rootId ? bulletTitle(bullets.get(scope.rootId)?.body || "笔记 #" + scope.rootId, 65) : "全部知识";
  const kind = DISTRIBUTIONS.find(item => item.key === settings.distribution)!;
  const ratings = calendar.reduce((sum, day) => sum.map((value, index) => value + day.ratings[index]), [0, 0, 0, 0]);
  const reviewedDays = calendar.filter(day => day.count > 0);
  const retentionDays = reviewedDays.length ? calendar.filter(day => day.day >= reviewedDays[0].day && day.day <= today) : [];
  const targetValues = snapshot.scheduler_configs.filter(config => selected.fsrs.some(card => card.scheduler_config_id === config.id))
    .map(config => Number(config.scheduler.desired_retention)).filter(value => Number.isFinite(value) && value > 0 && value <= 1);
  const target = targetValues.length ? { low: Math.min(...targetValues), high: Math.max(...targetValues) } : undefined;

  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true); setHistoryError(false);
    fetch("/api/statistics/history", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Statistics history unavailable");
      return parseStatisticsHistory(await response.json());
    }).then(value => { if (!controller.signal.aborted) setHistory(value); })
      .catch(() => { if (!controller.signal.aborted) setHistoryError(true); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [snapshot.fetched_at, retry]);

  const openCards = (title: string, ids: string[]) => setDetail({ title, kind: "fsrs", ids });
  const openBullets = (title: string, ids: string[]) => setDetail({ title, kind: "bullet", ids });
  const follow = (panel: Panel) => { setDetail(null); navigate(panel, from); };
  const renderCards = (ids: string[]) => <ul>{ids.map(id => <li key={id}><a href={readingUrl([{ kind: "fsrs", id }])} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); follow({ kind: "fsrs", id }); }}>{cards.get(id) ? memoryCueTitle(cards.get(id)!.cue) : "记忆对象 #" + id}<ArrowUpRight /></a><small>{cards.get(id)?.last_review_at === null && "首次复习 · "}{cards.get(id)?.due_at && new Date(cards.get(id)!.due_at).toLocaleString("zh-CN", { timeZone })}</small></li>)}</ul>;
  const renderReviews = (ids: string[]) => <ul>{snapshot.fsrs_review.filter(review => ids.includes(review.id)).sort((a, b) => Date.parse(b.review_datetime) - Date.parse(a.review_datetime)).map(review => <li key={review.id}><div className="statistics-review-meta"><i data-rating={RATING_KEYS[review.rating - 1]} /><strong>{RATINGS[review.rating - 1]}</strong><time>{new Date(review.review_datetime).toLocaleString("zh-CN", { timeZone })}</time></div><a href={readingUrl([{ kind: "fsrs", id: review.fsrs_id }])} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); follow({ kind: "fsrs", id: review.fsrs_id }); }}>{cards.get(review.fsrs_id) ? memoryCueTitle(cards.get(review.fsrs_id)!.cue) : "记忆对象 #" + review.fsrs_id}<ArrowUpRight /></a></li>)}</ul>;
  const historyHelp = <><p>每日结束时的笔记数量或字符数；今天取当前记录。日期明细列出当天的变更，新增、修改、删除各自按节点去重。目录与标签按当时状态筛选。</p><p>{history?.coverage_start ? "记录始于 " + new Date(history.coverage_start).toLocaleString("zh-CN", { timeZone }) : "从已有变更记录开始展示。"}</p></>;
  const growthSeries = settings.growth === "changes" ? [
    { key: "added" as const, label: "新增", color: "var(--site-added)" },
    { key: "modified" as const, label: "修改", color: "var(--site-modified)", dash: "4 3" },
    { key: "removed" as const, label: "删除", color: "var(--site-removed)", dash: "2 3" },
  ] : [{ key: settings.growth, label: settings.growth === "total" ? "笔记" : "正文字符", color: "var(--site-link)" }];

  return <div className="knowledge-statistics">
    <div className="statistics-page-heading"><h1 className="index-title">统计</h1><div className="statistics-scope">
      {scope.rootId && <IconButton label="返回上级统计" onClick={() => change({ rootId: bullets.get(scope.rootId!)?.parent_id || null })}><ArrowLeft /></IconButton>}
      <span title={rootTitle}>{ROOT_LABELS[rootTitle] || rootTitle}</span>{scope.tag && <span className="statistics-scope-tag">#{scope.tag}</span>}
      <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><button type="button" className="icon-button" aria-label="筛选统计范围" title="筛选统计范围" aria-pressed={!!(scope.rootId || scope.tag)}><Filter /></button></PopoverTrigger><PopoverContent className="statistics-filter" align="end">
        <label>目录<select value={scope.rootId || ""} onChange={event => change({ rootId: event.target.value || null })}><option value="">全部知识</option>{snapshot.bullets.filter(bullet => bullet.depth <= 2 || bullet.id === scope.rootId).map(bullet => <option key={bullet.id} value={bullet.id}>{"　".repeat(Math.min(bullet.depth, 3)) + (ROOT_LABELS[bullet.body.trim()] || bulletTitle(bullet.body, 65))}</option>)}</select></label>
        <label>标签<select value={scope.tag || ""} onChange={event => change({ tag: event.target.value || null })}><option value="">全部标签</option>{allTags.map(tag => <option key={tag}>{tag}</option>)}</select></label>
        <div className="statistics-filter-footer"><small>{timeZone}</small><IconButton label="清除统计筛选" disabled={!scope.rootId && !scope.tag} onClick={() => { change(ALL_KNOWLEDGE); setFilterOpen(false); }}><X /></IconButton></div>
      </PopoverContent></Popover>
    </div></div>

    <dl className="statistics-summary">
      <SummaryValue icon={<FileText />} label="笔记" value={selected.bullets.length} onClick={() => openBullets("笔记", [...selected.bulletIds])} />
      <SummaryValue icon={<Type />} label="正文字符" value={selected.characters} onClick={() => openBullets("正文字符 · 从多到少", [...selected.bullets].sort((a, b) => Array.from(b.body).length - Array.from(a.body).length).map(bullet => bullet.id))} help="按 Unicode 码点计数，包含空白和 Markdown 标记" />
      <SummaryValue icon={<GitBranch />} label="引用" value={selected.references.length} onClick={() => setDetail({ kind: "references", title: "笔记引用", ids: [] })} help="所选笔记发出的直接引用" />
      <SummaryValue icon={<Hash />} label="标签" value={selected.tagNames.length} onClick={() => setDetail({ kind: "tags", title: "有效标签", ids: selected.tagNames })} />
      <SummaryValue icon={<BrainCircuit />} label="记忆对象" value={selected.fsrs.length} onClick={() => openCards("记忆对象", [...selected.fsrsIds])} />
      <SummaryValue icon={<History />} label="累计复习" value={recordedReviews.length} onClick={() => setDetail({ kind: "review", title: "累计复习", ids: recordedReviews.map(review => review.id) })} />
    </dl>

    <ChartSection title="知识变化" help={historyHelp} controls={<div className="statistics-mode-controls" role="group" aria-label="知识变化指标">
      <IconButton label="每日笔记总数" aria-pressed={settings.growth === "total"} onClick={() => change({ growth: "total" })}><FileText /></IconButton>
      <IconButton label="每日正文字符数" aria-pressed={settings.growth === "characters"} onClick={() => change({ growth: "characters" })}><Type /></IconButton>
      <IconButton label="每日新增、修改与删除" aria-pressed={settings.growth === "changes"} onClick={() => change({ growth: "changes" })}><History /></IconButton>
    </div>}>
      {historyError && <div className="statistics-inline-status" role="status"><span>{history ? "显示上次读取的变化记录" : "暂时无法读取变化记录"}</span><IconButton label="重新读取变化记录" disabled={historyLoading} onClick={() => setRetry(value => value + 1)}><RefreshCw /></IconButton></div>}
      {history ? <DailyLineChart data={timeline} series={growthSeries} label="知识逐日变化折线图" empty="尚无知识变更记录" onSelect={day => setDetail({ kind: "history", title: day.day + " · 知识变化", ids: [], day })} /> : !historyError && <div className="statistics-chart-empty" aria-busy={historyLoading}>{historyLoading ? "正在读取变化记录…" : "尚无知识变更记录"}</div>}
    </ChartSection>

    <ChartSection title="内容分布" help="按下级目录汇总。蓝色部分表示已关联 FSRS 的笔记；点击一行继续查看该目录。" controls={<div className="statistics-mode-controls" role="group" aria-label="内容分布指标"><IconButton label="按笔记数量" aria-pressed={settings.content === "count"} onClick={() => change({ content: "count" })}><FileText /></IconButton><IconButton label="按正文字符数" aria-pressed={settings.content === "characters"} onClick={() => change({ content: "characters" })}><Type /></IconButton></div>}>
      {settings.content === "count" && <div className="statistics-legend"><span><i className="statistics-bar-key" />已关联 FSRS</span><span><i className="statistics-uncovered-key" />未关联</span></div>}
      <div className="statistics-content-distribution">{groups.map(group => {
        const maximum = Math.max(1, ...groups.map(item => settings.content === "count" ? item.count : item.characters));
        const value = settings.content === "count" ? group.count : group.characters;
        return <button type="button" className="statistics-content-row" key={group.bullet.id} title={bulletTitle(group.bullet.body, 500)} onClick={() => group.bullet.id === scope.rootId ? openBullets("目录中的笔记", group.ids) : change({ rootId: group.bullet.id })}>
          <span className="statistics-content-label">{ROOT_LABELS[group.bullet.body.trim()] || bulletTitle(group.bullet.body, 110)}</span>
          <span className="statistics-content-track"><span className="statistics-content-bar" style={{ width: value / maximum * 100 + "%" }}><span style={{ width: (settings.content === "count" ? group.covered / group.count : 1) * 100 + "%" }} /></span></span>
          <span className="statistics-content-value">{formatCount(value)}</span><ChevronRight />
        </button>;
      })}{!groups.length && <div className="statistics-small-empty">此范围暂无笔记</div>}</div>
    </ChartSection>

    <ChartSection title="每日复习" help={<><p>固定显示所选自然年。蓝色计实际评分次数，灰色计当前安排的待复习对象（含首复）；今天的格子分成两色。点选日期查看明细，点击年份回到今年。</p><p>未来每个对象只计当前的下一次到期，复习后随安排更新。今天以前到期的对象单独汇总在下方。</p><a href="https://github.com/glutanimate/review-heatmap/wiki/Use" target="_blank" rel="noreferrer">Review Heatmap ↗</a></>} controls={<div className="statistics-calendar-year" role="group" aria-label="复习日历年份">
      <IconButton label="上一年" disabled={reviewYear <= 1} onClick={() => change({ reviewYear: reviewYear - 1 })}><ChevronLeft /></IconButton>
      <button type="button" disabled={reviewYear === currentYear} title={"返回今年（" + currentYear + "）"} aria-label={"返回今年（" + currentYear + "）"} onClick={() => change({ reviewYear: undefined })}>{reviewYear}</button>
      <IconButton label="下一年" disabled={reviewYear >= 9999} onClick={() => change({ reviewYear: reviewYear + 1 })}><ChevronRight /></IconButton>
    </div>}>
      <ReviewHeatmap key={reviewYear} days={calendar} today={today} onSelect={day => setDetail(day.day === today
        ? { kind: "calendar", title: day.day + " · 今天", ids: [], reviewDay: day }
        : day.day > today ? { kind: "fsrs", title: day.day + " · 待复习", ids: day.pendingIds }
        : { kind: "review", title: day.day + " · 已复习", ids: day.reviewIds })} />
      {reviewYear === currentYear && (backlog.ids.length > 0 || backlog.newIds.length > 0) && <div className="statistics-backlog">
        {backlog.ids.length > 0 && <div><button type="button" aria-label="查看今天以前到期的复习对象" onClick={() => openCards("今天以前到期 · 复习", backlog.ids)}><strong>{formatCount(backlog.ids.length)}</strong><span>逾期复习</span></button><div className="statistics-backlog-bars">{backlog.overdueBins.map(bin => <button type="button" key={bin.label} disabled={!bin.ids.length} style={{ flex: Math.max(1, bin.ids.length) }} title={bin.label + " · " + bin.ids.length + " 个"} aria-label={"逾期 " + bin.label + "，" + bin.ids.length + " 个"} onClick={() => openCards("逾期 · " + bin.label, bin.ids)}><span /></button>)}</div></div>}
        {backlog.newIds.length > 0 && <button type="button" className="statistics-new-backlog" title="今天以前已到期、尚未首次复习" onClick={() => openCards("今天以前到期 · 待首复", backlog.newIds)}><strong>{formatCount(backlog.newIds.length)}</strong><span>待首复</span></button>}
      </div>}
    </ChartSection>

    <div className="statistics-two-columns">
      <ChartSection title="复习阶段" help="未首复单独计数；其他对象按 FSRS 的学习、复习、重新学习状态分类。">
        <div className="statistics-stage-chart" aria-label="记忆对象的阶段分布">{stages.filter(stage => stage.ids.length).map(stage => <button type="button" key={stage.key} data-stage={stage.key} style={{ flex: stage.ids.length }} title={stage.label + " " + stage.ids.length + " 个"} aria-label={stage.label + " " + stage.ids.length + " 个，查看对象"} onClick={() => openCards(stage.label, stage.ids)} />)}</div>
        <dl className="statistics-stage-legend">{stages.map(stage => <div key={stage.key}><dt><i data-stage={stage.key} />{stage.label}</dt><dd>{formatCount(stage.ids.length)}</dd></div>)}</dl>
      </ChartSection>
      <ChartSection title="评分分布" help="与上方年历使用相同年份的实际复习记录。Again 表示未能回忆；Hard、Good、Easy 表示成功回忆。" controls={<span className="statistics-year-caption">{reviewYear}</span>}>
        <div className="statistics-rating-chart">{ratings.map((count, index) => <div className="statistics-rating-column" key={index}><span>{formatCount(count)}</span><button type="button" data-rating={RATING_KEYS[index]} style={{ "--rating-fraction": count / Math.max(1, ...ratings) } as CSSProperties} aria-label={RATINGS[index] + " " + count + " 次，查看评分记录"} disabled={!count} onClick={() => setDetail({ kind: "review", title: reviewYear + " · " + RATINGS[index], ids: recordedReviews.filter(review => review.rating === index + 1 && Number(calendarDay(review.review_datetime, timeZone).slice(0, 4)) === reviewYear).map(review => review.id) })} /><small>{RATINGS[index]}</small></div>)}</div>
      </ChartSection>
    </div>

    <ChartSection title="真实保留率" controls={<span className="statistics-year-caption">{reviewYear}</span>} help={<><p>使用年历所选年份。每个对象每天只取第一次复习，且距上次复习至少 24 小时。Hard、Good、Easy 计成功；没有样本的日期留空。</p><p>目标线来自当前调度配置；日期明细显示成功数和样本数。<a href="https://docs.ankiweb.net/stats.html#true-retention-table" target="_blank" rel="noreferrer">Anki 统计说明 ↗</a></p></>}>
      <DailyLineChart data={retentionDays} series={[{ key: "retention", label: "成功回忆", color: "var(--site-link)" }]} label="每日真实保留率折线图" rate target={target} empty="尚无符合条件的跨日复习记录" describe={day => day.recalled + " / " + day.tested + " 次"} onSelect={day => setDetail({ kind: "review", title: day.day + " · 跨日首次复习", ids: day.retentionReviewIds })} />
    </ChartSection>

    <ChartSection title={kind.title} help={<><p>{kind.help}</p><a href="https://docs.ankiweb.net/stats.html#card-stability" target="_blank" rel="noreferrer">FSRS 统计说明 ↗</a></>} controls={<div className="statistics-mode-controls" role="group" aria-label="记忆状态指标">{DISTRIBUTIONS.map(item => <IconButton key={item.key} label={item.title} aria-pressed={item.key === settings.distribution} onClick={() => change({ distribution: item.key })}>{item.icon}</IconButton>)}</div>}>
      <div className="statistics-distribution-summary">{distribution.median !== null && <span>{settings.distribution === "retrievability" ? "平均" : "中位数"}<strong>{settings.distribution === "retrievability" ? percentage(distribution.mean!) : distribution.median.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}</strong>{settings.distribution === "stability" || settings.distribution === "interval" ? "天" : ""}</span>}{distribution.unmeasured > 0 && <span className="statistics-unmeasured">未估计 {formatCount(distribution.unmeasured)}</span>}</div>
      <DistributionChart bins={distribution.bins} label={kind.title + "分布"} unit={kind.unit} onSelect={bin => openCards(kind.title + " · " + bin.label + " " + kind.unit, bin.ids)} />
    </ChartSection>

    {lapses.length > 0 && <ChartSection title="反复遗忘" help="至少出现过两次 Again，按次数排列。打开复习线索可查看关联知识和完整复习历史。"><div className="statistics-lapses">{lapses.map(item => <a key={item.card.id} href={readingUrl([{ kind: "fsrs", id: item.card.id }])} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); follow({ kind: "fsrs", id: item.card.id }); }}><span>{memoryCueTitle(item.card.cue)}</span><span className="statistics-lapse-count" aria-label={item.count + " 次 Again"}>{item.count}</span><ArrowUpRight /></a>)}</div></ChartSection>}

    <Sheet open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><SheetContent className="statistics-details" showCloseButton={false}>
      <SheetHeader><SheetTitle>{detail?.title}</SheetTitle><SheetDescription className="sr-only">统计明细。选择知识或复习线索，在阅读路径中打开。</SheetDescription><SheetClose asChild><IconButton label="关闭统计明细"><X /></IconButton></SheetClose></SheetHeader>
      <div className="statistics-detail-content">
        {detail?.kind === "bullet" && <ul>{detail.ids.map(id => <li key={id}><a href={readingUrl([{ kind: "bullet", id }])} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); follow({ kind: "bullet", id }); }}>{bulletTitle(bullets.get(id)?.body || "笔记 #" + id, 200)}<ArrowUpRight /></a></li>)}</ul>}
        {detail?.kind === "fsrs" && renderCards(detail.ids)}
        {detail?.kind === "review" && renderReviews(detail.ids)}
        {detail?.kind === "calendar" && detail.reviewDay && <div className="statistics-calendar-detail">
          <h3>已复习 <span>{formatCount(detail.reviewDay.count)} 次 · {detail.reviewDay.objectIds.length} 个对象</span></h3>
          {detail.reviewDay.count ? renderReviews(detail.reviewDay.reviewIds) : <div className="statistics-small-empty">今天还没有复习记录</div>}
          <h3>待复习 <span>{formatCount(detail.reviewDay.pendingIds.length)} 个{detail.reviewDay.firstReviewIds.length > 0 && " · 含首复 " + detail.reviewDay.firstReviewIds.length + " 个"}</span></h3>
          {detail.reviewDay.pendingIds.length ? renderCards(detail.reviewDay.pendingIds) : <div className="statistics-small-empty">今天没有待复习安排</div>}
        </div>}
        {detail?.kind === "tags" && <ul>{detail.ids.map(tag => <li key={tag}><a href={readingUrl([{ kind: "tag", tag }])} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); follow({ kind: "tag", tag }); }}>#{tag}<ArrowUpRight /></a></li>)}</ul>}
        {detail?.kind === "references" && <ul>{selected.references.map(link => <li key={link.source_bullet_id + ":" + link.target_bullet_id}><span>{bulletTitle(bullets.get(link.source_bullet_id)?.body || "笔记 #" + link.source_bullet_id, 100)}</span><a href={readingUrl([{ kind: "bullet", id: link.target_bullet_id }])} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); follow({ kind: "bullet", id: link.target_bullet_id }); }}><GitBranch />{bulletTitle(bullets.get(link.target_bullet_id)?.body || "笔记 #" + link.target_bullet_id, 160)}<ArrowUpRight /></a></li>)}</ul>}
        {detail?.kind === "history" && detail.day && <>{(["added", "modified", "removed"] as const).map((operation, index) => <div className="statistics-history-group" key={operation}><h3 data-operation={operation}>{["新增", "修改", "删除"][index]} <span>{detail.day![operation]}</span></h3><ul>{detail.day![(operation + "Ids") as "addedIds" | "modifiedIds" | "removedIds"].map(id => <li key={id}>{bullets.has(id) ? <a href={readingUrl([{ kind: "bullet", id }])} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); follow({ kind: "bullet", id }); }}>{bulletTitle(bullets.get(id)!.body, 180)}<ArrowUpRight /></a> : <span className="statistics-deleted-note">笔记 #{id} · 已删除</span>}</li>)}</ul></div>)}</>}
        {detail && detail.kind !== "history" && detail.kind !== "references" && detail.kind !== "calendar" && detail.ids.length === 0 && <div className="statistics-small-empty">没有符合条件的记录</div>}
        {detail?.kind === "references" && !selected.references.length && <div className="statistics-small-empty">此范围暂无引用</div>}
      </div>
    </SheetContent></Sheet>
  </div>;
}
