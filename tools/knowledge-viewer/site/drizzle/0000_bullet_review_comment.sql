CREATE TABLE `bullet_review_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`bullet_ids` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bullet_review_comment_draft_idx` ON `bullet_review_comment` (`draft_id`,`created_at`);
