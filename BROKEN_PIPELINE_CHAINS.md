# Broken Pipeline Chains — PR #13513

## Scope and method

Reviewer 5 of 7; this report is the only file written by this reviewer. Review checkout: `/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports`.

**Lens verdict: safe after specific fixes.** The original two merge-relative P2 findings are preserved: one from the upstream range, one from SDK regeneration/adaptation and also present on the supplied main control. The completed static follow-up adds two **pre-existing Kilo P2** TUI findings, excluded from this PR's regression verdict, and one precisely scoped human-verification item. No new P0/P1 issue was established.

Reviewed exact HEAD `6a7d6bc002319ac2987bcde3d6c63efcafc07021` against actual base/merge base `bf1cf502a3c511e9daf6a43244568ae4e83473a8`, not against main. Main control: `62998965e9fb0d9ed89011c62498b39801dbbb4f`. Verified the provided authoritative local upstream refs:

| Ref suffix | Commit |
|---|---|
| upstream-v1.18.18 | `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d` |
| upstream-v1.18.19 | `2b72179c663cadcb54f54d9f19221b3fb3d11fb6` |
| upstream-v1.18.20 | `7248bc1964b13fa67e601733f89ee9dc6dfa0563` |

Confirmed 59 changed files (3 added/56 modified), 1,524 insertions/647 deletions, 95 reachable commits and two first-parent commits. `91ca95bad927436131ea4783a470885a381ce6ad` has base and pristine .20 parents and the same tree as base. Final HEAD has `91ca95bad9` and transformed `9563af96a012effc25df5a11eaa1f7633161a742` parents. Pristine .18 → .20 changes 181 files, so that larger upstream inventory must not be mistaken for this PR's 59-file delta.

Read root `AGENTS.md`, `REVIEW.md`, `TESTING.md`, `kilo-steer`, merge-review validation/audit references, merge-minimizer guidance, upstream merge documentation, and applicable CLI/test/HttpApi/LLM/core-tool/VS Code instructions. Inspected the complete handwritten production delta, generated-client transport and signature changes, all changed-file marker locations, and removed marker lines. The marker inventory contains **737 marker-bearing lines in 29 changed files**; this counts delimiters/imports as well as behavior, not 737 independent features.

Method: trace producers through transformations, registration/service graphs, persistence/events and consumers; exercise production functions and existing implementation tests; compare suspicious behavior to base, main, pristine .20 and merge parents. Inline historical controls transpile exact functions from `git show` in memory rather than modifying the checkout. Compilation alone is not treated as semantic proof.

**Static follow-up completeness:** completed bounded producer → intermediate transformation/state/registration → concrete consumer tracing for **737/737 marker-bearing lines in 29/29 changed files: 17 production files and 12 test files**, including historical regions and all four removed marker-bearing lines. Delimiters, adjacent imports and related declarations were grouped by behavior; type-only markers terminate at their schema/public-type consumer rather than being counted as independent runtime flows. No marker region remains omitted from the in-repository source trace. This replaces the first round's incomplete-source-audit qualification; it does **not** claim runtime execution of every branch or external-provider certification.

The audit used **20 semantic families**: search/spawn; core projection/replay; core context/compaction; CLI arguments/stdin; CLI cloud/local/daemon dispatch; headless event/reply ownership; catalog/model fields; provider credentials/headers; plugin registration/lifecycle; request option/schema/cache lowering; transport timeout/WebSocket settlement; stream error/retry; billing/routed metadata; session rows/listing/plan paths; session fork/deletion/sandbox inheritance; Task orchestration; tool visibility/host RPC; TUI prompt/memory arbitration; TUI command/export/feedback; and TUI part rendering/approval/diffs. Marked test regions were traced into their corresponding production family, including fixture/layer substitutions and final assertions. The generated SDK was also audited beyond its marker inventory. Material conclusions and exact exceptions are grouped below, not presented as a per-file checklist.

## Findings

### P2 — SDK-wide `throwOnError` no longer reaches Kilo's error normalizer

**Location:** `packages/sdk/js/src/v2/gen/client/client.gen.ts:201`; consumer `packages/sdk/js/src/error-interceptor.ts:19`; registration `packages/sdk/js/src/v2/client.ts:100`.

**Provenance:** introduced by merge adaptation/SDK regeneration relative to this PR's actual base. Base and pristine .20 pass the control; HEAD fails. The supplied main also fails. The pristine and transformed-parent generated transport blobs have no delta; the rewritten transport appears in final HEAD. This is not a pristine .18 → .20 runtime change, nor an issue already present in this PR's immediate base.

**Broken chain:** `createKiloClient({ throwOnError: true })` → generated `_config` → request's effective `throwOnError` → HTTP error body → error interceptors → `wrapClientError` → caller's rejected promise. The generated request correctly resolves `options.throwOnError ?? _config.throwOnError` for whether to throw, but sends the **unmerged per-call `options`** to interceptors. `wrapClientError` sees no `opts.throwOnError` and returns the raw JSON object. The outer request then throws that object.

**Concrete failure:** an SDK consumer configuring error throwing once at client creation receives `{ name: "NotFoundError", data: { message: "session missing" } }` instead of an `Error`; `error.message` is undefined and `String(error)` is `[object Object]`. Error-formatting and `instanceof Error` handling lose the useful server diagnostic. This is reproducible through the public SDK, not only the internal transport. Most inspected in-repo callers supply `throwOnError` per call, so a broad TUI/extension failure is **not** claimed.

**Proof/control:** a fake 404 at the fetch boundary with the real public client produces `errorInstance:false,message:null` with the client-wide default, and `errorInstance:true,message:"session missing"` with the identical option passed per call. The exact historical transport plus the unchanged real Kilo interceptor gives:

```text
{"ref":"HEAD","errorInstance":false,"message":null}
{"ref":"bf1cf502a3c511e9daf6a43244568ae4e83473a8","errorInstance":true,"message":"session missing"}
{"ref":"62998965e9fb0d9ed89011c62498b39801dbbb4f","errorInstance":false,"message":null}
{"ref":"7248bc1964b13fa67e601733f89ee9dc6dfa0563","errorInstance":true,"message":"session missing"}
```

**Alternative challenged:** the new behavior might be an intentional generic SDK error-policy change. That does not explain away the Kilo regression: the handwritten wrapper explicitly promises normalized thrown errors, remains installed, and works when the effective option happens to be present per call. The break is the missing default-option pass-through.

**Fix direction:** ensure the Kilo interceptor receives the effective `throwOnError` value, including client defaults, while preserving raw tuple errors when effective throwing is false. Prefer a narrow handwritten-wrapper or generator compatibility seam rather than an unmaintained manual generated edit. Cover global true/per-call undefined, global true/per-call false, per-call true, and network/request-construction errors.

### P2 — Disabled workspace listing becomes an empty deduplication source for `syncList`

**Location:** `packages/opencode/src/control-plane/workspace.ts:717`, with internal reader at `:729` and writer at `:759`.

**Provenance:** introduced by the upstream .18 → .20 range, retained in the merge. Base and supplied main do not duplicate rows; HEAD and pristine .20 do.

