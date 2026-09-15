"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DistributionBin, ReviewDay } from "./statistics-model";

export const formatCount = (value: number) => value.toLocaleString("zh-CN");
export const shortDate = (day: string) => day.slice(5).replace("-", "/");
export const percentage = (value: number) => (value * 100).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "%";

export function ChartSection({ title, help, controls, children, className = "" }: {
  title: string; help?: ReactNode; controls?: ReactNode; children: ReactNode; className?: string;
}) {
  const id = useId();
  return <section className={"statistics-section " + className} aria-labelledby={id}>
    <div className="statistics-section-heading"><h2 id={id}>{title}</h2>
      {help && <Tooltip><TooltipTrigger asChild><button type="button" className="icon-button statistics-help" aria-label={title + "的统计说明"}><CircleHelp /></button></TooltipTrigger><TooltipContent className="statistics-help-content" side="top">{help}</TooltipContent></Tooltip>}
      {controls && <div className="statistics-chart-controls">{controls}</div>}
    </div>{children}
  </section>;
}

type Series<T> = { key: Extract<keyof T, string>; label: string; color: string; dash?: string };
function pointerIndex(state: unknown): number | null {
  if (!state || typeof state !== "object" || !("activeTooltipIndex" in state)) return null;
  const raw = state.activeTooltipIndex;
  if (raw === null || raw === undefined) return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function DailyLineChart<T extends { day: string }>({ data, series, label, onSelect, rate = false, target, empty, describe }: {
  data: T[]; series: Series<T>[]; label: string; onSelect: (row: T) => void; rate?: boolean;
  target?: { low: number; high: number }; empty?: string; describe?: (row: T) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const selected = active !== null ? data[active] : null;
  const hasValues = data.some(row => series.some(item => typeof row[item.key] === "number"));
  const maximum = data.reduce((max, row) => Math.max(max, ...series.map(item => typeof row[item.key] === "number" ? Number(row[item.key]) : 0)), 0);
  const smallCountMaximum = Math.max(1, Math.ceil(maximum));
  const format = rate ? percentage : formatCount;
  const pointDescription = (row: T) => row.day + "，" + series.map(item => item.label + " " + (typeof row[item.key] === "number" ? format(Number(row[item.key])) : "无样本")).join("，") + (describe ? "，" + describe(row) : "");
  const activate = (index: number | null) => setActive(index !== null && index < data.length ? index : null);
  return <div className="statistics-line-block">
    <div className="statistics-legend">{series.map(item => <span key={item.key}><i style={{ "--series-color": item.color, borderTopStyle: item.dash ? "dashed" : "solid" } as CSSProperties} />{item.label}</span>)}{target && <span><i className="statistics-target-key" />当前目标{target.low === target.high ? " " + percentage(target.low) : "范围"}</span>}</div>
    {!hasValues ? <div className="statistics-chart-empty">{empty || "暂无记录"}</div> : <>
      <div className="statistics-chart statistics-line-chart" tabIndex={0} role="group" aria-label={label + "；左右方向键选择日期，回车查看明细"}
        onFocus={() => activate(data.length - 1)} onBlur={() => activate(null)}
        onKeyDown={event => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); activate(Math.max(0, Math.min(data.length - 1, (active ?? data.length - 1) + (event.key === "ArrowLeft" ? -1 : 1)))); }
          if (event.key === "Home" || event.key === "End") { event.preventDefault(); activate(event.key === "Home" ? 0 : data.length - 1); }
          if ((event.key === "Enter" || event.key === " ") && selected) { event.preventDefault(); onSelect(selected); }
        }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={data} accessibilityLayer={false} margin={{ top: 12, right: 12, bottom: 6, left: -12 }}
            onMouseMove={state => activate(pointerIndex(state))} onMouseLeave={() => activate(null)}
            onClick={state => { const index = pointerIndex(state); if (index !== null && data[index]) { activate(index); onSelect(data[index]); } }}>
            <CartesianGrid vertical={false} stroke="var(--site-line)" strokeDasharray="2 5" />
            <XAxis dataKey="day" tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={32} stroke="var(--site-muted)" />
            <YAxis tickFormatter={format} domain={rate ? [0, 1] : [0, maximum <= 4 ? smallCountMaximum : "auto"]} ticks={!rate && maximum <= 4 ? Array.from({ length: smallCountMaximum + 1 }, (_, index) => index) : undefined} allowDecimals={rate} tickLine={false} axisLine={false} width={rate ? 64 : 60} stroke="var(--site-muted)" />
            {target && (target.low === target.high ? <ReferenceLine y={target.low} stroke="var(--site-muted)" strokeDasharray="4 5" /> : <ReferenceArea y1={target.low} y2={target.high} fill="var(--site-hover)" strokeOpacity={0} />)}
            {series.map(item => <Line key={item.key} type="linear" dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={1.8} strokeDasharray={item.dash} dot={rate || data.length <= 45 ? { r: 2, strokeWidth: 0, fill: item.color } : false} activeDot={false} connectNulls={false} isAnimationActive={false} />)}
            {selected && <ReferenceLine x={selected.day} stroke="var(--site-scrollbar)" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="statistics-point-readout" aria-live="polite">{selected ? <><time>{selected.day}</time>{series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}<strong>{typeof selected[item.key] === "number" ? format(Number(selected[item.key])) : "—"}</strong></span>)}{describe && <small>{describe(selected)}</small>}</> : <><time>{data[0]?.day}</time><span className="statistics-date-end">{data.at(-1)?.day}</span></>}</div>
      <span className="sr-only">{selected ? pointDescription(selected) : label}</span>
    </>}
  </div>;
}

