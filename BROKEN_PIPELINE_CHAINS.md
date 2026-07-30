# Broken Kilo Pipeline Chains in Upstream Merge PR 12695

Review range: base `70eeaff3837e29529e26c7c090767df0a3768249`, head `518501a994bcd660e8c6d061b450c32412104004`.

## Methodology

I intersected the 1,502-file range diff with shared files containing `kilocode_change` at either endpoint, inspected Kilo-owned files changed in the same subsystems, and compared the merge result with both merge parents. For each behavior below I followed the producer through schemas/config/runtime state, transport or persistence, and the final CLI/UI consumer. I prioritized behavior present on Kilo `main` immediately before the merge and removed or disconnected by conflict resolution; compilation-only compatibility changes were not treated as proof of correctness.

## Findings

### 1. High: plain `kilo run` permission rejection no longer makes the process fail

The permission event path still auto-rejects root and tracked Task-child asks and prints `auto-rejecting` (`packages/opencode/src/cli/cmd/run.ts:899-954`), but the merge removed the `autoRejected` accumulator and its post-loop conversion into an error. `loop()` therefore returns no error when the session subsequently becomes idle, `finish()` leaves `process.exitCode` at zero, and automation can treat a denied/incomplete run as success. This breaks the behavior added by `d579774960`; three retained tests still require the removed diagnostic `run ended with an auto-rejected permission...`, which no production source now emits (`packages/opencode/test/cli/run/run-process.test.ts:135-160,304-313`).

Chain: `permission.asked` -> CLI sends `reply: "reject"` -> rejection state is dropped -> idle breaks the stream -> `finish()` sees no error -> shell exit code is 0.

### 2. High: clearing settings can either throw or reveal stale values from another config file

The merge removed both safeguards introduced by `624b5890f1`: `patchJsonc()` no longer treats deletion of an absent nested path as a no-op, and `updateGlobal()` no longer propagates null delete sentinels across all layered global files. The first failure is directly reproducible: `jsonc-parser.modify("{}", ["missing", "nested"], undefined, ...)` throws `Can not delete in empty document`. The second leaves lower-precedence values in `kilo.json`, `opencode.json[c]`, etc.; after the primary value is deleted, normal config merging exposes the stale sibling value again. The corresponding multi-file unset tests were deleted. VS Code actively emits nested null sentinels from model, permission, indexing, context, and experimental settings, so this is a live UI-to-storage chain rather than a dormant helper.

Chain: settings control -> `updateConfig`/`updateGlobalConfig` sends a nested `null` -> config HTTP handler -> `Config.update*` -> `patchJsonc` throws for an absent path, or writes only the primary file -> reload merges sibling files -> cleared setting errors or reappears.

### 3. High: the new `web_search` setting was removed end to end

The configurable web-search feature merged into base as PR 12369 (`bd0d1f08ae`) has been removed at every propagation layer: the Browser settings toggle is gone, `Config.web_search` and settings import/export support are gone, the generated SDK no longer exposes the field, and `ToolRegistry.tools()` no longer reads config. The final consumer now enables web search only for the Kilo provider or Exa/Parallel flags (`packages/opencode/src/tool/registry.ts:76-81,339-344`). Consequently third-party providers cannot opt in, despite the feature's intended behavior and prior config values becoming silently unread.

Chain: Browser toggle/config file `web_search: true` -> config schema/SDK field removed -> registry no longer reads the value -> `webSearchEnabled()` rejects non-Kilo providers -> the model never receives the tool.

### 4. High: authenticated Kilo users no longer route Exa searches through the Kilo proxy

The merge deleted `packages/opencode/src/kilocode/tool/websearch-kilo-exa.ts`, removed `Auth.Service` from the web-search tool, dropped the `kilo-exa` override, and replaced transport selection with unconditional MCP Exa/Parallel dispatch. This undoes `c0ebf98778`. A Kilo token is still stored by auth, but it is never read by web search; the `/api/exa/search` request, bearer header, Kilo response decoding, and `transport` metadata are all gone. Authenticated users without `EXA_API_KEY` now use the unauthenticated external MCP endpoint instead of the Kilo proxy, potentially losing the service path intended for Kilo accounts.

Chain: `kilo auth login` persists token -> web-search initialization previously read `Auth.Service` -> selected `kilo-rest` -> bearer request to Kilo Gateway -> formatted result; the head stops after token persistence and dispatches to MCP instead.

### 5. Medium: queued follow-ups are reported to clients as user interruptions