**Broken chain:** `POST /experimental/workspace/sync-list` → `WorkspaceHttpApi.syncList` → `Workspace.syncList` → `Workspace.list` → existing-name set → adapter discovery → insert new workspace ID. The new flag-off `return []` is correct for presentation, but `syncList` also uses `list` as its database deduplication source. It is not itself flag-gated.

**Concrete failure:** with a registered adapter returning a previously stored workspace, each sync-list request while `experimentalWorkspaces=false` inserts another row for the same workspace name/directory. Listing hides those rows while disabled; turning the feature back on reveals duplicates with independent IDs. This affects API/SDK callers and mixed client/server flag states; normal same-process flag-off TUI menu use is not claimed, because its workspace command is hidden.

**Reachability:** `packages/opencode/src/server/routes/instance/httpapi/api.ts:98` adds the workspace API unconditionally. `groups/workspace.ts:85` declares the sync-list endpoint without a feature-flag middleware, and `handlers/workspace.ts:51` calls the service without a flag check. The SDK exposes it, and TUI dialogs call it at `packages/tui/src/component/dialog-workspace-list.tsx:91` and `dialog-workspace-create.tsx:81`. The workspace SQL table has only an ID primary key, not a unique project/name constraint (`packages/core/src/control-plane/workspace.sql.ts:6`).

**Proof/control:** executed the exact `fromRow`, `list` and `syncList` implementations from each commit with real Effect/Drizzle and an in-memory SQLite table. Seeded one row, returned the same workspace from a controlled adapter boundary, and invoked `syncList` twice. Assertions checked row count and calls into the sync-start boundary:

```text
{"ref":"HEAD","enabled":false,"rows":3,"attemptedSync":2,"visible":0}
{"ref":"HEAD","enabled":true,"rows":1,"attemptedSync":0,"visible":1}
{"ref":"bf1cf502a3c511e9daf6a43244568ae4e83473a8","enabled":false,"rows":1,"attemptedSync":0,"visible":1}
{"ref":"bf1cf502a3c511e9daf6a43244568ae4e83473a8","enabled":true,"rows":1,"attemptedSync":0,"visible":1}
{"ref":"62998965e9fb0d9ed89011c62498b39801dbbb4f","enabled":false,"rows":1,"attemptedSync":0,"visible":1}
{"ref":"62998965e9fb0d9ed89011c62498b39801dbbb4f","enabled":true,"rows":1,"attemptedSync":0,"visible":1}
{"ref":"7248bc1964b13fa67e601733f89ee9dc6dfa0563","enabled":false,"rows":3,"attemptedSync":2,"visible":0}
{"ref":"7248bc1964b13fa67e601733f89ee9dc6dfa0563","enabled":true,"rows":1,"attemptedSync":0,"visible":1}
```

**Important bound on proof:** adapter enumeration, ID generation and the sync-start boundary were controlled; the real service logic and SQL writes were executed. This is not a full HTTP reproduction or a real remote-workspace connection. In fact, production `startSync` already exits when disabled at `workspace.ts:442`; **no flag-off remote connection bypass is alleged**. The defect is duplicate persistent rows before that guard.

**Alternative challenged:** disabling the feature could legitimately hide workspace state. That is compatible with this finding: hiding rows must not make a write-side reconciliation operation forget they exist. The enabled control proves the existing deduplication logic still works when the presentation filter is absent.

**Fix direction:** make `syncList` a no-op while disabled, or have its deduplication query read stored workspaces independently of the user-visible list gate. Add disabled/repeated-sync/re-enable coverage.

## Additional findings from the completed historical-marker trace

These do **not** add merge-relative regressions. Both are present in actual base and supplied main and should be handled as separate existing-product follow-ups.

### P2, pre-existing Kilo — Non-blocking suggestions never reach the imported TUI renderer

**Marker regions:** `packages/tui/src/routes/session/index.tsx:71–76` and `:261–308`; missing dispatch at `:1955–2013` and `:3049–3072`. The new upstream reasoning change does not modify these branches.

**Full chain:** registry imports/initializes `SuggestTool` → advertises it for CLI/VS Code at `packages/opencode/src/tool/registry.ts:313` → `kilocode/suggestion/tool.ts:74–79` publishes `blocking:false` plus message/call IDs → `Suggestion.show` stores the pending action and publishes `suggestion.shown` → `context/sync.tsx:353–356` updates `store.suggestion` → the session route filters it out of `blockingSuggestion` → the dedicated `Suggest`/`SuggestBar` renderer is never dispatched. `toolDisplay("suggest")` returns `generic`; the `Suggest` identifier occurs only in its import. Its intended consumer at `kilocode/suggestion/tui/render.tsx:63–64` is therefore unreachable from this route.

**Concrete failure:** built-in suggestions do not show their action buttons in the TUI, so users cannot accept the offered action through that UI. The tool awaits the pending result (`suggestion/tool.ts:96`), but a later prompt or abort can dismiss it; this is not described as an unavoidable permanent hang. VS Code's distinct rendering path is not implicated.

**Proof/control:** exact historical `toolDisplays`/`toolDisplay` execution and source-reference assertions, with ordinary registered tool rendering as the architectural control, produce:

```text
{"ref":"HEAD","suggestDisplay":"generic","SuggestReferences":1,"renderedSuggest":false}
{"ref":"bf1cf502a3c511e9daf6a43244568ae4e83473a8","suggestDisplay":"generic","SuggestReferences":1,"renderedSuggest":false}
{"ref":"62998965e9fb0d9ed89011c62498b39801dbbb4f","suggestDisplay":"generic","SuggestReferences":1,"renderedSuggest":false}
```

The strongest alternative—a second inline rendering site—was checked by searching `SuggestBar`, `<Suggest` and suggest dispatch across TUI and the Kilo suggestion render directory. The only `SuggestBar` invocation is inside the unused `Suggest` component. The blocking footer is a separate control and intentionally excludes the built-in tool's `blocking:false` request.

**Fix direction:** restore the `suggest` tool-display entry and dispatch `Suggest` with its matching pending request, `InlineTool` and `BlockTool`. Verify accept, new-prompt dismiss, abort and tool-result metadata rendering. No source fix was applied.

### P2, pre-existing Kilo — Parent/child navigation executes group-wide process cleanup

**Marker region:** `packages/tui/src/routes/session/index.tsx:354–390`; lifecycle caller `packages/tui/src/app.tsx:1152`.

**Full chain:** parent → child session navigation updates route ID → the keyed `<Show>` disposes the old `Session` component → its `onCleanup` calls `stopProcesses(processSessionID)` unconditionally → `processSessions` expands the parent and siblings → SDK `backgroundProcess.stopSession` → `kilocode/server/httpapi/handlers/background-process.ts:47–51` → `BackgroundProcess.stopSession` at `kilocode/background-process/index.ts:1231–1246` → ordinary session-lifetime processes are terminated. Persistent processes are outside that map, and a child process with parent lifetime is transferred rather than terminated by that particular call.

**Concrete failure:** merely opening a child task can stop an ordinary development server or watcher belonging to its parent session. The same-group guard at route line 384 only protects an update of a surviving component; it cannot suppress the separate cleanup triggered by keyed remounting.

**Proof/control:** ran the exact marked cleanup block from HEAD/base/main inside real Solid reactive primitives, with the same one-argument keyed `Show` callback shape used by `app.tsx`; only SDK calls were recorded instead of stopping OS processes. The materially different unkeyed control preserves the component and exercises the same-group guard:

