import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 网站写入批注；agent 通过 Sites 数据库读取工具取得这些记录。
export const bulletReviewComment = sqliteTable("bullet_review_comment", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull(),
  bulletIds: text("bullet_ids").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("bullet_review_comment_draft_idx").on(table.draftId, table.createdAt)]);
