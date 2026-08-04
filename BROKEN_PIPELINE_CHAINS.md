# Broken Pipeline Chains

## Scope And Methodology

- Reviewed PR #12695 at exact head `054ee594915b93546d0613a45e0671edd43905ee` against base and merge-base `0b8f749ae13388cf7a38ea7fb9183acaac99eef8`. The range contains 1,237 changed files, 101,898 insertions, and 41,085 deletions.
- Read root `AGENTS.md`, `REVIEW.md`, `packages/opencode/AGENTS.md`, `packages/core/src/tool/AGENTS.md`, `packages/schema/AGENTS.md`, `packages/opencode/src/session/llm/AGENTS.md`, server/test package instructions, `packages/kilo-vscode/AGENTS.md`, `kilo-steer`, and merge-review/merge-minimizer guidance.
- Enumerated marker changes with the full base-to-head diff, not only head grep results. `git diff -G'kilocode_change'` identified 175 touched files and 659 changed marker lines: 381 additions and 278 deletions. Across all 1,237 changed paths, base contained 3,311 marker occurrences in 265 files and head contains 3,416 in 301 files. Repository-wide non-Markdown totals are 5,750 at base and 5,853 at head. Deleted/moved marker regions were included through `git diff` and base-side `git grep`.
- Grouped the changed marker regions into behavior chains, then followed Kilo introduction points through schema/type/config/state, event storage and projection, route assembly, IPC/SSE, OpenAPI/SDK, and final CLI/TUI/VS Code consumers. The principal groups were: durable/session events and legacy projection; production listener/API/SDK composition; config hot reload; question localization/blocking and permission interactivity; editor context; worktree/session metadata; interactive terminal and PTY association; plugin/provider/auth bootstrap; tool registry/sandbox/network policy; snapshot/revert/compaction compatibility; CLI/TUI lifecycle and auto-approval; and UI branding/rendering.
- Compared base and head definitions, registrations, senders/receivers, and generated boundaries. Passing compilation or generated SDK presence was not treated as behavioral proof. Targeted tests and direct schema/manifest probes were run where practical.

## Findings

### P1 High: the native `/api/event` stream terminates on normal Kilo/legacy events

**Broken links:** `packages/server/src/handlers/event.ts:2,11-17,30-36`; contract mismatch introduced at `packages/opencode/src/server/routes/instance/httpapi/api.ts:70-74`; omitted definitions are selected at `packages/protocol/src/groups/event.ts:52-55` and `packages/schema/src/event-manifest.ts:57-61,63-82`.

**Expected chain:** a producer such as `packages/opencode/src/session/status.ts:39-44` publishes `SessionStatusEvent.Status` through the shared `EventV2Bridge` -> `EventManifest.Latest` contains `session.status` -> Kilo constructs `ServerApi` with all `EventManifest.Latest` definitions -> `EventHandler` subscribes to the shared `EventV2` bus -> the handler encodes against the same API-specific event union -> SSE -> generated SDK Next/client consumers receive the event.

**Actual head chain and silent failure:** Kilo correctly builds `ServerApi` with 89 latest definitions, but the moved shared handler hard-codes `OpenCodeEvent`, whose schema is built from only 58 `ServerDefinitions`. Thirty-one events emitted by this Kilo listener are excluded, including `session.status`, `session.error`, `permission.asked`, `question.asked`, `global.config.updated`, and `global.disposed`. `Schema.encodeUnknownSync(OpenCodeEvent)` throws inside `Stream.map` when the first omitted event arrives, terminating the SSE response after it opened successfully. This is a common server event: `SessionStatus.set` emits `session.status` on busy/idle transitions. A generated current-API client can therefore connect successfully and then lose the stream during an ordinary session turn. Kilo's shipped legacy global SSE path is separate and was not shown to fail from this mismatch.

**Base/head evidence:** base `packages/server/src/handlers/event.ts` serialized `JSON.stringify(data)` without narrowing the event union and filtered/resolved location before forwarding. Head changed this to `Schema.encodeUnknownSync(OpenCodeEvent)` while Kilo's API assembly changed independently to `makeApi({ definitions: EventManifest.Latest.values().toArray() })`. The direct probe returned:

```text
session.status REJECTED SchemaError(Expected V2Event, got {"id":"evt_status","type":"session.status","data":{"sessionID":"ses_test","status":{"type":"idle"}}})
global.config.updated REJECTED SchemaError(Expected V2Event, got {"id":"evt_cfg","type":"global.config.updated","data":{}})
```

The manifest probe returned `latest: 89`, `server: 58`, `omitted: 31`; a second control confirmed `session.status` is present in `Latest`, absent from `ServerDefinitions`, and rejected by the encoder. Existing `httpapi-v2-location.test.ts` now positively expects cross-location native events, and its targeted suite passes, but it only emits `session.created`, which belongs to both unions, so it does not exercise the broken branch.

**Repair/verification direction:** make the handler encoder derive from the same definitions used to construct its `Api` (for example, an API-specific handler factory or injected event schema), or retain a schema that covers `EventManifest.Latest` for the Kilo assembly. Add a production-listener test that opens `/api/event`, causes actual `session.status`, `permission.asked`, and `global.config.updated` emissions, asserts the stream remains open, and verifies generated SDK decoding. Also decide and test the intended cross-location policy separately; the merge deliberately removed base's subscriber-location filtering.

### P2 Medium: released `session.next.prompt.promoted.1` rows are no longer readable or replayable

**Broken links:** removed durable definition between base `packages/core/src/session/event.ts` and head `packages/schema/src/session-event.ts:445-478`; absent from `packages/schema/src/durable-event-manifest.ts:7-15`; hard failure at `packages/core/src/event.ts:51-60,544-565`; silent omission at `packages/core/src/event.ts:64-109`; downstream compatibility comment without decoder at `packages/opencode/src/kilocode/plugins/sync-v2.tsx:162-165`.

**Expected chain:** released base writes `session.next.prompt.promoted.1` into `event` -> durable manifest retains a decoder for the released key -> SQL durable stream/history or workspace `/sync/history` reads it -> decoder maps it to a current prompt-visible event or a retained compatibility event -> projector marks the admitted input promoted and materializes the user message -> sync/TUI consumers display it -> replay into another workspace remains contiguous and succeeds.

**Actual head chain and silent failure:** base explicitly defined `PromptLifecycle.Promoted`, included it in durable definitions, generated it into OpenAPI/SDK, projected it into a user message, and persisted it as version 1. Head removes the definition and every generated type, with only a comment saying new promotion now emits `session.next.prompted`. No migration or storage decoder maps already-persisted `session.next.prompt.promoted.1` rows. Consequently:

- `EventV2.durable()` reads raw rows and `decodeSerializedEvent` throws `Unknown durable event type session.next.prompt.promoted.1`, terminating `/api/session/{id}/event` and any in-process durable subscriber when that historical row is reached.
- `EventV2.readAggregate()` uses `inArray(EventTable.type, SessionDurable.definitions.keys())`; the removed row is silently filtered out of `/api/session/{id}/history`. Pagination can therefore omit the promotion while advancing around later rows.
- `/sync/history` still sends raw rows, and `/sync/replay` calls `replayAll`; replay defects on the unknown type, so moving/warping a released session across Kilo workspaces can fail despite current event tests being green.

**Base/head evidence:** base grep found the definition, projector/message-updater cases, SDK/OpenAPI variants, and TUI consumers. Head grep finds only the explanatory comment. A manifest probe at head returned:

```json
{"global":false,"session":false}
```

for `Durable.has("session.next.prompt.promoted.1")` and `SessionDurable.definitions.has(...)`. Head's event tests explicitly assert unknown replay types defect, confirming the failure mode rather than providing fallback behavior. The existing `event-storage-compat` tests cover released tool-content shapes but not removed durable event keys.

**Repair/verification direction:** retain a storage/replay-only compatibility definition for `session.next.prompt.promoted.1` and translate its payload (`timeCreated`) to the current `Prompted` semantics (`timestamp`, `delivery`) before projection, without re-exposing an obsolete current producer unless required. Alternatively migrate every persisted row atomically and idempotently before any reader starts. Add old-database controls for `durable()`, finite `history()`, `/sync/history -> /sync/replay`, and old -> head -> old behavior.