```text
{"ref":"HEAD","keyed":false,"navigation":"parent -> child","stopRequests":[]}
{"ref":"HEAD","keyed":true,"navigation":"parent -> child","stopRequests":["parent","child"]}
{"ref":"bf1cf502a3c511e9daf6a43244568ae4e83473a8","keyed":false,"navigation":"parent -> child","stopRequests":[]}
{"ref":"bf1cf502a3c511e9daf6a43244568ae4e83473a8","keyed":true,"navigation":"parent -> child","stopRequests":["parent","child"]}
{"ref":"62998965e9fb0d9ed89011c62498b39801dbbb4f","keyed":false,"navigation":"parent -> child","stopRequests":[]}
{"ref":"62998965e9fb0d9ed89011c62498b39801dbbb4f","keyed":true,"navigation":"parent -> child","stopRequests":["parent","child"]}
```

**Alternative challenged:** the existing same-group guard might already preserve the processes. It does in the unkeyed control, but the actual app uses a keyed session-ID boundary. This proof covers lifecycle and emitted stop requests, not a manual TUI/OS-process kill exercise.

**Fix direction:** own group-lifetime cleanup outside the keyed session component, or make unmount cleanup consult the destination group before sending stop requests. Preserve cleanup on actual group exit/application shutdown. No source fix was applied.

## Notable non-findings and bounded follow-ups, grouped by chain

### Provider construction → option lowering → wire request

- **Cloudflare:** auth/env account and gateway metadata → custom loader → native OpenAI/Anthropic or unified Workers AI model → AI SDK encoder → gateway envelope was exercised using the **actual custom loader extracted from production**, not just the test's mirrored `gatewayModel` helper. HEAD and pristine .20 emit OpenAI `v1/responses` and Anthropic `v1/messages`; both Workers ID forms retain `compat/chat/completions`. The synthetic Cloudflare token is present in the outer gateway auth header, absent from third-party upstream envelopes, and present for Workers AI. Base demonstrably forwarded it into the unified third-party envelope. This is a preserved upstream fix, not a lost credential pass-through.
- Catalog/config model `api.npm` resolution precedes variants in `provider.ts:1298` and `:1523`; `ProviderTransform.providerOptions` chooses the native option namespace before `LLM.stream` uses it. Reasoning/cache/tool-schema transforms remain connected. Native LLM opt-in does not accidentally intercept Cloudflare after the npm rewrite: `native-runtime.ts:55` rejects that provider ID. Explicit custom npm/baseURL combinations and live BYOK billing remain unverified.
- **Cerebras:** plugin import → internal registration (`plugin/index.ts:93`) → `Plugin.trigger` → `LLMRequestPrep.prepare` → `streamText.maxOutputTokens` remains connected. Kilo's existing `maxOutputTokensForRequest` independently preserves the same omission at `provider/transform.ts:1741`, including when default plugins are disabled. The new hook is redundant with that Kilo guard, but is not a broken chain. Tests cover configured cap, absent cap, and other-provider controls.
- Removed Cloudflare `chat.params` cap suppression was checked against the new native routing; it is not silently lost on the standard path. Qwen's removed temperature/top-p defaults are intentional upstream changes; explicit agent settings still precede transform defaults in request preparation. Kilo gateway options, Ling defaults, Gemini schema sanitation, cache breakpoints and reasoning-summary hooks remain at their existing call sites; transform tests executed.
- Completed credential writer/reader tracing: `ProviderConnectDialog.tsx:413–441` constructs Bedrock/Vertex metadata → `provider-actions.ts:295–307` preserves string metadata in `auth.set` → `ControlHttpApi.authSet` → `Auth.set` stores it → `cloud-auth.ts` discriminates structured credentials → provider loader supplies Bedrock `credentialProvider` or Vertex `googleAuthOptions`/OAuth fetch. `providerKey` suppresses accidental treatment of access-key IDs/service-account JSON as bearer tokens. Azure endpoint/resource precedence reaches the SDK constructor without retaining both options; Snowflake's missing-credential message reaches the custom model-loader error. Kilo/OpenRouter/Cerebras/Nvidia/Vercel/Zenmux branded headers reach `resolveSDK` and the selected SDK's HTTP fetch; the Cerebras post-hook intentionally overwrites the inline label with `kilo`.
- Completed catalog-field tracing: gateway model parser → `ModelsDev.get`/model cache → model/config patches → `Provider.Model`/`toPublicInfo` → generated model type and extension mirror. `recommendedIndex` feeds TUI/model-picker ordering, `prompt` feeds `session/system.ts`, `isFree` feeds disclosure/export eligibility, `mayTrainOnYourPrompts` feeds filtering/privacy, `hasUserByokAvailable` feeds BYOK disclosure, `terminalBench` feeds model-info/sidebar panels, `autoRouting.models` feeds the extension's `autoChoices`, and `ai_sdk_provider` chooses the native Kilo constructor. Provider `description` and `metadata.noteKey/icon/priority` reach provider display/catalog consumers; `modelsEmpty` reaches prompt/CLI errors. No field was dismissed as connected merely because it appeared in a schema.
- Catalog refresh has a concrete invalidation consumer: core `ModelsDev.refresh` → `ModelsRefresh.notify` → registered listener → `ScopedCache.invalidateAll(state.cache)`; its finalizer removes the listener. Kilo small-model ID priority and fallback reach title generation, branch/commit-message generation and prompt enhancement. The native Kilo option-lowering exception requiring human verification is called out precisely below.

### Codex token refresh → residency → HTTP/WebSocket → retry/cleanup

- Current auth is read before routing; coordinated Kilo refresh settles before residency extraction (`codex.ts:486–539`). The new claim is derived from the refreshed access token and is only added on the rewritten Codex endpoint. Auth-store schema changes are unnecessary: the access token was already persisted, and this is a derived header rather than a new durable field.
- `ws.ts` forwards close code to the pool; code 1009 activates per-session HTTP fallback immediately. `ws-pool.ts:146` still consumes the discarded failed stream, so the newly fast fallback does not remove Kilo's rejection cleanup. Abort/reset, connection reuse, ordinary stream retry and session-deletion/dispose paths remain connected and have existing implementation test coverage.
- The residency/refresh/WebSocket tests were run with synthetic credentials/local boundaries. No enterprise account or provider-side residency enforcement was tested.

### Provider errors → normalized stream → retry → persisted terminal state

- `rawFinishReason=network_error` now fails the adapter with `ResponseStreamError`, rather than emitting a successful finish step. `MessageV2.fromError` recognizes it as retryable; processor retry policy consumes it. Adapter state is recreated for each `LLM.stream` attempt, preventing the skipped finish/reset branch from leaking counters into the next request.
- Kilo's error-frame normalization still unwraps `response.failed`, wrapped and bare error records before the shared parser. New capacity/try-again prose reaches fallback retryability. Existing login/billing-action exclusions, explicit retry limits, offline handling and cancellation remain connected; provider-error, retry, processor and compaction suites exercised these paths.
- Successful steps still pass raw billing usage, routed model ID and response headers through `LLMAISDK` → processor → `Session.getUsage`/step-finish storage. Provider-reported Kilo/OpenRouter cost wins before estimated pricing. Finite pricing guards do not replace that precedence. Cost/routed-model/response-metadata tests pass.
- No claim is made that every provider's arbitrary prose or all retry-after/cancellation timing combinations were independently covered.

