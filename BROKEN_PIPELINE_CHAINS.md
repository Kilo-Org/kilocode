# Broken Pipeline Chains Review

## Scope and methodology

Reviewed PR #11090 at `6a1377abaa88902b741f3ffff276aa6b743f3a3c` against the reviewed base and merge base `b90ab85c3b4ad5097fe11e431d0319f31f935d6e` (`origin/main...HEAD`). The range contains 270 changed files, with 7,733 insertions and 3,901 deletions.

I inspected every added, removed, or relocated `kilocode_change` marker in production code, then followed the associated values and behavior through service layers, instance context, events, HTTP/SSE schemas, generated SDK types, and Kilo clients. I used repository-wide producer/consumer searches, focused tests, and small runtime probes where static tracing could not prove the wire behavior.

## Findings

### Medium: EventV2 sends transformed domain values without wire encoding

**Complete chain:** Event schemas use transformed Effect values, such as `DateTime.Utc`, while their encoded HTTP/SDK representation is numeric epoch milliseconds. For example, `ModelV2.Info.time.released` uses `DateTimeUtcFromMillis` at `packages/core/src/model.ts:60`. A catalog update publishes that domain object at `packages/core/src/catalog.ts:176`. `EventV2Bridge` forwards `event.data` directly to the legacy bus at `packages/opencode/src/event-v2-bridge.ts:74`, and versioned session events similarly reach `bus.publish` through the unencoded `event.data` path at `packages/opencode/src/sync/index.ts:359`. The global SSE handler then applies plain `JSON.stringify` at `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts:24`.

**Break point:** Neither bridge path calls the event definition's schema encoder before putting data on the legacy bus or global SSE stream. `DateTime.Utc` therefore serializes with its `toJSON()` method as an ISO timestamp string. The generated contract instead declares `EventCatalogModelUpdated.properties.model.time.released` as a number or one of the special numeric strings at `packages/sdk/js/src/v2/gen/types.gen.ts:3790`, and exposes the event at `packages/sdk/js/src/v2/gen/types.gen.ts:3813`. The same mismatch affects the newly exposed direct `session.next.*` event types: their source timestamp is a `DateTime.Utc` at `packages/core/src/session-event.ts:22`, while the SDK declares `timestamp: number`, for example at `packages/sdk/js/src/v2/gen/types.gen.ts:3487`.

**Observed result:** A real `GET /global/event` stream followed by `GET /api/model` returned HTTP 200 and emitted a directory-scoped `catalog.model.updated`, but `model.time.released` was `"2025-09-09T00:00:00.000Z"` with JavaScript type `string`. A direct session-event bridge probe likewise emitted `"1970-01-01T00:00:01.234Z"` instead of `1234`.

**Impact:** Generated SDK consumers silently receive a different type than the documented contract. Numeric comparisons, sorting, date construction, validation, and event persistence/replay code can behave incorrectly even though TypeScript compilation succeeds. The durable fix should encode `definition.data` before crossing into legacy bus/SSE payloads and ensure replay decodes persisted data back to the schema's domain type.

### Medium: `roll-call` no longer honors `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX`

**Complete chain:** The environment value is parsed into `RuntimeFlags.outputTokenMax` at `packages/opencode/src/effect/runtime-flags.ts:51`. The PR changed `ProviderTransform.maxOutputTokens` from reading the process-level flag implicitly to accepting an optional argument and otherwise using the fixed 32,000 default at `packages/opencode/src/provider/transform.ts:20` and `packages/opencode/src/provider/transform.ts:1332`. Normal session requests forward the runtime value at `packages/opencode/src/session/llm.ts:218`.

**Break point:** The Kilo `roll-call` command still calls `ProviderTransform.maxOutputTokens(model)` without the runtime value at `packages/opencode/src/kilocode/cli/cmd/roll-call.ts:288`. `roll-call` is registered as a legacy `cmd` and its `call()` helper has no `RuntimeFlags` input, so the parsed flag is never consumed on this path.

**Observed result:** With `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX=1234`, a runtime probe produced `{ "runtimeFlag": 1234, "rollCallHelperDefault": 32000, "forwarded": 1234 }`.

**Impact:** Provider probes can request up to 32,000 output tokens, or the model limit, despite an operator explicitly setting a lower cap. That defeats cost and latency controls specifically for a command that can contact many models in one invocation.

### Low: chunk-compaction heuristics drop low output-token caps

**Complete chain:** `SessionCompaction` reads the same runtime flag and forwards it to its primary overflow and retained-tail calculations at `packages/opencode/src/session/compaction.ts:244` and `packages/opencode/src/session/compaction.ts:266`.

