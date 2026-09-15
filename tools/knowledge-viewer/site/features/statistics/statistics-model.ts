import type { Bullet, Fsrs, Review, Snapshot } from "../../lib/knowledge-types";

const DAY_MS = 86_400_000;
const calendarFormatters = new Map<string, Intl.DateTimeFormat>();
export type StatisticsScope = { rootId: string | null; tag: string | null };
export const ALL_KNOWLEDGE: StatisticsScope = { rootId: null, tag: null };
export type HistoryBullet = { id: string; parent_id: string | null; characters: number };
export type HistoryTag = { bullet_id: string; tag: string };
export type HistoryEvent = {
  id: string; at: string; table: "bullet" | "bullet_tag"; changed: boolean;
  before: HistoryBullet | HistoryTag | null; after: HistoryBullet | HistoryTag | null;
};
export type KnowledgeHistory = {
  observed_at: string; coverage_start: string | null;
  bullets: HistoryBullet[]; tags: HistoryTag[]; events: HistoryEvent[];
};
export type KnowledgeDay = {
  day: string; total: number; characters: number;
  added: number; modified: number; removed: number;
  addedIds: string[]; modifiedIds: string[]; removedIds: string[];
};
export type ReviewDay = {
  day: string; count: number; objectIds: string[]; ratings: number[];
  recalled: number; tested: number; retention: number | null; reviewIds: string[]; retentionReviewIds: string[];
  pendingIds: string[]; firstReviewIds: string[];
};
export type DistributionBin = { label: string; count: number; cumulative: number; ids: string[] };
export type DistributionKind = "retrievability" | "stability" | "difficulty" | "interval";

// 所有日期分组使用同一个 IANA 时区。纯日期运算不受夏令时的一天长短影响。
export function calendarDay(value: string | number, timeZone: string): string {
  if (!calendarFormatters.has(timeZone)) calendarFormatters.set(timeZone, new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }));
  const parts = calendarFormatters.get(timeZone)!.formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return get("year") + "-" + get("month") + "-" + get("day");
}
export function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + offset * DAY_MS).toISOString().slice(0, 10);
}
export function daysBetween(start: string, end: string): string[] {
  if (start > end) return [];
  const count = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / DAY_MS) + 1;
  return Array.from({ length: count }, (_, index) => shiftDay(start, index));
}
export function compareIds(left: string, right: string): number {
  const a = BigInt(left), b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function inheritedScopeMatch(id: string, bullets: Map<string, { parent_id: string | null }>, tags: Map<string, Set<string>>, scope: StatisticsScope): boolean {
  let rootMatches = scope.rootId === null, tagMatches = scope.tag === null;
  let current: string | null = id;
  const visited = new Set<string>();
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const bullet = bullets.get(current);
    if (!bullet) break;
    if (current === scope.rootId) rootMatches = true;
    if (scope.tag && tags.get(current)?.has(scope.tag)) tagMatches = true;
    current = bullet.parent_id;
  }
  return bullets.has(id) && rootMatches && tagMatches;
}

export function selectStatistics(snapshot: Snapshot, scope: StatisticsScope) {
  const allBullets = new Map(snapshot.bullets.map(bullet => [bullet.id, bullet]));
  const tags = new Map<string, Set<string>>();
  for (const row of snapshot.effective_tags) {
    if (!tags.has(row.bullet_id)) tags.set(row.bullet_id, new Set());
    tags.get(row.bullet_id)!.add(row.tag);
  }
  const bullets = snapshot.bullets.filter(bullet => inheritedScopeMatch(bullet.id, allBullets, tags, scope));
  const bulletIds = new Set(bullets.map(bullet => bullet.id));
  const all = scope.rootId === null && scope.tag === null;
  const linkedIds = new Set(snapshot.fsrs_bullet.filter(link => bulletIds.has(link.bullet_id)).map(link => link.fsrs_id));
  const fsrs = snapshot.fsrs.filter(card => all || linkedIds.has(card.id));
  const fsrsIds = new Set(fsrs.map(card => card.id));
  const coveredIds = new Set(snapshot.fsrs_bullet.filter(link => fsrsIds.has(link.fsrs_id) && bulletIds.has(link.bullet_id)).map(link => link.bullet_id));
  const reviews = snapshot.fsrs_review.filter(review => fsrsIds.has(review.fsrs_id));
  const references = snapshot.references.filter(link => bulletIds.has(link.source_bullet_id));
  const tagNames = [...new Set(snapshot.effective_tags.filter(tag => bulletIds.has(tag.bullet_id)).map(tag => tag.tag))].sort();
  return { bullets, bulletIds, fsrs, fsrsIds, coveredIds, reviews, references, tagNames,
    characters: bullets.reduce((total, bullet) => total + Array.from(bullet.body).length, 0) };
}

