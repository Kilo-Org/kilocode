# Broken Pipeline Chains Review

Reviewed PR #12460 at `51d8031c9997bd5478bcde715562169f732d04d4` against `origin/main` (`b367105c8d648c8e05b62c2d27a28a95a4772f61`) and upstream `v1.17.9` (`5c23e88419c4743b9be42cea132f2fb1e6cb63ff`). I traced changed `kilocode_change` behavior and Kilo-owned consumers across the relocated core/server/SDK/HTTP/PTY layers, credential and organization routing, MCP roots, V2 event/UI projection, shell relocation, and markdown worker/theme/Mermaid paths. This review targets broken propagation chains rather than compile-time or style issues.

## Findings

### Resolved, previously high severity: Completed Mermaid fences were passed to Mermaid with their Markdown delimiters

`stream()` correctly separates a code block's Markdown identity from its source: a completed ` ```mermaid ... ``` ` token has `raw` equal to the whole fenced block but `src` equal to `graph TD...` ([`markdown-stream.ts:67-70`](packages/ui/src/components/markdown-stream.ts#L67-L70), [`markdown-stream.ts:81-84`](packages/ui/src/components/markdown-stream.ts#L81-L84)). The new Kilo-specific branch initially carries that source in `unstable` ([`markdown.tsx:378-394`](packages/ui/src/components/markdown.tsx#L378-L394)), but `updateCodeBlock()` drops it and writes `block.raw` into `code[data-lang="mermaid"]` ([`markdown.tsx:709-720`](packages/ui/src/components/markdown.tsx#L709-L720)). `renderMermaid()` then reads that DOM text and passes it directly to `mermaid.parse()`/`render()` ([`markdown-mermaid.ts:398-403`](packages/ui/src/kilocode/markdown-mermaid.ts#L398-L403), [`markdown-mermaid.ts:430-435`](packages/ui/src/kilocode/markdown-mermaid.ts#L430-L435)).

