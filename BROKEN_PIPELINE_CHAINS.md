# Broken Pipeline Chains Review: OpenCode v1.17.5 Merge

## Scope And Method

Reviewed `origin/main...HEAD` on `marius-kilocode/review-opencode-v1.17.5` (PR #12404), with the Kilo-base reference at `.worktrees/opencode-merge/kilo-main` and pristine OpenCode `v1.17.5` at `.worktrees/opencode-merge/opencode`.

The range changes 194 files across 46 commits. I enumerated the 18 changed paths whose diff includes `kilocode_change`, then traced producer, handoff, and consumer links for the merge conflict domains and the Kilo-specific paths most exposed to silent wiring loss. This included source inspection, base/upstream comparisons, targeted tests, generated SDK inspection, and a temporary authenticated `kilo serve` probe. The probe database and server were removed afterward.

The marker-bearing changes fell into these grouped domains:

- Session-message compatibility migrations and projection ordering.
- Connector-to-Integration and credential model migration, including Kilo legacy JSON credential handling and OpenAI OAuth headers.
- Database and Ripgrep LayerNode composition.
- AppRuntime ProjectCopy composition, InstanceStore exit settlement, HTTP route composition, and prompt hooks.
- TUI Integration data refresh and Kilo-specific TUI rendering.

The reviewed conflict resolutions also included the requested nullable `seq` migration, credential Kilo blocks, ProjectCopy dependencies, lazy `Database.node`, InstanceStore `onExit`, Integration settlement guards, and `server.ts` Kilo route assembly.

## Findings

### High: Fresh databases bypass the nullable `session_message.seq` compatibility migration

**Chain:** Kilo compatibility requirement for released writers -> `SessionMessageTable.seq` nullable -> `20260714141136_session-message-legacy-writer-compat` rebuilds the table with nullable `seq` -> fresh database initialization -> released client writes a legacy message without `seq`.

The producer and existing-database migration are correct, but the new upstream fresh-database bootstrap introduced a different intermediate path that was not reconciled with Kilo's compatibility change:

- `packages/core/src/session/sql.ts:127` declares `seq: integer()` with the Kilo compatibility comment.
- `packages/core/src/database/migration/20260714141136_session-message-legacy-writer-compat.ts:14` creates `seq integer`, also nullable.
- `packages/core/src/database/schema.gen.ts:177` instead creates `seq integer NOT NULL`.
- `packages/core/src/database/migration.ts:28-36` uses `schema.up(tx)` for an empty database and then records every migration as completed. Therefore the nullable compatibility migration is deliberately not replayed for fresh databases.

This is a real behavior split, not just a declarative mismatch. An existing database upgraded through the migration accepts the older writer's row without `seq`; a database first created by the merged build does not. The intended cross-version sharing guarantee fails whenever a current Kilo creates the database before a released client accesses it.

The base worktree's `DatabaseMigration.apply` replayed the migration sequence for fresh databases. Upstream v1.17.5 changed it to bootstrap `schema.gen.ts` and mark the migration list complete. The merge introduced `schema.gen.ts` with upstream's `NOT NULL` table definition while retaining Kilo's nullable runtime schema and migration.

Current tests cover upgrade/repair paths but not this path. `packages/core/test/kilocode/database-migration-compat.test.ts` starts from an older schema and applies the compatibility migration. `packages/core/test/database-migration.test.ts` checks that a fresh database has the expected tables and indexes, but does not inspect `session_message.seq` nullability or write a legacy no-`seq` row after fresh initialization.

### High: Production `kilo serve` drops all `@opencode-ai/server` V2 server routes

**Chain:** `Api` registers Integration, Credential, and ProjectCopy groups -> `handlers` supplies their handlers -> `serverRoutes` mounts `HttpApiBuilder.layer(Api)` -> `createRoutes` includes `serverRoutes` -> `kilo serve` should expose the generated SDK endpoints.

The upstream listener refactor split the full route graph from a new listener graph, and the Kilo resolution leaves `serverRoutes` out of the production listener:

- `packages/opencode/src/server/routes/instance/httpapi/server.ts:187-192` builds `serverRoutes` from `@opencode-ai/server` `Api` and provides Kilo's reference-aware handler graph.
- `packages/server/src/handlers.ts:26-51` merges `IntegrationHandler`, `CredentialHandler`, and `ProjectCopyHandler` into that graph.
- `packages/opencode/src/server/routes/instance/httpapi/server.ts:285-291` includes `serverRoutes` in `createRoutes`.
- `packages/opencode/src/server/routes/instance/httpapi/server.ts:318-320` builds `createListenerRoutes` from only root, event, PTY, instance, documentation, and UI routes. It omits `serverRoutes`.
- `packages/opencode/src/server/server.ts:111-113` starts `createListenerRoutes`, and `packages/opencode/src/cli/cmd/serve.ts:15-21` calls `Server.listen` for the shipped `kilo serve` command.

The SDK and OpenAPI promise the absent endpoints. `packages/sdk/openapi.json` and the generated client include `/api/integration/*`, `/api/credential/{credentialID}`, and `/experimental/project/{projectID}/copy*`; `packages/tui/src/context/data.tsx:543-554` calls `sdk.client.v2.integration.list`, while `packages/tui/src/component/prompt/move.tsx:40-49` and `packages/tui/src/component/dialog-move-session.tsx:70-73` call V2 ProjectCopy endpoints.

The temporary real-listener probe confirmed the wiring result after authenticating as `kilo`:

```text
GET /api/integration       -> 404 {"error":"Not Found"}
GET /indexing/status       -> 200
```

`/indexing/status` is an `InstanceHttpApi` Kilo route and remains in the listener. This controls for listener startup/authentication and isolates the omission to the `serverRoutes` branch. The normal server therefore advertises SDK operations that return 404, including the only HTTP path that reaches the new Integration attempt completion/cancellation handlers. In-process `Server.Default()` and tests built from `HttpApiApp.routes` do include the routes, which explains why compilation and existing HTTP API tests remain green.

### Needs Human Verification, Low: InstanceStore interruption fix has no focused retry regression test

**Chain:** `load` or `reload` inserts an `Entry` -> a boot fiber runs `completeLoad` -> scope interruption/failure occurs -> `onExit` removes the failed cache entry and completes its deferred -> a later caller can load the directory.

The source chain appears correct. `packages/opencode/src/project/instance-store.ts:80-88` wraps boot in `Effect.onExit`, removes failed entries, and settles the deferred. Both `load` and `reload` fork that effect into the store scope and await the deferred at lines 122-165. This fixes the previously possible permanently pending cache entry.

No focused test was found that blocks `InstanceBootstrap.run`, interrupts the boot fiber or enclosing scope, and then proves a second `load` resolves. The existing `packages/opencode/test/kilocode/project/instance-store.test.ts` covers concurrent and interrupted disposal rather than boot interruption. This is not evidence of a current break, but this race is important enough to exercise manually or with a targeted regression test.

## Notable Non-Findings

- **Integration settlement implementation is internally intact.** Plugins receive the location-scoped `Integration.Service` through `PluginBoot` (`packages/core/src/plugin/boot.ts:60-96`) and register methods, including OpenAI's OAuth methods. `Integration.connect.oauth` records the pending attempt, `settle` persists through `Credential.create`, and the completion/cancellation handlers call `service.attempt.complete` and `service.attempt.cancel` directly (`packages/server/src/handlers/integration.ts:51-101`). The restored `settling` guards prevent cancellation or expiry from overtaking credential persistence. `packages/core/test/integration.test.ts` covers code completion, cancellation, automatic completion, expiry, and persistence. The production HTTP exposure for this otherwise intact path is broken by the listener finding above.

- **Kilo credential removal follows the new Integration identity.** Legacy imports and `KILO_AUTH_CONTENT` normalize keys with `replace(/\/+$/, "")` before constructing `IntegrationSchema.ID` in `packages/core/src/credential.ts:142`, `163`, and `230`. `KiloAuth.remove` applies the same normalization, calls `credentials.list(integration)`, removes each returned record, then removes legacy auth (`packages/opencode/src/kilocode/auth/remove.ts:6-15`). The new `Credential.remove` implementation handles both persistent and injected process-local values (`packages/core/src/credential.ts:394-405`). `packages/opencode/test/kilocode/auth-remove.test.ts` passes.

- **ProjectCopy dependencies are present in both service constructions.** The AppRuntime conflict resolution provides Database, FSUtil, core Git, EventV2, and ProjectDirectories to `ProjectCopy.layer` (`packages/opencode/src/effect/app-runtime.ts:126-132`). The LayerNode route graph uses `ProjectCopy.node`, whose declared dependencies match that service (`packages/core/src/project/copy.ts:146-299`). The full route graph's handler consumes `ProjectCopy.Service`. No direct `ProjectCopy.Service` consumer through `AppRuntime.runPromise` was found; this is an observation, not a missing dependency.

- **Lazy `Database.node` remains connected.** `Database.node` now defers `path()` until layer construction (`packages/core/src/database/database.ts:70-71`). The LayerNode route graph includes that single node (`packages/opencode/src/server/routes/instance/httpapi/server.ts:223-280`), and LayerNode caches nodes while recursively providing dependencies. AppRuntime uses its independent `Database.defaultLayer`, as intended for process-wide services. No dangling `Database.node` consumer or missing LayerNode dependency was found.

- **Prompt requirement and review telemetry hooks survive the merge.** Command execution still resolves the command-selected agent, invokes `agents.guardRequirements(agent)`, marks template text parts with `KiloSessionProcessor.markReviewTelemetry`, and passes the resulting parts to `prompt` (`packages/opencode/src/session/prompt.ts:2074-2127`). The metadata extractor and completion telemetry consumer remain in `packages/opencode/src/kilocode/session/processor.ts` and `packages/opencode/src/session/processor.ts`.

- **SDK regeneration restored the requested Kilo surface.** `packages/sdk/js/src/v2/gen/sdk.gen.ts` includes client classes for `BackgroundProcess`, `Indexing`, `InteractiveTerminal`, `Notebook`, `AgentManager`, and `Memory`. Its event union includes `session.network.asked`, `interactive_terminal.*`, `memory.*`, `indexing.*`, Agent Manager, and Notebook events in `packages/sdk/js/src/v2/gen/types.gen.ts:7-123`. Representative VS Code consumers still import generated `NotebookRequest`, `AgentManagerRequest`, `MemoryStatusResponse`, and `IndexingStatus` types. The listener probe also confirmed a Kilo instance route (`/indexing/status`) remains live.

## Short Command Excerpts

```text
$ bun test ./test/database-migration.test.ts ./test/kilocode/database-migration-compat.test.ts ./test/integration.test.ts ./test/credential.test.ts
30 pass
0 fail

$ bun test ./test/kilocode/auth-remove.test.ts ./test/server/project-copy.test.ts
2 pass
0 fail
```

```text
$ git diff --name-only origin/main...HEAD | wc -l
194

$ git diff --name-only origin/main...HEAD ... kilocode_change marker files | wc -l
18
```

```text
$ authenticated real `kilo serve` probe
GET /api/integration  -> 404
GET /indexing/status  -> 200
```

`git diff --check origin/main...HEAD` produced no whitespace errors.

## Limitations

- This was a source-and-runtime-chain audit, not a full clean build or full integration suite. CI was already reported green; focused core and CLI tests above were run instead.
- The real listener probe intentionally used a temporary database and did not perform external OAuth or gateway authentication.
- The source tree was not edited. This report is the only file created by this review; pre-existing untracked report files were left untouched.
