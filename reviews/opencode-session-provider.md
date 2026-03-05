# PR #6622 (OpenCode v1.2.16) Review: Session / Provider / MCP Core Modules

## Files Reviewed

| File                                           | Status   | +/-     |
| ---------------------------------------------- | -------- | ------- |
| `packages/opencode/src/mcp/index.ts`           | modified | +37/-0  |
| `packages/opencode/src/provider/error.ts`      | modified | +14/-1  |
| `packages/opencode/src/provider/provider.ts`   | modified | +22/-1  |
| `packages/opencode/src/provider/transform.ts`  | modified | +29/-5  |
| `packages/opencode/src/session/compaction.ts`  | modified | +90/-23 |
| `packages/opencode/src/session/index.ts`       | modified | +10/-1  |
| `packages/opencode/src/session/message-v2.ts`  | modified | +30/-14 |
| `packages/opencode/src/session/processor.ts`   | modified | +28/-20 |
| `packages/opencode/src/session/prompt.ts`      | modified | +2/-0   |
| `packages/opencode/src/session/session.sql.ts` | modified | +6/-1   |

## Summary

This file group implements four major capabilities:

1. **HTTP 413 recovery and overflow-triggered compaction** -- The processor now catches `ContextOverflowError` (including HTTP 413) at the stream level and triggers auto-compaction instead of retrying or hard-stopping. Compaction itself gains an `overflow` mode that strips media, replays the last non-compaction user message, and falls back gracefully when context is still too large.

2. **MCP descendant process cleanup** -- On shutdown, the MCP module now discovers and SIGTERMs the full descendant tree of each stdio-based MCP transport process, preventing orphan grandchild processes (e.g., headless Chrome from `chrome-devtools-mcp`).

3. **Workspace-scoped sessions** -- A `workspace_id` column is added to the session table, populated from a new `WorkspaceContext` module, and sessions can be listed/filtered by workspace. This underpins the VS Code Agent Manager's multi-workspace isolation.

4. **Provider & schema hardening** -- Cloudflare AI Gateway options are properly forwarded, Gemini tool-schema sanitization is improved to handle combiner nodes (`anyOf`/`oneOf`/`allOf`) and schema-empty objects, and HTML error pages from gateways/proxies get human-readable messages instead of raw markup.

---

## Detailed Findings

### `packages/opencode/src/mcp/index.ts`

**What changed:** New `descendants(pid)` helper walks the process tree via `pgrep -P`. On state cleanup, each MCP client's transport PID has its full descendant tree SIGTERMed before the SDK `client.close()` call.

**Observations:**

1. **Empty catch block (style violation):** The catch block on `process.kill(dpid, "SIGTERM")` at the kill loop is empty. The project AGENTS.md explicitly forbids empty catch blocks. At minimum this should log the failure:

   ```ts
   } catch (err) {
     log.debug("failed to kill descendant", { dpid, err })
   }
   ```

2. **`(client.transport as any)?.pid` is fragile.** The MCP SDK's `StdioClientTransport` exposes `pid` but it's not part of the typed public API. If the SDK changes internals, this silently becomes a no-op. A comment noting the dependency or a version-pinned assumption would help.

3. **Windows is skipped.** `descendants()` returns `[]` on win32. This is fine for now since `pgrep` doesn't exist on Windows, but the orphan-process problem presumably exists there too. Worth a TODO.

4. **Sequential `pgrep` per PID.** For deeply nested trees this is O(depth) spawned processes. In practice MCP servers rarely have deep trees so this is acceptable, but worth noting.

5. **Race condition window.** Between `descendants()` returning and `process.kill()` executing, PIDs could be recycled. The probability is near-zero in practice on modern kernels with 32-bit PID spaces, but the comment should acknowledge this is best-effort.

**Risk:** Low. Kill failures are non-fatal. The feature is additive and only fires on shutdown.

---

### `packages/opencode/src/provider/error.ts`

**What changed:**

