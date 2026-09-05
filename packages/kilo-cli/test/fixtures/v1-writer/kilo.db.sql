PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
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
INSERT INTO event_sequence VALUES('ses_f8f1b4717ffezqT4RcVu03DmkY',11,NULL);
CREATE TABLE `event` (
          `id` text PRIMARY KEY,
          `aggregate_id` text NOT NULL,
          `seq` integer NOT NULL,
          `type` text NOT NULL,
          `data` text NOT NULL,
          CONSTRAINT `fk_event_aggregate_id_event_sequence_aggregate_id_fk` FOREIGN KEY (`aggregate_id`) REFERENCES `event_sequence`(`aggregate_id`) ON DELETE CASCADE
        );
INSERT INTO event VALUES('evt_070e4b8e9001QFngBm7Vgz50KT','ses_f8f1b4717ffezqT4RcVu03DmkY',0,'session.created.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","info":{"id":"ses_f8f1b4717ffezqT4RcVu03DmkY","slug":"lucky-tiger","projectID":"prj_v1_writer_fixture","directory":"/tmp/kilo-v1-writer-fixture-project","path":"","cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"title":"Actual V1 writer fixture","agent":"build","model":{"id":"fixture-model","providerID":"fixture-provider","variant":"fixture-variant"},"version":"local","time":{"created":1788600432872,"updated":1788600432872}}}');
INSERT INTO event VALUES('evt_070e4b8ed001qrXGxi0k8XMDWz','ses_f8f1b4717ffezqT4RcVu03DmkY',1,'session.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","info":{"id":"ses_f8f1b4717ffezqT4RcVu03DmkY","slug":"lucky-tiger","projectID":"prj_v1_writer_fixture","directory":"/tmp/kilo-v1-writer-fixture-project","path":"","summary":{"additions":1,"deletions":0,"files":1,"diffs":[{"file":"fixture.ts","patch":"@@ -0,0 +1 @@\n+fixture\n","before":"","after":"fixture\n","additions":1,"deletions":0,"status":"modified"}]},"cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"title":"Actual V1 writer fixture","agent":"build","model":{"id":"fixture-model","providerID":"fixture-provider","variant":"fixture-variant"},"version":"local","time":{"created":1788600432872,"updated":1788600432876}}}');
INSERT INTO event VALUES('evt_070e4b8ee001SK74K3zPCdCbbx','ses_f8f1b4717ffezqT4RcVu03DmkY',2,'message.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","info":{"id":"msg_fixture_user","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","role":"user","time":{"created":10},"summary":{"title":"fixture summary","body":"fixture body","diffs":[{"file":"fixture.ts","patch":"@@ -0,0 +1 @@\n+fixture\n","before":"","after":"fixture\n","additions":1,"deletions":0,"status":"modified"}]},"agent":"build","model":{"providerID":"fixture-provider","modelID":"fixture-model","variant":"fixture-variant"},"system":"fixture system context","tools":{"bash":true},"editorContext":{"directory":"/tmp/kilo-v1-writer-fixture-project","worktree":"/tmp/kilo-v1-writer-fixture-project","visibleFiles":["fixture.ts"],"openTabs":["fixture.ts"],"activeFile":"fixture.ts","shell":"zsh"}}}');
INSERT INTO event VALUES('evt_070e4b8ef001ioRlhxFE5v7QEV','ses_f8f1b4717ffezqT4RcVu03DmkY',3,'message.part.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","part":{"id":"prt_fixture_user_text","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","messageID":"msg_fixture_user","type":"text","text":"hello from the actual V1 writer","time":{"start":10,"end":11},"metadata":{"origin":"fixture"}},"time":1788600432879}');
INSERT INTO event VALUES('evt_070e4b8f0001PT1q4eEXF0c7tC','ses_f8f1b4717ffezqT4RcVu03DmkY',4,'message.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","info":{"id":"msg_fixture_assistant","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","role":"assistant","time":{"created":20,"completed":25},"parentID":"msg_fixture_user","modelID":"fixture-model","providerID":"fixture-provider","mode":"build","agent":"build","path":{"cwd":"/tmp/kilo-v1-writer-fixture-project","root":"/tmp/kilo-v1-writer-fixture-project"},"cost":0.5,"tokens":{"total":17,"input":2,"output":3,"reasoning":4,"cache":{"read":5,"write":6}},"structured":{"fixture":true},"variant":"fixture-variant","finish":"end_turn"}}');
INSERT INTO event VALUES('evt_070e4b8f0002mHOYsdsOn8NCFi','ses_f8f1b4717ffezqT4RcVu03DmkY',5,'message.part.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","part":{"id":"prt_fixture_assistant_text","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","messageID":"msg_fixture_assistant","type":"text","text":"assistant response from the actual V1 writer","time":{"start":20,"end":21}},"time":1788600432880}');
INSERT INTO event VALUES('evt_070e4b8f1001ETphiTgzgh1jEU','ses_f8f1b4717ffezqT4RcVu03DmkY',6,'message.part.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","part":{"id":"prt_fixture_tool","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","messageID":"msg_fixture_assistant","type":"tool","callID":"call_fixture","tool":"bash","state":{"status":"completed","input":{"command":"printf fixture","description":"fixture command"},"output":"fixture\n","title":"fixture command","metadata":{"origin":"fixture"},"time":{"start":22,"end":23}}},"time":1788600432881}');
INSERT INTO event VALUES('evt_070e4b8f60017TUGUqLkHyItFw','ses_f8f1b4717ffezqT4RcVu03DmkY',7,'message.part.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","part":{"id":"prt_fixture_step_finish","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","messageID":"msg_fixture_assistant","type":"step-finish","reason":"stop","model":{"providerID":"fixture-provider","modelID":"fixture-model"},"generationID":"generation_fixture","vercelID":"vercel_fixture","metrics":{"prompt":101,"generation":202,"source":"provider"},"time":{"start":20,"end":25,"elapsed":5},"cost":0.5,"tokens":{"total":17,"input":2,"output":3,"reasoning":4,"cache":{"read":5,"write":6}}},"time":1788600432886}');
INSERT INTO event VALUES('evt_070e4b8f70010zZA4u4gNXsJkd','ses_f8f1b4717ffezqT4RcVu03DmkY',8,'message.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","info":{"id":"msg_fixture_compaction","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","role":"user","time":{"created":30},"agent":"build","model":{"providerID":"fixture-provider","modelID":"fixture-model","variant":"fixture-variant"}}}');
INSERT INTO event VALUES('evt_070e4b8f7002lB0f2eHGUDcOO1','ses_f8f1b4717ffezqT4RcVu03DmkY',9,'message.part.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","part":{"id":"prt_fixture_compaction","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","messageID":"msg_fixture_compaction","type":"compaction","auto":true,"tail_start_id":"msg_fixture_user"},"time":1788600432887}');
INSERT INTO event VALUES('evt_070e4b8f8001N0VMKwFapNlCBh','ses_f8f1b4717ffezqT4RcVu03DmkY',10,'message.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","info":{"id":"msg_fixture_summary","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","role":"assistant","time":{"created":31,"completed":32},"parentID":"msg_fixture_compaction","modelID":"fixture-model","providerID":"fixture-provider","mode":"build","agent":"build","path":{"cwd":"/tmp/kilo-v1-writer-fixture-project","root":"/tmp/kilo-v1-writer-fixture-project"},"summary":true,"cost":0.25,"tokens":{"total":7,"input":1,"output":2,"reasoning":1,"cache":{"read":2,"write":1}},"finish":"end_turn"}}');
INSERT INTO event VALUES('evt_070e4b8f8002YD3x5Ltou9cxeC','ses_f8f1b4717ffezqT4RcVu03DmkY',11,'message.part.updated.1','{"sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","part":{"id":"prt_fixture_summary_text","sessionID":"ses_f8f1b4717ffezqT4RcVu03DmkY","messageID":"msg_fixture_summary","type":"text","text":"compaction summary from the actual V1 writer"},"time":1788600432888}');
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
INSERT INTO project VALUES('prj_v1_writer_fixture','/tmp/kilo-v1-writer-fixture-project',NULL,NULL,NULL,NULL,NULL,1,1,NULL,'[]',NULL);
CREATE TABLE `message` (
          `id` text PRIMARY KEY,
          `session_id` text NOT NULL,
          `time_created` integer NOT NULL,
          `time_updated` integer NOT NULL,
          `data` text NOT NULL,
          CONSTRAINT `fk_message_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
        );
INSERT INTO message VALUES('msg_fixture_user','ses_f8f1b4717ffezqT4RcVu03DmkY',10,1788600432878,'{"role":"user","time":{"created":10},"agent":"build","model":{"providerID":"fixture-provider","modelID":"fixture-model","variant":"fixture-variant"},"system":"fixture system context","tools":{"bash":true},"editorContext":{"directory":"/tmp/kilo-v1-writer-fixture-project","worktree":"/tmp/kilo-v1-writer-fixture-project","visibleFiles":["fixture.ts"],"openTabs":["fixture.ts"],"activeFile":"fixture.ts","shell":"zsh"},"summary":{"title":"fixture summary","body":"fixture body","diffs":[{"file":"fixture.ts","patch":"@@ -0,0 +1 @@\n+fixture\n","before":"","after":"fixture\n","additions":1,"deletions":0,"status":"modified"}]}}');
INSERT INTO message VALUES('msg_fixture_assistant','ses_f8f1b4717ffezqT4RcVu03DmkY',20,1788600432880,'{"role":"assistant","time":{"created":20,"completed":25},"parentID":"msg_fixture_user","modelID":"fixture-model","providerID":"fixture-provider","mode":"build","agent":"build","path":{"cwd":"/tmp/kilo-v1-writer-fixture-project","root":"/tmp/kilo-v1-writer-fixture-project"},"cost":0.5,"tokens":{"total":17,"input":2,"output":3,"reasoning":4,"cache":{"read":5,"write":6}},"structured":{"fixture":true},"variant":"fixture-variant","finish":"end_turn"}');
INSERT INTO message VALUES('msg_fixture_compaction','ses_f8f1b4717ffezqT4RcVu03DmkY',30,1788600432887,'{"role":"user","time":{"created":30},"agent":"build","model":{"providerID":"fixture-provider","modelID":"fixture-model","variant":"fixture-variant"}}');
INSERT INTO message VALUES('msg_fixture_summary','ses_f8f1b4717ffezqT4RcVu03DmkY',31,1788600432888,'{"role":"assistant","time":{"created":31,"completed":32},"parentID":"msg_fixture_compaction","modelID":"fixture-model","providerID":"fixture-provider","mode":"build","agent":"build","path":{"cwd":"/tmp/kilo-v1-writer-fixture-project","root":"/tmp/kilo-v1-writer-fixture-project"},"summary":true,"cost":0.25,"tokens":{"total":7,"input":1,"output":2,"reasoning":1,"cache":{"read":2,"write":1}},"finish":"end_turn"}');
CREATE TABLE `part` (
          `id` text PRIMARY KEY,
          `message_id` text NOT NULL,
          `session_id` text NOT NULL,
          `time_created` integer NOT NULL,
          `time_updated` integer NOT NULL,
          `data` text NOT NULL,
          CONSTRAINT `fk_part_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE
        );
