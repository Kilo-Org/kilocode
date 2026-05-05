# PR #9911 — kilocode_change marker review

Branch: `review/pr-9911` (originally `markijbema/kilo-opencode-v1.14.30`). Merges upstream opencode `v1.14.30` (`eb4219304`) into Kilo `main`.

## Summary

- **Files changed in PR:** 165
- **Shared files (needs marker check):** ~70 (the rest are Kilo-owned: `packages/ui/**`, `packages/sdk/**`, `kilocode`-path files, tests/docs, etc.)
- **Files where marker count changed:** 5 — only 1 is a hard-decrease and it is fully explained by an upstream file split.
- **Flagged findings:** 2 (1 missing marker on a Kilo-specific rename; 1 “needs human eyes” on a session-listing behaviour change that could use a second pair of eyes).
- **Overall verdict:** The merge resolution looks careful. No clear accidental deletions of `kilocode_change` markers were detected. The only genuine regression candidate is a Kilo-specific flag rename in the new `server/backend.ts` that should be annotated. The session list filtering change in `session.ts` is documented but is worth a focused re-check.

## Marker-count delta table

Files where `kilocode_change` count on `origin/main` differs from `HEAD`:

| File | main | HEAD | Verdict |
|---|---|---|---|
| `packages/opencode/src/server/proxy.ts` | 1 | 2 | OK (one existing marker re-worded, one added for narrower `Msg` type) |
| `packages/opencode/src/server/routes/instance/httpapi/permission.ts` | 12 | (deleted) | OK — file was split upstream into `groups/permission.ts` + `handlers/permission.ts`, Kilo-specific bits preserved in both |
| `packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts` | 0 | 4 | OK (markers re-applied around `SaveAlwaysRulesBody` + endpoint) |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/permission.ts` | 0 | 5 | OK (markers re-applied around `saveAlwaysRules` and the `Kilo` reply behaviour) |
| `packages/opencode/src/session/session.ts` | 35 | 36 | OK (one added for new `scope`/`path` branch) |

## Full reviewed-file list (shared files only)

All files below were reviewed; those not called out as FLAG/NEEDS HUMAN EYES had marker counts unchanged and either (a) no material diff, or (b) a diff that is a clean upstream change that does not touch any `kilocode_change`-guarded block.

| File | Verdict | Note |
|---|---|---|
| `packages/opencode/src/agent/agent.ts` | OK | `Schema.Number` → `Schema.Finite`; upstream dropped `codesearch` permission |
| `packages/opencode/src/auth/index.ts` | OK | Upstream `NonNegativeInt` migration; `Telemetry` import marker preserved |
| `packages/opencode/src/bus/bus-event.ts` | OK | Pure addition (`effectPayloads`) |
| `packages/opencode/src/cli/cmd/agent.ts` | OK | `codesearch` removed from permission list |
| `packages/opencode/src/cli/cmd/run.ts` | OK | `codesearch` tool removed |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | OK | Adds `paste_summary_enabled` / `session_directory_filter_enabled` KV toggles; Kilo markers preserved |
| `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx` | OK | TODO added inside a `kilocode_change` block noting that the dialog does not yet respect `session_directory_filter_enabled` (see NEEDS HUMAN EYES below) |
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | OK | Upstream editor-selection key-dedupe + KV-based paste summary toggle; `// kilocode_change #7252` and `// kilocode_change - dismiss persistent config warning…` preserved |
| `packages/opencode/src/cli/cmd/tui/context/editor-zed.ts` | OK | Small upstream change |
| `packages/opencode/src/cli/cmd/tui/context/editor.ts` | OK | Small upstream change |
| `packages/opencode/src/cli/cmd/tui/context/sync.tsx` | OK | New `sessionListQuery()` + `listSessions()`; both Kilo import markers preserved |
| `packages/opencode/src/cli/cmd/tui/context/theme.tsx` | OK | No actual diff |
| `packages/opencode/src/cli/cmd/tui/event.ts` | OK | Small upstream change |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | OK | `CodeSearch` tool render removed; `SemanticSearchTool // kilocode_change` import preserved |
| `packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx` | OK | `codesearch` prompt branch removed |
| `packages/opencode/src/config/agent.ts` | OK | `NullOr(Schema.Number)` → `NullOr(Schema.Finite)` inside existing `kilocode_change` lines; markers preserved |
| `packages/opencode/src/config/console-state.ts` | OK | Upstream `NonNegativeInt` |
| `packages/opencode/src/config/mcp.ts` | OK | Upstream `PositiveInt` |
| `packages/opencode/src/config/permission.ts` | OK | `codesearch` entry removed (upstream) |
| `packages/opencode/src/config/provider.ts` | OK | Upstream `Finite` migration |
| `packages/opencode/src/file/index.ts` | OK | Upstream `NonNegativeInt` migration |
| `packages/opencode/src/file/ripgrep.ts` | OK | Upstream `NonNegativeInt` migration |
| `packages/opencode/src/lsp/lsp.ts` | OK | Upstream `NonNegativeInt`; `TsClient // kilocode_change` preserved |
| `packages/opencode/src/plugin/github-copilot/models.ts` | OK | Upstream-only change |
| `packages/opencode/src/project/project.ts` | OK | Upstream `NonNegativeInt` |
| `packages/opencode/src/project/vcs.ts` | OK | Upstream `NonNegativeInt`; `makeRuntime // kilocode_change` preserved |
| `packages/opencode/src/provider/auth.ts` | OK | Upstream `Finite`; Kilo markers preserved |
| `packages/opencode/src/provider/models.ts` | OK | Upstream `Finite` |
| `packages/opencode/src/provider/provider.ts` | OK | Upstream Azure/OpenAI body handling + ProviderTransform guard; Kilo markers preserved |
| `packages/opencode/src/provider/transform.ts` | OK | Upstream deepseek/mistral/github-copilot tweaks; `result["store"] = false` for azure (upstream regression fix) |
| `packages/opencode/src/pty/index.ts` | OK | Upstream int migration |
| `packages/opencode/src/server/backend.ts` | **FLAG** | New upstream file with a Kilo-specific flag rename and no marker — see findings |
| `packages/opencode/src/server/middleware.ts` | OK | `LoggerMiddleware` converted to a factory; `KiloServer.skipLogging` marker preserved |
| `packages/opencode/src/server/proxy-util.ts` | OK (low-risk pre-existing gap) | Extracted helper; `x-kilo-directory`/`x-kilo-workspace` header deletes live here now. These were already unmarked on `origin/main` so this is not a regression, but see note below |
| `packages/opencode/src/server/proxy.ts` | OK | Converted to Effect; both kilocode markers re-applied and one added |
| `packages/opencode/src/server/routes/instance/httpapi/*` (groups/handlers split) | OK | See permission-file split note. All other old files had zero Kilo markers on main |
| `packages/opencode/src/server/routes/instance/httpapi/permission.ts` (deleted) | OK | Content moved into `groups/permission.ts` + `handlers/permission.ts`; kilo-specific endpoint `saveAlwaysRules` and the `reply` NotFound guard are both carried over |
| `packages/opencode/src/server/routes/instance/session.ts` | OK | Adds upstream `scope`/`path` query, passes them to `Session.list`. No markers disturbed |
| `packages/opencode/src/server/server.ts` | OK | Backend selection refactored via new `ServerBackend.select()`; `KiloServer.DOC_TITLE`/`DOC_DESCRIPTION`/`kilocode/server/server` markers preserved |
| `packages/opencode/src/server/workspace.ts` | OK | Small upstream change |
| `packages/opencode/src/session/instruction.ts` | OK | Upstream reordered AGENTS.md lookup; `Flag.KILO_DISABLE_PROJECT_CONFIG` was already unmarked pre-PR |
| `packages/opencode/src/session/message-v2.ts` | OK | Large upstream schema diff, no marker lines changed |
| `packages/opencode/src/session/message.ts` | OK | Upstream int migration |
| `packages/opencode/src/session/prompt.ts` | OK | Upstream system prompt order change; kilo markers preserved |
| `packages/opencode/src/session/session.ts` | **NEEDS HUMAN EYES** | Large merge; new `scope`/`path` branch wraps/bypasses `KiloSession.filters`. See findings |
| `packages/opencode/src/session/status.ts` | OK | Upstream int migration |
| `packages/opencode/src/snapshot/index.ts` | OK | Upstream int migration |
| `packages/opencode/src/storage/storage.ts` | OK | Upstream int migration |
| `packages/opencode/src/sync/index.ts` | OK | Pure addition (`effectPayloads`) |
| `packages/opencode/src/tool/bash.ts` | OK | Upstream `Effect.scoped` + tree-sitter `tree.delete()` release; all Kilo markers preserved inside the new scoped block |
| `packages/opencode/src/tool/codesearch.ts` / `.txt` | OK | Deleted upstream (#24992) |
| `packages/opencode/src/tool/lsp.ts` | OK | Upstream `Schema.Int` migration |
| `packages/opencode/src/tool/mcp-exa.ts` | OK | `CodeArgs` removed upstream |
| `packages/opencode/src/tool/read.ts` | OK | Upstream `NonNegativeInt`; all Kilo markers preserved |
| `packages/opencode/src/tool/registry.ts` | OK | `CodeSearchTool` removed, `Flag.KILO_ENABLE_EXA // kilocode_change` preserved |
| `packages/opencode/src/util/named-schema-error.ts` | OK | Adds `EffectSchema` (upstream) |
| `packages/opencode/src/util/timeout.ts` | OK | Upstream `.finally` refactor |
| `packages/opencode/src/v2/*` | OK | Upstream spec files |
| `packages/opencode/test/**` | OK | Upstream test changes; no kilocode markers touched |

## Findings

### FINDING 1 — FLAG — `packages/opencode/src/server/backend.ts` uses `Flag.KILO_EXPERIMENTAL_HTTPAPI` with no `kilocode_change` marker

**What changed.** The upstream v1.14.30 merge introduced this new file. Upstream’s version reads:
```
if (Flag.OPENCODE_EXPERIMENTAL_HTTPAPI) return { backend: "effect-httpapi", reason: "env" }
```
HEAD at `packages/opencode/src/server/backend.ts:15` renames the flag to Kilo’s variant:
```
if (Flag.KILO_EXPERIMENTAL_HTTPAPI) return { backend: "effect-httpapi", reason: "env" }
```
This is the correct runtime behaviour (and matches the Kilo flag previously used in `server/server.ts` on `origin/main`), but the rename is a Kilo-specific divergence from upstream and carries no `kilocode_change` marker.

**Why it looks suspicious.** This is exactly the type of drift that `kilocode_change` markers exist to flag at future merges. Without the marker, a subsequent upstream sync that touches this line could silently re-introduce the `OPENCODE_*` name or resolve the conflict in the wrong direction.

**What the human should verify.** Add `// kilocode_change - renamed from OPENCODE_EXPERIMENTAL_HTTPAPI` (or equivalent) on `packages/opencode/src/server/backend.ts:15` before merging.

### FINDING 2 — NEEDS HUMAN EYES — `packages/opencode/src/session/session.ts` `list()` — new `scope`/`path` branch interacts with `KiloSession.filters`

**What changed.** `session.ts:817-856`. Upstream added `scope?: "project"` and `path?: string` to `Session.list`, and the route (`packages/opencode/src/server/routes/instance/session.ts:83`) passes `scope === "project" ? undefined : query.directory` plus `path` through to it. Kilo’s existing `KiloSession.filters` call was converted to a conditional:
```
const conditions =
  input?.path !== undefined
    ? [eq(SessionTable.project_id, project.id)]
    : KiloSession.filters({ projectID: project.id, directory: input?.directory })
```
and the original (commented-out) Flag-gated `KILO_EXPERIMENTAL_WORKSPACES` block is kept inside the new `else if` branch.

A `kilocode_change start / end` block with a helpful rationale comment was added (session.ts:829). One `kilocode_change` marker was added net of zero removals, so the count went 35 → 36.

**Why it could use a second look.**

1. When `scope === "project"` with no `path`, the route sends `directory: undefined` and `path: undefined`. In `Session.list` this takes the `path === undefined` branch and calls `KiloSession.filters({ projectID, directory: undefined })`, which (per `packages/opencode/src/kilocode/session/index.ts:90`) collapses to `[eq(SessionTable.project_id, projectID)]`. That matches upstream’s intended “all sessions in project” semantics — good.
2. When `path` is provided, Kilo’s directory-union filter is deliberately **skipped** (the comment in `session.ts:829` documents this). This means the cross-project-id visibility that Kilo introduced in PR #8875 is not applied on path-scoped requests. That is presumably intentional for path-anchored filtering but it is a semantic change worth confirming with the author, especially for the VS Code extension which calls `sdk.client.session.list(...)` with `path` via the new `sessionListQuery()` in `cli/cmd/tui/context/sync.tsx:170` whenever `session_directory_filter_enabled` is truthy (the default).
3. The inner `else if` branch at `session.ts:849-855` contains only a commented-out block — effectively a no-op — because Kilo disables upstream’s directory filter in favour of `KiloSession.filters`. That is correct, but double-check the logic: if a caller passes `directory` with `scope !== "project"` and `path === undefined`, the handling goes purely through `KiloSession.filters`. Match with the VSCode/webview clients to make sure nobody relied on the old upstream path.

**What the human should verify.**
- That the default path sent by the TUI (`sessionListQuery()` in `cli/cmd/tui/context/sync.tsx:167-175`) matches what Kilo users expect to see in the session list (both inside and outside worktrees).
- That the Agent Manager / kilo-vscode extension still calls `Session.list` with the expected shape — historically it passed `directory` and relied on Kilo’s cross-project-id visibility.
- That `SessionTable.path` exists in the schema for all existing rows (otherwise the `isNull(SessionTable.path)` branch at `session.ts:846` is the only path that catches legacy Kilo sessions when `directory` is also supplied).

### Minor note (not a finding) — `proxy-util.ts` header-sanitisation

`packages/opencode/src/server/proxy-util.ts:14-18` deletes `x-kilo-directory` and `x-kilo-workspace`. These are Kilo-specific headers but are unmarked. They were already unmarked in the original `proxy.ts` on `origin/main:27-28`, so this PR is not a regression. Still worth adding `// kilocode_change` someday so a future upstream sync doesn’t silently remove these deletes.

## Method

- Generated the changed-file list with `git diff origin/main...HEAD --name-only`.
- For every shared path, compared `grep -c kilocode_change` on `origin/main` vs `HEAD`. Any mismatch was inspected in detail with `git diff origin/main...HEAD -- <file>` and `git show eb4219304:<file>` (upstream at the merge commit).
- For large-diff shared files with equal counts (e.g. `session/message-v2.ts`, `tool/bash.ts`, `cli/cmd/tui/component/prompt/index.tsx`, `provider/provider.ts`, `provider/transform.ts`, `session/session.ts`), inspected the diff directly to confirm that no existing `kilocode_change`-guarded block was altered behind a preserved marker.
- Spot-checked PR hotspots listed in the task description: `server/proxy.ts`, `server/backend.ts`, `server/server.ts`, all `server/routes/instance/httpapi/**`, `session/session.ts`, `tool/bash.ts`, `cli/cmd/tui/context/sync.tsx`, `cli/cmd/tui/component/prompt/index.tsx`, `cli/cmd/tui/component/dialog-session-list.tsx`, `cli/cmd/tui/context/theme.tsx` (no diff).