### Subagent creation/resume → permissions → foreground/background settlement

- Task validation still rejects primary agents and cross-parent resumption. Parent session restrictions and Kilo read-only/MCP ceilings enter child permissions; current restrictions refresh on resume. Sandbox inheritance and platform registration occur before `session.created` publication, with explicit reconstruction on resume. Model/variant/workflow selection reaches child prompts and tool metadata. Registry visibility is not mistaken for enforcement: tool execution retains sandbox wrappers and inherited session policy.
- The new terminal child-tool-error check is inside the same `runTask` and process finalizer as assistant errors. It reaches foreground failure via `BackgroundJob.wait`, or background notification via `renderOutput` with the resumable task ID. Cost propagation still brackets each invocation and covers success/error/cancellation; cancellation does not turn into a successful task result. Existing task/nesting/model/sandbox tests execute these implementations.
- Actual extracted `run.ts` event loops prove the new `session.created` chain approves a newly observed child without waiting for Task metadata, preserves the root-Task metadata fallback for resumed children, and leaves unrelated ordinary permission requests untouched.
- **Pre-existing Kilo follow-ups, not merge findings:** (1) `run.ts:932` rejects `skillShell`/`sandboxEscalation` asks before session filtering; an unrelated session's special ask can be rejected by an attached run. (2) metadata-tracked resumed children are not added to the new `sessions` set, and `KiloRunAuto.track` accepts only root Task parts, so a newly created grandchild beneath a resumed child remains untracked. Both behaviors were reproduced against HEAD, actual base and supplied main. They are excluded from this merge verdict; whole-process user-visible hang/interference reproductions were not performed.

Exact event-loop output (controlled SDK reply boundary; all logic came from the actual loop):

```text
{"ref":"HEAD","replies":[{"requestID":"new","reply":"once"},{"requestID":"other-skill","reply":"reject"},{"requestID":"resumed","reply":"once"}]}
{"ref":"bf1cf502a3c511e9daf6a43244568ae4e83473a8","replies":[{"requestID":"other-skill","reply":"reject"},{"requestID":"resumed","reply":"once"}]}
{"ref":"62998965e9fb0d9ed89011c62498b39801dbbb4f","replies":[{"requestID":"other-skill","reply":"reject"},{"requestID":"resumed","reply":"once"}]}
```

### Core session/context persistence → headers/compaction → reader

- New core session headers enter `LLM.request.http`, survive route-default merging at `packages/llm/src/route/client.ts:178`, and become transport headers at `route/transport/http.ts:102`. Compaction now copies `input.request.http`; core runner tests assert parent/session affinity preservation.
- The projector's new epoch markers annotate retained behavior, not newly introduced resets. Move/revert still reset the compatibility epoch; runner initialization/preparation still supplies expected location. Stored-message normalization/encoding, nullable legacy sequence exclusion and legacy promotion replay hooks remain registered. Core projector, compaction, runner and released-writer compatibility tests pass.
- Compaction still writes the compatibility `include` field alongside `recent`. This PR does not alter schema/migration files. The tests are synthetic released-writer controls, not an actual installed-client old → new → old UI exercise.
- Ripgrep's surrogate-safe truncation occurs before `Match.make`; Kilo context selection, truncation/partial flags and match decoration survive the mapping. Spawn-bound validation remains attached after preparation, and bounded cancellation/settlement helpers remain connected. Real ripgrep, target replacement and settlement tests pass.

### HTTP/source schema → generated SDK → TUI/extension consumers

- Provider handler is composed in production `httpapi/server.ts:186`; `Auth.node` and Kilo model-cache dependencies are already present at `:240`/`:250`. New persisted-credential connected status is not a missing service-layer dependency. Disabled/enabled filters and prompt-training filtering precede valid-provider selection; `failed` remains separate.
- Provider list → `fetchProviderData` → `KiloProvider`'s `providersLoaded` message → webview provider context (`context/provider.tsx:58–63`) carries `connected` unchanged. The field is still `string[]`; no new mirrored field is required. The new auth read does not serialize the credential map. Tests cover route responses, runtime fetch-option removal, failed-cache recovery and SDK errors.
- Generated required-argument corrections, simplified unknown index signatures, SSE generic changes, SDK property registration and Kilo endpoints were inspected. No route addition/removal is hidden in this regeneration. SDK HTTP/SSE tests exercise representative current routes. The specific default-error-options regression is isolated above; a passing per-call error suite does not cover it.
- Encrypted reasoning metadata survives `reasoning-end` → processor part metadata/end time → storage/SSE → TUI `ReasoningPart` → `ReasoningHeader.encrypted`. Blank opaque parts now render without an expansion affordance, and the Kilo `partID` → routed-model badge connection remains. Text reasoning and completed duration use the existing fields. No visual/manual TUI test was performed.
- Websearch registration still routes through Kilo tool visibility, permission checks and sandbox-aware HTTP; adding `opencode-go` to availability does not bypass these execution guards. Existing Kilo-auth/Exa transport tests pass.
- The changed `customize-opencode` Markdown remains unregistered in the core builtin registry (`plugin/internal.ts:112`), so its new global `.jsonc` sentence is not injected by Kilo's builtin skill registration. Kilo's `kilo-config` path remains separate. No new literal model-facing prompt was introduced by the inspected changed production code; changes to sampling, advertised websearch availability, error tool results and encrypted reasoning display are behavioral changes, not prompt-file edits.
- The four removed marker-bearing lines are delimiter/placement changes in the provider handler and the rewritten websearch availability expression. Their surrounding Kilo model filtering, metadata, failed-provider response and `ProviderV2.ID.kilo` branch remain present. No removal of those Kilo behaviors was found.

### Remaining historical session, registry and TUI chains — static completion