export function contentDistribution(snapshot: Snapshot, scope: StatisticsScope) {
  const selected = selectStatistics(snapshot, scope);
  const allBullets = new Map(snapshot.bullets.map(bullet => [bullet.id, bullet]));
  const groups = new Map<string, { bullet: Bullet; count: number; characters: number; covered: number; ids: string[] }>();
  for (const bullet of selected.bullets) {
    let current = bullet;
    const seen = new Set<string>();
    while (current.id !== scope.rootId && current.parent_id !== scope.rootId && current.parent_id !== null && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = allBullets.get(current.parent_id);
      if (!parent) break;
      current = parent;
    }
    // 当前目录节点自身由标题承担，分布只比较下级；叶节点仍可查看自己。
    if (bullet.id === scope.rootId && selected.bullets.length > 1) continue;
    const key = current.id;
    if (!groups.has(key)) groups.set(key, { bullet: current, count: 0, characters: 0, covered: 0, ids: [] });
    const group = groups.get(key)!;
    group.count += 1;
    group.characters += Array.from(bullet.body).length;
    group.covered += selected.coveredIds.has(bullet.id) ? 1 : 0;
    group.ids.push(bullet.id);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || compareIds(a.bullet.sibling_order, b.bullet.sibling_order));
}

// 固定自然年：历史计实际评分，今天起计当前下一次到期；两者不相加。
// 每日回忆率只取每个对象当天第一次、间隔至少 24 小时的复习。
export function reviewCalendar(reviews: Review[], cards: Fsrs[], now: number, timeZone: string, year = Number(calendarDay(now, timeZone).slice(0, 4))): ReviewDay[] {
  const today = calendarDay(now, timeZone);
  const prefix = String(year).padStart(4, "0");
  const days = new Map(daysBetween(prefix + "-01-01", prefix + "-12-31").map(day => [day, {
    day, count: 0, objectIds: [] as string[], ratings: [0, 0, 0, 0],
    recalled: 0, tested: 0, retention: null as number | null, reviewIds: [] as string[], retentionReviewIds: [] as string[],
    pendingIds: [] as string[], firstReviewIds: [] as string[],
  }]));
  const previous = new Map<string, number>();
  const firstOfDay = new Set<string>();
  const objects = new Map<string, Set<string>>();
  const ordered = [...reviews].sort((a, b) => Date.parse(a.review_datetime) - Date.parse(b.review_datetime) || compareIds(a.id, b.id));
  for (const review of ordered) {
    const time = Date.parse(review.review_datetime);
    if (time > now) continue;
    const day = calendarDay(time, timeZone), row = days.get(day);
    const key = day + ":" + review.fsrs_id;
    const last = previous.get(review.fsrs_id);
    if (row) {
      row.count += 1;
      row.ratings[review.rating - 1] += 1;
      row.reviewIds.push(review.id);
      if (!objects.has(day)) objects.set(day, new Set());
      objects.get(day)!.add(review.fsrs_id);
      if (!firstOfDay.has(key) && last !== undefined && time - last >= DAY_MS) {
        row.tested += 1;
        row.recalled += review.rating > 1 ? 1 : 0;
        row.retentionReviewIds.push(review.id);
      }
    }
    firstOfDay.add(key);
    previous.set(review.fsrs_id, time);
  }
  for (const row of days.values()) {
    row.objectIds = [...(objects.get(row.day) || [])];
    row.retention = row.tested ? row.recalled / row.tested : null;
  }
  for (const card of cards) {
    const dueDay = calendarDay(card.due_at, timeZone);
    const row = days.get(dueDay);
    // 逾期对象在独立汇总中；历史格始终只展示已经发生的复习。
    if (!row || dueDay < today) continue;
    row.pendingIds.push(card.id);
    if (card.last_review_at === null) row.firstReviewIds.push(card.id);
  }
  return [...days.values()];
}

