import type { buildKnowledgeModel } from "@/lib/knowledge-model";
import { bulletTitle, splitBulletContent } from "@/lib/reading-path";
import type { Bullet, Panel } from "@/lib/knowledge-types";
import { draftChildren, type BulletDraft } from "@/lib/bullet-review";
import { compareBigintStrings } from "@/lib/knowledge-model";

export type KnowledgeModel = ReturnType<typeof buildKnowledgeModel>;
export type Navigate = (panel: Panel, from?: number) => void;
export const ROOT_LABELS: Record<string, string> = {knowledge: "主题知识", source: "来源材料"};

export type PageBlock = {
  id: string;
  title: string;
  heading: string | null;
  content: string;
  available: boolean;
  children: PageBlock[];
  reviewSide?: "before";
};
export type BlockSurface = {kind: "body"} | {kind: "reference"; key: string};
export type ReferenceDirection = "outgoing" | "incoming";
export type ReferenceGroup = {
  key: string;
  context: {id: string; label: string}[];
  blocks: PageBlock[];
};
export type ReferenceSection = {
  direction: ReferenceDirection;
  label: string;
  description: string;
  groups: ReferenceGroup[];
};

// 正文与引用只共用呈现模型；引用边不成为有序子树的一部分。
function buildBlock(model: KnowledgeModel, id: string, ancestors: Set<string>, draft?: BulletDraft | null, beforeOnly = false): PageBlock | null {
  if (ancestors.has(id)) return null;
  const bullet: Bullet | undefined = beforeOnly && draft?.base[id] ? {id, ...draft.base[id]} : model.bulletsById.get(id);
  if (!bullet) return {id, title: "内容 #" + id, heading: null, content: "", available: false, children: []};
  const path = new Set(ancestors).add(id);
  const children = buildChildren(model, id, path, draft, beforeOnly);
  return {id, title: bulletTitle(bullet.body), ...splitBulletContent(bullet.body), available: true, children, ...(beforeOnly ? {reviewSide: "before" as const} : {})};
}

function buildChildren(model: KnowledgeModel, parentId: string, ancestors: Set<string>, draft?: BulletDraft | null, beforeOnly = false): PageBlock[] {
  const bullets: Bullet[] = beforeOnly && draft ? draftChildren(draft.base, parentId) : model.getChildren(parentId);
  const rows = bullets.map(bullet => ({bullet, beforeOnly}));
  if (draft && !beforeOnly) for (const bullet of draftChildren(draft.base, parentId)) {
    const after = draft.proposed[bullet.id];
    if (after && (after.parent_id !== parentId || after.sibling_order !== bullet.sibling_order)) rows.push({bullet, beforeOnly: true});
  }
  return rows.sort((a, b) => compareBigintStrings(a.bullet.sibling_order, b.bullet.sibling_order)
    || compareBigintStrings(a.bullet.id, b.bullet.id) || Number(b.beforeOnly) - Number(a.beforeOnly))
    .map(({bullet, beforeOnly}) => buildBlock(model, bullet.id, ancestors, draft, beforeOnly))
    .filter((block): block is PageBlock => block !== null);
}

export function buildPageBlocks(model: KnowledgeModel, parentId: string, draft?: BulletDraft | null): PageBlock[] {
  return buildChildren(model, parentId, new Set([parentId]), draft);
}

export function buildReferenceSections(model: KnowledgeModel, id: string): ReferenceSection[] {
  const definitions = [
    {direction: "outgoing" as const, label: "引用", description: "本条内容引用的原文", ids: model.outgoingById.get(id) || []},
    {direction: "incoming" as const, label: "反向引用", description: "引用本条内容的原文", ids: model.incomingById.get(id) || []},
  ];
  return definitions.flatMap(({ids, ...definition}) => {
    const groups = new Map<string, ReferenceGroup>();
    for (const linkedId of new Set<string>(ids)) {
      const block = buildBlock(model, linkedId, new Set());
      if (!block) continue;
      const context = (model.getPath(linkedId) as {id: string | null; label: string}[])
        .slice(1, -1).filter((part): part is {id: string; label: string} => part.id !== null)
        .map(part => ({id: part.id, label: ROOT_LABELS[part.label] || part.label}));
      const key = context.map(part => part.id).join("/") || (block.available ? "root" : "unavailable");
      const group = groups.get(key) || {key, context, blocks: []};
      group.blocks.push(block);
      groups.set(key, group);
    }
    return groups.size ? [{...definition, groups: [...groups.values()]}] : [];
  });
}

// 引用实例的折叠不能覆盖正文或另一个来源中的同一块。
export function blockExpansionKey(surface: BlockSurface, id: string): string {
  return surface.kind === "body" ? id : "reference-block:" + surface.key + ":" + id;
}
