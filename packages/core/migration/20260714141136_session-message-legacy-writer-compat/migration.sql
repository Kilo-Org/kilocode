-- kilocode_change - new file
CREATE TABLE `__new_session_message` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`seq` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT `fk_session_message_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_session_message`(`id`, `session_id`, `type`, `seq`, `time_created`, `time_updated`, `data`) SELECT `id`, `session_id`, `type`, `seq`, `time_created`, `time_updated`, `data` FROM `session_message`;--> statement-breakpoint
DROP TABLE `session_message`;--> statement-breakpoint
ALTER TABLE `__new_session_message` RENAME TO `session_message`;--> statement-breakpoint
CREATE UNIQUE INDEX `session_message_session_seq_idx` ON `session_message` (`session_id`,`seq`);--> statement-breakpoint
CREATE INDEX `session_message_session_type_seq_idx` ON `session_message` (`session_id`,`type`,`seq`);--> statement-breakpoint
CREATE INDEX `session_message_session_time_created_id_idx` ON `session_message` (`session_id`,`time_created`,`id`);--> statement-breakpoint
CREATE INDEX `session_message_time_created_idx` ON `session_message` (`time_created`);
