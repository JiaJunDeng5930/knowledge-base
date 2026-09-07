import type { Bullet, Snapshot } from "./knowledge-types";
import { compareBigintStrings } from "./knowledge-model.js";

// 草稿以 ID 为键；负数 ID 只在草稿中标识新增 bullet。
export type DraftBullet = Omit<Bullet, "id"> & {tags: string[]; references: string[]};
export type DraftDocument = Record<string, DraftBullet>;
export type BulletDraft = {id: string; base: DraftDocument; proposed: DraftDocument; processed_comment_ids: string[]; updated_at: string};
export type ReviewComment = {id: string; draft_id: string; bullet_ids: string[]; body: string; created_at: string};
export type BulletReview = {draft: BulletDraft | null; comments: ReviewComment[]};
export type BulletChange = {id: string; before?: DraftBullet; after?: DraftBullet; kind: "added" | "deleted" | "modified" | "moved"; bodyChanged: boolean; moved: boolean; tagsChanged: boolean; referencesChanged: boolean};

const integer = /^(0|-?[1-9][0-9]*)$/;
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every(x => typeof x === "string"); }
function isDocument(value: unknown): value is DraftDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as DraftDocument;
  const positions = new Set<string>();
  for (const [id, row] of Object.entries(document)) {
    if (!/^-?[1-9][0-9]*$/.test(id) || !row || typeof row.body !== "string" || !Number.isInteger(row.depth) || row.depth < 0
      || typeof row.sibling_order !== "string" || !integer.test(row.sibling_order) || !isStringArray(row.tags) || !isStringArray(row.references)) return false;
    if (row.parent_id === null ? row.depth !== 0 : typeof row.parent_id !== "string" || document[row.parent_id]?.depth !== row.depth - 1) return false;
    if (row.references.some(target => !Object.hasOwn(document, target)) || new Set(row.tags).size !== row.tags.length || new Set(row.references).size !== row.references.length) return false;
    const position = JSON.stringify([row.parent_id, row.sibling_order]);
    if (positions.has(position)) return false;
    positions.add(position);
  }
  return true;
}

export function parseBulletDraft(value: unknown): BulletDraft {
  const draft = value as BulletDraft;
  if (!draft || typeof draft.id !== "string" || !isDocument(draft.base) || !isDocument(draft.proposed)
      || !isStringArray(draft.processed_comment_ids) || typeof draft.updated_at !== "string") throw new Error("Bullet draft invalid response");
  return draft;
}

function sameSet(a: string[], b: string[]) { return a.length === b.length && a.every(x => b.includes(x)); }
export function bulletChanges(draft: BulletDraft): Map<string, BulletChange> {
  const changes = new Map<string, BulletChange>();
  for (const id of new Set([...Object.keys(draft.base), ...Object.keys(draft.proposed)])) {
    const before = draft.base[id], after = draft.proposed[id];
    const bodyChanged = before?.body !== after?.body;
    const moved = !!before && !!after && (before.parent_id !== after.parent_id || before.sibling_order !== after.sibling_order);
    const tagsChanged = !sameSet(before?.tags || [], after?.tags || []);
    const referencesChanged = !sameSet(before?.references || [], after?.references || []);
    if (!before || !after || bodyChanged || moved || tagsChanged || referencesChanged) changes.set(id, {
      id, before, after, bodyChanged, moved, tagsChanged, referencesChanged,
      kind: !before ? "added" : !after ? "deleted" : moved ? "moved" : "modified",
    });
  }
  return changes;
}

export function draftSnapshot(snapshot: Snapshot, document: DraftDocument): Snapshot {
  const bullets = Object.entries(document).map(([id, row]) => ({id, body: row.body, parent_id: row.parent_id, depth: row.depth, sibling_order: row.sibling_order}));
  const effective_tags: Snapshot["effective_tags"] = [];
  for (const bullet of bullets) {
    const tags = new Set<string>();
    let id: string | null = bullet.id;
    const seen = new Set<string>();
    while (id !== null && document[id] && !seen.has(id)) {
      seen.add(id); document[id].tags.forEach(tag => tags.add(tag)); id = document[id].parent_id;
    }
    tags.forEach(tag => effective_tags.push({bullet_id: bullet.id, tag}));
  }
  return {...snapshot, bullets, effective_tags, references: Object.entries(document).flatMap(([id, row]) => row.references.map(target_bullet_id => ({source_bullet_id: id, target_bullet_id})))};
}

// 保留删除的原节点；其余节点使用拟提交结构。旧位置另由块列表显示。
export function previewSnapshot(snapshot: Snapshot, draft: BulletDraft): Snapshot {
  return draftSnapshot(snapshot, {...draft.base, ...draft.proposed});
}

export function draftChildren(document: DraftDocument, parentId: string | null): Bullet[] {
  return Object.entries(document).filter(([, row]) => row.parent_id === parentId)
    .map(([id, row]) => ({id, ...row}))
    .sort((a, b) => compareBigintStrings(a.sibling_order, b.sibling_order) || compareBigintStrings(a.id, b.id));
}
// getRandomValues 也支持本地 HTTP 预览；请求 ID 在失败重试时复用。
export function createReviewCommentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