- Added `/request entity too large/i` to `OVERFLOW_PATTERNS` regex list.
- `parseAPICallError` now also treats `statusCode === 413` as `context_overflow` regardless of message content.
- HTML response bodies (`<!doctype` / `<html`) get human-readable messages for 401 and 403 instead of dumping raw markup.

**Observations:**

1. **Good: dual 413 detection.** Checking both the regex pattern on the message _and_ the raw status code catches cases where the message doesn't match any pattern (e.g., empty body from gateway proxies like Cerebras/Mistral).

2. **HTML body handling is defensive but narrow.** Only 401 and 403 get specialized messages. A 502/503 gateway error page would still dump HTML into the error message. The fallback `return msg` line at the end of the HTML block means the raw HTML won't be appended (the `${msg}: ${e.responseBody}` line is skipped), so this is still an improvement.

3. **The 413-to-overflow mapping is unconditional.** This is correct -- HTTP 413 "Request Entity Too Large" from a reverse proxy almost always means the request body (context) exceeded the proxy's limit. There's no provider where 413 means something unrelated.

**Risk:** Low. These are all error-path improvements.

---

### `packages/opencode/src/provider/provider.ts`

**What changed:** The `cloudflare-ai-gateway` custom loader now forwards `metadata`, `cacheTtl`, `cacheKey`, `skipCache`, and `collectLog` options from `input.options` to the `createAiGateway()` call. Previously only `accountId`, `gateway`, and `apiKey` were passed.

**Observations:**

1. **Metadata parsing from header is a fallback.** The `try { JSON.parse(input.options?.headers?.["cf-aig-metadata"]) }` fallback handles the case where metadata was passed as a stringified header (legacy pattern). The empty catch swallows parse errors silently -- acceptable here since the `undefined` fallback is the right default.

2. **Conditional options spreading is clean.** `Object.values(opts).some((v) => v !== undefined)` avoids sending an empty `options` object to the gateway SDK.

3. **No breaking changes.** Existing configurations without these options continue to work identically.

**Risk:** Low. Additive feature for Cloudflare AI Gateway users.

---

### `packages/opencode/src/provider/transform.ts`

**What changed:** The Gemini schema sanitizer in `ProviderTransform.schema()` now:

- Introduces `isPlainObject`, `hasCombiner`, and `hasSchemaIntent` helpers.
- Skips the `items` default-type injection for arrays that have combiner nodes (`anyOf`/`oneOf`/`allOf`).
- Only assigns `items.type = "string"` when the items object has no schema intent (no `type`, `properties`, `$ref`, etc.).

**Observations:**

1. **This fixes real Gemini tool-call failures.** The previous code would overwrite `items.type` to `"string"` on empty-looking objects that actually used combiners (e.g., `{ items: { anyOf: [...] } }`), causing Gemini to reject the schema.

2. **`hasSchemaIntent` is comprehensive.** Covers `$ref`, `additionalProperties`, `patternProperties`, `not`, `if/then/else`, `prefixItems`, `const`, etc. This correctly identifies objects that carry schema meaning despite lacking an explicit `type` field.

3. **The `hasCombiner` guard on the array branch** (`if (result.type === "array" && !hasCombiner(result))`) prevents adding default `items` to arrays defined via combiners (e.g., `{ type: "array", anyOf: [...] }`). This is the right behavior -- Gemini should receive the combiner as-is.

4. **Performance is fine.** `hasSchemaIntent` checks ~15 keys via `Array.some()`. This runs once per tool schema, not per message.

**Risk:** Low-Medium. Schema transforms affect all Gemini users. The logic is sound but any regression would break tool calling for Google/Gemini models. Testing with complex tool schemas (nested combiners, `$ref`, `prefixItems`) is recommended.

---

### `packages/opencode/src/session/compaction.ts`

**What changed:** Major rework. The `process()` function now:

- Accepts an `overflow?: boolean` parameter.
- In overflow mode: walks backward to find the last non-compaction user message, slices messages before it, and plans to replay it after compaction.
- Passes `{ stripMedia: true }` to `MessageV2.toModelMessages()` to reduce context size.
- Handles the case where compaction itself overflows (`result === "compact"`) with differentiated error messages depending on whether a replay was planned.
- On success, creates a synthetic "continue" user message (as before) and optionally replays the saved user message and its file parts.

**Observations:**

1. **Critical behavioral change: overflow compaction now replays user messages.** When compaction succeeds in overflow mode, the code creates a new user message with parts cloned from the replay target. This means the conversation can automatically recover and retry after a 413 without user intervention. This is a significant UX improvement.

2. **The replay part cloning at lines ~250-270 (patch)** creates new part IDs via `Identifier.ascending("part")` and preserves file parts. The `isMedia` check (from `MessageV2.isMedia`) correctly identifies images and PDFs. Non-media file parts are carried through, which is correct since media was already stripped for compaction.

3. **Edge case: no replayable message found.** If `overflow` is true but no suitable non-compaction user message exists before the parent, the code falls back to `replay = undefined` and `messages = input.messages` (full history). This means compaction proceeds as non-overflow, which will likely fail again with an overflow error. The `result === "compact"` handler then sets a `ContextOverflowError` with a descriptive message and returns `"stop"`, which is the correct terminal behavior.

4. **The `hasContent` guard** checks whether there are non-compaction user messages in the sliced prefix. If not, replay is abandoned. This prevents infinite compaction loops where the only message is a compaction marker.

5. **`stripMedia: true` removes file parts from model messages** (see `message-v2.ts` changes). This is the first line of defense against overflow -- media (images, PDFs) can be huge and are often not needed for a compaction summary.

6. **The `overflow` field propagates through `CompactionPart`** (new optional boolean) and is set in `prompt.ts` based on `!processor.message.finish`. This means if the processor ended without a finish reason (i.e., it was interrupted by an error), the compaction is marked as overflow. This heuristic is slightly imprecise -- a missing `finish` could also mean the stream was aborted. However, the only caller sets `overflow` in the context of a `ContextOverflowError`, so in practice this is correct.

