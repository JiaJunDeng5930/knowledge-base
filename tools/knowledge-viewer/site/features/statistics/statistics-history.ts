import type { HistoryBullet, HistoryEvent, HistoryTag, KnowledgeHistory } from "./statistics-model";

const isId = (value: unknown): value is string => typeof value === "string" && /^-?\d+$/.test(value);
const isDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function isBullet(value: unknown): value is HistoryBullet {
  return object(value) && isId(value.id) && (value.parent_id === null || isId(value.parent_id))
    && typeof value.characters === "number" && Number.isSafeInteger(value.characters) && value.characters >= 0;
}
function isTag(value: unknown): value is HistoryTag {
  return object(value) && isId(value.bullet_id) && typeof value.tag === "string";
}
function isEvent(value: unknown): value is HistoryEvent {
  if (!object(value) || !isId(value.id) || !isDate(value.at) || typeof value.changed !== "boolean") return false;
  const valid = value.table === "bullet" ? isBullet : value.table === "bullet_tag" ? isTag : null;
  return !!valid && (value.before === null || valid(value.before)) && (value.after === null || valid(value.after))
    && (value.before !== null || value.after !== null);
}
export function parseStatisticsHistory(value: unknown): KnowledgeHistory {
  if (!object(value) || !isDate(value.observed_at) || (value.coverage_start !== null && !isDate(value.coverage_start))
    || !Array.isArray(value.bullets) || !value.bullets.every(isBullet)
    || !Array.isArray(value.tags) || !value.tags.every(isTag)
    || !Array.isArray(value.events) || !value.events.every(isEvent)) {
    throw new Error("Knowledge statistics history invalid response");
  }
  return value as KnowledgeHistory;
}

export async function fetchStatisticsHistory(url: string, key: string, readerKey: string, fetcher: typeof fetch = fetch): Promise<KnowledgeHistory> {
  if (!url || !key || !readerKey) throw new Error("Knowledge statistics history configuration unavailable");
  const endpoint = new URL("/rest/v1/rpc/read_knowledge_statistics_history", url);
  if (endpoint.protocol !== "https:") throw new Error("Knowledge statistics history requires HTTPS");
  const headers: Record<string, string> = { apikey: key, "x-bullet-draft-key": readerKey, Accept: "application/json" };
  if (!key.startsWith("sb_publishable_")) headers.Authorization = "Bearer " + key;
  const response = await fetcher(endpoint, { headers, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Knowledge statistics history upstream unavailable");
  return parseStatisticsHistory(await response.json());
}
