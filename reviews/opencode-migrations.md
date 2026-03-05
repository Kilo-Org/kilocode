# Review: OpenCode Migrations (PR #6622 — OpenCode v1.2.16)

## Files Reviewed

| #   | File                                                                                | Status | +/-  |
| --- | ----------------------------------------------------------------------------------- | ------ | ---- |
| 1   | `packages/opencode/migration/20260225215848_workspace/migration.sql`                | Added  | +7   |
| 2   | `packages/opencode/migration/20260225215848_workspace/snapshot.json`                | Added  | +959 |
| 3   | `packages/opencode/migration/20260227213759_add_session_workspace_id/migration.sql` | Added  | +2   |
| 4   | `packages/opencode/migration/20260227213759_add_session_workspace_id/snapshot.json` | Added  | +983 |

## Summary

Two sequential migrations introduce a new `workspace` concept into the database:

1. **Migration 20260225215848** creates a `workspace` table with columns `id`, `branch`, `project_id`, and `config`, linked to the `project` table via a cascading FK.
2. **Migration 20260227213759** adds a nullable `workspace_id` column to the `session` table, with a non-unique index on it.

These migrations lay the groundwork for associating sessions with workspaces (likely git worktrees managed by the Agent Manager). The migrations are additive-only (new table, new nullable column, new index) and do not modify or drop any existing schema, which is the safest class of migration.

## Detailed Findings

### 1. `migration/20260225215848_workspace/migration.sql`

**Schema:**

```sql
CREATE TABLE `workspace` (
  `id` text PRIMARY KEY,
  `branch` text,
  `project_id` text NOT NULL,
  `config` text NOT NULL,
  CONSTRAINT `fk_workspace_project_id_project_id_fk`
    FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
```

**Observations:**

- **No `time_created` / `time_updated` columns.** Every other table in the schema (`session`, `project`, `message`, `part`, `todo`, `session_share`, `control_account`, `permission`) includes the standard `Timestamps` pair (`time_created INTEGER NOT NULL`, `time_updated INTEGER NOT NULL`) via `schema.sql.ts`. The `workspace` table omits these. This is a **deviation from the established pattern**. If a Drizzle ORM table definition is later added for `workspace` that includes `Timestamps` (as all others do), it will require a third migration to `ALTER TABLE workspace ADD time_created ...` and `ADD time_updated ...` with backfill logic. **Severity: Low-Medium.** Not a data-loss risk, but creates technical debt and a likely follow-up migration.

- **`config` is `text NOT NULL` with no default.** This means every insert must supply a config value. The column stores a JSON blob (per convention in this codebase, e.g., `commands`, `sandboxes`, `data` columns). This is fine for new records, but if any code path attempts to create a workspace without a config, it will fail with a NOT NULL constraint error. **Severity: Low.** Not a migration safety issue; just a runtime consideration.

- **`branch` is nullable.** This is appropriate — not all workspaces may be associated with a specific branch (e.g., the primary worktree).

- **CASCADE on `project_id`.** Deleting a project cascades to delete all its workspaces. This is consistent with the existing pattern (session, permission tables also cascade on project deletion). **No issue.**

- **No indexes on `project_id` or `branch`.** Queries that filter workspaces by project or branch will do full table scans. Given that the workspace table is expected to be small (one per worktree per project), this is acceptable for now. **Severity: Informational.**

### 2. `migration/20260225215848_workspace/snapshot.json`

Auto-generated Drizzle migration snapshot. The snapshot correctly reflects the cumulative schema after this migration, including all pre-existing tables (`project`, `session`, `message`, `part`, `todo`, `permission`, `session_share`, `control_account`) plus the new `workspace` table. The `prevIds` field correctly references the prior snapshot ID (`d2736e43-700f-4e9e-8151-9f2f0d967bc8`).

**No issues.** Standard generated artifact.

### 3. `migration/20260227213759_add_session_workspace_id/migration.sql`

**Schema:**

```sql
ALTER TABLE `session` ADD `workspace_id` text;
CREATE INDEX `session_workspace_idx` ON `session` (`workspace_id`);
```

**Observations:**