**Risk:** Medium. This is the most complex change in the group. The replay mechanism introduces new state transitions in the session loop. If replay re-triggers overflow (e.g., the user's message itself is too large), the terminal `"stop"` with `ContextOverflowError` prevents infinite loops. However, the interaction between `prompt.ts`, `processor.ts`, and `compaction.ts` is subtle and would benefit from integration tests.

---

### `packages/opencode/src/session/index.ts`

**What changed:**

- `WorkspaceContext` imported from `../control-plane/workspace-context`.
- `workspaceID` added as optional field to `Session.Info` schema, `fromRow()`, `toRow()`, and `createNext()`.
- `list()` gains an optional `workspaceID` filter parameter, with a condition added when `WorkspaceContext.workspaceID` is set.

**Observations:**

1. **Schema addition is additive and optional.** `workspaceID: z.string().optional()` won't break existing consumers. The SDK will need regeneration to expose this field, but older clients will simply ignore it.

2. **`WorkspaceContext.workspaceID` is read from a module that doesn't exist yet in the current codebase.** This is introduced by this PR. If the import path `../control-plane/workspace-context` is not present in the final merge, it will cause a build failure. The patch group doesn't include this file, so we can't verify its implementation.

3. **`list()` filters by workspace implicitly** -- it reads `WorkspaceContext.workspaceID` directly rather than taking it from the `input` parameter. The `input?.workspaceID` parameter is declared but never used in the conditions. This appears to be a **bug or incomplete implementation**: the declared parameter suggests the caller should be able to pass a workspace filter, but the actual condition uses the ambient `WorkspaceContext.workspaceID`. Either the parameter should be used (`input?.workspaceID ?? WorkspaceContext.workspaceID`) or it should be removed from the input type.

4. **`createNext()` unconditionally reads `WorkspaceContext.workspaceID`.** Sessions created outside a workspace context will have `workspaceID: undefined`, which maps to `workspace_id: NULL` in the database. This is correct for backward compatibility.

**Risk:** Medium. The `WorkspaceContext` import dependency is unverifiable from this patch group. The unused `workspaceID` input parameter on `list()` looks like a bug. Database migration for the new column needs verification (handled in `session.sql.ts`).

---

### `packages/opencode/src/session/message-v2.ts`

**What changed:**

- New `isMedia(mime)` helper: returns true for `image/*` and `application/pdf`.
- `CompactionPart` gains optional `overflow: boolean` field.
- `toModelMessages()` signature gains `options?: { stripMedia?: boolean }`.
- When `stripMedia` is true, file parts that are media (per `isMedia`) are replaced with a text placeholder describing the file instead of being sent as binary data.
- Non-media files (text, directories) are unaffected.

**Observations:**

1. **The `isMedia` helper centralizes a check** that was previously done inline in the media-attachment extraction logic (compare with `isMediaAttachment` lambda at line 636 of the current file). Good refactor.

2. **`stripMedia` text replacement format:** `[Attached file: ${part.filename ?? "unnamed"} (${part.mime})]`. This gives the compaction model enough context to know a file was attached without sending the binary data. The `?? "unnamed"` fallback handles parts without filenames.

3. **SDK impact:** The `overflow` field on `CompactionPart` is optional, so the SDK type change is backward-compatible. Existing clients that don't know about `overflow` will simply ignore it.

4. **`toModelMessages` options parameter** uses the established pattern of adding an optional config object. The default behavior (no options) is unchanged.

**Risk:** Low. All changes are additive and backward-compatible.

---

### `packages/opencode/src/session/processor.ts`

**What changed:**

- The `finish-step` handler now checks `!input.assistantMessage.summary` before triggering compaction. This prevents compaction messages from triggering further compaction (which would be an infinite loop).
- The catch block for `ContextOverflowError` is no longer a TODO comment. It now sets `needsCompaction = true` and publishes a `Session.Event.Error`. Importantly, it does **not** fall through to the retry logic -- the `else` branch ensures overflow errors skip retries entirely and go straight to compaction.
- The retry logic is wrapped in the `else` branch of the overflow check.

**Observations:**

1. **Critical fix: the `TODO` is now implemented.** Previously, `ContextOverflowError` in the catch block was silently ignored (just a comment), and the error would fall through to the retry check. Since `ContextOverflowError` is not retryable, it would set the error on the message and stop. Now it correctly triggers compaction.

2. **The `!input.assistantMessage.summary` guard** prevents compaction-of-compaction loops. Without this, a compaction message that itself hit the context limit would try to compact again indefinitely. This is a necessary safety check.

3. **Error is published before compaction.** `Bus.publish(Session.Event.Error, ...)` fires before the processor returns `"compact"`. This means the UI will see the error event, but the session loop in `prompt.ts` will then handle the compaction. The VS Code extension should handle this gracefully -- it will see an error event followed by compaction activity.

4. **The `break` at the end of the catch block's overflow branch** exits the stream processing loop, letting the post-loop code clean up tool calls and return `"compact"`. This is correct.

**Risk:** Medium. This fundamentally changes error handling for context overflow -- from "stop with error" to "auto-compact and retry". The behavior is clearly better, but any bug in the compaction path could cause session corruption or loops. The `!summary` guard is the key safety net.

---

### `packages/opencode/src/session/prompt.ts`

**What changed:** Two lines added:

1. `overflow: task.overflow` passed to `SessionCompaction.process()` when handling a compaction task.
2. `overflow: !processor.message.finish` set on the compaction task when auto-compaction is triggered after a processor run.

**Observations:**

1. **`!processor.message.finish` as overflow signal:** If the processor returned `"compact"` due to an overflow error in the catch block, `processor.message.finish` will be `undefined` (the stream didn't complete normally). If compaction was triggered by the `finish-step` handler (normal overflow detection), `processor.message.finish` will be set (the step completed). So `!processor.message.finish` correctly distinguishes error-triggered compaction from normal compaction.

2. **Minimal and surgical change.** The overflow flag threads through the existing compaction task infrastructure without changing the prompt loop's control flow.

**Risk:** Low. The change is a simple parameter passthrough.

---

### `packages/opencode/src/session/session.sql.ts`

**What changed:**

- `workspace_id: text()` column added to `SessionTable` (nullable, no foreign key).
- New index `session_workspace_idx` on `workspace_id`.

**Observations:**

1. **No migration file visible in this patch group.** Drizzle ORM typically requires migration files for schema changes. If the project uses auto-push or if the migration is in a separate patch group, this is fine. But if migrations are manual, this column addition could fail on existing databases without a corresponding migration.

2. **No foreign key on `workspace_id`.** This is intentional -- workspace IDs likely come from the VS Code extension and don't correspond to a table in the CLI's SQLite database.

3. **The index is appropriate.** Session listing now filters by `workspace_id`, so the index supports the new query pattern.

4. **Nullable column.** Existing sessions will have `workspace_id = NULL`, which is correct since they predate workspace isolation.

**Risk:** Low-Medium. The schema change itself is safe, but migration handling needs to be confirmed. If Drizzle auto-generates migrations from schema diff, this should be automatic. If not, a missing migration would cause a runtime error on database open.

---

## Risk to VS Code Extension

| Area                                   | Impact | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session.Info schema**                | Low    | `workspaceID` is additive and optional. The SDK `Session` type will gain this field after regeneration. Existing extension code ignores unknown fields.                                                                                                                                                                                                                                                                                                                                                                             |
| **CompactionPart.overflow**            | Low    | New optional field. SDK `CompactionPart` type gains `overflow?: boolean`. Extension code that processes compaction parts won't break.                                                                                                                                                                                                                                                                                                                                                                                               |
| **Session.list() workspace filtering** | Medium | If the extension calls `session.list()` and the CLI has `WorkspaceContext.workspaceID` set, results will be filtered. The extension's Agent Manager, which manages multiple workspaces, may need to pass `workspaceID` explicitly to see the right sessions. **This needs verification** -- the extension currently calls `client.session.list({ directory: dir, roots: true })` without a workspace filter. If `WorkspaceContext.workspaceID` is set server-side, the extension may silently receive fewer sessions than expected. |
| **Compaction auto-recovery**           | Low    | The extension will see `session.error` events followed by automatic compaction. The UI should handle this naturally -- the error event may flash briefly before compaction resolves it.                                                                                                                                                                                                                                                                                                                                             |
| **MCP process cleanup**                | None   | Transparent to the extension. MCP clients are managed by the CLI process.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **413/overflow handling**              | None   | Error handling changes are internal to the CLI. The extension receives normalized error events via SSE.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **SDK regeneration required**          | Yes    | The `workspaceID` field on `Session`, `overflow` field on `CompactionPart`, and `stripMedia` option won't be reflected in the SDK until `./script/generate.ts` is run. The extension won't see these fields until the SDK is regenerated.                                                                                                                                                                                                                                                                                           |

## Overall Risk

**Medium.**

The most impactful changes are the overflow-triggered compaction path (processor.ts + compaction.ts + prompt.ts) and the workspace session scoping (index.ts + session.sql.ts). Both introduce new state transitions and data model changes that affect the core session lifecycle.

**Key concerns:**

1. The compaction overflow + replay mechanism is complex and introduces multiple new code paths. Integration testing with actual 413 responses and large contexts is essential.
2. The `WorkspaceContext` module is not included in this patch group, making its behavior unverifiable. The `list()` function's `workspaceID` parameter appears unused (potential bug).
3. Database schema change requires migration verification.
4. SDK regeneration is required for extension compatibility with new fields.
5. Empty catch block in MCP `process.kill` loop violates the project's coding standards.

**No blocking issues identified.** All changes are backward-compatible at the data level. The overflow recovery is a significant improvement over the previous "TODO" state.
