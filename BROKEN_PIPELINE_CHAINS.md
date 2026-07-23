# Broken Pipeline Chains Review

Reviewed PR #12460 at `51d8031c9997bd5478bcde715562169f732d04d4` against `origin/main` (`b367105c8d648c8e05b62c2d27a28a95a4772f61`) and upstream `v1.17.9` (`5c23e88419c4743b9be42cea132f2fb1e6cb63ff`). I traced changed `kilocode_change` behavior and Kilo-owned consumers across the relocated core/server/SDK/HTTP/PTY layers, credential and organization routing, MCP roots, V2 event/UI projection, shell relocation, and markdown worker/theme/Mermaid paths. This review targets broken propagation chains rather than compile-time or style issues.

## Findings

### High, high confidence: Completed Mermaid fences are passed to Mermaid with their Markdown delimiters

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

Impact: every non-streaming completed Mermaid fence takes the error path instead of rendering its SVG. The normal Markdown parser/previous incremental path supplied code source, so this is a cross-layer regression introduced by the worker/block-rendering migration.

### Medium, medium confidence: The merge removed Kilo's second-step user-message escalation, weakening queued steering after tool continuation

The Kilo queue intentionally leaves the active prompt's historical messages in the next request and moves the queued target to the end to avoid an invalid assistant prefill ([`prompt-queue.ts:84-119`](packages/opencode/src/kilocode/session/prompt-queue.ts#L84-L119)). Before the merge, when a later LLM step followed a finished assistant, every non-synthetic user text chronologically after that assistant was wrapped as a system reminder requesting the model to address it ([`origin/main:session/prompt.ts:1710-1730`](packages/opencode/src/session/prompt.ts#L1710-L1730)). The PR removes that only conversion and now forwards the same queued/history message content unmodified ([`session/prompt.ts:1698-1707`](packages/opencode/src/session/prompt.ts#L1698-L1707)).

The surrounding queue machinery is still active: `prompt()` serializes a follow-up behind the current loop without cancelling the in-flight stream ([`session/prompt.ts:1406-1429`](packages/opencode/src/session/prompt.ts#L1406-L1429)), and the next loop scopes/reorders the message set ([`session/prompt.ts:1471-1481`](packages/opencode/src/session/prompt.ts#L1471-L1481)). Therefore a user follow-up received while the previous turn is executing tools is still propagated to the continuation request, but it no longer receives the explicit Kilo priority/continuation instruction that made it actionable amid the original task and tool results.

This may be an intentional upstream alignment, but there is no replacement Kilo behavior or regression test asserting that a steering message arriving during a multi-step tool turn is followed before the agent resumes the original plan. Manual verification: send a tool-using prompt, submit a direct course-correction while the tool is running, and confirm the continuation immediately follows the correction rather than continuing the old task. Repeat with an assistant/tool continuation where the queued message has a `time.created` earlier than the final assistant step.

## Verified Chains / Non-Findings

- **PTY self-command, shell environment, and secret stripping remain connected.** The deleted `PtyPreparation` behavior was moved rather than dropped: `Pty.create()` resolves bare `kilo`/`kilocode`, adopts the location/configured shell, sets `KILO_TERMINAL`/`KILO_PTY_ID`, and removes server credentials before spawn ([`core/src/pty.ts:199-230`](packages/core/src/pty.ts#L199-L230)). Legacy instance HTTP creation still invokes `shell.env` for the effective cwd ([`opencode/src/server/routes/instance/httpapi/handlers/pty.ts:69-81`](packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts#L69-L81)); the canonical `/api/pty` route receives the same hook via `PluginPtyEnvironment` ([`plugin/pty-environment.ts:8-23`](packages/opencode/src/plugin/pty-environment.ts#L8-L23), [`server/src/handlers/pty.ts:35-50`](packages/server/src/handlers/pty.ts#L35-L50)). Targeted PTY tests passed, including websocket I/O, retained exit state, plugin environment precedence, and self-command resolution.

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

$ bun test test/kilocode/pty-self-command.test.ts test/server/httpapi-v2-pty.test.ts
6 pass, 0 fail

$ bun test test/kilocode/session-runner-model.test.ts test/plugin/provider-kilo.test.ts
8 pass, 0 fail

$ bun test src/components/markdown-worker-protocol.test.ts src/components/markdown-worker-queue.test.ts src/components/markdown-worker-transport.test.ts src/components/markdown-code-state.test.ts src/kilocode/markdown-bidi.test.ts
15 pass, 0 fail

$ bun test test/cli/tui/data.test.tsx test/cli/tui/sync.test.tsx test/kilocode/tui-sync-event.test.ts
10 pass, 0 fail
```

The TUI command emitted pre-existing/non-fatal missing `/tmp/opencode/state/kv.json` warnings but completed successfully. `git diff --check origin/main...HEAD` reports whitespace warnings in the added Pierre patch; that is outside this behavior-chain review.

## Limitations

- This was a static and targeted-test review of the requested range. It did not launch authenticated Kilo Gateway requests, real MCP servers, or an interactive TUI/VS Code instance.
- The queued-prompt finding is behaviorally well-supported by the removed conversion and still-active queue flow, but requires the specified real multi-step steering scenario to establish user-visible severity.
- The Mermaid failure was confirmed directly against the installed Mermaid parser, but no DOM-level component test currently exercises a completed Mermaid fence end-to-end.

Summary: 1 confirmed broken chain and 1 medium-confidence queued-prompt regression risk. Report: `BROKEN_PIPELINE_CHAINS.md`.