The queue still deliberately breaks only after the current LLM step has drained, but the head records `closeReasons.set(sessionID, "interrupted")` (`packages/opencode/src/session/prompt.ts:1798-1805`). Base used the Kilo-only `superseded` reason added by `8a47d8b788`. The merge also removed `superseded` from the event schema, extension/webview message types, and outcome suppression test. `KiloSession.publishTurnClose()` emits the changed value, `kilo-provider-utils.ts:551-556` forwards it unchanged, `session.tsx:1103-1105` stores it, and `session-outcome.ts:49` renders an interruption warning. Normal FIFO handoff now flashes "Turn interrupted" even though no work was prematurely stopped.

Chain: queued prompt -> drained current step sees `hasFollowup()` -> `interrupted` close reason -> `session.turn.close` SSE -> extension message -> webview close state -> warning banner.

### 6. Medium: the experimental output-token cap is dropped by one overflow decision

`KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX` is still parsed into `RuntimeFlags.outputTokenMax`, and request sizing, LLM usable budget, and compaction-chunk logic still consume it. The merge removed only the argument passed from `SessionProcessor` to `isOverflow()` (`packages/opencode/src/session/processor.ts:704-708`), so this final overflow check falls back to the default/model output limit while the actual request and surrounding budget calculations use the configured cap. With a non-default cap, the processor can disagree with the request/compaction pipeline about when context is exhausted, causing premature compaction or a provider-side overflow before local compaction.

Chain: env flag -> `RuntimeFlags.outputTokenMax` -> request/LLM/compaction calculations retain it -> processor `isOverflow` drops it -> inconsistent terminal overflow decision.

### 7. Needs human verification: enabling the experimental V2 event system no longer emits normal-turn events

`KILO_EXPERIMENTAL_EVENT_SYSTEM` remains parsed and still installs the internal V2 debug plugin, whose view reads `session.v2.messages`. However, the merge removed the flag dependency and all normal prompt/processor dual-write producers for Prompted, Agent/ModelSwitched, Step, Text, Reasoning, Tool, Retried, Synthetic, and Shell events. Event definitions, durable manifests, sync projection, HTTP delivery, SDK types, and V2 consumers remain. Compaction still conditionally publishes a small subset, so the flag is now partially active rather than clearly retired. If the intent was to keep exercising the V1-to-V2 migration path, ordinary turns no longer populate the final V2 consumer; if the upstream V2 runner is now intended to replace this path, verify that Kilo can actually route flagged sessions through it before accepting these removals.

Chain: env flag -> runtime flag -> debug plugin enabled -> consumer requests V2 messages, but V1 prompt/processor no longer emits the events needed to project those messages.

## Notable Non-Findings

- Kilo question localization/mode hints and non-blocking `blocking` survived the schema move into `@opencode-ai/schema/v1/question`; the VS Code event mapper and QuestionDock still consume them.
- Offline session status survived the schema extraction into `session-status-event.ts` and remains forwarded by the extension.
- MCP OAuth callback race/binding behavior was not lost: the shared-file code now delegates to `kilocode/mcp-oauth-callback.ts`, which owns host binding and explicit `EADDRINUSE` reporting.
- Shell `description` was removed from completed tool metadata/title, but the original tool input still carries `description`, and current VS Code rendering prefers `input.description`; no broken final consumer was established.
- The new Effect `LayerNode`/`AppNodeBuilder` rewiring retained the inspected Kilo runtime dependencies, including Question, RepositoryCache, AgentManager, Notebook, KiloSessions, Auth, sandbox HTTP, and RuntimeFlags where still consumed.

## Commands And Limitations

- Inspected with `git diff --name-status`, `git diff --find-renames`, marker intersections via `git grep`, merge-parent comparisons, targeted `grep`/file reads, and history/provenance via `git log`/`git show`.
- `bun -e` reproduced the removed absent-path JSONC guard failure: `Can not delete in empty document`.
- Targeted `bun test ./test/cli/run/run-process.test.ts -t ...` could not start because the checkout lacks `@opentui/solid/preload`; behavior was therefore traced statically and cross-checked against retained assertions.
- `bun run script/check-opencode-annotations.ts --base ...` intentionally skipped because the script detected an upstream merge.
- `git diff --check` found pre-existing whitespace defects in the reviewed merge (mostly generated SDK output); these are outside pipeline scope.
- The review focused on affected `kilocode_change` behavior chains and Kilo-owned endpoints, not an exhaustive audit of all 1,502 changed files. No external services, OAuth browser flow, or live model/provider calls were exercised.