- **Nullable column addition — safe migration.** Adding a nullable column to an existing table is a non-destructive operation. All existing sessions will have `workspace_id = NULL`, which is a valid state (local sessions not associated with any workspace). **No data loss risk.**

- **No foreign key constraint on `workspace_id`.** The `session.workspace_id` column is not declared as a FK referencing `workspace(id)`. This is notable because every other cross-table reference in the schema uses explicit FK constraints with `ON DELETE CASCADE`:
  - `session.project_id` → `project(id)` CASCADE
  - `message.session_id` → `session(id)` CASCADE
  - `workspace.project_id` → `project(id)` CASCADE
  - etc.

  Without a FK constraint, deleting a workspace will leave orphaned `workspace_id` values in the `session` table. This is likely intentional — SQLite's `ALTER TABLE ADD COLUMN` does not support adding FK constraints inline, and adding a FK would require recreating the table (which is risky on a populated table in SQLite). The application layer will need to handle cleanup when workspaces are deleted. **Severity: Low-Medium.** Not a migration safety issue, but the lack of referential integrity is a long-term maintenance concern. A comment in the migration or Drizzle schema documenting this decision would be valuable.

- **Index on `workspace_id` is appropriate.** Queries filtering or joining sessions by workspace will benefit from this index. The index includes NULL values, which is correct for SQLite.

- **Missing trailing newline.** The patch shows `\ No newline at end of file`. This is a minor style issue (some tools and linters flag this). **Severity: Trivial.**

### 4. `migration/20260227213759_add_session_workspace_id/snapshot.json`

Auto-generated Drizzle migration snapshot. The `prevIds` field correctly chains to the workspace creation migration (`1f1dbf2d-bf66-4b25-8af4-4ba7633b7e40`). The snapshot includes the new `workspace_id` column on the `session` table (type: `text`, `notNull: false`) and the new `session_workspace_idx` index.

**No issues.** Standard generated artifact.

## Risk to VS Code Extension

**Risk: Low.**

The VS Code extension (`packages/kilo-vscode/`) communicates with the CLI server via the `@kilocode/sdk` and consumes `Session` objects. The current `Session` type in the SDK (`packages/sdk/js/src/v2/gen/types.gen.ts:818`) does not include a `workspaceID` field. These migrations only change the database schema; they do not change:

- The `Session.Info` Zod schema (`packages/opencode/src/session/index.ts:116`) — no `workspaceID` field is added to the Info type
- The `fromRow()` / `toRow()` functions — they do not read/write `workspace_id`
- The server API routes — no new query parameters or response fields
- The SDK types — unchanged

The extension's Agent Manager already tracks worktree-session associations client-side via `WorktreeStateManager` (using `ManagedSession.worktreeId`). These migrations appear to be preparation for moving that association server-side, but since `workspace_id` is not yet exposed through the API, the extension is unaffected.

**When `workspace_id` is eventually exposed in `Session.Info` and the SDK is regenerated**, the extension will need to be updated. The field will be optional (nullable), so existing extension code will not break, but the Agent Manager may want to consume it to replace or supplement its local `worktreeId` tracking.

**One concern:** If a future version of the CLI server starts populating `workspace_id` and the extension is running an older SDK version that doesn't include the field, the extra field will simply be ignored by TypeScript (it's not validated at runtime). No breakage expected.

## Overall Risk

**Low.**

Both migrations are purely additive:

- A new table creation (`workspace`)
- A nullable column addition to an existing table (`session.workspace_id`)
- A new index

No existing data is modified, moved, or deleted. No existing columns are altered. No table is dropped or recreated. The `drizzle-orm/bun-sqlite/migrator` applies these sequentially, and both operations are idempotent in the sense that they will fail gracefully if already applied (Drizzle's migration journal tracks applied migrations by timestamp).

**Residual risks:**

1. The `workspace` table omitting `time_created`/`time_updated` will likely require a follow-up migration.
2. The absence of a FK constraint on `session.workspace_id` → `workspace(id)` means the application must handle orphan cleanup.
3. The `config NOT NULL` constraint on `workspace` means all insert paths must supply a config value from day one.

None of these represent data loss, corruption, or backward compatibility risks. They are design decisions that create minor technical debt.
