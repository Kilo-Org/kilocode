# Broken Pipeline Chains Review

Reviewed PR: `https://github.com/Kilo-Org/kilocode/pull/10822`

Reviewed snapshot: `94fc42255c35827b197d97368d75d079242e9f4d`

Reviewed PR base snapshot: `2f7f23deac683078a350014ec8a1a946aae46ce4`

Pristine upstream target reference: `/Users/marius/Documents/git/kilocode/.worktrees/opencode-merges/v1.14.46/merge/.worktrees/opencode-merge/opencode`

## Scope And Methodology

- Reviewed the 181-path PR diff and the 9 changed paths selected by `git diff --name-only -Gkilocode_change`.
- Traced changed Kilo compatibility behavior from introduction through runtime propagation, OpenAPI generation, generated SDK call shape, and known consumers. This was intentionally chain-oriented rather than an exhaustive file checklist.
- Compared the merged `packages/opencode/src/server/routes/instance/httpapi/public.ts` against pristine upstream to isolate the HttpApi query-contract architectural change: upstream removed global OpenAPI injection of `directory` and `workspace` and now requires every `WorkspaceRoutingMiddleware` endpoint to declare matching runtime query fields.
- Audited all Kilo-owned HttpApi groups that apply `WorkspaceRoutingMiddleware`, including unchanged adjacent groups that became dependent on the new upstream contract.
- Inspected focused regression tests and ran read-only guards where dependencies were available. No code, Git index, refs, or existing reports were mutated.

## Findings

### 1. High: 18 Kilo-only HttpApi endpoints lost workspace-routing query contracts

The merge changes the contract for workspace routing. `packages/opencode/src/server/routes/instance/httpapi/public.ts:119` no longer injects `directory` and `workspace` into every instance route after OpenAPI generation. Instead, `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:17` defines `WorkspaceRoutingQueryFields`, with the explicit requirement that endpoint query schemas spread those fields because Effect middleware cannot declare query params.

Many Kilo-owned groups were ported correctly, including background processes, indexing, Kilo gateway, remote control, session import, suggestions, and the Kilo-specific session viewed endpoint. The following endpoints still apply `WorkspaceRoutingMiddleware` but do not declare the routing fields in their endpoint query schema:

| Product behavior | Endpoints | Suspect link |
|---|---|---|
| Agent builder | `POST /agent-builder/preview`, `PUT /agent-builder/:id` | `packages/opencode/src/kilocode/server/httpapi/groups/agent-builder.ts:46`, `packages/opencode/src/kilocode/server/httpapi/groups/agent-builder.ts:58` omit `WorkspaceRoutingQuery`. Generated SDK types expose `query?: never` at `packages/sdk/js/src/v2/gen/types.gen.ts:7656` and `packages/sdk/js/src/v2/gen/types.gen.ts:7701`. |
| Commit message generation | `POST /commit-message` | `packages/opencode/src/kilocode/server/httpapi/groups/commit-message.ts:28` omits `WorkspaceRoutingQuery`. Generated SDK type exposes `query?: never` at `packages/sdk/js/src/v2/gen/types.gen.ts:7900`. |
| Prompt enhancement | `POST /enhance-prompt` | `packages/opencode/src/kilocode/server/httpapi/groups/enhance-prompt.ts:22` omits `WorkspaceRoutingQuery`. Generated SDK type exposes `query?: never` at `packages/sdk/js/src/v2/gen/types.gen.ts:8172`. |
| Network wait recovery | `GET /network`, `POST /network/:requestID/reply`, `POST /network/:requestID/reject` | `packages/opencode/src/kilocode/server/httpapi/groups/network.ts:22`, `packages/opencode/src/kilocode/server/httpapi/groups/network.ts:31`, and `packages/opencode/src/kilocode/server/httpapi/groups/network.ts:42` omit `WorkspaceRoutingQuery`. Generated SDK types expose `query?: never` at `packages/sdk/js/src/v2/gen/types.gen.ts:8809`, `packages/sdk/js/src/v2/gen/types.gen.ts:8827`, and `packages/sdk/js/src/v2/gen/types.gen.ts:8858`. |
| Telemetry proxy | `POST /telemetry/capture`, `POST /telemetry/setEnabled` | `packages/opencode/src/kilocode/server/httpapi/groups/telemetry.ts:30` and `packages/opencode/src/kilocode/server/httpapi/groups/telemetry.ts:41` omit `WorkspaceRoutingQuery`. Generated SDK types expose `query?: never` at `packages/sdk/js/src/v2/gen/types.gen.ts:9357` and `packages/sdk/js/src/v2/gen/types.gen.ts:9384`. |
| Kilo Console config | `GET /config/sources`, `GET /config/effective`, `PUT /config/rules`, `GET /config/model-state`, `PATCH /config/model-state`, `GET /tui/config`, `GET /tui/keybinds` | These endpoints in `packages/opencode/src/kilocode/server/httpapi/groups/config-console.ts` omit `WorkspaceRoutingQuery`; generated SDK types expose `query?: never`, for example `packages/sdk/js/src/v2/gen/types.gen.ts:7972`, `packages/sdk/js/src/v2/gen/types.gen.ts:8041`, and `packages/sdk/js/src/v2/gen/types.gen.ts:8078`. |
| Kilo Console config with custom query schemas | `GET /config/rules`, `PATCH /tui/config` | `ConfigRulesQuery` and `TuiConfigQuery` omit `WorkspaceRoutingQueryFields` at `packages/opencode/src/kilocode/server/httpapi/groups/config-console.ts:56` and `packages/opencode/src/kilocode/server/httpapi/groups/config-console.ts:98`. Generated SDK query types retain only `scope`, not `directory` or `workspace`, at `packages/sdk/js/src/v2/gen/types.gen.ts:8004` and `packages/sdk/js/src/v2/gen/types.gen.ts:8124`. |