export function DistributionChart({ bins, label, unit, onSelect }: {
  bins: DistributionBin[]; label: string; unit: string; onSelect: (bin: DistributionBin) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const selected = active !== null ? bins[active] : null;
  const choose = (state: unknown) => { const index = pointerIndex(state); if (index !== null && bins[index]) setActive(index); };
  return <div>
    <div className="statistics-legend"><span><i className="statistics-bar-key" />对象数量</span><span><i className="statistics-cdf-key" />累计比例</span></div>
    {!bins.some(bin => bin.count) ? <div className="statistics-chart-empty">尚无可估计的记忆状态</div> : <>
      <div className="statistics-chart statistics-distribution-chart" role="group" tabIndex={0} aria-label={label + "；左右方向键选择区间，回车查看对象"}
        onFocus={() => setActive(0)} onBlur={() => setActive(null)} onKeyDown={event => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive(Math.max(0, Math.min(bins.length - 1, (active ?? 0) + (event.key === "ArrowLeft" ? -1 : 1)))); }
          if ((event.key === "Enter" || event.key === " ") && selected) { event.preventDefault(); onSelect(selected); }
        }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}><ComposedChart data={bins} accessibilityLayer={false} margin={{ top: 12, right: 4, bottom: 6, left: -12 }} onMouseMove={choose} onMouseLeave={() => setActive(null)} onClick={state => { const index = pointerIndex(state); if (index !== null && bins[index]) onSelect(bins[index]); }}>
          <CartesianGrid vertical={false} stroke="var(--site-line)" strokeDasharray="2 5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={8} stroke="var(--site-muted)" />
          <YAxis yAxisId="count" allowDecimals={false} tickFormatter={formatCount} width={52} tickLine={false} axisLine={false} stroke="var(--site-muted)" />
          <YAxis yAxisId="cumulative" orientation="right" domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={percentage} width={44} tickLine={false} axisLine={false} stroke="var(--site-muted)" />
          <Bar dataKey="count" yAxisId="count" fill="var(--site-secondary-link)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          <Line type="linear" dataKey="cumulative" yAxisId="cumulative" stroke="var(--site-ink)" strokeWidth={1.3} strokeDasharray="3 3" dot={false} activeDot={false} isAnimationActive={false} />
          {selected && <ReferenceLine x={selected.label} yAxisId="count" stroke="var(--site-scrollbar)" />}
        </ComposedChart></ResponsiveContainer>
      </div>
      <div className="statistics-point-readout" aria-live="polite">{selected ? <><span>{selected.label} {unit}</span><strong>{formatCount(selected.count)} 个</strong><small>累计 {percentage(selected.cumulative)}</small></> : <span className="statistics-axis-unit">{unit}</span>}</div>
    </>}
  </div>;
}

