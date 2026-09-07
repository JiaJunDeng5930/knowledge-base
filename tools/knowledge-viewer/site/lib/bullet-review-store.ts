import type { BulletDraft, BulletReview, ReviewComment } from "./bullet-review";

type CommentRow = Omit<ReviewComment, "bullet_ids"> & {bullet_ids: string};
type Database = Pick<D1Database, "prepare" | "batch">;
export class ReviewRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// 删除精确 ID，使旧请求的清理不会删除读取之后才产生的批注。
export async function readBulletReview(db: Database, draft: BulletDraft | null): Promise<BulletReview> {
  const result = await db.prepare("SELECT id, draft_id, bullet_ids, body, created_at FROM bullet_review_comment ORDER BY created_at, id").all<CommentRow>();
  const processed = new Set(draft?.processed_comment_ids || []);
  const stale = result.results.filter(row => row.draft_id !== draft?.id || processed.has(row.id));
  for (let offset = 0; offset < stale.length; offset += 50) {
    await db.batch(stale.slice(offset, offset + 50).map(row => db.prepare("DELETE FROM bullet_review_comment WHERE id = ? AND draft_id = ?").bind(row.id, row.draft_id)));
  }
  const comments = result.results.filter(row => row.draft_id === draft?.id && !processed.has(row.id))
    .map(row => ({...row, bullet_ids: JSON.parse(row.bullet_ids) as string[]}));
  return {draft, comments};
}

export function parseCommentInput(input: unknown, draft: BulletDraft | null): ReviewComment {
  const value = input as Partial<ReviewComment>;
  if (!draft || value?.draft_id !== draft.id) throw new ReviewRequestError("草稿已更新或已提交，请刷新后重新选择批注位置。", 409);
  if (typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
    || typeof value.body !== "string" || !value.body.trim() || value.body.length > 4000
    || !Array.isArray(value.bullet_ids) || !value.bullet_ids.length || value.bullet_ids.length > 100
    || value.bullet_ids.some(id => typeof id !== "string" || !(Object.hasOwn(draft.base, id) || Object.hasOwn(draft.proposed, id)))) {
    throw new ReviewRequestError("请选择批注位置并填写批注，正文最多 4000 字。 ");
  }
  return {id: value.id, draft_id: draft.id, bullet_ids: [...new Set(value.bullet_ids)], body: value.body.trim(), created_at: new Date().toISOString()};
}

export async function saveReviewComment(db: Database, comment: ReviewComment): Promise<void> {
  await db.prepare("INSERT INTO bullet_review_comment (id, draft_id, bullet_ids, body, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
    .bind(comment.id, comment.draft_id, JSON.stringify(comment.bullet_ids), comment.body, comment.created_at).run();
  const saved = await db.prepare("SELECT draft_id, bullet_ids, body FROM bullet_review_comment WHERE id = ?").bind(comment.id).first<CommentRow>();
  if (!saved || saved.draft_id !== comment.draft_id || saved.bullet_ids !== JSON.stringify(comment.bullet_ids) || saved.body !== comment.body) {
    throw new ReviewRequestError("这条批注的内容已发生变化，请重新发送。", 409);
  }
}