Broken chain:

1. Clients identify a directory/workspace using explicit query params or client-scoped headers.
2. `WorkspaceRoutingMiddleware` consumes those values in `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:152` and `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:165`.
3. Under the new Effect HttpApi contract, the endpoint query schema must accept the URL params before middleware can consume them.
4. The listed Kilo endpoints omit that schema link. Explicit `?directory=...` or `?workspace=...` requests are rejected as unknown query fields, and generated SDK senders cannot express the params because they now expose `query?: never` or scope-only query types. Header-only direct requests still work, which lets existing exerciser coverage miss the break.

Impact is not theoretical:

- Kilo Console creates a directory-scoped SDK client at `packages/kilo-console/src/client.ts:150` and then calls affected methods such as `sdk.config.modelState()` and `sdk.tui.config.get()` at `packages/kilo-console/src/client.ts:368` and `packages/kilo-console/src/client.ts:371`. The SDK's v2 rewrite intentionally moves directory headers into URL query params only for `GET` and `HEAD` at `packages/sdk/js/src/v2/client.ts:17`. Those affected GET requests therefore carry `directory` and can receive 400 schema rejections.
- The TUI hot-reload path calls affected `sdk.client.tui.config.get()` at `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config-hot-reload.ts:33`. Local TUI use may default to the correct directory, but attached or directory-scoped clients require human verification.
- VS Code explicitly calls `client.network.list({ directory: dir })` and `net.reject({ requestID, directory: dir })` while draining waits at `packages/kilo-vscode/src/services/cli-backend/connection-service.ts:48` and `packages/kilo-vscode/src/services/cli-backend/connection-service.ts:52`. The regenerated SDK says these params are invalid and its runtime methods discard them, because `Network.list()` accepts `Options<never>` and `Network.reject()` maps only `requestID` at `packages/sdk/js/src/v2/gen/sdk.gen.ts:6957` and `packages/sdk/js/src/v2/gen/sdk.gen.ts:6988`. The local type assertion hides the sender/receiver mismatch rather than fixing it.

The current exerciser does not detect this break: its Kilo scenarios use `x-kilo-directory` headers, for example `packages/opencode/test/server/httpapi-exercise/runner.ts:122`, while the missing link concerns URL query acceptance and generated SDK query shape. `packages/opencode/test/server/httpapi-query-schema-drift.test.ts:40` checks selected upstream routes only, and `packages/opencode/test/kilocode/server/httpapi-public.test.ts:54` checks only already-ported Kilo route families.

### 2. Medium, human verification required: task deny-rule inheritance is bypassed when resuming an existing child session

The merge adds `deriveSubagentSessionPermission()` in `packages/opencode/src/agent/subagent-permissions.ts:17` and uses it when creating a new task child in `packages/opencode/src/tool/task.ts:86`. This correctly propagates parent-agent denies such as plan-mode edit restrictions into a newly-created child session.

However, `task_id` resume chooses the existing session before the create branch:

