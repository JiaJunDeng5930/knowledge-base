import type { Bullet, Panel } from "./knowledge-types";

export function panelKey(panel: Panel): string {
  if (panel.kind === "bullet") return "b:" + panel.id;
  if (panel.kind === "fsrs") return "f:" + panel.id;
  if (panel.kind === "tag") return "t:" + panel.tag;
  return panel.kind;
}

export function readingUrl(panels: Panel[]): string {
  const params = new URLSearchParams();
  for (const panel of panels) params.append("p", panelKey(panel) + (panel.kind === "bullet" ? (panel.focus ? "@" + panel.focus : "") + (panel.highlight ? "?" + panel.highlight : "") : ""));
  return "/?" + params.toString();
}

export function readPanels(url: URL): Panel[] {
  const panels: Panel[] = [];
  for (const value of url.searchParams.getAll("p")) {
    if (["index", "all", "memory"].includes(value)) panels.push({ kind: value as "index" | "all" | "memory" });
    else if (/^b:-?\d+(?:@-?\d+)?(?:\?[\s\S]*)?$/.test(value)) {
      const match = value.match(/^b:(-?\d+)(?:@(-?\d+))?(?:\?([\s\S]*))?$/)!;
      panels.push({kind: "bullet", id: match[1], ...(match[2] ? {focus: match[2]} : {}), ...(match[3] ? {highlight: match[3]} : {})});
    }
    else if (/^f:-?\d+$/.test(value)) panels.push({kind: "fsrs", id: value.slice(2)});
    else if (value.startsWith("t:") && value.length > 2) panels.push({kind: "tag", tag: value.slice(2)});
  }
  if (panels.length) return panels;
  const legacy = url.pathname.match(/^\/(bullet|fsrs)\/(-?\d+)\/?$/);
  if (legacy) return [{kind: legacy[1] as "bullet" | "fsrs", id: legacy[2]}];
  return [{kind: "index"}];
}

// 链接只替换当前笔记之后的阅读分支；重复目标回到此前面板。
export function followPanel(panels: Panel[], from: number, target: Panel): {panels: Panel[]; active: number} {
  const prefix = panels.slice(0, from + 1);
  const found = prefix.findIndex(panel => panelKey(panel) === panelKey(target));
  if (found >= 0) {
    if (target.kind === "bullet" && (target.focus || target.highlight)) {
      const updated = [...panels];
      updated[found] = target;
      return {panels: updated, active: found};
    }
    return {panels, active: found};
  }
  return {panels: [...prefix, target], active: prefix.length};
}

export function bulletTitle(body: string, maxLength = 86): string {
  const first = body.trim().split("\n").find(line => line.trim()) || "无标题笔记";
  if (/^(?:\x60{3}|~{3})/.test(first)) return "代码片段" + (first.replace(/^(?:\x60{3,}|~{3,})/, "").trim() ? " · " + first.replace(/^(?:\x60{3,}|~{3,})/, "").trim() : "");
  const clean = first.replace(/^#{1,6}\s+/, "").replace(/\x60([^\x60]+)\x60/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1");
  return clean.length > maxLength ? clean.slice(0, maxLength - 1) + "…" : clean;
}

// bullet 是自然语言，不默认具有标题；此拆分仅用于阅读排版。
export function splitBulletContent(body: string): {heading: string | null; content: string} {
  const text = body.trim();
  const first = text.split("\n")[0] || "";
  const explicit = first.match(/^#{1,6}\s+(.+)$/);
  const label = first.length <= 48 && !/[.。！？!?；;：:]$/.test(first) && !/[。！？!?；;]/.test(first)
    && !/^(?:\x60{3}|~{3}|[-*+]\s|\d+[.)]\s|>|\$\$|\|)/.test(first);
  if (explicit || (first && label)) return {heading: explicit ? explicit[1] : first, content: text.slice(first.length).trim()};
  return {heading: null, content: text};
}

export function resultExcerpt(body: string, query: string, length = 170): string {
  const {heading, content} = splitBulletContent(body);
  // 短笔记只出现一次；命中长正文时摘要保留命中附近的原文。
  if (!content) return "";
  if (!heading && body.replace(/\s+/g, " ").trim().length <= 140) return "";
  return searchExcerpt(content, query, length);
}

export function searchBullets(bullets: Bullet[], query: string): Bullet[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return bullets;
  return bullets.map((bullet, index) => {
    const body = bullet.body.toLocaleLowerCase();
    const idMatch = terms.length === 1 && terms[0].replace(/^#/, "") === bullet.id;
    if (!idMatch && !terms.every(term => body.includes(term))) return null;
    const title = bulletTitle(bullet.body, 300).toLocaleLowerCase();
    const rank = idMatch ? 0 : title === terms.join(" ") ? 1 : terms.every(term => title.includes(term)) ? 2 : 3;
    return {bullet, rank, index};
  }).filter((entry): entry is {bullet: Bullet; rank: number; index: number} => entry !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(entry => entry.bullet);
}

export function searchExcerpt(body: string, query: string, length = 150): string {
  const text = body.replace(/\s+/g, " ").trim();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.map(term => text.toLowerCase().indexOf(term)).filter(n => n >= 0);
  const start = matches.length ? Math.max(0, Math.min(...matches) - 36) : 0;
  return (start ? "…" : "") + text.slice(start, start + length) + (text.length > start + length ? "…" : "");
}