- **Session rows, listing and plans:** shared Revert brands round-trip through `toRow`/`fromRow`; `workspace` state comes from revert processing and remains in the public result. Lightweight summary diffs persist through the projector/row fields rather than being confused with full patch payloads. `listByProject` → `KiloSession.filters` → SQL and `listGlobal` → worktree-family filtering → experimental handler's `worktreeName` enrichment → generated type → TUI session picker/extension session-mention reader were followed. `Session.plan`'s `.kilo/plans` value reaches plan prompts, plan-exit file resolution and follow-up handling. Compatibility facades delegate to the same Session service via `AppRuntime`; their LayerNode dependencies were inspected.
- **Fork/deletion lifetimes:** fork model-at-cutoff selection feeds the new session; cloned message/part IDs, zeroed historical costs and compaction tail IDs feed stored copies. `prepareForkedPart` → `KiloPartLifecycle` and `remapChildren` → child clone/map → `task_id`, metadata and output rewriting → Task resume validation closes the child-reference loop. `carryForkDiff` writes the fork's cumulative/base diff keys consumed by `SessionSummary` and diff APIs. Removal closes jobs, confinement, attribution, process/terminal state, published session state and export capture in the inspected order; FK-safe publishing only swallows the specific deleted-session FK condition. Turn-open/close wrappers publish through the legacy Bus, consumed by memory lifecycle, TUI notifications and extension attention—not an absent EventV2-only listener.
- **Sandbox and Task inheritance:** Agent Manager issues a counted server-side grant; session creation consumes it and hands its source directory/session to policy inheritance before publication. Policy snapshots have writer/readers in the sandbox store/current-profile path; `SessionTools` executes through `SandboxPolicy.executeTool`, and code-mode MCP calls independently use `executeMcp`. The registry's network flag is an availability filter, not the sole security boundary. Parent-lifetime background processes transfer in `stopSession`; ordinary processes terminate and persistent processes use a separate map. The separate keyed-TUI cleanup defect is not hidden by this valid Task-finalizer chain.
- **All registry additions:** imports → `infos`/`build`/`extra` → builtin definitions → per-request visibility → JSON schema lowering → tool execution → processor output were followed for recall/memory, background/interactive processes, chart/image, notification/file delivery, notebook, Agent Manager and scout tools. Optional notebook/host availability and client/experimental flags have corresponding gates. Notebook and Agent Manager requests retain operation/request/session IDs through Bus/SSE → extension bridges → SDK reply/reject endpoints → matching deferred; timeout/cancel/disposal settles the wait. Notification goes through `KiloSessions.sendAgentNotification`; image generation uses the provided HTTP client; file-delivery attachments preserve their result metadata. Memory visibility's root-key cache is invalidated by bootstrap's memory status/updated subscriptions. Plugin discovery calls only recognized server exports, preserving external plugin compatibility while skipping named constants.
- **TUI event arbitration and feedback:** question/suggestion/network/terminal producers → event schemas/Bus/SSE → sync maps → session-group selection → prompt component → SDK accept/reject/write/resize/close → server handler were traced. Non-blocking suggestion dispatch is the explicit broken exception above. Permission provenance is produced by `SessionTools.ask`, preserved by `processor.metadata`/completion, and consumed by `stateMetadata` → `describeApproval` → inline/block badges; todo's suppression flag reaches the block badge. Memory error sink → Bus → `MemoryTuiEvents` → toast is wired; the `app.tsx:1152` keyed boundary remounts its captured session filter and cleanup, so a stale-session memory-listener hypothesis was rejected. Feedback command IDs reach registered keybindings and `submitFeedback`, which checks telemetry consent and sends the selected assistant's permitted fields to `Telemetry.trackFeedback`.
- **TUI text/status/export:** background status/count, interactive `closedBy`/exit code and semantic-search result arrays are produced by their tools, preserved in tool metadata and read by the dedicated renderer selected by `toolDisplays`. Task initialization/Starting text derives from real child session/tool state. Question dismissal metadata survives into the compact/expanded display. Edit/apply-patch producers provide `diff`/`files[].patch`; `splitDiffHunks` preserves file/hunk headers for the actual diff widget. Markdown-table formatting feeds rendered text only. Copy/export fetch the no-limit messages endpoint (`handlers/session.ts:133`), then `formatTranscript` and clipboard/editor/file output; they do not use the truncated UI hydration store. Routed-model context/part ID reaches both reasoning and block headers and the step/footer fallback.
- **Every marked test region:** the 12 files' marked setup, input, expectation and teardown regions were read with their imported implementation call sites. Tests terminate in real transform/adapter/SDK/plugin methods or Session/Task/processor/projector state, with external LLM/host/snapshot boundaries substituted where declared. Cost tests persist child assistant costs before executing the real propagation path; terminal errors inspect `Cause`; output-cap tests inject `RuntimeFlags`; plugin fixture paths run through real plugin discovery. No-op snapshot replacements bound only the cancellation fixtures. The compaction ready-timeout catch means that one test can interrupt before its intended plugin boundary, so its passing result is not evidence of that exact timing point. Existing skips and the assertion-free SDK scenario remain explicitly weaker evidence. This is static test-chain coverage, not a new execution claim.

### Exact remaining human-verification item

**HV-1 — Native Anthropic option semantics through Kilo, pre-existing/activation-dependent; not an established merge bug.** Marker `packages/opencode/src/provider/transform.ts:1705–1709` delegates to `kilocode/provider-options.ts:6–28`. The source graph is resolved through Kilo model `ai_sdk_provider` → `kiloCustomLoaders` → `createKilo().anthropic` → the native Anthropic SDK. However, the adapter sets `anthropic.effort` from `openrouter.verbosity`, not `openrouter.reasoning.effort`, and selects adaptive thinking only from `reasoning.enabled`. A variant shaped only as `{ reasoning: { effort: "high" } }` therefore lacks native effort and disables thinking in this adapter. The helper is unchanged from actual base/main. What is missing is a captured, supported **native-Anthropic Kilo catalog/config variant contract plus outgoing request** proving this shape is activated in a shipped selection; the generic/OpenRouter path is not evidence of native activation. Verify that exact combination before treating it as an established product bug or changing the mapping. This is not an uninspected source branch or a new PR finding.

## Commands and results

Every tool command explicitly used the isolated checkout as `workdir`. Package selection was supplied with `bun test --cwd ...`; no root `bun test`, install, branch change, source edit, commit, push or GitHub mutation was performed. Existing test preloads allocate disposable XDG/home/config state and in-memory databases, but **that is not proof of hermetic config reads**. The parent reports primary-checkout config read leakage in the separate config-review run; this lens did not record every filesystem/config read and makes no claim that all its earlier package tests were isolated from ancestor/primary-checkout configuration. The later inline source controls use synthetic arguments/in-memory state and do not initialize project Config services. Some existing provider tests perform network catalog discovery, visible in their logs; these are not live inference tests.

**Runtime limitation:** commands used **Bun 1.3.14**, while root `package.json:7` pins **`bun@1.4.0`**. No Bun installation or pinned-runtime rerun was performed. In particular, the rejection-handling marker at `provider/provider.ts:67` explicitly concerns Bun 1.4; earlier test passes cannot certify that runtime-specific cancellation behavior. The static source conclusions do not depend on claiming a pinned-runtime test pass.

The following are **verbatim terminal result summaries**, with noisy timestamped discovery logs omitted, not claims that every stdout line is reproduced.

### Focused implementation suites

```sh
bun test --cwd packages/opencode ./test/plugin/cerebras.test.ts ./test/plugin/cloudflare.test.ts ./test/plugin/codex.test.ts ./test/plugin/openai-ws.test.ts ./test/provider/cf-ai-gateway-e2e.test.ts ./test/provider/error.test.ts ./test/kilocode/provider/error.test.ts ./test/session/retry.test.ts ./test/kilocode/run-auto.test.ts ./test/tool/task.test.ts
```

```text
 185 pass
 0 fail
 470 expect() calls
Ran 185 tests across 10 files. [20.47s]
```

```sh
bun test --cwd packages/opencode ./test/session/llm.test.ts ./test/session/processor-effect.test.ts ./test/kilocode/session-processor-retry-limit.test.ts ./test/kilocode/task-nesting.test.ts ./test/kilocode/tool-task-model.test.ts ./test/kilocode/provider-list-failed-state.test.ts ./test/server/httpapi-provider.test.ts ./test/server/sdk-error-shape.test.ts
```

```text
 96 pass
 1 skip
 0 fail
 331 expect() calls
Ran 97 tests across 8 files. [44.49s]
```