export function ReviewHeatmap({ days, today, onSelect }: { days: ReviewDay[]; today: string; onSelect: (day: ReviewDay) => void }) {
  const todayIndex = days.findIndex(day => day.day === today);
  const [active, setActive] = useState<number>(Math.max(0, todayIndex));
  const [hover, setHover] = useState<number | null>(null);
  const cells = useRef(new Map<number, HTMLButtonElement>());
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scroll.current, cell = cells.current.get(todayIndex);
    if (container && cell) container.scrollLeft += cell.getBoundingClientRect().left - container.getBoundingClientRect().left - (container.clientWidth - cell.clientWidth) / 2;
  }, [todayIndex]);
  const maximum = Math.max(1, ...days.flatMap(day => [day.count, day.pendingIds.length]));
  const level = (count: number) => count === 0 ? 0 : 1 + Math.min(3, Math.floor(Math.log1p(count) / Math.log1p(maximum) * 3));
  const startOffset = (new Date(days[0].day + "T12:00:00Z").getUTCDay() + 6) % 7;
  const weekCount = Math.ceil((startOffset + days.length) / 7);
  const months = days.flatMap((day, index) => day.day.endsWith("-01") || index === 0 ? [{ index: Math.floor((index + startOffset) / 7), label: Number(day.day.slice(5, 7)) + "月" }] : []);
  const hovered = hover !== null ? days[hover] : days[todayIndex];
  return <div className="statistics-calendar">
    <div className="statistics-calendar-scroll" tabIndex={-1} ref={scroll}>
      <div className="statistics-calendar-grid" style={{ "--calendar-weeks": weekCount } as CSSProperties}>
        <div className="statistics-calendar-months" aria-hidden="true">{months.map((month, index) => <span key={index} style={{ gridColumn: month.index + 1, gridRow: 1 }}>{month.label}</span>)}</div>
        <div className="statistics-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day, index) => <span key={day}>{index % 2 === 0 ? day : ""}</span>)}</div>
        <div className="statistics-calendar-days" role="group" aria-label={days[0].day.slice(0, 4) + " 年复习日历；方向键选择日期，回车查看已完成记录或待复习对象"}>
          {Array.from({ length: startOffset }, (_, index) => <span className="statistics-calendar-padding" key={"pad-" + index} />)}
          {days.map((day, index) => {
            const period = day.day < today ? "past" : day.day > today ? "future" : "today";
            const description = day.day + (period === "today" ? " · 今天" : "")
              + (period !== "future" ? " · 已复习 " + day.count + " 次 · " + day.objectIds.length + " 个对象" : "")
              + (period !== "past" ? " · 待复习 " + day.pendingIds.length + " 个" + (day.firstReviewIds.length ? "（含首复 " + day.firstReviewIds.length + " 个）" : "") : "");
            return <button type="button" key={day.day} ref={element => { if (element) cells.current.set(index, element); else cells.current.delete(index); }}
              className="statistics-calendar-day" data-period={period} aria-current={period === "today" ? "date" : undefined}
              style={{ "--calendar-completed": "var(--site-heatmap-" + level(day.count) + ")", "--calendar-pending": "var(--site-heatmap-pending-" + level(day.pendingIds.length) + ")" } as CSSProperties}
              tabIndex={index === active ? 0 : -1} aria-label={description} title={description}
              onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} onFocus={() => { setActive(index); setHover(index); }} onBlur={() => setHover(null)}
              onClick={() => onSelect(day)} onKeyDown={event => {
                const delta = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
                if (delta !== undefined || event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  const next = event.key === "Home" ? 0 : event.key === "End" ? days.length - 1 : Math.max(0, Math.min(days.length - 1, index + delta!));
                  setActive(next); cells.current.get(next)?.focus();
                }
              }} />;
          })}
        </div>
      </div>
    </div>
    <div className="statistics-calendar-footer">
      <div className="statistics-calendar-readout" aria-live="polite">{hovered ? <>
        <time>{hovered.day === today ? "今天" : hovered.day}</time>
        {hovered.day <= today && <span>已复习 <strong>{formatCount(hovered.count)}</strong> 次</span>}
        {hovered.day >= today && <span>待复习 <strong>{formatCount(hovered.pendingIds.length)}</strong> 个</span>}
      </> : <><time>{days[0].day}</time><span>—</span><time>{days.at(-1)!.day}</time></>}</div>
      <div className="statistics-calendar-scales">{(["completed", "pending"] as const).map(kind => <div className="statistics-calendar-scale" key={kind} aria-label={(kind === "completed" ? "已复习次数" : "待复习对象数") + "从少到多"}><span>{kind === "completed" ? "已复习" : "待复习"}</span>{[0, 1, 2, 3, 4].map(level => <i style={{ background: "var(--site-heatmap-" + (kind === "pending" ? "pending-" : "") + level + ")" }} key={level} />)}</div>)}</div>
    </div>
  </div>;
}