// 与仓库固定版本 py-fsrs 6.3.2 相同：elapsed_days 向下取整，w20 决定 FSRS-6 遗忘曲线。
// 未初始化对象返回 null，使它们不会被误统计为已经遗忘。
export function retrievability(card: Fsrs, scheduler: Record<string, unknown> | undefined, now: number): number | null {
  if (!card.last_review_at || card.stability_days === null) return null;
  const parameters = scheduler?.parameters;
  if (!Array.isArray(parameters) || parameters.length !== 21 || !Number.isFinite(parameters[20]) || parameters[20] <= 0) return null;
  const decay = -Number(parameters[20]);
  const factor = Math.pow(0.9, 1 / decay) - 1;
  const elapsed = Math.max(0, Math.floor((now - Date.parse(card.last_review_at)) / DAY_MS));
  return Math.pow(1 + factor * elapsed / card.stability_days, decay);
}

export function memoryDistribution(cards: Fsrs[], configs: Snapshot["scheduler_configs"], kind: DistributionKind, now: number) {
  const configById = new Map(configs.map(config => [config.id, config.scheduler]));
  const limits = kind === "retrievability" ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.000001]
    : kind === "difficulty" ? [2, 3, 4, 5, 6, 7, 8, 9, 10.000001]
    : [1, 3, 7, 14, 30, 90, 180, 365, Infinity];
  const labels = kind === "retrievability" ? ["0–10", "10–20", "20–30", "30–40", "40–50", "50–60", "60–70", "70–80", "80–90", "90–100"]
    : kind === "difficulty" ? ["1–2", "2–3", "3–4", "4–5", "5–6", "6–7", "7–8", "8–9", "9–10"]
    : ["<1", "1–3", "3–7", "7–14", "14–30", "30–90", "90–180", "180–365", "≥365"];
  const bins: DistributionBin[] = labels.map(label => ({ label, count: 0, cumulative: 0, ids: [] }));
  const values: number[] = [];
  for (const card of cards) {
    const value = kind === "retrievability" ? retrievability(card, configById.get(card.scheduler_config_id), now)
      : kind === "difficulty" ? card.difficulty
      : kind === "stability" ? card.stability_days
      : card.last_review_at ? (Date.parse(card.due_at) - Date.parse(card.last_review_at)) / DAY_MS : null;
    if (value === null || !Number.isFinite(value) || value < 0) continue;
    const index = limits.findIndex(limit => value < limit);
    if (index < 0) continue;
    bins[index].ids.push(card.id); bins[index].count += 1; values.push(value);
  }
  values.sort((a, b) => a - b);
  let cumulative = 0;
  for (const bin of bins) { cumulative += bin.count; bin.cumulative = values.length ? cumulative / values.length : 0; }
  const middle = Math.floor(values.length / 2);
  const median = values.length ? values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2 : null;
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return { bins, median, mean, measured: values.length, unmeasured: cards.length - values.length };
}

export function reviewBacklog(cards: Fsrs[], now: number, timeZone: string) {
  const today = calendarDay(now, timeZone);
  const backlog = { ids: [] as string[], newIds: [] as string[] };
  const overdueBins = [
    { label: "不足 1 天", until: 1, ids: [] as string[] },
    { label: "1–7 天", until: 7, ids: [] as string[] },
    { label: "7–30 天", until: 30, ids: [] as string[] },
    { label: "≥30 天", until: Infinity, ids: [] as string[] },
  ];
  for (const card of cards) {
    const due = Date.parse(card.due_at), day = calendarDay(due, timeZone);
    if (day < today) {
      if (card.last_review_at === null) backlog.newIds.push(card.id);
      else {
        backlog.ids.push(card.id);
        overdueBins.find(bin => (now - due) / DAY_MS < bin.until)!.ids.push(card.id);
      }
    }
  }
  return { ...backlog, overdueBins };
}