The skip is `returns public v2 provider not found errors` at `test/server/httpapi-provider.test.ts:264`.

```sh
bun test --cwd packages/core ./test/ripgrep.test.ts ./test/session-runner.test.ts
```

```text
 92 pass
 0 fail
 277 expect() calls
Ran 92 tests across 2 files. [1.82s]
```

```sh
bun test --cwd packages/opencode ./test/provider/transform.test.ts ./test/provider/provider.test.ts ./test/session/compaction.test.ts ./test/control-plane/workspace.test.ts ./test/kilocode/provider-cost.test.ts ./test/kilocode/session-routed-model.test.ts ./test/kilocode/session-response-metadata.test.ts ./test/kilocode/provider/first-byte.test.ts ./test/kilocode/codex-refresh.test.ts ./test/kilocode/sandbox/session.test.ts ./test/kilocode/permission/next.reply-routing.test.ts ./test/kilocode/tool/websearch-kilo-exa.test.ts
```

```text
(fail) provider loaded from env variable [5075.52ms]
  ^ this test timed out after 5000ms.

 685 pass
 1 skip
 1 fail
 1483 expect() calls
Ran 687 tests across 11 files. [85.89s]
```

This command named 12 paths but executed 11 files: `test/kilocode/codex-refresh.test.ts` does not exist. Correct Codex paths were subsequently run below. The skip is `projects a compaction message to v2 (v2 projector disabled)` at `test/session/compaction.test.ts:619`. A teardown log also reported `failed to kill process group` / `EPERM` for a test background-process group; this was not a test assertion failure or a proved merge regression.

```sh
bun test --cwd packages/opencode ./test/provider/provider.test.ts -t '^provider loaded from env variable$'
```

```text
 1 pass
 99 filtered out
 0 fail
 3 expect() calls
Ran 1 test across 1 file. [2.16s]
```

```sh
bun test --cwd packages/opencode ./test/kilocode/codex-auth-refresh.test.ts ./test/kilocode/codex-refresh-user-agent.test.ts ./test/server/httpapi-sdk.test.ts ./test/kilocode/provider/first-byte.test.ts
```

```text
(fail) HttpApi SDK > matches generated SDK instance read routes [5007.20ms]
  ^ this test timed out after 5000ms.

 36 pass
 1 fail
 121 expect() calls
Ran 37 tests across 4 files. [21.85s]
```

```sh
bun test --cwd packages/opencode ./test/server/httpapi-sdk.test.ts -t 'matches generated SDK instance read routes'
```

```text
 1 pass
 20 filtered out
 0 fail
Ran 1 test across 1 file. [4.36s]
```

Both timeout reruns used the original deadlines, without source edits or timeout inflation. They are classified as non-reproducing timing/network-sensitive failures, not established merge regressions. No full base-suite run was performed. **The filtered SDK route test has no result assertions:** `serverPathParity` at `httpapi-sdk.test.ts:230` simply runs the scenario, and the scenario returns captured values without comparing them. Its passing rerun proves request execution/settlement only, not correct status/content. Other tests in that file, the provider route tests and the inline SDK controls do execute assertions; their evidence must not be conflated with this weaker scenario.

```sh
bun test --cwd packages/core ./test/session-projector.test.ts ./test/session-compaction.test.ts ./test/kilocode/database-migration-compat.test.ts ./test/kilocode/search-target.test.ts ./test/kilocode/ripgrep-settlement.test.ts
```

```text
 21 pass
 0 fail
 68 expect() calls
Ran 21 tests across 5 files. [2.31s]
```

### Static checks

```sh
bun run --cwd packages/opencode typecheck
bun run --cwd packages/sdk/js typecheck
```

Each exited 0 with:

```text
$ tsgo --noEmit
```

```sh
bun run lint -- packages/opencode/src/provider packages/opencode/src/plugin packages/opencode/src/session/retry.ts packages/opencode/src/session/session.ts packages/opencode/src/session/llm/ai-sdk.ts packages/opencode/src/tool/task.ts packages/opencode/src/tool/registry.ts packages/opencode/src/cli/cmd/run.ts packages/opencode/src/control-plane/workspace.ts packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts packages/core/src/session packages/core/src/ripgrep.ts packages/sdk/js/src/v2 packages/tui/src/routes/session/index.tsx
```

Exited 0:

```text
Found 582 warnings and 0 errors.
Finished in 4.0s on 81 files with 130 rules using 18 threads.
```

Warnings were not promoted to semantic review findings; no clean-warning claim is made.

### Reproducible in-memory controls

SDK historical control command (real generated transport and real Kilo interceptor, current helper dependencies held fixed):

```sh
bun -e 'import assert from "node:assert/strict"; import * as utils from "./packages/sdk/js/src/v2/gen/client/utils.gen.ts"; import * as sse from "./packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts"; import * as body from "./packages/sdk/js/src/v2/gen/core/utils.gen.ts"; import {wrapClientError} from "./packages/sdk/js/src/error-interceptor.ts"; const deps={...utils,...sse,...body}; for (const ref of ["HEAD","bf1cf502a3c511e9daf6a43244568ae4e83473a8","62998965e9fb0d9ed89011c62498b39801dbbb4f","7248bc1964b13fa67e601733f89ee9dc6dfa0563"]) { const out=Bun.spawnSync(["git","show",`${ref}:packages/sdk/js/src/v2/gen/client/client.gen.ts`],{cwd:process.cwd()}); assert.equal(out.exitCode,0); const js=new Bun.Transpiler({loader:"ts"}).transformSync(out.stdout.toString()).replace(/import\s[\s\S]*?from\s"[^"]+";?/g, "").replace("export const createClient", "const createClient"); const createClient=new Function(...Object.keys(deps),`${js};return createClient;`)(...Object.values(deps)); const client=createClient({baseUrl:"http://review.invalid",throwOnError:true,fetch:async()=>Response.json({name:"NotFoundError",data:{message:"session missing"}},{status:404})}); client.interceptors.error.use(wrapClientError); const err=await client.get({url:"/session/ses_missing"}).catch(e=>e); console.log(JSON.stringify({ref,errorInstance:err instanceof Error,message:err.message??null})); assert.equal(err instanceof Error,ref==="bf1cf502a3c511e9daf6a43244568ae4e83473a8" || ref==="7248bc1964b13fa67e601733f89ee9dc6dfa0563"); }'
```

Workspace historical control command (real extracted logic/SQL; controlled adapter and sync boundary, minimal in-memory table):

