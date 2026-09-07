// bigint 身份和排序值始终使用十进制字符串，与原查看器契约一致。
export type Bullet = { id: string; body: string; parent_id: string | null; depth: number; sibling_order: string };
export type Fsrs = { id: string; cue: string; scheduler_config_id: string; state: 1 | 2 | 3; step: number | null; stability_days: number | null; difficulty: number | null; last_review_at: string | null; due_at: string };
export type Review = { id: string; fsrs_id: string; rating: 1 | 2 | 3 | 4; review_datetime: string; review_duration: string | null };
export type Snapshot = {
  bullets: Bullet[];
  references: {source_bullet_id: string; target_bullet_id: string}[];
  effective_tags: {bullet_id: string; tag: string}[];
  scheduler_configs: {id: string; scheduler: Record<string, unknown>}[];
  fsrs: Fsrs[];
  fsrs_bullet: {fsrs_id: string; bullet_id: string}[];
  fsrs_review: Review[];
  fetched_at: string;
};
export type Panel = {kind: "index"} | {kind: "all"} | {kind: "memory"} | {kind: "bullet"; id: string; focus?: string; highlight?: string} | {kind: "fsrs"; id: string} | {kind: "tag"; tag: string};
