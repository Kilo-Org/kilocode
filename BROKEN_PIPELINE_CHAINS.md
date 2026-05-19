# Broken Pipeline Chains Review

## Scope
- PR: https://github.com/Kilo-Org/kilocode/pull/10387
- Base compared: main

## Findings

### Finding 1
- Severity: High
- File(s): `packages/opencode/src/server/routes/instance/config.ts`, `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts`, `packages/opencode/src/server/routes/instance/index.ts`, `packages/opencode/src/server/routes/instance/httpapi/api.ts`
- Chain: Kilo's legacy `GET /config/providers` route lists providers, computes default model IDs, then overrides the `kilo` provider default from the Kilo API via `fetchDefaultModel(token, organizationId)` when `ProviderID.kilo` is available. The SDK/UI consumes the `default` field from `config.providers` to choose the provider default shown/used for Kilo. PR 10387 routes `/config/providers` through the Effect HttpApi backend when `KILO_EXPERIMENTAL_HTTPAPI` is enabled, and also includes the Effect `ConfigApi` in the generated SDK/OpenAPI surface.
- Missing/altered link: The Effect handler for `config.providers` only does `Provider.defaultModelIDs(providers)` and returns it. It does not import/use `Auth`, `ProviderID`, `ModelID`, or `fetchDefaultModel`, so the Kilo API default-model override present in the legacy Hono route is dropped on the HttpApi path.
- Suspected impact: On channels where the Effect HttpApi backend is selected, `client.config.providers()` and `/config/providers` silently return the static/default local model for the `kilo` provider instead of the organization/user default from the Kilo API. This can make the UI select or display the wrong default Kilo model while compiling cleanly.
- Human verification recommendation: Compare `GET /config/providers` with `KILO_EXPERIMENTAL_HTTPAPI=false` and `true` for an authenticated Kilo account whose cloud default differs from the local default. Verify the `default.kilo` value matches in both paths, then port the legacy Kilo override into `ConfigHttpApi.providers` or extract a shared helper used by both handlers.

## Chains Reviewed
- Kilo HttpApi group registration chain: Kilo groups are imported in `InstanceHttpApi`, Kilo handler layers are provided by `provideKiloHttpApiHandlers`, and legacy Hono bridge registration forwards Kilo paths to the Effect handler when `KILO_EXPERIMENTAL_HTTPAPI` is enabled. Result: no broken link found for group/handler registration.
- Permission `allow-everything` chain: request body schema -> legacy Kilo route / Effect permission endpoint -> `AllowEverythingPermission.effect` -> session/global permission mutation -> `Permission.Service.allowEverything` and config update event. Result: no broken link found.
- Config warnings chain: `Config.Warning` shape -> Effect `Warning` schema -> `ConfigHttpApi.warnings` -> SDK/OpenAPI `/config/warnings` -> legacy bridge route. Result: no broken link found.
- Config providers Kilo default-model chain: legacy `ConfigRoutes.providers` cloud default override -> Effect `ConfigHttpApi.providers` -> SDK/UI consumer of `default`. Result: broken link found; see Finding 1.
- Provider auth callback disposal chain: OAuth callback -> provider auth service -> `disposeAllInstancesAfterProviderAuthCallback` in both legacy and Effect handlers. Result: no broken link found.
- Kilo Gateway routes chain: `/kilo/*` schemas -> Effect handlers -> gateway helpers/auth/model cache/session import -> legacy bridge registrations. Result: no broken link found in registration or handler propagation; `cloud/session/import` uses `EffectBridge` to restore instance/workspace context before calling the shared import helper.
- Kilo Gateway cloud sessions query chain: SDK/OpenAPI query params -> Effect query schema -> handler numeric limit conversion -> `getCloudSessions`. Result: no broken link found.
- Worktree diff endpoints chain: query schema -> legacy bridge paths -> Effect handlers -> base branch resolution -> `WorktreeDiff.full/summary/detail` -> Agent Manager-facing response. Result: no broken link found.
- Experimental session worktree listing chain: `worktrees/projectID/directory` query params -> current project/worktree family resolution -> `Session.listGlobal` filters -> `worktreeName` decoration -> pagination cursor header. Result: no broken link found.
- Session viewed chain: SDK/OpenAPI `/session/viewed` -> bridge path -> Effect handler -> `KiloSessions.setViewedSessions`. Result: no broken link found.
- Indexing status/event chain: indexing status schema/event definition -> HttpApi status endpoint -> `KiloIndexing.current()` via `EffectBridge` -> event schema registration for OpenAPI. Result: no broken link found.
- Remote connection chain: `/remote/enable|disable|status` -> EffectBridge where needed -> `KiloSessions.enableRemote/disableRemote/remoteStatus`. Result: no broken link found.
- Network approval chain: `/network` routes -> EffectBridge -> `SessionNetwork.list/reply/reject` with `QuestionID` path branding and OpenAPI path override. Result: no broken link found.
- Suggestion chain: `/suggestion` routes -> `Suggestion.list/accept/dismiss` -> session ID branding for Effect response schema. Result: no broken link found.
- Commit-message and enhance-prompt chains: payload schema -> config/prompt lookup or text payload -> `EffectBridge` -> Kilo helper -> response schema. Result: no broken link found.
- Server auth username/password chain: `KILO_SERVER_USERNAME`/`KILO_SERVER_PASSWORD` flags -> shared `ServerAuth` helpers -> HttpApi authorization middleware -> clients using `ServerAuth.headers/header`. Result: no broken link found.
- Indexing `indexing.status` SSE schema chain: `BusEvent.define("indexing.status")` -> imported before HttpApi event schema construction -> publisher in `KiloIndexing`. Result: no broken link found.
