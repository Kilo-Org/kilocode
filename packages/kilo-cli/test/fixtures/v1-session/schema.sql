-- Synthetic Kilo V1 session store schema, shaped by the audited origin/main
-- (1536aef0fbe96c4575d23e9de2d50ba897f6b8ac) bootstrap DDL in
-- packages/core/src/database/schema.gen.ts plus the v1 migration journal.
-- Indexes are omitted: they do not affect copy correctness. See
-- kilocode/baseline/v1-session-schema-audit.md for the mapping evidence.

CREATE TABLE "migration" (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);

CREATE TABLE "project" (
  "id" text PRIMARY KEY,
  "worktree" text NOT NULL,
  "vcs" text,
  "name" text,
  "icon_url" text,
  "icon_url_override" text,
  "icon_color" text,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  "time_initialized" integer,
  "sandboxes" text NOT NULL,
  "commands" text
);

CREATE TABLE "session" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "workspace_id" text,
  "parent_id" text,
  "slug" text NOT NULL,
  "directory" text NOT NULL,
  "path" text,
  "title" text NOT NULL,
  "version" text NOT NULL,
  "share_url" text,
  "summary_additions" integer,
  "summary_deletions" integer,
  "summary_files" integer,
  "summary_diffs" text,
  "metadata" text,
  "cost" real DEFAULT 0 NOT NULL,
  "tokens_input" integer DEFAULT 0 NOT NULL,
  "tokens_output" integer DEFAULT 0 NOT NULL,
  "tokens_reasoning" integer DEFAULT 0 NOT NULL,
  "tokens_cache_read" integer DEFAULT 0 NOT NULL,
  "tokens_cache_write" integer DEFAULT 0 NOT NULL,
  "revert" text,
  "permission" text,
  "agent" text,
  "model" text,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  "time_compacting" integer,
  "time_archived" integer,
  CONSTRAINT "fk_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
);

CREATE TABLE "message" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  "data" text NOT NULL,
  CONSTRAINT "fk_message_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE TABLE "part" (
  "id" text PRIMARY KEY,
  "message_id" text NOT NULL,
  "session_id" text NOT NULL,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  "data" text NOT NULL,
  CONSTRAINT "fk_part_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE
);

-- V1 dual-written projection; note the nullable seq from
-- 20260714141136_session-message-legacy-writer-compat.
CREATE TABLE "session_message" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL,
  "type" text NOT NULL,
  "seq" integer,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  "data" text NOT NULL,
  CONSTRAINT "fk_session_message_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE TABLE "event_sequence" (
  "aggregate_id" text PRIMARY KEY,
  "seq" integer NOT NULL,
  "owner_id" text
);

-- V1 event table has no "created" column; v2 adds it via 20260804233008_loose_psylocke.
CREATE TABLE "event" (
  "id" text PRIMARY KEY,
  "aggregate_id" text NOT NULL,
  "seq" integer NOT NULL,
  "type" text NOT NULL,
  "data" text NOT NULL,
  CONSTRAINT "fk_event_aggregate_id_event_sequence_aggregate_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "event_sequence"("aggregate_id") ON DELETE CASCADE
);

CREATE TABLE "todo" (
  "session_id" text NOT NULL,
  "content" text NOT NULL,
  "status" text NOT NULL,
  "priority" text NOT NULL,
  "position" integer NOT NULL,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  CONSTRAINT "todo_pk" PRIMARY KEY("session_id", "position"),
  CONSTRAINT "fk_todo_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE TABLE "session_share" (
  "session_id" text PRIMARY KEY,
  "id" text NOT NULL,
  "secret" text NOT NULL,
  "url" text NOT NULL,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  CONSTRAINT "fk_session_share_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE TABLE "session_input" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL,
  "prompt" text NOT NULL,
  "delivery" text NOT NULL,
  "admitted_seq" integer NOT NULL,
  "promoted_seq" integer,
  "time_created" integer NOT NULL,
  CONSTRAINT "fk_session_input_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE TABLE "session_context_epoch" (
  "session_id" text PRIMARY KEY,
  "baseline" text NOT NULL,
  "snapshot" text NOT NULL,
  "baseline_seq" integer NOT NULL,
  CONSTRAINT "fk_session_context_epoch_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE TABLE "data_migration" (
  "name" text PRIMARY KEY,
  "time_completed" integer NOT NULL
);

CREATE TABLE "project_directory" (
  "project_id" text NOT NULL,
  "directory" text NOT NULL,
  "type" text,
  "strategy" text,
  "time_created" integer NOT NULL,
  CONSTRAINT "project_directory_pk" PRIMARY KEY("project_id", "directory"),
  CONSTRAINT "fk_project_directory_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
);

CREATE TABLE "workspace" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "name" text DEFAULT '' NOT NULL,
  "branch" text,
  "directory" text,
  "extra" text,
  "project_id" text NOT NULL,
  "time_used" integer NOT NULL,
  CONSTRAINT "fk_workspace_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
);

CREATE TABLE "permission" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "action" text NOT NULL,
  "resource" text NOT NULL,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  CONSTRAINT "fk_permission_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
);

CREATE TABLE "account" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL,
  "url" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "token_expiry" integer,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL
);

CREATE TABLE "account_state" (
  "id" integer PRIMARY KEY,
  "active_account_id" text,
  "active_org_id" text,
  CONSTRAINT "fk_account_state_active_account_id_account_id_fk" FOREIGN KEY ("active_account_id") REFERENCES "account"("id") ON DELETE SET NULL
);

CREATE TABLE "control_account" (
  "email" text NOT NULL,
  "url" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "token_expiry" integer,
  "active" integer NOT NULL,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  CONSTRAINT "control_account_pk" PRIMARY KEY("email", "url")
);

CREATE TABLE "credential" (
  "id" text PRIMARY KEY,
  "integration_id" text,
  "label" text NOT NULL,
  "value" text NOT NULL,
  "connector_id" text,
  "method_id" text,
  "active" integer,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL
);

CREATE TABLE "kilo_board" (
  "root_session_id" text PRIMARY KEY,
  "objective" text NOT NULL,
  "objective_message_id" text,
  "next_seq" integer DEFAULT 1 NOT NULL,
  "message_count" integer DEFAULT 0 NOT NULL,
  "message_bytes" integer DEFAULT 0 NOT NULL,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  CONSTRAINT "fk_kilo_board_root_session_id_session_id_fk" FOREIGN KEY ("root_session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE TABLE "kilo_board_message" (
  "id" text PRIMARY KEY,
  "board_root_session_id" text NOT NULL,
  "seq" integer NOT NULL,
  "time_created" integer NOT NULL,
  "sender_session_id" text NOT NULL,
  "recipient" text NOT NULL,
  "type" text NOT NULL,
  "body" text NOT NULL,
  "reply_to" text,
  "source_message_id" text NOT NULL,
  "source_call_id" text NOT NULL,
  CONSTRAINT "fk_kilo_board_message_board_root_session_id_kilo_board_root_session_id_fk" FOREIGN KEY ("board_root_session_id") REFERENCES "kilo_board"("root_session_id") ON DELETE CASCADE
);
