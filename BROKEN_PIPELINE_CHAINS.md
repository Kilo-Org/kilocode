# Broken Pipeline Chains Review: PR #12088

## Scope and methodology

Reviewed `origin/main...HEAD` for PR #12088, including the full 1,206-file diff and surrounding Kilo code. I mechanically inventoried all `kilocode_change` occurrences in PR-changed files (276 files, 3,096 marker lines), then prioritized values and behavior crossing schemas, SDK/API boundaries, storage, state, events, IPC/SSE, flags, and final UI/runtime consumers. Compilation was not treated as evidence of a complete chain.

## Findings

### P1: Session-wide diffs are always empty for the existing no-`messageID` consumers

`SessionSummary.summarize` still computes the cumulative session diff, writes it to `Storage` under `session_diff/<sessionID>`, publishes `session.diff`, and updates the session summary (`packages/opencode/src/session/summary.ts:104-143`). However, the read side now immediately returns `[]` whenever `messageID` is omitted (`packages/opencode/src/session/summary.ts:146-152`). The HTTP query deliberately keeps `messageID` optional (`packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:39-42`), and the route passes that optional value through unchanged (`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:101-106`).

The two session-level consumers omit `messageID` by design:

- VS Code's session Changes source calls `client.session.diff({ sessionID, directory })` and feeds the result to `createSessionDiffSource` (`packages/kilo-vscode/src/diff/sources/catalog.ts:39-43`, `packages/kilo-vscode/src/diff/sources/session.ts:33-65`). It will now render an empty session diff even though the backend populated the cumulative diff and session summary.
- TUI full-session hydration calls `sdk.client.session.diff({ sessionID })` and replaces `draft.session_diff[sessionID]` with the result (`packages/opencode/src/cli/cmd/tui/context/sync.tsx:945-957`, `packages/opencode/src/cli/cmd/tui/context/sync.tsx:1005-1008`). The session sidebar file list reads that state (`packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/files.tsx:17`), so reopening/hydrating a session silently clears the visible changed-file list until a later live `session.diff` event happens to repopulate it.

This is a broken producer-to-storage-to-route-to-UI chain, not merely a changed endpoint interpretation. The pre-merge implementation read the stored cumulative `session_diff` when `messageID` was omitted, and the final regression-fix commit removed that branch. Existing tests only call `summary.diff` with a `messageID` (`packages/opencode/test/session/snapshot-tool-race.test.ts:279`), while VS Code's diff-source tests stub the fetch function and therefore cannot catch the backend disconnect.

### P2, human verification: explicit-location EventV2 publications may lose `project` on the legacy SSE envelope

`EventV2Bridge.publish` returns directly to the underlying EventV2 service when a caller supplies `options.location` (`packages/opencode/src/event-v2-bridge.ts:22-26`). `Location.Ref` carries only `directory` and optional `workspaceID` (`packages/core/src/location.ts:8-12`). The bridge listener then populates the legacy/global envelope's `project` only from the ambient `InstanceRef`, not from the event location (`packages/opencode/src/event-v2-bridge.ts:38-50`).

The new core session API is a concrete explicit-location publisher (`packages/core/src/session.ts:201-235`). If it runs without the legacy `InstanceRef`, its `session.created` event reaches `/global/event` with the right directory but `project: undefined`. Current Kilo consumers primarily route by directory/session and the VS Code provider also checks `properties.info.projectID`, so I did not prove a user-visible failure. Human verification is warranted for mixed legacy/v2 sessions and multi-project shared-server clients because the envelope schema and comments promise project routing, and TUI `useEvent` drops non-global events whose envelope project does not match (`packages/opencode/src/cli/cmd/tui/context/event.ts:63-75`). Verify an explicit-location v2 session event through `/global/event` while no `InstanceRef` is active and confirm all intended TUI/Console/extension consumers receive it.

## Notable non-findings

