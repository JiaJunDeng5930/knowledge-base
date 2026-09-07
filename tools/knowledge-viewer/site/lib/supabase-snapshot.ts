import type { Snapshot } from "./knowledge-types";

// 七个固定只读查询；不接受来自客户端的表名、列名或 SQL。
// 在 PostgREST 中将 bigint 转成 text，避免先解析为 Number 后丢失精度。
export const SNAPSHOT_QUERIES = [
  ["bullets", "bullet", "id::text,body,parent_id::text,depth,sibling_order::text", "id"],
  ["references", "bullet_reference", "source_bullet_id::text,target_bullet_id::text", "source_bullet_id,target_bullet_id"],
  ["effective_tags", "effective_bullet_tag", "bullet_id::text,tag", "bullet_id,tag"],
  ["scheduler_configs", "scheduler_config", "id::text,scheduler", "id"],
  ["fsrs", "fsrs", "id::text,cue,scheduler_config_id::text,state,step,stability_days,difficulty,last_review_at,due_at", "id"],
  ["fsrs_bullet", "fsrs_bullet", "fsrs_id::text,bullet_id::text", "fsrs_id,bullet_id"],
  ["fsrs_review", "fsrs_review", "id::text,fsrs_id::text,rating,review_datetime,review_duration::text", "id"],
] as const;

export async function fetchSupabaseSnapshot(url: string, key: string, fetcher: typeof fetch = fetch): Promise<Snapshot> {
  if (!url || !key) throw new Error("Knowledge snapshot configuration unavailable");
  const origin = new URL(url);
  if (origin.protocol !== "https:") throw new Error("Knowledge snapshot requires HTTPS");
  const headers: Record<string, string> = { apikey: key, Accept: "application/json" };
  if (!key.startsWith("sb_publishable_")) headers.Authorization = "Bearer " + key;
  const entries = await Promise.all(SNAPSHOT_QUERIES.map(async ([name, table, select, order]) => {
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    // 读取到空页，不假定数据库的每页上限为 1000。
    for (;;) {
      const endpoint = new URL("/rest/v1/" + table, origin);
      endpoint.search = new URLSearchParams({select, order, limit: "1000", offset: String(offset)}).toString();
      const response = await fetcher(endpoint, { headers, cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("Knowledge snapshot upstream unavailable");
      const page: unknown = await response.json();
      if (!Array.isArray(page) || page.some(row => !row || typeof row !== "object")) throw new Error("Knowledge snapshot invalid response");
      for (const row of page) {
        for (const [field, value] of Object.entries(row)) {
          if (field === "id" || field.endsWith("_id") || field === "sibling_order" || field === "review_duration") {
            if (value !== null && (typeof value !== "string" || !/^-?\d+$/.test(value))) throw new Error("Knowledge snapshot invalid bigint");
          }
        }
      }
      rows.push(...page);
      if (!page.length) break;
      offset += page.length;
    }
    return [name, rows];
  }));
  return { ...Object.fromEntries(entries), fetched_at: new Date().toISOString() } as Snapshot;
}
