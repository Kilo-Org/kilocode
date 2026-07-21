# Kilo-Specific Test Audit: OpenCode v1.17.5 Merge (PR #12404)

## Scope and Methodology

Reviewed `origin/main...HEAD` on `marius-kilocode/review-opencode-v1.17.5` for removed or weakened Kilo-specific tests. The audit covered:

- Test/spec paths changed by the PR and deleted test files.
- Full diffs of the Kilo-sensitive shared and Kilo-owned tests: catalog credential routing, credential storage, auth-v2 migration, logout removal, and JSON storage migration.
- Removed `kilocode_change` test blocks, added `.skip` / `.todo` markers, and Kilo test-directory counts relative to `.worktrees/opencode-merge/kilo-main`.
- Pristine upstream `v1.17.5` and upstream commit `30aec297d8` (OpenCode PR #31968) to distinguish intended connector-to-integration changes from Kilo-specific merge fallout.
- Targeted execution of the reviewed Core and CLI test files.

No source files were edited. This report is the only file created by this audit.

## Findings

### Needs Human Verification: six Kilo OAuth regression tests were deleted without integration-suite replacements

`packages/core/test/connector.test.ts` was removed as part of upstream PR #31968, which replaces `Connector` with `Integration`. The replacement `packages/core/test/integration.test.ts` retains general OAuth success, normal cancellation, and expiry coverage, but it does not recreate the six Kilo-marked regression cases that were at `origin/main:packages/core/test/connector.test.ts:361-640`:

- Auto OAuth reports a failed attempt when credential persistence fails.
- Code OAuth reports a failed attempt when credential persistence fails.
- Credential persistence completes if cancellation races after persistence has started.
- A code OAuth attempt remains valid while its callback is completing.
- A stalled code callback times out, fails, and releases its attempt.
- A stalled credential write times out, fails, and releases its attempt.

The current implementation has Kilo guards for this behavior in `packages/core/src/integration.ts:250,378-380,428,523-557`. Commit `06d871409b` restored atomic settlement, cancellation/expiry exclusion while settling, and a 30-second timeout after the connector-to-integration migration. The new `packages/core/test/integration.test.ts:167-336` covers code completion, cancellation before settlement, auto completion, and expiry, but not persistence failure, completion/cancellation races, or either timeout path.

This is a real loss of regression coverage, even though the production safeguards are present. Confirm whether those six tests are intentionally retired with the old API or should be ported to `Integration`.

### No Finding: auth-v2 migration keeps the required active-account and organization behavior

`packages/core/test/kilocode/account-auth-v2-migration.test.ts` changed from preserving two credentials plus an active selection to the new one-credential-per-integration model. The test still supplies two Kilo OAuth accounts and selects `acc_second`; it asserts that exactly `second` is imported, that the integration list has one credential, and that it retains both `access-second` and `metadata.accountID = org-second` (`:50-97`).

The removed assertion that both accounts survive is intentional under the documented new model: `// one credential per integration: only the active account is imported`. The active-account import and Kilo organization metadata are still explicitly asserted.

### No Finding: OAuth organization routing and provider logout cleanup remain asserted

- `packages/core/test/catalog.test.ts:41-75` still injects a Kilo OAuth credential with `accountID: "organization"` and asserts `apiKey: "access"` plus `kilocodeOrganizationId: "organization"` in the provider request body.
- `packages/opencode/test/kilocode/auth-remove.test.ts:23-43` still creates two Anthropic credentials, invokes `remove("anthropic")`, asserts the integration list is empty, and verifies legacy `Auth.remove()` ran. The old `active()` assertion was removed because the integration API has no active credential concept.

### No Finding: Kilo JSON migration coverage is intact

`packages/opencode/test/kilocode/storage/json-migration.test.ts` has 24 test cases before and after the merge. The diff only changes database setup from hand-loading legacy migration SQL to initializing a temporary database through the production Core migration runner, then tolerates delayed Windows SQLite WAL cleanup. The project, session, message, part, todo, permission, sharing, bootstrap/retry, and corruption cases remain present.

### No Finding: credential-test reductions follow removed active-credential semantics

The Kilo `KILO_AUTH_CONTENT` isolation test remains in `packages/core/test/credential.test.ts:55-123`, including environment parsing, Kilo organization metadata, process-local create/update/remove behavior, and confirmation that no durable credentials are written. The downgraded-client `auth.json` dual-write test also remains at `:207-275`.

The deleted Kilo assertions in the shared credential test cover selecting an active credential, reconciling a separately selected row, and dual-writing whichever credential is active. The new upstream `Credential` model stores one credential per integration, so the test now asserts replacement, update, and removal of that stored credential. This matches upstream commit `30aec297d8` and the API removed from `Connector`; it does not look like an accidental Kilo test deletion.

## Notable Non-Findings

- `packages/core/test/connector.test.ts` deletion is structurally justified by upstream PR #31968: `packages/core/src/connector.ts` and its test are deleted, while `packages/core/src/integration.ts` and `packages/core/test/integration.test.ts` are added. The only concern is the six Kilo regression cases listed above, not the file deletion itself.
- `packages/opencode/test/storage/workspace-time-migration.test.ts` is also absent from pristine upstream `v1.17.5` and was deleted in upstream commit `30aec297d8`. Its beta-reset behavior is covered by `packages/core/test/database-migration.test.ts:153-226`, which builds legacy workspace data, applies the event-sourced reset migration, and asserts the workspace table is empty. The current migration remains in `packages/core/src/database/migration/20260507164347_add_workspace_time.ts`.
- No new `.skip` or `.todo` markers were added in changed test/spec files.
- No Kilo test directory lost files: `packages/opencode/test/kilocode` is 214 files on both PR and base; `packages/core/test/kilocode` is 16 on both; `packages/kilo-vscode/tests` is 274 on both. There is no `packages/kilo-vscode/test/kilocode` directory in either tree.
- No deleted Kilo fixture or Kilo-owned test path was found. The deleted connector suite is shared, although it contained the six Kilo-marked cases above.

## Command Output Excerpts

Changed test/spec paths: 35

```text
packages/core/test/catalog.test.ts
packages/core/test/connector.test.ts
packages/core/test/credential.test.ts
packages/core/test/database-migration.test.ts
packages/core/test/integration.test.ts
packages/core/test/kilocode/account-auth-v2-migration.test.ts
packages/core/test/location-layer.test.ts
packages/core/test/move-session.test.ts
packages/core/test/plugin/models-dev.test.ts
packages/core/test/plugin/provider-azure.test.ts
packages/core/test/plugin/provider-cloudflare-workers-ai.test.ts
packages/core/test/plugin/provider-gitlab.test.ts
packages/core/test/plugin/provider-helper.ts
packages/core/test/plugin/provider-openai.test.ts
packages/core/test/plugin/provider-snowflake-cortex.test.ts
packages/core/test/project-copy.test.ts
packages/core/test/project-directories.test.ts
packages/core/test/project.test.ts
packages/opencode/test/cli/run/footer.view.test.tsx
packages/opencode/test/fixture/mcp-session-recovery.ts
packages/opencode/test/kilocode/auth-remove.test.ts
packages/opencode/test/kilocode/storage/json-migration.test.ts
packages/opencode/test/mcp/session-recovery.test.ts
packages/opencode/test/plugin/snowflake-cortex.test.ts
packages/opencode/test/project/project-directory.test.ts
packages/opencode/test/project/project.test.ts
packages/opencode/test/server/httpapi-exercise/index.ts
packages/opencode/test/server/httpapi-public-openapi.test.ts
packages/opencode/test/server/project-copy.test.ts
packages/opencode/test/storage/workspace-time-migration.test.ts
packages/tui/test/cli/tui/__snapshots__/inline-tool-wrap-snapshot.test.tsx.snap
packages/tui/test/cli/tui/data.test.tsx
packages/tui/test/cli/tui/diff-viewer.test.tsx
packages/tui/test/cli/tui/inline-tool-wrap-snapshot.test.tsx
packages/tui/test/fixture/tui-sdk.ts
```

Deleted test/spec paths:

```text
D packages/core/test/connector.test.ts
D packages/opencode/test/storage/workspace-time-migration.test.ts
```

Kilo test-directory count comparison:

```text
packages/opencode/test/kilocode: 214 (PR) / 214 (kilo-main)
packages/core/test/kilocode: 16 (PR) / 16 (kilo-main)
packages/kilo-vscode/tests: 274 (PR) / 274 (kilo-main)
packages/kilo-vscode/test/kilocode: absent in both trees
```

Targeted tests:

```text
$ bun test test/catalog.test.ts test/credential.test.ts test/integration.test.ts test/kilocode/account-auth-v2-migration.test.ts
28 pass
0 fail
75 expect() calls

$ bun test test/kilocode/auth-remove.test.ts test/kilocode/storage/json-migration.test.ts
25 pass
0 fail
135 expect() calls
```

## Limitations

- This is a diff and targeted-test audit, not a complete repository test run or a manual OAuth flow test.
- The upstream deletion rationale is supported by the pristine v1.17.5 tree and upstream commit history, but upstream PR discussion was not reviewed.
- The six deleted OAuth regression cases were not reimplemented or run against an equivalent test harness because this task is report-only. Their absence from the integration suite is the outstanding human-verification item.