export function memoryStages(cards: Fsrs[]) {
  const stages = [
    { key: "new", label: "未首复", ids: [] as string[] },
    { key: "learning", label: "学习", ids: [] as string[] },
    { key: "review", label: "复习", ids: [] as string[] },
    { key: "relearning", label: "重学", ids: [] as string[] },
  ];
  for (const card of cards) stages[card.last_review_at === null ? 0 : card.state === 1 ? 1 : card.state === 2 ? 2 : 3].ids.push(card.id);
  return stages;
}

export function frequentLapses(cards: Fsrs[], reviews: Review[], now: number) {
  const lapses = new Map<string, Review[]>();
  for (const review of reviews) if (review.rating === 1 && Date.parse(review.review_datetime) <= now) {
    if (!lapses.has(review.fsrs_id)) lapses.set(review.fsrs_id, []);
    lapses.get(review.fsrs_id)!.push(review);
  }
  return cards.filter(card => (lapses.get(card.id)?.length || 0) >= 2).map(card => ({ card, count: lapses.get(card.id)!.length }))
    .sort((a, b) => b.count - a.count || compareIds(a.card.id, b.card.id));
}

// 从同一数据库快照的当前投影逆向回放审计历史；正文、标签继承、移动与删除均按当时状态筛选。
export function knowledgeTimeline(history: KnowledgeHistory, scope: StatisticsScope, timeZone: string): KnowledgeDay[] {
  if (history.coverage_start === null) return [];
  const today = calendarDay(history.observed_at, timeZone), firstDay = calendarDay(history.coverage_start, timeZone);
  const bullets = new Map(history.bullets.map(bullet => [bullet.id, { ...bullet }]));
  const tags = new Map<string, Set<string>>();
  for (const tag of history.tags) {
    if (!tags.has(tag.bullet_id)) tags.set(tag.bullet_id, new Set());
    tags.get(tag.bullet_id)!.add(tag.tag);
  }
  const events = [...history.events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || compareIds(b.id, a.id));
  let position = 0;
  const result: KnowledgeDay[] = [];
  for (const day of daysBetween(firstDay, today).reverse()) {
    const selected = [...bullets.values()].filter(bullet => inheritedScopeMatch(bullet.id, bullets, tags, scope));
    const added = new Set<string>(), modified = new Set<string>(), removed = new Set<string>();
    while (position < events.length && calendarDay(events[position].at, timeZone) === day) {
      const event = events[position++];
      if (event.table === "bullet_tag") {
        const after = event.after as HistoryTag | null, before = event.before as HistoryTag | null;
        if (after) tags.get(after.bullet_id)?.delete(after.tag);
        if (before) {
          if (!tags.has(before.bullet_id)) tags.set(before.bullet_id, new Set());
          tags.get(before.bullet_id)!.add(before.tag);
        }
      } else {
        const after = event.after as HistoryBullet | null, before = event.before as HistoryBullet | null;
        const id = (after || before)!.id;
        const matchesAfter = inheritedScopeMatch(id, bullets, tags, scope);
        if (before) bullets.set(id, before); else bullets.delete(id);
        const matchesBefore = inheritedScopeMatch(id, bullets, tags, scope);
        if (before === null && matchesAfter) added.add(id);
        else if (after === null && matchesBefore) removed.add(id);
        else if (event.changed && (matchesBefore || matchesAfter)) modified.add(id);
      }
    }
    result.push({ day, total: selected.length, characters: selected.reduce((sum, bullet) => sum + bullet.characters, 0),
      added: added.size, modified: modified.size, removed: removed.size,
      addedIds: [...added], modifiedIds: [...modified], removedIds: [...removed] });
  }
  return result.reverse();
}