The resulting source begins with ` ```mermaid`, which Mermaid rejects as not having a diagram type. Reproduced from this checkout:

```text
$ bun -e 'import mermaid from "mermaid"; ...'
ok "graph TD\n  A-->B"
fail "```mermaid\ngraph TD\n  A-->B\n```" No diagram type detected matching given configuration for text: ```mermaid
graph TD
  A-->B
```
```

The merge follow-up now preserves `Block.src` separately from fenced `raw` identity and writes the delimiter-free source into `code[data-lang="mermaid"]`. A real VS Code Storybook/Chromium test renders the completed flowchart SVG and verifies the DOM source contains `flowchart TD` without a Markdown fence.

### Resolved review concern: queued steering remains actionable without restoring the removed wrapper

The Kilo queue intentionally leaves the active prompt's historical messages in the next request and moves the queued target to the end to avoid an invalid assistant prefill ([`prompt-queue.ts:84-119`](packages/opencode/src/kilocode/session/prompt-queue.ts#L84-L119)). Before the merge, when a later LLM step followed a finished assistant, every non-synthetic user text chronologically after that assistant was wrapped as a system reminder requesting the model to address it ([`origin/main:session/prompt.ts:1710-1730`](packages/opencode/src/session/prompt.ts#L1710-L1730)). The PR removes that only conversion and now forwards the same queued/history message content unmodified ([`session/prompt.ts:1698-1707`](packages/opencode/src/session/prompt.ts#L1698-L1707)).

The surrounding queue machinery is still active: `prompt()` serializes a follow-up behind the current loop without cancelling the in-flight stream ([`session/prompt.ts:1406-1429`](packages/opencode/src/session/prompt.ts#L1406-L1429)), and the next loop scopes/reorders the message set ([`session/prompt.ts:1471-1481`](packages/opencode/src/session/prompt.ts#L1471-L1481)). Therefore a user follow-up received while the previous turn is executing tools is still propagated to the continuation request, but it no longer receives the explicit Kilo priority/continuation instruction that made it actionable amid the original task and tool results.

The removed wrapper was an intentional upstream fix: it mutated cached persisted messages into synthetic system reminders and was not part of Kilo's queued-turn request path after `KiloSessionPromptQueue.scope()` hides the later prompt from the active turn. Restoring it would reintroduce the cache mutation bug without improving queue steering. The merge follow-up instead fixes the real race by registering the follow-up slot before dismissing a pending question/suggestion, then adds an isolated real question-tool test. That test proves the dismissed old turn does not make another LLM request, the queued steering prompt is the next user message, and no stale `<system-reminder>` wrapper is injected.

## Verified Chains / Non-Findings

- **PTY self-command and shell environment remain connected; credential stripping is now hardened.** The deleted `PtyPreparation` behavior was moved rather than dropped: `Pty.create()` resolves bare `kilo`/`kilocode`, adopts the location/configured shell, and sets `KILO_TERMINAL`/`KILO_PTY_ID`. The follow-up child-process test exposed that deleting server credential keys was insufficient because node-pty inherited missing keys from the parent environment. Core now passes empty tombstones for both server credentials. The canonical `/api/pty` regression proves caller/plugin precedence, forced terminal identity, and empty credentials inside the spawned shell.

- **Kilo OAuth organization routing reaches the gateway.** The newly explicit credential lookup selects the active integration connection, loads the credential, maps OAuth `metadata.accountID` to `kilocodeOrganizationId`, and removes the legacy `accountID` body field ([`session/runner/model.ts:89-125`](packages/core/src/session/runner/model.ts#L89-L125), [`session/runner/model.ts:146-168`](packages/core/src/session/runner/model.ts#L146-L168)). That request body enters AI SDK options ([`aisdk.ts:60-66`](packages/core/src/aisdk.ts#L60-L66)), Kilo's plugin constructs `createKilo` with those options ([`plugin/provider/kilo.ts:12-42`](packages/core/src/plugin/provider/kilo.ts#L12-L42)), and the gateway uses the organization option to produce request headers ([`kilo-gateway/src/provider.ts:39-70`](packages/kilo-gateway/src/provider.ts#L39-L70)). Targeted credential/provider tests passed.

- **MCP roots propagation is complete.** The new client factory reads the active `InstanceState.directory`, advertises `roots`, and is used for normal transport connects and OAuth authorization connects ([`mcp/index.ts:111-117`](packages/opencode/src/mcp/index.ts#L111-L117), [`mcp/index.ts:231-245`](packages/opencode/src/mcp/index.ts#L231-L245), [`mcp/index.ts:833-840`](packages/opencode/src/mcp/index.ts#L833-L840)). No disconnected `new Client` path remains in the runtime MCP service.

- **Catalog/integration event consumers were updated.** Core replaced model-only catalog events with `catalog.updated` and publishes after catalog finalization ([`core/src/catalog.ts:36-38`](packages/core/src/catalog.ts#L36-L38), [`core/src/catalog.ts:189-199`](packages/core/src/catalog.ts#L189-L199)). The V2 TUI data layer refreshes both models and providers on the new event and refreshes integration/models/providers after integration changes ([`tui/src/context/data.tsx:142-148`](packages/tui/src/context/data.tsx#L142-L148), [`tui/src/context/data.tsx:449-456`](packages/tui/src/context/data.tsx#L449-L456)). Targeted data tests cover the new event path.

- **Kilo theme transfer to the Markdown worker is connected.** The raw Kilo Shiki theme is exported in the marked context, sent during worker initialization, registered by the worker, and used in streaming and completed-token highlighting ([`context/marked.tsx:27-401`](packages/ui/src/context/marked.tsx#L27-L401), [`markdown-worker.ts:66-121`](packages/ui/src/components/markdown-worker.ts#L66-L121), [`markdown-shiki.worker.ts:30-53`](packages/ui/src/components/markdown-shiki.worker.ts#L30-L53)). Pierre registration also retains a synchronous consumer path via `ensureKiloDiffTheme()`.

- **CORS relocation retains Kilo origins.** Shared server CORS imports the Kilo-owned matcher and applies it before configured origins ([`server/src/cors.ts:1-27`](packages/server/src/cors.ts#L1-L27)); the relocated matcher accepts `https://*.kilo.ai` ([`server/src/kilocode/cors.ts:1-5`](packages/server/src/kilocode/cors.ts#L1-L5)). The legacy Kilo server module no longer owns a competing CORS implementation.

## Command Outputs

```text
HEAD:        51d8031c9997bd5478bcde715562169f732d04d4
origin/main: b367105c8d648c8e05b62c2d27a28a95a4772f61
v1.17.9:     5c23e88419c4743b9be42cea132f2fb1e6cb63ff

$ bun test test/server/httpapi-v2-pty.test.ts test/kilocode/provider-saved-auth.test.ts test/provider/provider.test.ts
95 pass, 0 fail

$ bun test test/kilocode/session-runner-model.test.ts test/plugin/provider-kilo.test.ts
8 pass, 0 fail

$ bunx playwright test tests/markdown-mermaid.spec.ts --project=chromium
1 pass, 0 fail; rendered a real flowchart SVG from delimiter-free source

$ bun run script/test-runner.ts kilocode/session-prompt-queue.test.ts kilocode/session-prompt-steering.test.ts --concurrency 1 --retries 0
2 files passed, 0 failed

$ bun test test/cli/tui/data.test.tsx test/cli/tui/sync.test.tsx test/kilocode/tui-sync-event.test.ts
10 pass, 0 fail
```

The TUI command emitted pre-existing/non-fatal missing `/tmp/opencode/state/kv.json` warnings but completed successfully. `git diff --check origin/main...HEAD` reports whitespace warnings in the added Pierre patch; that is outside this behavior-chain review.

## Limitations

- This was a static and targeted-test review of the requested range. It did not launch authenticated Kilo Gateway requests, real MCP servers, or an interactive TUI/VS Code instance.
- Windows-specific PTY behavior was not exercised on this Darwin host.

Summary: the confirmed Mermaid chain and the real queued-question ordering race are fixed and exercised end to end. The removed legacy steering wrapper remains intentionally absent. Report: `BROKEN_PIPELINE_CHAINS.md`.