## Notable Non-Findings

- **Question and permission chain preserved:** `labelKey`, `descriptionKey`, `mode`, `questionKey`, `headerKey`, and `blocking` moved to `packages/schema/src/v1/question.ts`, survive OpenAPI and generated SDK, pass through `Question.ask`, and are consumed by TUI and VS Code. The `interactive` permission flag is present in schema, route payload, handler, ACP/TUI/direct-mode/VS Code senders, and the skill-shell human-only guard.
- **Editor context chain preserved:** VS Code gathers and sends `editorContext`; generated request types include it; prompt input persists it on user messages; compaction retains it; system/environment prompt consumers read it.
- **Config hot-reload chain preserved on the legacy global stream:** config/TUI writers emit `global.config.updated` through `GlobalBus`; TUI and VS Code receive and refetch config. The event is also in the generated manifest. This does not mitigate finding 1 for the new `/api/event` route.
- **Interactive terminal and PTY chain preserved:** tool registration and primary-agent gating, session association, events, typed routes, handlers, OpenAPI/SDK, TUI/direct-mode state reducers, and write/resize/close consumers are all present at head.
- **Worktree labels and session search preserved:** experimental session listing sets `worktreeName`; schema/OpenAPI/SDK retain it; TUI and VS Code search/display consumers read it.
- **Compaction/tool storage compatibility preserved:** current writers retain released `include` and stored tool-content shapes, with SQL-boundary codecs and targeted compatibility tests.
- **Production listener service graph repaired:** Kilo listener composition now provides the moved location/session middleware, `SessionV2`, local execution, `MoveSession`, and shared app services. The route graph itself is present; finding 1 is a handler-schema mismatch after route construction.
- **Plugin/bootstrap registration preserved:** the removed `PluginBoot` marker migrated to `PluginInternal`, which remains included via location services. The Kilo rule suppressing redundant `customize-opencode` registration remains in the internal boot sequence, while Kilo provider hooks and Kilo bootstrap/tool registries remain reachable.

## Command Results

```text
$ git rev-parse HEAD
054ee594915b93546d0613a45e0671edd43905ee
$ git merge-base 0b8f749ae13388cf7a38ea7fb9183acaac99eef8 054ee594915b93546d0613a45e0671edd43905ee
0b8f749ae13388cf7a38ea7fb9183acaac99eef8
$ git diff --shortstat BASE..HEAD
1237 files changed, 101898 insertions(+), 41085 deletions(-)
$ marker diff counts
659 changed marker lines; 381 added; 278 removed; 175 files matched -G
$ changed-path marker inventory
base: 3311 occurrences / 265 files; head: 3416 occurrences / 301 files
```

```text
$ bun test test/event-manifest.test.ts test/kilocode/sync-event-encoding.test.ts test/server/httpapi-v2-location.test.ts  # packages/opencode
10 pass; 0 fail; 35 expect() calls; 3 files; 3.55s
$ bun test test/kilocode/event-storage-compat.test.ts test/session-history.test.ts  # packages/core
9 pass; 0 fail; 23 expect() calls; 2 files; 657ms
```

The passing tests are controls and demonstrate why compilation/CI remains green; none injects an omitted Kilo event through `packages/server/src/handlers/event.ts`, and none seeds a released `session.next.prompt.promoted.1` row.

## Limitations

- This was a focused broken-chain audit, not a full verdict on all 1,237 files. Marker occurrences were exhaustively enumerated and grouped, but the report intentionally omits a per-file/per-marker checklist.
- No real user database, credentials, remote workspace, browser, VS Code host, or production server was used. The durable-row finding is static proof plus manifest/runtime probes; a disposable old-version database smoke test remains advisable.
- The worktree initially contained unrelated untracked `vscode-self-test.config.json`; parallel reviewer reports appeared while this audit was running. None was read, changed, or removed. This audit wrote only this report. No commit, push, or GitHub mutation was performed.