INSERT INTO part VALUES('prt_fixture_user_text','msg_fixture_user','ses_f8f1b4717ffezqT4RcVu03DmkY',1788600432879,1788600432879,'{"type":"text","text":"hello from the actual V1 writer","time":{"start":10,"end":11},"metadata":{"origin":"fixture"}}');
INSERT INTO part VALUES('prt_fixture_assistant_text','msg_fixture_assistant','ses_f8f1b4717ffezqT4RcVu03DmkY',1788600432880,1788600432880,'{"type":"text","text":"assistant response from the actual V1 writer","time":{"start":20,"end":21}}');
INSERT INTO part VALUES('prt_fixture_tool','msg_fixture_assistant','ses_f8f1b4717ffezqT4RcVu03DmkY',1788600432881,1788600432882,'{"type":"tool","callID":"call_fixture","tool":"bash","state":{"status":"completed","input":{"command":"printf fixture","description":"fixture command"},"output":"fixture\n","title":"fixture command","metadata":{"origin":"fixture"},"time":{"start":22,"end":23}}}');
INSERT INTO part VALUES('prt_fixture_step_finish','msg_fixture_assistant','ses_f8f1b4717ffezqT4RcVu03DmkY',1788600432886,1788600432886,'{"type":"step-finish","reason":"stop","model":{"providerID":"fixture-provider","modelID":"fixture-model"},"generationID":"generation_fixture","vercelID":"vercel_fixture","metrics":{"prompt":101,"generation":202,"source":"provider"},"time":{"start":20,"end":25,"elapsed":5},"cost":0.5,"tokens":{"total":17,"input":2,"output":3,"reasoning":4,"cache":{"read":5,"write":6}}}');
INSERT INTO part VALUES('prt_fixture_compaction','msg_fixture_compaction','ses_f8f1b4717ffezqT4RcVu03DmkY',1788600432887,1788600432887,'{"type":"compaction","auto":true,"tail_start_id":"msg_fixture_user"}');
INSERT INTO part VALUES('prt_fixture_summary_text','msg_fixture_summary','ses_f8f1b4717ffezqT4RcVu03DmkY',1788600432888,1788600432888,'{"type":"text","text":"compaction summary from the actual V1 writer"}');
CREATE TABLE `session_context_epoch` (
          `session_id` text PRIMARY KEY,
          `baseline` text NOT NULL,
          `snapshot` text NOT NULL,
          `baseline_seq` integer NOT NULL, `agent` text DEFAULT 'build' NOT NULL, `replacement_seq` integer, `revision` integer DEFAULT 0 NOT NULL,
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
INSERT INTO session VALUES('ses_f8f1b4717ffezqT4RcVu03DmkY','prj_v1_writer_fixture',NULL,NULL,'lucky-tiger','/tmp/kilo-v1-writer-fixture-project','','Actual V1 writer fixture','local',NULL,1,0,1,'[{"file":"fixture.ts","patch":"@@ -0,0 +1 @@\n+fixture\n","before":"","after":"fixture\n","additions":1,"deletions":0,"status":"modified"}]',NULL,0.5,2,3,4,5,6,NULL,NULL,'build','{"id":"fixture-model","providerID":"fixture-provider","variant":"fixture-variant"}',1788600432872,1788600432876,NULL,NULL);
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
CREATE TABLE IF NOT EXISTS "migration" (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);
INSERT INTO migration VALUES('20260127222353_familiar_lady_ursula',1788600432862);
INSERT INTO migration VALUES('20260211171708_add_project_commands',1788600432863);
INSERT INTO migration VALUES('20260213144116_wakeful_the_professor',1788600432863);
INSERT INTO migration VALUES('20260225215848_workspace',1788600432863);
INSERT INTO migration VALUES('20260227213759_add_session_workspace_id',1788600432863);
INSERT INTO migration VALUES('20260228203230_blue_harpoon',1788600432863);
INSERT INTO migration VALUES('20260303231226_add_workspace_fields',1788600432863);
INSERT INTO migration VALUES('20260309230000_move_org_to_state',1788600432863);
INSERT INTO migration VALUES('20260312043431_session_message_cursor',1788600432863);
INSERT INTO migration VALUES('20260323234822_events',1788600432863);
INSERT INTO migration VALUES('20260410174513_workspace-name',1788600432863);
INSERT INTO migration VALUES('20260413175956_chief_energizer',1788600432863);
INSERT INTO migration VALUES('20260423070820_add_icon_url_override',1788600432863);
INSERT INTO migration VALUES('20260427172553_slow_nightmare',1788600432863);
INSERT INTO migration VALUES('20260428004200_add_session_path',1788600432863);
INSERT INTO migration VALUES('20260501142318_next_venus',1788600432863);
INSERT INTO migration VALUES('20260504145000_add_sync_owner',1788600432863);
INSERT INTO migration VALUES('20260507164347_add_workspace_time',1788600432863);
INSERT INTO migration VALUES('20260510033149_session_usage',1788600432863);
INSERT INTO migration VALUES('20260511000411_data_migration_state',1788600432863);
INSERT INTO migration VALUES('20260511173437_session-metadata',1788600432863);
INSERT INTO migration VALUES('20260601010001_normalize_storage_paths',1788600432863);
INSERT INTO migration VALUES('20260601202201_amazing_prowler',1788600432863);
INSERT INTO migration VALUES('20260602002951_lowly_union_jack',1788600432863);
INSERT INTO migration VALUES('20260602182828_add_project_directories',1788600432863);
INSERT INTO migration VALUES('20260603001617_session_message_projection_indexes',1788600432863);
INSERT INTO migration VALUES('20260603040000_session_message_projection_order',1788600432863);
INSERT INTO migration VALUES('20260603141458_session_input_inbox',1788600432863);
INSERT INTO migration VALUES('20260603160727_jittery_ezekiel_stane',1788600432863);
INSERT INTO migration VALUES('20260604172448_event_sourced_session_input',1788600432863);
INSERT INTO migration VALUES('20260605003541_add_session_context_snapshot',1788600432863);
INSERT INTO migration VALUES('20260605042240_add_context_epoch_agent',1788600432863);
INSERT INTO migration VALUES('20260611035744_credential',1788600432863);
INSERT INTO migration VALUES('20260611192811_lush_chimera',1788600432863);
INSERT INTO migration VALUES('20260612174303_project_dir_strategy',1788600432863);
INSERT INTO migration VALUES('20260622142730_simplify_session_context_epoch',1788600432863);
INSERT INTO migration VALUES('20260622170816_reset_v2_session_state',1788600432863);
INSERT INTO migration VALUES('20260622202450_simplify_session_input',1788600432863);
INSERT INTO migration VALUES('20260714141136_session-message-legacy-writer-compat',1788600432863);
CREATE UNIQUE INDEX `event_aggregate_seq_idx` ON `event` (`aggregate_id`,`seq`);
CREATE INDEX `event_aggregate_type_seq_idx` ON `event` (`aggregate_id`,`type`,`seq`);
CREATE UNIQUE INDEX `permission_project_action_resource_idx` ON `permission` (`project_id`,`action`,`resource`);
CREATE INDEX `message_session_time_created_id_idx` ON `message` (`session_id`,`time_created`,`id`);
CREATE INDEX `part_message_id_id_idx` ON `part` (`message_id`,`id`);
CREATE INDEX `part_session_idx` ON `part` (`session_id`);
CREATE INDEX `recall_part_search_idx` ON `part` (`session_id`,`id`,`message_id`,json_extract("data", '$.type'),CASE WHEN json_extract("data", '$.type') = 'text' THEN coalesce(json_extract("data", '$.text'), '') WHEN json_extract("data", '$.type') = 'file' THEN trim(coalesce(json_extract("data", '$.filename'), '') || ' ' || CASE WHEN coalesce(json_extract("data", '$.url'), '') NOT LIKE 'data:%' THEN coalesce(json_extract("data", '$.url'), '') ELSE '' END || ' ' || coalesce(json_extract("data", '$.source.path'), '') || ' ' || coalesce(json_extract("data", '$.source.name'), '') || ' ' || CASE WHEN coalesce(json_extract("data", '$.source.uri'), '') NOT LIKE 'data:%' THEN coalesce(json_extract("data", '$.source.uri'), '') ELSE '' END || ' ' || coalesce(json_extract("data", '$.source.clientName'), '')) ELSE coalesce(json_extract("data", '$.state.error'), '') END) WHERE json_valid("part"."data") AND ((json_extract("part"."data", '$.type') = 'text' AND coalesce(json_extract("part"."data", '$.synthetic'), 0) = 0 AND coalesce(json_extract("part"."data", '$.ignored'), 0) = 0) OR json_extract("part"."data", '$.type') = 'file' OR (json_extract("part"."data", '$.type') = 'tool' AND json_extract("part"."data", '$.state.status') = 'error'));
CREATE INDEX `session_input_session_pending_delivery_seq_idx` ON `session_input` (`session_id`,`promoted_seq`,`delivery`,`admitted_seq`);
CREATE UNIQUE INDEX `session_input_session_admitted_seq_idx` ON `session_input` (`session_id`,`admitted_seq`);
CREATE UNIQUE INDEX `session_input_session_promoted_seq_idx` ON `session_input` (`session_id`,`promoted_seq`);
CREATE UNIQUE INDEX `session_message_session_seq_idx` ON `session_message` (`session_id`,`seq`);
CREATE INDEX `session_message_session_type_seq_idx` ON `session_message` (`session_id`,`type`,`seq`);
CREATE INDEX `session_message_session_time_created_id_idx` ON `session_message` (`session_id`,`time_created`,`id`);
CREATE INDEX `session_message_time_created_idx` ON `session_message` (`time_created`);
CREATE INDEX `session_project_idx` ON `session` (`project_id`);
CREATE INDEX `session_workspace_idx` ON `session` (`workspace_id`);
CREATE INDEX `session_parent_idx` ON `session` (`parent_id`);
CREATE INDEX `todo_session_idx` ON `todo` (`session_id`);
COMMIT;