- Turn lifecycle remains connected: prompt loop calls `KiloSession.publishTurnOpen/Close`; those publish to the legacy Bus, which reaches memory lifecycle subscribers, the unified `GlobalBus`, Kilo session ingest, generated SSE event types, TUI notifications, and VS Code attention/status consumers (`packages/opencode/src/session/prompt.ts:1793-1813`, `packages/opencode/src/kilocode/session/index.ts:30-39`, `packages/opencode/src/kilocode/memory/turn.ts:53-93`, `packages/opencode/src/kilo-sessions/kilo-sessions.ts:249-294`).
- `snapshotInitialization: "wait"` is propagated from Agent Manager/VS Code request options through generated SDK schemas, prompt/command loop input, processor, Snapshot service, and the final slow-initialization policy branch (`packages/kilo-vscode/src/KiloProvider.ts:3216`, `packages/opencode/src/session/prompt.ts:1327`, `packages/opencode/src/session/processor.ts:144`, `packages/opencode/src/snapshot/index.ts:894`, `packages/opencode/src/kilocode/snapshot/track.ts:427`).
- `editorContext` is accepted by the request schema, persisted on the user message, preserved in generated follow-ups, and consumed by editor-context/system-environment prompt injection (`packages/opencode/src/session/prompt.ts:527`, `packages/opencode/src/session/prompt.ts:792`, `packages/opencode/src/session/prompt.ts:1637`, `packages/opencode/src/session/system.ts:83-103`).
- Edit/write `filediff` metadata is populated before permission prompts and final tool results, survives metadata slimming, and is consumed by VS Code permission and tool diff rendering (`packages/opencode/src/tool/edit.ts:114-215`, `packages/opencode/src/tool/write.ts:61-109`, `packages/kilo-vscode/webview-ui/src/components/chat/permission-diff-utils.ts:45`, `packages/ui/src/components/message-part.tsx:1979-2057`).
- Kilo config extensions were moved into `ConfigV1.Info`, which remains the parser, HTTP schema, and effective runtime config type; indexing, remote control, console UI fields, privacy filtering, and commit-message settings still have runtime readers. Runtime flags checked included `experimentalScout`, `experimentalReferences`, `disableChannelDb`, and `skipMigrations`; each has downstream consumers.
- Sync/event compatibility remains connected for the reviewed legacy clients: EventV2 data is encoded at the bridge, sync events are emitted as `syncEvent`, generated SDK types model that envelope, and TUI/VS Code normalize it before legacy consumers (`packages/opencode/src/event-v2-bridge.ts:42-70`, `packages/opencode/src/cli/cmd/tui/context/event.ts:4-61`, `packages/kilo-vscode/src/services/cli-backend/sdk-sse-adapter.ts:3-30`).
- Per-session platform attribution reaches `KiloSession.register`, child-task creation, telemetry platform resolution, and Kilo session metadata. Snapshot confinement, inherited permissions, background task cost deltas, indexing startup, and Scout flag-to-agent/tool registration also retained final consumers.

## Commands

- `git status --short --branch`
- `git diff --stat origin/main...HEAD`
- `git diff --name-status origin/main...HEAD`
- `git log --oneline --decorate origin/main..HEAD`
- `gh pr view 12088 --repo Kilo-Org/kilocode --json title,body,baseRefName,headRefName,commits,files`
- Git/grep inventories over every changed file containing `kilocode_change`, plus targeted `git diff`, `git show`, source reads, and symbol searches for each traced chain
- `git diff --check origin/main...HEAD` (passed)
- `bun run script/check-opencode-promise-facades.ts` (passed: no runtime drift)
- `bun run script/check-opencode-annotations.ts --base origin/main` (skipped itself because it detected an upstream merge)

## Limitations

- Focused Bun tests could not start because the installed workspace is incomplete: Bun reported missing preload `@opentui/solid/preload`.
- `packages/opencode` typecheck could not start because `tsgo` is not installed. Typechecking would not establish end-to-end consumption in any case.
- The PR is an upstream merge spanning 1,206 files, 276 marker-bearing changed files, and 3,096 marker lines. I traced all marker-bearing changed files by inventory and grouped repeated plumbing into behavior chains, but did not execute every product UI or remote/cloud integration. The explicit-location event item is therefore intentionally reported for human verification rather than asserted as a confirmed break.
