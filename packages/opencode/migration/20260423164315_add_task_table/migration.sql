CREATE TABLE `task` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL DEFAULT '',
	`status` text NOT NULL DEFAULT 'open',
	`priority` text NOT NULL DEFAULT 'medium',
	`assignee` text,
	`depends_on` text,
	`worktree` text,
	`pr` text,
	`summary` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_task_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `task_session_idx` ON `task` (`session_id`);
