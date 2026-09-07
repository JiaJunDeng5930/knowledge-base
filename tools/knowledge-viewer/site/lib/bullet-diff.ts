import type { BulletDraft, DraftBullet } from "./bullet-review";

// Bullet diff：固定基线与当前草稿的差异，不累积中间版本。
export type BulletChange = {id: string; before?: DraftBullet; after?: DraftBullet; kind: "added" | "deleted" | "modified" | "moved"; bodyChanged: boolean; moved: boolean; tagsChanged: boolean; referencesChanged: boolean};

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

// 目录的上级提示同时沿原结构和新结构传播，移动前后的分支都能找到变化。
export function bulletChangedAncestors(draft: BulletDraft, changes = bulletChanges(draft)): Set<string> {
  const ancestors = new Set<string>();
  for (const id of changes.keys()) {
    for (const document of [draft.base, draft.proposed]) {
      let parentId = document[id]?.parent_id ?? null;
      const seen = new Set<string>();
      while (parentId !== null && document[parentId] && !seen.has(parentId)) {
        seen.add(parentId); ancestors.add(parentId);
        parentId = document[parentId].parent_id;
      }
    }
  }
  return ancestors;
}
