# Review: PR #6622 — OpenCode v1.2.16 Misc File Group

## Files Reviewed

| File                                      | Status   | +/-       |
| ----------------------------------------- | -------- | --------- |
| `packages/opencode/package.json`          | modified | +8 / -8   |
| `packages/opencode/src/auth/index.ts`     | modified | +6 / -1   |
| `packages/opencode/src/config/config.ts`  | modified | +12 / -10 |
| `packages/opencode/src/flag/flag.ts`      | modified | +6 / -1   |
| `packages/opencode/src/id/id.ts`          | modified | +1 / -0   |
| `packages/opencode/src/index.ts`          | modified | +2 / -1   |
| `packages/opencode/src/pty/index.ts`      | modified | +19 / -85 |
| `packages/opencode/src/storage/schema.ts` | modified | +1 / -0   |

## Summary

This group contains miscellaneous changes across the CLI core: auth key normalization to prevent trailing-slash duplicates, a **behavioral default flip** for the `KILO_EXPERIMENTAL_MARKDOWN` flag, a new `workspace` identifier prefix, environment variable renaming (`OPENCODE` -> `KILO` + new `KILO_PID`), a pty refactor that **reverts** a previous WebSocket deduplication cleanup, a new database table export, and dependency reordering in `package.json`. Most changes are low-risk housekeeping, but two items carry meaningful risk: the markdown flag default change and the pty refactor revert.

## Detailed Findings

### 1. `packages/opencode/package.json`

**What changed:** Dependency entries for `@kilocode/kilo-gateway`, `@kilocode/kilo-telemetry`, `@kilocode/plugin`, `@kilocode/sdk`, and `simple-git` are reordered within the `dependencies` object. `@opentui/core` and `@opentui/solid` are bumped from `0.1.81` to `0.1.86`. The `kilocode_change` comment on the `@kilocode/plugin` dependency line in `config.ts:348` was also removed.

**Analysis:**

- The dependency reordering is purely cosmetic. JSON object key order has no semantic effect on resolution.
- The `@opentui/core` and `@opentui/solid` bump from `0.1.81` -> `0.1.86` is a minor version bump of the terminal UI framework. This is TUI-only and does not affect the HTTP server API or the VS Code extension.
- **Note:** The current checked-out code still shows `0.1.81`, meaning this review is based on the patch diff as the source of truth for the PR.

**Risk:** Low. No functional change beyond the opentui bump, which only affects the TUI rendering layer.

---

### 2. `packages/opencode/src/auth/index.ts`

**What changed:** Both `Auth.set()` and `Auth.remove()` now normalize keys by stripping trailing slashes (`key.replace(/\/+$/, "")`). In `set()`, the old trailing-slash variant is explicitly deleted from the persisted data before writing the normalized key. In `remove()`, both the original and normalized forms are deleted.

**Analysis:**

- This is a correctness fix. Auth keys are URL-like strings (e.g., `https://example.com/` vs `https://example.com`). Without normalization, a user could end up with duplicate entries — one with and one without a trailing slash — causing stale auth lookups and confusing behavior.
- The `set()` logic correctly handles the transition: if the incoming key has a trailing slash, the old trailing-slash entry is removed and the clean entry is written. If the incoming key is already clean, `delete data[normalized + "/"]` removes any stale trailing-slash variant.
- The `remove()` logic deletes both forms to ensure no orphaned entries remain.
- `Auth.get()` and `Auth.all()` are unchanged — `get()` still does an exact key lookup. This means callers that pass a trailing-slash key to `get()` will **not** find entries stored under the normalized key. However, since `set()` now always normalizes, this is only a concern for entries written before this change. This is an acceptable trade-off; a migration isn't necessary for auth data.

**Risk:** Low. Defensive fix with correct cleanup logic. No API signature changes.

---

### 3. `packages/opencode/src/config/config.ts`

**What changed:** Two separate modifications:

1. **Well-known config URL normalization (lines 175-192):** The auth key used to build the `.well-known/opencode` URL is now stripped of trailing slashes, matching the normalization done in `auth/index.ts`. This prevents malformed URLs like `https://example.com//.well-known/opencode`.

2. **Removal of `kilocode_change` comment (line 348):** The `// kilocode_change` marker on the `@kilocode/plugin` dependency line inside `installDependencies()` was removed.

**Analysis:**

- The URL normalization is the companion fix to the auth change — ensures the fetch URL is well-formed regardless of how the auth key was originally stored.
- Removing the `kilocode_change` marker on `config.ts:348` is technically a violation of the project's fork merge guidelines. The `@kilocode/plugin` package name is a Kilo-specific change (upstream uses `@opencode-ai/plugin`), so this line diverges from upstream and **should** retain its `kilocode_change` marker. However, looking at the patch context, the marker is already absent in the current working tree, so this may have already been merged. Minor documentation concern only.