- Existing task child lookup: `packages/opencode/src/tool/task.ts:74`
- Existing-or-create decision: `packages/opencode/src/tool/task.ts:86`
- New deny derivation only inside `sessions.create(...)`: `packages/opencode/src/tool/task.ts:92`

Broken or suspect chain:

1. A parent agent's deny rules are introduced on the agent definition.
2. `deriveSubagentSessionPermission()` copies them into a newly-created child session.
3. A resumed child skips `sessions.create(...)`, so the deny copy is not recomputed or persisted.
4. A child created before the fix, or under a less restrictive parent and later resumed from plan mode, can retain permissive session rules.

The new regression file `packages/opencode/test/agent/plan-mode-subagent-bypass.test.ts` tests the pure helper for new derivations, but does not exercise the resumed `task_id` path. Existing resume coverage at `packages/opencode/test/tool/task.test.ts:207` confirms reuse without asserting refreshed permissions. Human verification should decide whether resumed task sessions must merge current parent-agent denies before prompting, or whether reuse across parent contexts is intentionally trusted.

## Notable Non-Findings

### Routed HttpApi flows that remain linked

- The newly-required routing query fields are present on core instance groups and on the changed Kilo groups for background processes, indexing status, Kilo gateway, `/kilocode/*`, remote control, session import, and suggestions. `packages/opencode/test/kilocode/server/httpapi-public.test.ts:54` specifically checks background-process routing metadata, and `packages/opencode/test/kilocode/server/httpapi-public.test.ts:73` checks selected Kilo Console routes.
- Kilo cloud-session pagination remains linked end-to-end: runtime accepts string `limit` in `packages/opencode/src/kilocode/server/httpapi/groups/kilo-gateway.ts:353`, handler conversion applies `Number(...)` in `packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts:347`, the Kilo OpenAPI override publishes numeric caller shape in `packages/opencode/src/server/routes/instance/httpapi/public.ts:65`, and generated SDK exposes `limit?: number` in `packages/sdk/js/src/v2/gen/types.gen.ts:8588`.
- Kilo path-parameter compatibility overrides remain present for `bgp*` background process IDs and `que*` network request IDs in `packages/opencode/src/server/routes/instance/httpapi/public.ts:523` and `packages/opencode/src/server/routes/instance/httpapi/public.ts:527`.

### Provider metadata and status

- Catalog status remains intentionally narrower (`alpha`, `beta`, `deprecated`) while normalized provider/config status also accepts `active` in `packages/opencode/src/provider/model-status.ts:3` and `packages/opencode/src/provider/model-status.ts:6`.
- Status propagation is intact from models.dev/config inputs through normalized provider models (`packages/opencode/src/provider/provider.ts:1039`, `packages/opencode/src/provider/provider.ts:1246`) and into v2 model output (`packages/opencode/src/v2/model.ts:118`). Generated SDK exposes `active` at `packages/sdk/js/src/v2/gen/types.gen.ts:1530`.

### Session diff optional-path compatibility

- Storage and API schemas accept legacy missing `file` and `patch` values in `packages/opencode/src/snapshot/index.ts:26`. `SessionSummary.diff()` guards both optional values in `packages/opencode/src/session/summary.ts:137` and `packages/opencode/src/session/summary.ts:141`.
- Share and ingest transport boundaries filter legacy summary rows without file names before satisfying SDK `Session` transport contracts in `packages/opencode/src/share/share-next.ts:92` and `packages/opencode/src/kilo-sessions/kilo-sessions.ts:133`.
- CLI export redaction preserves counts while conditionally redacting optional file and patch data in `packages/opencode/src/cli/cmd/export.ts:26`.
- Shared UI review and turn consumers reject rows lacking file paths before rendering in `packages/ui/src/components/session-review.tsx:73` and `packages/ui/src/components/session-turn.tsx:95`. Kilo UI normalizes missing names to an empty string in `packages/kilo-ui/src/components/session-diff.ts:56`; VS Code diff sources do the same in `packages/kilo-vscode/src/diff/sources/session.ts:71` and `packages/kilo-vscode/src/diff/sources/worktree.ts:148`.
- VS Code turn summary de-duplication groups all missing-file rows under `""` at `packages/kilo-vscode/webview-ui/src/components/chat/VscodeSessionTurn.tsx:86`. This is lossy but compatible with rows that cannot identify a file; no broken sender/receiver link was found.

### ACP tool attachment replay