```sh
bun -e 'import assert from "node:assert/strict"; const dir=`${process.cwd()}/packages/core`; const {Effect}=await import(Bun.resolveSync("effect",dir)); const {SqliteClient}=await import(Bun.resolveSync("@effect/sql-sqlite-bun",dir)); const {EffectDrizzleSqlite}=await import("./packages/effect-drizzle-sqlite/src/index.ts"); const {eq}=await import(Bun.resolveSync("drizzle-orm",dir)); const {sqliteTable,text,integer}=await import(Bun.resolveSync("drizzle-orm/sqlite-core",dir)); const WorkspaceTable=sqliteTable("workspace",{id:text().primaryKey(),type:text(),name:text(),branch:text(),directory:text(),extra:text({mode:"json"}),project_id:text(),time_used:integer()}); for(const ref of ["HEAD","bf1cf502a3c511e9daf6a43244568ae4e83473a8","62998965e9fb0d9ed89011c62498b39801dbbb4f","7248bc1964b13fa67e601733f89ee9dc6dfa0563"]){const out=Bun.spawnSync(["git","show",`${ref}:packages/opencode/src/control-plane/workspace.ts`],{cwd:process.cwd()});assert.equal(out.exitCode,0); const source=out.stdout.toString(); const segment=source.slice(source.indexOf("    const list = Effect.fn(\"Workspace.list\")"),source.indexOf("    const get = Effect.fn(\"Workspace.get\")")); const row=source.slice(source.indexOf("function fromRow("),source.indexOf("export const CreateInput")); const js=new Bun.Transpiler({loader:"ts"}).transformSync(row+segment); for(const enabled of [false,true]) await Effect.runPromise(Effect.gen(function*(){const db=yield* EffectDrizzleSqlite.makeWithDefaults();yield* db.run("CREATE TABLE workspace (id TEXT PRIMARY KEY,type TEXT,name TEXT,branch TEXT,directory TEXT,extra TEXT,project_id TEXT,time_used INTEGER)");yield* db.insert(WorkspaceTable).values({id:"wrk_existing",type:"test",name:"same",project_id:"project",time_used:0}).run();const starts=[];let seq=0;const deps={Effect,eq,WorkspaceTable,db,flags:{experimentalWorkspaces:enabled},registeredAdapters:()=>[["test",{}]],WorkspaceAdapterRuntime:{list:()=>Effect.succeed([{name:"same",type:"test",projectID:"project",directory:"/fixture",branch:null,extra:null}])},WorkspaceV2:{ID:{ascending:()=>`wrk_new_${++seq}`}},startSync:(info)=>Effect.sync(()=>{starts.push(info.id)})};const api=new Function(...Object.keys(deps),`${js};return {list,syncList};`)(...Object.values(deps));yield* api.syncList({id:"project"});yield* api.syncList({id:"project"});const rows=yield* db.select().from(WorkspaceTable).all();const visible=yield* api.list({id:"project"});const changed=!enabled&&(ref==="HEAD"||ref.startsWith("7248"));assert.equal(rows.length,changed?3:1);assert.equal(starts.length,changed?2:0);console.log(JSON.stringify({ref,enabled,rows:rows.length,attemptedSync:starts.length,visible:visible.length}));}).pipe(Effect.provide(SqliteClient.layer({filename:":memory:",disableWAL:true})),Effect.scoped));}'
```

Cloudflare production-loader capture command:

```sh
bun -e 'import assert from "node:assert/strict"; import os from "node:os"; const dir=`${process.cwd()}/packages/opencode`; const {Effect}=await import(Bun.resolveSync("effect",dir)); const real=globalThis.fetch; try { for(const ref of ["HEAD","bf1cf502a3c511e9daf6a43244568ae4e83473a8","7248bc1964b13fa67e601733f89ee9dc6dfa0563"]){ const out=Bun.spawnSync(["git","show",`${ref}:packages/opencode/src/provider/provider.ts`],{cwd:process.cwd()});assert.equal(out.exitCode,0); const source=out.stdout.toString();const start=source.indexOf("    \"cloudflare-ai-gateway\": Effect.fnUntraced");const end=source.indexOf("    cerebras:",start);assert.ok(start>=0&&end>start);const code=`const loaders={${source.slice(start,end)}};return loaders["cloudflare-ai-gateway"];`;const js=new Bun.Transpiler({loader:"ts"}).transformSync(code).replace(/import\("(ai-gateway-provider[^\"]*)"\)/g,(_,name)=>`import(${JSON.stringify(Bun.resolveSync(name,dir))})`);const loader=new Function("Effect","dep","iife","InstallationVersion","os",js)(Effect,{auth:()=>Effect.succeed({type:"api",key:"cf-test-secret",metadata:{accountId:"account",gatewayId:"gateway"}}),env:()=>Effect.succeed({})},fn=>fn(),"review",os);const item=await Effect.runPromise(loader({id:"cloudflare-ai-gateway",options:{metadata:{chain:"review"}}}));for(const id of ["openai/gpt-5.4","anthropic/claude-sonnet-4-6","workers-ai/@cf/test","@cf/test"]){let capture;globalThis.fetch=async(input,init)=>{capture={url:String(input),headers:Object.fromEntries(new Headers(init.headers)),body:JSON.parse(init.body)};throw new Error("STOP_AFTER_CAPTURE")};const model=await item.getModel({},id,{});await model.doGenerate({prompt:[{role:"user",content:[{type:"text",text:"hi"}]}],maxOutputTokens:64}).catch(()=>undefined);assert.ok(capture);assert.equal(capture.headers["cf-aig-authorization"],"Bearer cf-test-secret");const step=capture.body[0];const workers=id.startsWith("workers-ai/")||id.startsWith("@cf/");assert.equal(JSON.stringify(step).includes("cf-test-secret"),workers||ref.startsWith("bf1"));assert.equal(step.query.model,ref.startsWith("bf1")||workers?id:id.slice(id.indexOf("/")+1));console.log(JSON.stringify({ref,id,provider:step.provider,endpoint:step.endpoint,secretInUpstream:JSON.stringify(step).includes("cf-test-secret"),outerAuthCorrect:true}));}}}finally{globalThis.fetch=real}'
```

Verbatim HEAD output; base/pristine behavior is summarized above:

```text
{"ref":"HEAD","id":"openai/gpt-5.4","provider":"openai","endpoint":"v1/responses","secretInUpstream":false,"outerAuthCorrect":true}
{"ref":"HEAD","id":"anthropic/claude-sonnet-4-6","provider":"anthropic","endpoint":"v1/messages","secretInUpstream":false,"outerAuthCorrect":true}
{"ref":"HEAD","id":"workers-ai/@cf/test","provider":"compat","endpoint":"chat/completions","secretInUpstream":true,"outerAuthCorrect":true}
{"ref":"HEAD","id":"@cf/test","provider":"compat","endpoint":"chat/completions","secretInUpstream":true,"outerAuthCorrect":true}
```

This executed the exact production custom-loader block with installed `ai-gateway-provider` 3.2.0 held fixed, synthetic auth/env and a fetch boundary that captured then deliberately threw `STOP_AFTER_CAPTURE`. Assertions verified model-ID stripping and token scoping; the output records the selected endpoints. It did not create diagnostic files or contact Cloudflare. Thus it proves request construction, not successful live response parsing or billing.

### Static-follow-up control commands

Inventory command rechecked the denominator using `git diff --name-only <actual-base> HEAD`, then counted literal marker-bearing lines in each `git show HEAD:<path>` result. Output:

```text
{"files":29,"productionFiles":17,"testFiles":12,"markerLines":737}
```

Suggestion dispatcher/history control (outputs are in the pre-existing finding):