**Risk:** Low. The URL normalization is a clear improvement. The marker removal is cosmetic.

---

### 4. `packages/opencode/src/flag/flag.ts`

**What changed:**

1. A new `falsy()` helper function is added that checks if an env var is `"false"` or `"0"`.
2. `KILO_EXPERIMENTAL_MARKDOWN` changes from `truthy("KILO_EXPERIMENTAL_MARKDOWN")` to `!falsy("KILO_EXPERIMENTAL_MARKDOWN")`.

**Analysis:**

- **This is a behavioral default change.** Previously, the markdown renderer was opt-in: it was `false` by default and required `KILO_EXPERIMENTAL_MARKDOWN=true` to activate. Now it is **enabled by default** (`true`) and requires `KILO_EXPERIMENTAL_MARKDOWN=false` to disable.
- The flag controls which renderer is used in the TUI for message text parts (`src/cli/cmd/tui/routes/session/index.tsx:1408`): the `<markdown>` component (experimental) vs the `<code filetype="markdown">` component (legacy).
- **Impact scope:** TUI-only. The VS Code extension does not read this flag (confirmed by search — no references in `packages/kilo-vscode/`). The extension renders its own markdown via its webview, not through the CLI's TUI.
- **Risk factor:** Users who had the flag unset (the majority) will now see the experimental markdown renderer by default. If the opentui `0.1.86` bump includes related stability improvements, this may be intentional. However, if the experimental renderer has known issues, this could cause regressions for CLI/TUI users.
- The `falsy()` function itself is well-implemented — mirrors `truthy()` semantics with the inverted check.

**Risk:** **Medium.** Silent behavioral default change. Does not affect the VS Code extension, but does affect all TUI users. Should be verified that the markdown renderer is stable enough for default use.

---

### 5. `packages/opencode/src/id/id.ts`

**What changed:** A new `workspace: "wrk"` entry is added to the `Identifier.prefixes` map.

**Analysis:**

- This adds a new ID prefix for workspace entities. The prefix `"wrk"` is consistent with the existing naming pattern (`"ses"`, `"msg"`, `"prt"`, etc.).
- The identifier system uses this map for both ID generation (`create()`, `ascending()`, `descending()`) and schema validation (`schema()`). Adding a new entry is purely additive.
- This is a prerequisite for the `WorkspaceTable` added in `storage/schema.ts` and the `control-plane/workspace.sql` module (not included in this file group but referenced by the schema export).

**Risk:** Low. Additive change with no impact on existing identifiers.

---

### 6. `packages/opencode/src/index.ts`

**What changed:**

1. `process.env.OPENCODE = "1"` is replaced with `process.env.KILO = "1"`.
2. `process.env.KILO_PID = String(process.pid)` is added.

**Analysis:**

- **`OPENCODE` -> `KILO` rename:** The `OPENCODE` env var was set during CLI startup to signal that the process is running inside the Kilo agent. This rename aligns with the broader `OPENCODE` -> `KILO` branding effort. **However,** any external tools, scripts, or shell configurations that check for `process.env.OPENCODE` (or `$OPENCODE` in shell) will break. A search of the codebase shows the only other reference is in `packages/app/script/e2e-local.ts` (test infra for the desktop app, which is not actively maintained). No references exist in the VS Code extension.
- **`KILO_PID` addition:** Exposes the parent CLI process PID as an env var. This is useful for child processes (e.g., bash tool, MCP servers) to identify or signal the parent. No current consumers found in the codebase, so this is forward-looking infrastructure.

**Risk:** Low-Medium. The `OPENCODE` -> `KILO` env var rename is a **breaking change** for any external integrations relying on `$OPENCODE`. Within the monorepo, impact is minimal (only the unmaintained desktop e2e test references it). The VS Code extension does not check this env var.

---

### 7. `packages/opencode/src/pty/index.ts`

**What changed:** The patch **removes** 85 lines and **adds** 19 lines. Specifically, the patch **deletes** the `Subscriber` type, `sockets` WeakMap, `owners` WeakMap, `socketCounter`, `tagSocket()`, and `token()` — the entire WebSocket deduplication/identity-tracking infrastructure.

**Analysis of current state:** Looking at the actual file on disk, **the code that the patch claims to remove is still present** (lines 26-78, 31-33, 35-78, etc.). This means the PR patch has **not yet been applied** to the checked-out code. The current codebase retains all of the WebSocket tracking infrastructure.

The patch's intent is to remove the socket identity tracking layer that:

- Assigns a unique monotonic ID to each WebSocket connection (`tagSocket`)
- Extracts an identity token from the WebSocket's `.data` property (`token`)
- Tracks which pty session a socket is connected to (`owners`)
- Validates that subscribers haven't been replaced by a different connection

**If applied, the implications would be:**

- The `connect()` function's subscriber validation (lines 233-241 in current code) — which checks `sockets.get(ws) !== sub.id` and `token(ws) !== sub.token` — would become non-functional or would need rewriting.
- The `owners` WeakMap logic (lines 334-338 in current code) that prevents a socket from being subscribed to multiple pty sessions simultaneously would be removed.
- This could allow stale WebSocket connections to continue receiving data after being logically disconnected, and could allow a single WebSocket to be subscribed to multiple pty sessions.

**However,** looking at the patch more carefully and the `+19` additions, the patch likely replaces the complex identity tracking with a simpler mechanism. Since I can only see the removed lines in the patch (the additions are truncated), the actual replacement logic is not fully visible.

**Risk to VS Code Extension:** The VS Code extension does **not** interact with the pty WebSocket system directly (confirmed by grep). The extension communicates via the HTTP/SSE API through `@kilocode/sdk`. Pty sessions are a TUI-only feature. No risk to the extension.

**Risk:** **Medium.** The pty refactor removes defensive WebSocket identity tracking. If the replacement logic is insufficient, it could cause issues with terminal sessions in the TUI (ghost subscribers, data leaks between sessions). However, since the current code on disk still has the full implementation, this assessment is based on the patch diff alone.

---

### 8. `packages/opencode/src/storage/schema.ts`

**What changed:** A new export is added: `export { WorkspaceTable } from "../control-plane/workspace.sql"`.

**Analysis:**

- This exports a new Drizzle ORM table definition for workspaces. The `schema.ts` file is the central barrel export used by the database migration system.
- The source module `../control-plane/workspace.sql` does not exist in the current checkout, confirming this is part of a new feature being introduced in the PR (workspace management in the control plane).
- Adding a table export here means the database migration system will pick it up and create the table. This is a standard pattern in the codebase.
- **Database schema changes are automatically applied** via Drizzle's migration system. If the `WorkspaceTable` definition has issues, it could cause migration failures on startup.

**Risk:** Low-Medium. Additive database schema change. The table definition itself is not in this file group so cannot be fully assessed. If `control-plane/workspace.sql` has issues (e.g., conflicts with existing tables, incorrect column types), it would surface as a runtime migration error.

---

## Risk to VS Code Extension

**Overall: Low.**

None of the changes in this file group directly affect the VS Code extension's operation:

| Change                                    | Extension Impact                                              |
| ----------------------------------------- | ------------------------------------------------------------- |
| Auth key normalization                    | No — extension uses SDK HTTP API, not direct auth file access |
| Config URL normalization                  | No — well-known config is resolved server-side                |
| `KILO_EXPERIMENTAL_MARKDOWN` default flip | No — TUI-only flag, not read by extension                     |
| `workspace` ID prefix                     | No — new feature, additive                                    |
| `OPENCODE` -> `KILO` env var              | No — extension does not check this env var                    |
| `KILO_PID` addition                       | No — not consumed by extension                                |
| Pty refactor                              | No — pty is TUI-only; extension uses HTTP/SSE via SDK         |
| `WorkspaceTable` export                   | No — database change is server-side                           |
| `@opentui/core` / `@opentui/solid` bump   | No — TUI rendering library only                               |
| `package.json` dep reordering             | No — cosmetic                                                 |

The extension communicates exclusively through the `@kilocode/sdk` HTTP/SSE client. None of the server API routes, response schemas, or SSE event shapes are modified by this file group.

## Overall Risk

**Low-Medium.**

The primary risk items are:

1. **`KILO_EXPERIMENTAL_MARKDOWN` default flip (Medium):** Silent change from opt-in to opt-out. All TUI users will now see the experimental markdown renderer. Should be validated that the renderer is production-ready, especially in conjunction with the `@opentui` 0.1.81 -> 0.1.86 bump.

2. **Pty WebSocket tracking removal (Medium):** Removes defensive identity validation. Impact limited to TUI terminal sessions. The replacement logic is not fully visible in the patch.

3. **`OPENCODE` env var removal (Low-Medium):** Potential breaking change for external tools/scripts relying on `$OPENCODE` env var. Mitigated by the fact that no known consumers exist outside the monorepo.

4. **`WorkspaceTable` database migration (Low-Medium):** Cannot fully assess without seeing the table definition. Risk of migration failures if the definition is incorrect.

All other changes (auth normalization, config URL fix, new ID prefix, dependency reordering) are low-risk improvements.