- Completed tool attachments are persisted on `MessageV2.ToolStateCompleted` at `packages/opencode/src/session/message-v2.ts:312`, included in generated SDK types at `packages/sdk/js/src/v2/gen/types.gen.ts:664`, converted into ACP image content blocks by `completedToolContent()` at `packages/opencode/src/acp/agent.ts:1604`, and preserved in ACP raw output by `completedToolRawOutput()` at `packages/opencode/src/acp/agent.ts:1639`.
- Both live completion and session replay call the same helpers at `packages/opencode/src/acp/agent.ts:352` and `packages/opencode/src/acp/agent.ts:838`. Focused tests cover both paths in `packages/opencode/test/acp/event-subscription.test.ts`.

### TUI bootstrap aggregation and undefined messages

- Blocking bootstrap calls are labeled, awaited with `Promise.allSettled`, and converted into one aggregate error at `packages/opencode/src/cli/cmd/tui/context/sync.tsx:592` and `packages/opencode/src/cli/cmd/tui/context/sync.tsx:602`. The Kilo global-config bootstrap call remains included at `packages/opencode/src/cli/cmd/tui/context/sync.tsx:597`.
- Session sync now treats an errored messages response as an empty list at `packages/opencode/src/cli/cmd/tui/context/sync.tsx:807`, preserving the Kilo `strip(message.info)` projection.

### SDK thrown-error interception

- Both legacy and v2 SDK factories install the same interceptor in `packages/sdk/js/src/client.ts:64` and `packages/sdk/js/src/v2/client.ts:97`.
- The generated clients pass `(error, response, request, opts)` to interceptors before the `throwOnError` branch at `packages/sdk/js/src/gen/client/client.gen.ts:163` and `packages/sdk/js/src/v2/gen/client/client.gen.ts:214`. `wrapClientError()` preserves result-tuple consumers and wraps only `throwOnError` callers at `packages/sdk/js/src/error-interceptor.ts:13`.

### Config reset sentinels, events, and selected sender/receiver pairs

- Indexing reset sentinels survive the OpenAPI optional-null cleanup: source config permits nullable `model` and `dimension` in `packages/kilo-indexing/src/config.ts:24`, the Kilo OpenAPI override re-adds nullability in `packages/opencode/src/server/routes/instance/httpapi/public.ts:278`, and generated SDK exposes both nullable values in `packages/sdk/js/src/v2/gen/types.gen.ts:1055`.
- Kilo session ingest still subscribes to created/updated/message/part/diff/turn events and transports compatible sessions at `packages/opencode/src/kilo-sessions/kilo-sessions.ts:253`. No missing sender/receiver link was found in the event-only diffs, which are import moves into `@opencode-ai/core`.
- MCP Docker `--rm` injection remains intact while the merge adds tolerant output-schema fallback in `packages/opencode/src/mcp/index.ts:155`; this is additive and does not remove the Windows process shim at `packages/opencode/src/mcp/index.ts:1`.

## Command Outputs

- `git diff --name-only 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d | wc -l` -> `181`
- `git diff --name-only -Gkilocode_change 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d | wc -l` -> `9`
- Custom read-only routed-endpoint audit -> `confirmed suspect routed Kilo endpoints: 18`, listed in Finding 1.
- `git diff --check 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d` -> no output.
- `bun run script/check-kilo-generated-artifacts.ts` -> `check-kilo-generated-artifacts: ok`
- `bun run script/check-opencode-promise-facades.ts` -> `8 classified runtime site(s), 104 classified test reference(s), no runtime drift found.`
- `bun run script/check-opencode-annotations.ts` -> `Skipping shared upstream annotation check — upstream merge detected.`

## Limitations

- Focused Bun regressions could not execute in this read-only review checkout because workspace dependencies are absent. The attempted command failed with unresolved packages such as `effect` and `@opencode-ai/core/util/log`. No `bun install` was run because it would mutate the review checkout and violate the review rules.
- The audit establishes the missing query-schema and generated-SDK links statically. A human should verify affected Kilo Console, VS Code network-drain, attached TUI hot-reload, telemetry, agent-builder, commit-message, and enhance-prompt flows after the routing schemas are ported.
- Existing untracked reports (`INFRASTRUCTURE_CHANGE.md`, `KILOCODE_CHANGE_MARKERS.md`, `OPENCODE_MENTIONS.md`, `TESTS.md`, and `UNNECESSARY_MARKERS.md`) were left untouched.