```sh
bun -e 'import assert from "node:assert/strict"; for(const ref of ["HEAD","bf1cf502a3c511e9daf6a43244568ae4e83473a8","62998965e9fb0d9ed89011c62498b39801dbbb4f"]){const out=Bun.spawnSync(["git","show",`${ref}:packages/tui/src/routes/session/index.tsx`],{cwd:process.cwd()});assert.equal(out.exitCode,0);const src=out.stdout.toString();const start=src.indexOf("const toolDisplays = new Set(");const end=src.indexOf("function recordValue(",start);const js=new Bun.Transpiler({loader:"ts"}).transformSync(src.slice(start,end)).replace("export function toolDisplay","function toolDisplay");const display=new Function(`${js};return toolDisplay;`)();const refs=[...src.matchAll(/\bSuggest\b/g)].length;assert.equal(display("suggest"),"generic");assert.equal(refs,1);assert.equal(/<Suggest\b/.test(src),false);console.log(JSON.stringify({ref,suggestDisplay:display("suggest"),SuggestReferences:refs,renderedSuggest:false}));}'
```

Keyed lifecycle control using real Solid, exact historical cleanup source and a recorded SDK boundary (outputs are in the pre-existing finding):

```sh
bun -e 'import assert from "node:assert/strict"; const solid=await import(Bun.resolveSync("solid-js/dist/solid.js",`${process.cwd()}/packages/opencode`));for(const ref of ["HEAD","bf1cf502a3c511e9daf6a43244568ae4e83473a8","62998965e9fb0d9ed89011c62498b39801dbbb4f"]){const read=file=>{const out=Bun.spawnSync(["git","show",`${ref}:${file}`],{cwd:process.cwd()});assert.equal(out.exitCode,0);return out.stdout.toString()};const source=read("packages/tui/src/routes/session/index.tsx");const start=source.indexOf("  function processGroup(");const end=source.indexOf("  // kilocode_change end",start);const js=new Bun.Transpiler({loader:"ts"}).transformSync(source.slice(start,end));assert.match(read("packages/tui/src/app.tsx"),/route.data.sessionID : undefined} keyed/);for(const keyed of [false,true]){const calls=[];const entries=[{id:"parent"},{id:"child",parentID:"parent"}];let set,dispose;solid.createRoot(d=>{dispose=d;const [id,write]=solid.createSignal("parent");set=write;const deps={createEffect:solid.createEffect,onCleanup:solid.onCleanup,route:{get sessionID(){return id()}},sync:{session:{get:id=>entries.find(e=>e.id===id)},data:{session:entries}},project:{workspace:{current:()=>undefined}},sdk:{client:{backgroundProcess:{stopSession:async arg=>{calls.push(arg.sessionID)}}}}};const mount=new Function(...Object.keys(deps),js);const view=solid.createComponent(solid.Show,{get when(){return id()},keyed,children:(_)=>{mount(...Object.values(deps));return "mounted"}});solid.createRenderEffect(()=>view());});assert.deepEqual(calls,[]);set("child");await Promise.resolve();assert.deepEqual([...new Set(calls)].sort(),keyed?["child","parent"]:[]);console.log(JSON.stringify({ref,keyed,navigation:"parent -> child",stopRequests:calls.slice()}));dispose();}}'
```

No package suites were rerun during this static follow-up. These inline controls do not spawn real background processes, initialize project config or write diagnostic source files.

Harness attempts that did not count as passing tests:

- Initial `bun --cwd packages/opencode test ...` selected the package test script and printed `No test files found`; corrected to `bun test --cwd packages/opencode ...`, with non-zero tests/assertions shown above.
- Initial historical SDK `data:` module import failed with `NameTooLong`; replaced by in-memory `Function` evaluation of transpiled source.
- Initial workspace inline imports failed with `Cannot find package 'effect'` / `Cannot find module './packages/core/node_modules/effect'`; corrected using `Bun.resolveSync` from the package directory. No installation was attempted.
- The first Solid cleanup harness used a zero-argument `Show` child function, which Solid does not invoke as the render callback; it returned no stop requests and failed its assertion. The corrected control uses the actual app's one-argument callback shape, asserts the keyed boundary is present in each historical app source, and includes an unkeyed negative control. Only the corrected results support the finding.

### First-pass remote and checkout checks (parent owns final metadata)

```sh
gh pr view 13513 --repo Kilo-Org/kilocode --json headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus
```

```text
{"baseRefName":"johnnyeric/kilo-opencode-v1.18.18","baseRefOid":"bf1cf502a3c511e9daf6a43244568ae4e83473a8","headRefOid":"6a7d6bc002319ac2987bcde3d6c63efcafc07021","mergeStateStatus":"CLEAN","mergeable":"MERGEABLE"}
```

`gh pr checks 13513 --repo Kilo-Org/kilocode` reported all listed substantive checks passing, including HttpApi exerciser, platform unit jobs, JS/JetBrains typechecks, annotations and visual regressions; `[code]smith` was `skipping`. These checks do not cover the two counterexamples above.

Tracked working-tree and index diffs were empty before report creation and remained empty after it. Other reviewers' untracked reports appeared during the review and were left untouched. Only this report is authored by this reviewer. Final local HEAD remained `6a7d6bc002319ac2987bcde3d6c63efcafc07021`.

Report-format check:

```sh
bun run script/check-md-table-padding.ts BROKEN_PIPELINE_CHAINS.md
```

```text
check-md-table-padding: 1 file(s) checked, no padded tables found.
```

## Limitations / human verification

- Static source coverage is complete for the 737 marker-bearing lines/29 changed files within the bounded in-repo definition above. Runtime execution is not exhaustive. The specific unresolved external activation/serialization contract is HV-1 (`provider/transform.ts:1705–1709` → `kilocode/provider-options.ts:19–22`); it is not counted as a verified bug.
- Bun 1.3.14 was used instead of pinned 1.4.0. No runtime-specific claim is made for the Bun-1.4 stream-cancellation marker at `provider/provider.ts:67`.
- Disposable XDG/database setup does not establish config-read isolation. This lens did not trace every package-test config read; the parent's separately reported primary-checkout leakage must be reconciled by the config lens. Earlier package test results are scoped evidence, not a hermeticity guarantee.
- No full-process reproduction of the disabled-workspace duplicate via the HTTP endpoint; static production route composition plus real in-memory service-function/SQL execution establishes the write-side defect. Mixed client/server flag UX should be checked manually when fixing it.
- No real Cloudflare/Codex/Cerebras inference, live token-refresh settlement against provider accounts, enterprise residency enforcement, or real billing. Provider catalog discovery occurred in existing tests.
- No manual TUI/VS Code/JetBrains launch, visual reasoning test, Windows/Linux execution, full permission/sandbox penetration test, or real released-client round trip. Relevant synthetic compatibility and permission tests ran.
- No SDK/OpenAPI regeneration: source/generated writes were prohibited. Routes and generated artifacts were inspected and representative runtime SDK tests ran, but second-generation cleanliness is delegated to the parent/CI.
- Historical controls execute selected historical implementations with current dependencies and controlled boundaries, not fully installed historical checkouts. This holds helpers fixed to isolate the observed changes but is not a complete released-environment comparison.
- Two broader-suite timeouts passed alone; no base-suite timing control was run. Two explicitly skipped tests remain unverified.
- Exact rerere/mergiraf/manual conflict counts were not reconstructed by this lens. Local authoritative upstream refs were verified; no independent remote tag fetch was performed.
- No source edits, source diagnostic files, repository config changes, branch changes, commits, pushes or GitHub mutations. No real user database or login credential was intentionally accessed.
