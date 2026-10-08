# Cloud agent consumer inventory and contract map

Discovery evidence for [#14023](https://github.com/Kilo-Org/kilocode/issues/14023), supporting
[#14425](https://github.com/Kilo-Org/kilocode/issues/14425) (consumer inventory) and
[#14426](https://github.com/Kilo-Org/kilocode/issues/14426) (contract map and dispositions).

Source evidence: `Kilo-Org/cloud` @ `9a8c92ac7` (2026-10-06), `Kilo-Org/kilocode` `kilo-v2` @
`1aec22c5b2` and `origin/main` @ `82fddfdd60`. All findings are static-source. Live production
enablement, deployed versions, and ownership are **not** verified here — see "Open items".

## Consumer inventory

| # | Consumer | Repo / path | Owner | Deployed version | In scope? (proposal) |
|---|---|---|---|---|---|
| 1 | cloud-agent-next (runtime itself) | `Kilo-Org/cloud` `services/cloud-agent-next/` (Worker `cloud-agent-next`, `cloud-agent-next.kilosessions.ai`, `wrangler.jsonc:7,42-45`) | TBD — no CODEOWNERS in repo | TBD — needs production check | Yes — the runtime under migration |
| 2 | In-container wrapper | `services/cloud-agent-next/wrapper/` (`main.ts:1-18`, `kilo-runtime-lifecycle.ts:156-166`); image installs `@kilocode/cli@7.8.1` (`Dockerfile:6,64`; `wrangler.jsonc:185-281`; `src/shared/kilo-cli-version.ts`) | TBD | `@kilocode/cli` 7.8.1, `@kilocode/sdk` 7.8.1 (source pins) | Yes — primary consumer of the CLI server API |
| 3 | code-review-infra | `services/code-review-infra/src/code-review-orchestrator.ts` (client at :462-463) | TBD | TBD | Yes |
| 4 | auto-triage-infra | `services/auto-triage-infra/src/triage-orchestrator.ts:351-389` | TBD | TBD | Yes |
| 5 | auto-fix-infra | `services/auto-fix-infra/src/services/cloud-agent-next-client.ts` + `fix-orchestrator.ts:13` | TBD | TBD | Yes |
| 6 | security-auto-analysis | `services/security-auto-analysis/src/{launch,remediation,manual-analysis}.ts` | TBD | TBD | Yes |
| 7 | webhook-agent-ingest | `services/webhook-agent-ingest/src/queue-consumer.ts:418-600`, `dos/TriggerDO.ts` | TBD | TBD | Yes |
| 8 | kilo-bot (GitHub/Slack/Linear ingress) | `apps/web/src/lib/bot/{tools/spawn-cloud-agent-session,run,agent-runner}.ts` | TBD | TBD | Yes |
| 9 | apps/web control plane (personal + org routers) | `apps/web/src/routers/cloud-agent-next-router.ts`, `routers/organizations/organization-cloud-agent-next-router.ts`, `lib/cloud-agent-next/cloud-agent-client.ts` | TBD | TBD | Yes — proxy for all interactive clients |
| 10 | apps/web dashboard UI + stream-ticket route | `components/cloud-agent-next/*`, `app/api/cloud-agent-next/sessions/stream-ticket/route.ts` | TBD | TBD | Yes |
| 11 | apps/web app-builder | `routers/app-builder-router.ts`, `components/app-builder/project-manager/sessions/v2/streaming.ts` | TBD | TBD | Yes (via #9/#10 surfaces) |
| 12 | apps/mobile (agent-chat) | `apps/mobile/src/app/(app)/agent-chat/[session-id].tsx`, `components/agents/mobile-session-manager.ts`, `lib/cloud-agent-stream-ticket.ts` | TBD | TBD | Yes — via control plane + `@kilocode/cloud-agent-sdk` |
| 13 | apps/extension (VS Code, cloud repo) | `apps/extension/src/shared/{extension-agent-session-manager,cloud-agent-config}.ts` | TBD | TBD | Yes — via control plane + SDK |
| 14 | `kilo cloud` CLI | `Kilo-Org/kilocode` `origin/main:packages/opencode/src/kilocode/cli/cmd/cloud.ts`; v2 port `packages/kilo-cli/src/cloud*` | kilocode repo | n/a | Yes — already ported (see `baseline/cloud-cli-v2-parity.md`) |
| 15 | `@kilocode/cloud-agent-sdk` (contract package) | `Kilo-Org/cloud` `packages/cloud-agent-sdk/` | TBD | n/a | Yes — canonical client contract for 10/12/13 |

### Confirmed non-consumers

- `services/gastown/` — has its own per-container `/stream-ticket`; name collision only
  (`gastown.worker.ts:1058`).
- `services/security-sync/` — feeds findings to security-auto-analysis; no cloud-agent references.
- kilocode Agent Manager (`packages/kilo-vscode`) — zero `cloudAgentSessionId`/cloud-agent
  references across full history; its cloud usage is the separate cloud-session preview/import
  flow (`src/kilo-provider/handlers/cloud-session.ts`).
- kilocode kilo-sessions remote relay (`ingest.kilosessions.ai`) — separate surface, tracked
  under [#14019](https://github.com/Kilo-Org/kilocode/issues/14019).

## Headline findings

1. **Cancel exists server-side.** The kilocode v1 client has no cancel verb, but cloud-agent-next
   exposes `interruptSession`
   (`services/cloud-agent-next/src/router/handlers/session-management.ts:225-315`) and
   `cancelQueuedMessage` (:322-358), with six in-repo callers. The v2 CLI can add cancel against an
   existing contract — no backend invention required. This corrects the "source gap" recorded in
   `baseline/cloud-cli-v2-parity.md` (L58-63): the gap was client-side only.
2. **The runtime contract consumer is the in-container wrapper, and it already runs the v2-fork
   CLI.** The image installs `@kilocode/cli@7.8.1`; the wrapper spawns `kilo serve` and consumes
   the CLI's HTTP server API via `@kilocode/sdk@7.8.1` (`wrapper/src/main.ts:1-18`,
   `kilo-api.ts:244-341`) — both the v1 client and `@kilocode/sdk/v2` (`createKiloClient`,
   `kilo-api.ts:11,349`). Not headless `run`, not ACP.
3. **Blast radius splits cleanly:** admission-contract changes touch the six worker-side tRPC
   callers below; streaming changes touch only SDK consumers (web/mobile/extension). Automation
   services never stream.

## Contract map — the wrapper (the consumer of the kilocode runtime)

The wrapper↔CLI surface is what `kilo-v2` must keep stable or version. From
`wrapper/src/kilo-api.ts` and `wrapper/src/control-plane/kilo-runtime.ts`:

| Contract area | Consumed surface | Evidence |
|---|---|---|
| Startup | `createKilo()` / `createKiloClient` spawning `kilo serve`; `createSession` | `kilo-runtime-lifecycle.ts:156-166`; `kilo-api.ts:244-341`; `control-plane/kilo-runtime.ts:5-6,739` |
| Session admission | `sendPrompt`/`sendPromptAsync`, `sendCommand`, `listCommands` | `kilo-api.ts` (WrapperKiloClient) |
| Streaming | `subscribeEvents` (server event stream) | `kilo-api.ts`; `control-plane/kilo-event-feed.ts:1,68` |
| Tools | via server events + `sendCommand` | `kilo-api.ts` |
| Credentials | in-sandbox runtime credential proxy (`/api/runtime-credential-proxy/:route/*`, routes backend/provider/ingest/exa) | `services/cloud-agent-next/src/server.ts:276,449-462` |
| Persistence | session state via server API; logs via R2 upload route (`PUT /sessions/.../logs/...`, server.ts:955); ingest WS routes (server.ts:779,890) | as cited |
| Cancellation | `abortSession` | `kilo-api.ts:263-267`; shutdown path `wrapper/src/shutdown.ts` |

Two planes exist: legacy wrapper and control-plane wrapper (`src/session-plane.ts`;
`docs/control-plane.md`). The control plane already uses `@kilocode/sdk/v2` directly.

## Contract map — automation/worker consumers (consumers #3–8)

All six use raw HTTP to the tRPC router, Bearer + `x-internal-api-key`, and only the
admission/callback slice. None stream; none consume the CLI directly.

| Consumer | Procedures called | Callback pattern | Cancellation | Evidence |
|---|---|---|---|---|
| code-review-infra | `prepareSession`, `initiateFromKilocodeSessionV2`, `updateSession`, `sendMessageV2`, `getSessionHealth` | `callbackTarget`, rewritten via `updateSession` | `interruptSession` | `code-review-orchestrator.ts:1126,1243-1274,1396,1445,1457` |
| auto-triage-infra | `prepareSession`, `initiateFromPreparedSession` | per-ticket secret in `callbackTarget.headers` | — | `triage-orchestrator.ts:351-389` |
| auto-fix-infra | `prepareSession`, `initiateFromKilocodeSessionV2` | yes | — | `services/cloud-agent-next-client.ts:49,92` |
| security-auto-analysis | `prepareSession`, `initiateFromKilocodeSessionV2` | `callbackTarget` with derived HMAC token | `interruptSession` | `launch.ts:272-282,296,336`; `remediation.ts:1092,1203,1277`; `manual-analysis.ts:90` |
| webhook-agent-ingest | `prepareSession`, `initiateFromKilocodeSessionV2` (+`x-skip-balance-check`) | yes | — | `queue-consumer.ts:470,476,558` |
| kilo-bot | via web-internal `createCloudAgentNextClient` + `runSessionToCompletion` | per-request HMAC to `/api/internal/bot-session-callback/:id` | via web | `spawn-cloud-agent-session.ts:32-41,118-120` |

Credentials across all six: scoped tokens resolved by the web control plane per owner (see
`Kilo-Org/cloud` `docs/token-issuance-policy.md:95` for the auto-fix flow); services never hold
user model keys. Persistence: orchestration state in per-service Durable Objects + DB queues.
Tools: not exercised directly — the agent runs tools in-container; services see only lifecycle
callbacks.

## Contract map — interactive clients via the web control plane (consumers #9–13)

| Area | Surface | Consumers |
|---|---|---|
| Startup/admission | control-plane tRPC `prepareSession` → `initiateFromPreparedSession` | web router `:184,265`; mobile `:420-441`; extension `:518-732` |
| Messaging | `sendMessage` / `sendMessageV2`, `getMessageResult` polling | web `:292,360`; mobile `:325-331` |
| Streaming | 60s JWT stream ticket (`POST /api/cloud-agent-next/sessions/stream-ticket`, ownership-checked) → WS `/stream?…&ticket=…` with `fromId`/`replay` cursor | ticket route `:84-125`; `CloudAgentProvider.tsx:170-207`; SDK `cloud-agent-transport.ts:92-106` |
| Interactions | `answerQuestion`/`rejectQuestion`/`answerPermission`, `getPendingInteractions` | web `:582-602,646`; mobile `:372-394` |
| Cancellation | `interruptSession`, `cancelQueuedMessage` | web `:549,571`; mobile `:335-358`; extension `:528-534` |
| Persistence | history via `cliSessionsV2.*`; active sessions via `activeSessions.list`; server-side `cli_sessions_v2` | mobile session manager; ticket route ownership check |

The SDK (`packages/cloud-agent-sdk`) hardcodes no tRPC paths: `CloudAgentApi`
(`transport.ts:181-210`) is injected by each client and backed by the web control-plane routers;
`getTicket` hits the web route. Message statuses align:
`queued|running|completed|failed|interrupted`.

## Contract map — `kilo cloud` CLI (consumer #14)

| Area | v1 | v2 (`packages/kilo-cli`) |
|---|---|---|
| Startup/admission | `agent.start` tRPC | `CloudRpc.start` → adapter → tRPC (org override structurally omitted) |
| Messaging | `agent.send`, `getMessageResult` | `CloudRpc.send/status/result` |
| Streaming | in-process `streamAgentEvents` | `stream.prepare` (URL pinned pre-ticket) + CLI-local `streamAgentEvents`; adds AbortSignal |
| Credentials | v1 `Auth.Service`/`KILO_API_KEY` | explicit `{token, org, origins}` adapter; token never crosses RPC |
| Cancellation | none | none — **can now be added against `interruptSession`/`cancelQueuedMessage`** |
| Persistence | none client-side | none client-side |

## Dispositions

| Consumer | Disposition | Evidence / rationale |
|---|---|---|
| Wrapper (in-container) | **No change now; version the contract.** Already runs the v2-fork CLI (`@kilocode/cli` 7.8.1) via the server API, including `/sdk/v2`. The migration requirement inverts: `kilo-v2` must keep the wrapper-consumed server/API surface stable or versioned (see "Contract map — the wrapper"). Add contract tests in kilocode for that surface. | section above |
| code-review-infra | **No change** unless admission contract changes; uses internal-only `updateSession` ("Retained for services/code-review-infra", session-prepare.ts:229-236) — if that procedure is ever removed, file adaptation. | source |
| auto-triage-infra, auto-fix-infra, webhook-agent-ingest | **No change** — narrowest slice (prepare/initiate/callback). | source |
| security-auto-analysis | **No change**; uses `interruptSession`, keep that contract. | source |
| kilo-bot | **No change** — consumes via web control plane, insulated from direct tRPC drift. | source |
| apps/web control plane + dashboard + app-builder | **No change** for the CLI migration itself; affected only if cloud-agent-next's own contract evolves. Owns the stream-ticket auth boundary — keep ticket semantics stable for the CLI's `stream.prepare`. | source |
| apps/mobile, apps/extension | **No change** — SDK-mediated; any transport change lands in `@kilocode/cloud-agent-sdk` once. | source |
| `kilo cloud` CLI | **Already adapted** (v2 port complete, Kilo-owned, `baseline/cloud-cli-v2-parity.md`). Remaining: 5 deployed-verification gaps (envelope drift, ticket retry cadence, live WS behavior, real credential resolution, cancel) — all require the deployed environment, per the epic's rule that local fixtures don't establish hosted compatibility. Optional enhancement: add `cancel` via `interruptSession`/`cancelQueuedMessage`. | parity ledger + this map |

## Gaps to file

- Deployed-verification pass for the CLI's 5 gaps (needs authorized live environment) — candidate
  for [#14427](https://github.com/Kilo-Org/kilocode/issues/14427).
- Optional: `kilo cloud cancel` against `interruptSession`/`cancelQueuedMessage` — new scope,
  needs a product decision.
- Contract-test coverage in kilocode for the wrapper-consumed server API surface — candidate for
  [#14427](https://github.com/Kilo-Org/kilocode/issues/14427)/[#14428](https://github.com/Kilo-Org/kilocode/issues/14428).
- `updateSession` is single-consumer (code-review-infra) and marked "retained" — flag to
  cloud-agent-next owners before any removal.

## Open items

1. **Owners** — no CODEOWNERS exists in `Kilo-Org/cloud`; the inventory's owner column needs human
   input per row.
2. **Deployed versions** — source pins say `@kilocode/cli` 7.8.1 in the container; actual deployed
   worker/image versions need `wrangler`/production verification.
3. **Live enablement** — static source shows supported paths, not rollout state; each automation
   service's production enablement should be confirmed.
4. **Scope ratification** — the inventory's "In scope?" column is a proposal from source evidence;
   needs explicit sign-off, including whether security-auto-analysis's model-only triage path
   (which does not launch Cloud Agent) is in scope.

## Verification limits

Static source at the cited SHAs. No live endpoint was contacted; deployed contract drift,
production enablement, and deployed versions remain unverified.
