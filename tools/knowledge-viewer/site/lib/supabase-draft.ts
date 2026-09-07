import { parseBulletDraft, type BulletDraft } from "./bullet-review";

export async function fetchSupabaseDraft(url: string, key: string, draftReadKey: string, fetcher: typeof fetch = fetch): Promise<BulletDraft | null> {
  if (!url || !key || !draftReadKey) throw new Error("Bullet draft configuration unavailable");
  const endpoint = new URL("/rest/v1/bullet_draft", url);
  if (endpoint.protocol !== "https:") throw new Error("Bullet draft requires HTTPS");
  endpoint.search = new URLSearchParams({select: "id,base,proposed,processed_comment_ids,updated_at", limit: "1"}).toString();
  const headers: Record<string, string> = {apikey: key, "x-bullet-draft-key": draftReadKey, Accept: "application/json"};
  if (!key.startsWith("sb_publishable_")) headers.Authorization = "Bearer " + key;
  const response = await fetcher(endpoint, {headers, cache: "no-store", signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error("Bullet draft upstream unavailable");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length > 1) throw new Error("Bullet draft invalid response");
  return rows.length ? parseBulletDraft(rows[0]) : null;
}