**Break point:** The Kilo fallback chunking path does not accept or forward `outputTokenMax`. `KiloCompactionChunks.needed()` calls `usable()` without it at `packages/opencode/src/kilocode/session/compaction-chunks.ts:64`, and `budget()` repeats the omission at `packages/opencode/src/kilocode/session/compaction-chunks.ts:103`. This path internally limits summary models to 2,048 output tokens at `packages/opencode/src/kilocode/session/compaction-chunks.ts:107`, so the mismatch is visible when the configured cap is below 2,048.

**Impact:** The actual summary request is capped by the normal LLM path, but chunk eligibility and split budgets still reserve 2,048 tokens. Low-cap configurations therefore trigger chunking earlier and preserve less source context than their real request budget requires.

## Notable non-findings

- The Effect/ALS migration retained instance context through `effectCmd`, `EffectBridge`, bus callbacks, file-watcher callbacks, disposers, and directory-keyed `InstanceState`; the focused instance and event suites passed 39 tests.
- Indexing status and warning producers now pass an explicit instance context into `Bus.publish`, and their SSE/HTTP consumers still receive directory-scoped events. The isolated indexing startup suite passed all 16 tests.
- Permission reply directories remain carried by the global SSE envelope and recorded by the VS Code connection service; permission, question, session-fork remapping, and adjacent indexing-worktree suites passed 25 focused tests.
- Agent Manager terminal-font propagation remains complete from VS Code configuration through routing and the webview terminal consumer. The duplicate identical `TerminalFont` declaration in `packages/kilo-vscode/webview-ui/src/types/messages/agent-manager.ts:1` merges harmlessly; the targeted test and both extension/webview typechecks passed. No Agent Manager diff or transcript implementation changed in this range.
- CLI help/command registration, npm wrapper/resource copying, normal output-cap session processing, shell permission metadata, snapshot initialization, and generated route presence were covered by focused passing tests or complete producer-to-consumer tracing. No additional silent break was found in those paths.

## Commands and outputs

- `git rev-parse HEAD`, `git rev-parse origin/main`, and `git merge-base origin/main HEAD` confirmed the requested head and base exactly; the worktree was initially clean.
- `git diff --stat` and `git diff --name-status b90ab85...6a1377a` reported 270 changed files and were used as the complete review inventory.
- Repository-wide searches for `kilocode_change`, `Bus.publish`, `EventV2Bridge`, `session.next.*`, indexing events, permission directories, `outputTokenMax`, and all `maxOutputTokens`/`usable` call sites identified the producer and consumer sets described above.
- Output-cap probe: `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX=1234 bun -e ...` printed `{ "runtimeFlag": 1234, "rollCallHelperDefault": 32000, "forwarded": 1234 }`.
- Event bridge probe with `KILO_DB=:memory:` printed a bridged session timestamp as an ISO string. The end-to-end HTTP probe returned `modelStatus 200` and `{ "directory": "/tmp/catalog-http-chain-review", "released": "2025-09-09T00:00:00.000Z", "releasedType": "string" }`.
- CLI tests: 130/130 runtime-flag, overflow, processor, and compaction tests passed; 39/39 event and instance-context tests passed; 32/32 install/help/run tests passed; 25/25 indexing-worktree, permission, question, and fork tests passed.
- Core event/catalog tests passed 15/15. Agent Manager terminal-font tests passed 4/4.
- `bun run typecheck` passed in both `packages/opencode` and `packages/kilo-vscode`.
- `bun run script/check-opencode-annotations.ts --base b90ab85...` did not perform a check; it reported `Skipping shared upstream annotation check - upstream merge detected.`

## Limitations

- No live provider calls were made, so `roll-call` was verified by runtime-value probing and call-chain inspection rather than spending tokens across real models.
- No Windows, Linux glibc/musl, interactive TUI, or full VS Code UI session was launched. Platform packaging and Agent Manager UI behavior were assessed from focused tests and chain tracing.
- A combined parallel test invocation caused one indexing startup test to time out and observe another test's network failure text. Running `indexing-startup.test.ts` alone passed 16/16, indicating test-process interference rather than a reproducible product failure.
- The complete monorepo suite and SDK regeneration were not run. Regeneration was intentionally avoided because this review was required to modify only this report; committed OpenAPI and generated SDK artifacts were inspected directly.
- Final `git status` also showed untracked `KILOCODE_CHANGE_MARKERS.md`, `TESTS.md`, and `UNNECESSARY_MARKERS.md`. They were absent from the initial clean status and were not created, read, or modified during this review, indicating concurrent worktree activity. This review wrote only `BROKEN_PIPELINE_CHAINS.md`.
