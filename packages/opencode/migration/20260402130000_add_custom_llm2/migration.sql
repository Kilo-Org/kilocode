CREATE TABLE `custom_llm2` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
