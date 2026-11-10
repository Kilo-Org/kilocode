-- Schema and migration journal of a new Kilo v1 session store (kilo.db), as the v1 schema bootstrap writes them.
-- Generated from packages/core/src/database/schema.gen.ts and migration.gen.ts on Kilo v1 main at
-- b6a49d01c10d7e26c42a8a14b3441b7a1856c04c. Regenerate it when v1 adds a migration.

CREATE TABLE `workspace` (
  `id` text PRIMARY KEY,
  `type` text NOT NULL,
  `name` text DEFAULT '' NOT NULL,
  `branch` text,
  `directory` text,
  `extra` text,
  `project_id` text NOT NULL,
  `time_used` integer NOT NULL,
  CONSTRAINT `fk_workspace_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
CREATE TABLE `data_migration` (
  `name` text PRIMARY KEY,
  `time_completed` integer NOT NULL
);
CREATE TABLE `account_state` (
  `id` integer PRIMARY KEY,
  `active_account_id` text,
  `active_org_id` text,
  CONSTRAINT `fk_account_state_active_account_id_account_id_fk` FOREIGN KEY (`active_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL
);
CREATE TABLE `account` (
  `id` text PRIMARY KEY,
  `email` text NOT NULL,
  `url` text NOT NULL,
  `access_token` text NOT NULL,
  `refresh_token` text NOT NULL,
  `token_expiry` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
CREATE TABLE `control_account` (
  `email` text NOT NULL,
  `url` text NOT NULL,
  `access_token` text NOT NULL,
  `refresh_token` text NOT NULL,
  `token_expiry` integer,
  `active` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `control_account_pk` PRIMARY KEY(`email`, `url`)
);
CREATE TABLE `credential` (
  `id` text PRIMARY KEY,
  `integration_id` text,
  `label` text NOT NULL,
  `value` text NOT NULL,
  `connector_id` text,
  `method_id` text,
  `active` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
CREATE TABLE `event_sequence` (
  `aggregate_id` text PRIMARY KEY,
  `seq` integer NOT NULL,
  `owner_id` text
);
CREATE TABLE `event` (
  `id` text PRIMARY KEY,
  `aggregate_id` text NOT NULL,
  `seq` integer NOT NULL,
  `type` text NOT NULL,
  `data` text NOT NULL,
  CONSTRAINT `fk_event_aggregate_id_event_sequence_aggregate_id_fk` FOREIGN KEY (`aggregate_id`) REFERENCES `event_sequence`(`aggregate_id`) ON DELETE CASCADE
);
CREATE TABLE `kilo_board_message` (
  `id` text PRIMARY KEY,
  `board_root_session_id` text NOT NULL,
  `seq` integer NOT NULL,
  `time_created` integer NOT NULL,
  `sender_session_id` text NOT NULL,
  `recipient` text NOT NULL,
  `type` text NOT NULL,
  `body` text NOT NULL,
  `reply_to` text,
  `source_message_id` text NOT NULL,
  `source_call_id` text NOT NULL,
  CONSTRAINT `fk_kilo_board_message_board_root_session_id_kilo_board_root_session_id_fk` FOREIGN KEY (`board_root_session_id`) REFERENCES `kilo_board`(`root_session_id`) ON DELETE CASCADE
);
CREATE TABLE `kilo_board` (
  `root_session_id` text PRIMARY KEY,
  `objective` text NOT NULL,
  `objective_message_id` text,
  `next_seq` integer DEFAULT 1 NOT NULL,
  `cleared_seq` integer DEFAULT 0 NOT NULL,
  `message_count` integer DEFAULT 0 NOT NULL,
  `message_bytes` integer DEFAULT 0 NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_kilo_board_root_session_id_session_id_fk` FOREIGN KEY (`root_session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
CREATE TABLE `kilo_continuation_intent` (
  `account_id` text NOT NULL,
  `operation_key` text NOT NULL,
  `selection_json` text NOT NULL,
  `cloud_origin` text NOT NULL,
  `provider` text NOT NULL,
  `prepared_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  CONSTRAINT `kilo_continuation_intent_pk` PRIMARY KEY(`account_id`, `operation_key`)
);
CREATE TABLE `permission` (
  `id` text PRIMARY KEY,
  `project_id` text NOT NULL,
  `action` text NOT NULL,
  `resource` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_permission_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
CREATE TABLE `project_directory` (
  `project_id` text NOT NULL,
  `directory` text NOT NULL,
  `type` text,
  `strategy` text,
  `time_created` integer NOT NULL,
  CONSTRAINT `project_directory_pk` PRIMARY KEY(`project_id`, `directory`),
  CONSTRAINT `fk_project_directory_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
CREATE TABLE `project` (
  `id` text PRIMARY KEY,
  `worktree` text NOT NULL,
  `vcs` text,
  `name` text,
  `icon_url` text,
  `icon_url_override` text,
  `icon_color` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_initialized` integer,
  `sandboxes` text NOT NULL,
  `commands` text
);
CREATE TABLE `message` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,
  CONSTRAINT `fk_message_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
CREATE TABLE `part` (
  `id` text PRIMARY KEY,
  `message_id` text NOT NULL,
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,
  CONSTRAINT `fk_part_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE
);
CREATE TABLE `session_context_epoch` (
  `session_id` text PRIMARY KEY,
  `baseline` text NOT NULL,
  `snapshot` text NOT NULL,
  `baseline_seq` integer NOT NULL,
  CONSTRAINT `fk_session_context_epoch_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
CREATE TABLE `session_input` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `prompt` text NOT NULL,
  `delivery` text NOT NULL,
  `admitted_seq` integer NOT NULL,
  `promoted_seq` integer,
  `time_created` integer NOT NULL,
  CONSTRAINT `fk_session_input_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
CREATE TABLE `session_message` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `type` text NOT NULL,
  `seq` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,
  CONSTRAINT `fk_session_message_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
CREATE TABLE `session` (
  `id` text PRIMARY KEY,
  `project_id` text NOT NULL,
  `workspace_id` text,
  `parent_id` text,
  `slug` text NOT NULL,
  `directory` text NOT NULL,
  `path` text,
  `title` text NOT NULL,
  `version` text NOT NULL,
  `share_url` text,
  `summary_additions` integer,
  `summary_deletions` integer,
  `summary_files` integer,
  `summary_diffs` text,
  `metadata` text,
  `cost` real DEFAULT 0 NOT NULL,
  `tokens_input` integer DEFAULT 0 NOT NULL,
  `tokens_output` integer DEFAULT 0 NOT NULL,
  `tokens_reasoning` integer DEFAULT 0 NOT NULL,
  `tokens_cache_read` integer DEFAULT 0 NOT NULL,
  `tokens_cache_write` integer DEFAULT 0 NOT NULL,
  `revert` text,
  `permission` text,
  `agent` text,
  `model` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_compacting` integer,
  `time_archived` integer,
  CONSTRAINT `fk_session_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
CREATE TABLE `todo` (
  `session_id` text NOT NULL,
  `content` text NOT NULL,
  `status` text NOT NULL,
  `priority` text NOT NULL,
  `position` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `todo_pk` PRIMARY KEY(`session_id`, `position`),
  CONSTRAINT `fk_todo_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
CREATE TABLE `session_share` (
  `session_id` text PRIMARY KEY,
  `id` text NOT NULL,
  `secret` text NOT NULL,
  `url` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  CONSTRAINT `fk_session_share_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX `event_aggregate_seq_idx` ON `event` (`aggregate_id`,`seq`);
CREATE INDEX `event_aggregate_type_seq_idx` ON `event` (`aggregate_id`,`type`,`seq`);
CREATE INDEX `part_message_id_id_idx` ON `part` (`message_id`,`id`);
CREATE INDEX `part_session_idx` ON `part` (`session_id`);
CREATE INDEX `session_message_time_created_idx` ON `session_message` (`time_created`);
CREATE INDEX `session_project_idx` ON `session` (`project_id`);
CREATE INDEX `session_workspace_idx` ON `session` (`workspace_id`);
CREATE INDEX `session_parent_idx` ON `session` (`parent_id`);
CREATE INDEX `todo_session_idx` ON `todo` (`session_id`);
CREATE TABLE `migration` (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);
INSERT INTO `migration` VALUES ('20260127222353_familiar_lady_ursula', 0);
INSERT INTO `migration` VALUES ('20260211171708_add_project_commands', 0);
INSERT INTO `migration` VALUES ('20260213144116_wakeful_the_professor', 0);
INSERT INTO `migration` VALUES ('20260225215848_workspace', 0);
INSERT INTO `migration` VALUES ('20260227213759_add_session_workspace_id', 0);
INSERT INTO `migration` VALUES ('20260228203230_blue_harpoon', 0);
INSERT INTO `migration` VALUES ('20260303231226_add_workspace_fields', 0);
INSERT INTO `migration` VALUES ('20260309230000_move_org_to_state', 0);
INSERT INTO `migration` VALUES ('20260312043431_session_message_cursor', 0);
INSERT INTO `migration` VALUES ('20260323234822_events', 0);
INSERT INTO `migration` VALUES ('20260410174513_workspace-name', 0);
INSERT INTO `migration` VALUES ('20260413175956_chief_energizer', 0);
INSERT INTO `migration` VALUES ('20260423070820_add_icon_url_override', 0);
INSERT INTO `migration` VALUES ('20260427172553_slow_nightmare', 0);
INSERT INTO `migration` VALUES ('20260428004200_add_session_path', 0);
INSERT INTO `migration` VALUES ('20260501142318_next_venus', 0);
INSERT INTO `migration` VALUES ('20260504145000_add_sync_owner', 0);
INSERT INTO `migration` VALUES ('20260507164347_add_workspace_time', 0);
INSERT INTO `migration` VALUES ('20260510033149_session_usage', 0);
INSERT INTO `migration` VALUES ('20260511000411_data_migration_state', 0);
INSERT INTO `migration` VALUES ('20260511173437_session-metadata', 0);
INSERT INTO `migration` VALUES ('20260601010001_normalize_storage_paths', 0);
INSERT INTO `migration` VALUES ('20260601202201_amazing_prowler', 0);
INSERT INTO `migration` VALUES ('20260602002951_lowly_union_jack', 0);
INSERT INTO `migration` VALUES ('20260602182828_add_project_directories', 0);
INSERT INTO `migration` VALUES ('20260603001617_session_message_projection_indexes', 0);
INSERT INTO `migration` VALUES ('20260603040000_session_message_projection_order', 0);
INSERT INTO `migration` VALUES ('20260603141458_session_input_inbox', 0);
INSERT INTO `migration` VALUES ('20260603160727_jittery_ezekiel_stane', 0);
INSERT INTO `migration` VALUES ('20260604172448_event_sourced_session_input', 0);
INSERT INTO `migration` VALUES ('20260605003541_add_session_context_snapshot', 0);
INSERT INTO `migration` VALUES ('20260605042240_add_context_epoch_agent', 0);
INSERT INTO `migration` VALUES ('20260611035744_credential', 0);
INSERT INTO `migration` VALUES ('20260611192811_lush_chimera', 0);
INSERT INTO `migration` VALUES ('20260612174303_project_dir_strategy', 0);
INSERT INTO `migration` VALUES ('20260622142730_simplify_session_context_epoch', 0);
INSERT INTO `migration` VALUES ('20260622170816_reset_v2_session_state', 0);
INSERT INTO `migration` VALUES ('20260622202450_simplify_session_input', 0);
INSERT INTO `migration` VALUES ('20260714141136_session-message-legacy-writer-compat', 0);
INSERT INTO `migration` VALUES ('20260828074139_kilocode_board', 0);
INSERT INTO `migration` VALUES ('20260903104806_kilocode_board_reset', 0);
INSERT INTO `migration` VALUES ('20260907102000_kilocode_model_usage_index', 0);
INSERT INTO `migration` VALUES ('20261028192305_kilocode_continuation_intent', 0);
