# Cloud agent consumers — inventory and migration scope

Discovery for Kilo-Org/kilocode#14425 (parent epic #14023). Discovery only: no
source changes in any repository.

## Header

| Item | Value |
|---|---|
| Date | 2026-10-02 |
| Updated | 2026-10-07 — applied PR #14758 review; added `webhook-agent-ingest`; recorded the EOL removal decision for Gastown and KiloClaw |
| Cloud repo | `Kilo-Org/cloud` at `3de933dd85070e9d15c41d8ff3af6c91ca856fd4` (read-only clone) |
| This repo, `origin/main` (v1) | `622ed1f5ae5af2d864908a0bb759b0c9121d406c` |
| This repo, `kilo-v2` (v2) | `a2e6c1f69b36a0215c30a80f9d13da9f530073df` |

Citation conventions: `cloud@3de933dd <path>:<line>` means the cloud repo at
`3de933dd85070e9d15c41d8ff3af6c91ca856fd4`. Bare `path:line` means this repo at
the SHA above.

Both v1 and v2 publish the CLI package as **`@kilocode/cli`** (v1
`packages/opencode/package.json:2-3` on `origin/main` is `7.8.3`; the v2
`packages/kilo-cli/package.json:2-3` on `kilo-v2` is `0.0.0-internal` and
`private`). Every consumer below resolves `@kilocode/cli` from npm, so the v1/v2
distinction is a package/channel question, not a package-name question.

Do not confuse the SDK's `/v2` subpath with the Kilo v2 product. The
`@kilocode/sdk` package is v1's Kilo SDK, published from
`origin/main:packages/sdk/js/package.json` (name `@kilocode/sdk`, version `7.8.3`)
and already exposing a `./v2` subpath (`src/v2/…`). The `@kilocode/sdk/v2`
imports in cloud-agent-next refer to that second-generation client subpath, not
to the Kilo v2 runtime. On `kilo-v2` there is no `@kilocode/sdk` package yet:
`packages/sdk/package.json` is upstream `@opencode-ai/sdk`, with Kilo helpers in
`packages/kilo-client`. Contract mapping under #14426 must keep the two distinct.

Already tracked elsewhere, not re-assessed here: the `kilo cloud` CLI client
(`origin/main:packages/opencode/src/kilocode/cloud/` and
`packages/kilo-cli/src/cloud/`); the `/remote` relay contract consumed by
`cloud-agent-sdk` (#14019); the VS Code Agent Manager (#14016).

## Inventory

Scope is **proposed, pending approval by the cloud repo's owners** (no
`CODEOWNERS` exists in the clone; all owners are recorded as `unassigned`),
except the Gastown and KiloClaw EOL dispositions, which a cloud owner supplied
as review comments on PR #14758 on 2026-10-05. Those two are owner-reviewed;
the rest is still proposed.

| Consumer | Repo + path | Owner | Kilo dependency | How obtained and pinned | Deployed runtime | Update / rollout | In scope? | Rationale | Recommended gate | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| cloud-agent-next (hosted cloud agent; all `agent_*`/`workspace_*` sessions, incl. PR-review/auto-fix bot sandboxes) | `Kilo-Org/cloud` `services/cloud-agent-next/` | unassigned | Binary + SDK + HTTP: wrapper spawns `kilo serve` and imports `@kilocode/sdk` and `@kilocode/sdk/v2` | `@kilocode/cli@7.8.1` npm-global in sandbox image (Dockerfile `ARG KILOCODE_CLI_VERSION`); `KILOCODE_CLI_VERSION` in `wrangler.jsonc` `image_vars`/`build_vars` for every container class; `@kilocode/sdk@7.8.1` in `package.json` and `wrapper/package.json`; single source `src/shared/kilo-cli-version.ts` | 7.8.1 | Bump `KILO_CLI_VERSION` + manifests; `wrangler deploy` rebuilds Cloudflare Containers (changed-worker matrix in `deploy-workers.yml`; `deploy-production.yml`/`deploy-staging.yml`); `rollout_active_grace_period 1800` | yes | Primary hosted runtime; embeds the v1 CLI server + SDK; every hosted agent flow executes here. Owner-confirmed (PR #14758): the v1↔v2 message/API differs significantly, so this is a required adaptation, not a version bump alone; the concrete deltas are #14426 | G1 for adaptation; independent cutover (pinned, own go/no-go) | cloud@3de933dd `services/cloud-agent-next/Dockerfile:6,64`; `src/shared/kilo-cli-version.ts:1`; `wrangler.jsonc:182,277`; `wrapper/package.json:11`; `wrapper/src/control-plane/kilo-runtime.ts:184`; `wrapper/src/control/worktree-runtime.ts:379` |
| auto-routing-benchmark (decider benchmark runner) | `services/auto-routing-benchmark/container/` | unassigned | Binary: spawns `kilo run --format json` | `npm install -g @kilocode/cli@latest` resolved at image build; no version pin | latest at last image build (7.8.x as of the assessed SHA; exact build unverified) | `wrangler deploy` builds/pushes the container image; each deploy re-pins to that day's `latest` | yes | Floats on `@kilocode/cli@latest`, so a v2 `latest` reaches it automatically | G1 | cloud@3de933dd `services/auto-routing-benchmark/container/Dockerfile:12`; `container/server.mjs:64`; `wrangler.jsonc:32-39` |
| Gastown (agent orchestration via Durable Objects + container) | `services/gastown/container/` | unassigned | Binary + SDK: spawns `kilo serve` via `createKilo()`; ships `@kilocode/plugin` for plugin discovery | `@kilocode/cli@7.2.14` (+ `cli-linux-x64`, `cli-linux-x64-musl`, `@kilocode/plugin@7.2.14`) in Dockerfile; `@kilocode/sdk@7.2.14`, `@kilocode/plugin@7.2.52` in `container/package.json` | 7.2.14 | `pnpm --filter cloudflare-gastown deploy:prod` → `container:prepare` + container build + `wrangler deploy`; `max_instances 500` | no (EOL; slated for removal) | Owner disposition on PR #14758 (pandemicsyn, 2026-10-05): Gastown is EOL'd and slated for removal; do not invest effort updating it or add v2 compatibility. Removal tracking not yet created — see "EOL removal signal". Runtime facts recorded for completeness only | n/a (EOL; no v2 work) | cloud@3de933dd `services/gastown/container/Dockerfile:80-81`; `container/package.json:15-16`; `container/src/process-manager.ts:9,664`; PR #14758 review comment |
| KiloClaw (per-user OpenClaw runtimes on Fly.io) | `services/kiloclaw/` | unassigned | Binary: ships `@kilocode/cli` in the Fly image and spawns `kilo run --auto`; controller also configures the `kilo` provider | Baked `@kilocode/cli@7.2.31` in Dockerfile; controller runs background `npm install -g @kilocode/cli@latest` 3h after boot when `KILOCLAW_KILO_CLI=true` | baked 7.2.31, then per-instance self-upgrade to `latest` | `deploy-kiloclaw.yml` builds/pushes the Fly image; each machine self-upgrades at runtime | no (EOL; slated for removal) | Owner disposition on PR #14758 (pandemicsyn, 2026-10-05): KiloClaw is EOL'd and slated for removal; take it wholly out of v2 support if possible. Kilo only appears as an optional CLI users may invoke from OpenClaw and as a rescue/doctor admin mechanic, which the owner flags as the most likely to break. Residual risk: the runtime `@latest` self-upgrade can still pull a v2 release into EOL machines without an image rebuild; accepted because no v2 support is planned. The doctor route today runs `openclaw doctor`, not the Kilo CLI. Client-side removal/disposition is recorded by kilocode #14419 (its acceptance allows a product-decision removal) and inventoried by #14415; execution-plan Decision 5 already drops the client KiloClaw port. Cloud-service removal is not yet tracked — see "EOL removal signal" | n/a (EOL; no v2 work) | cloud@3de933dd `services/kiloclaw/Dockerfile:93`; `controller/src/index.ts:638-646`; `controller/src/routes/kilo-cli-run.ts:120,159`; `controller/src/routes/doctor.ts:420-421`; `docs/instance-features.md:29`; PR #14758 review comment |
| MCP catalog generator (CI) | `.github/workflows/kilo-mcp-catalog.yml` + `apps/web/src/scripts/mcp-catalog/catalog.ts` | unassigned | Binary: `kilo run --model … --variant … --format json` | `npm install -g @kilocode/cli` (unpinned) inside the workflow | workflow-run `latest` | Runs on every PR and main push; a required `catalog (PR)` check | yes (CI consumer executing the runtime) | Floats on `@latest`; generates summaries used by `services/kilo-mcp` | G1 | cloud@3de933dd `.github/workflows/kilo-mcp-catalog.yml:115,371`; `apps/web/src/scripts/mcp-catalog/catalog.ts:714,722` |
| code-review-infra | `services/code-review-infra/` | unassigned | HTTP only: calls cloud-agent-next `prepareSession`/`initiate` and `interruptSession` | n/a (no Kilo package) | n/a | n/a | no | Indirect caller: no runtime embed; cloud-agent-next owns execution and the response contract | n/a | cloud@3de933dd `services/code-review-infra/src/code-review-orchestrator.ts:1243,1262` |
| auto-fix-infra | `services/auto-fix-infra/` | unassigned | HTTP only: calls cloud-agent-next prepare/initiate | n/a | n/a | n/a | no | Same as code-review-infra | n/a | cloud@3de933dd `services/auto-fix-infra/src/fix-orchestrator.ts:259,270` |
| auto-triage-infra | `services/auto-triage-infra/` | unassigned | HTTP only: calls cloud-agent-next prepare/initiate + callback | n/a | n/a | n/a | no | Same as code-review-infra | n/a | cloud@3de933dd `services/auto-triage-infra/src/triage-orchestrator.ts:378,387` |
| security-auto-analysis (remediation) | `services/security-auto-analysis/` | unassigned | HTTP only: calls cloud-agent-next `prepareSession`/`interruptSession` | n/a | n/a | n/a | no | Same as code-review-infra | n/a | cloud@3de933dd `services/security-auto-analysis/src/remediation.ts:1202,1091` |
| webhook-agent-ingest | `services/webhook-agent-ingest/` | unassigned | HTTP only: queue consumer calls cloud-agent-next `prepareSession` and `initiateFromKilocodeSessionV2`; KiloClaw trigger type posts to kilo-chat | n/a (no Kilo package) | n/a | n/a | no | Indirect caller: no runtime embed; cloud-agent-next owns execution and the response contract | n/a | cloud@3de933dd `services/webhook-agent-ingest/src/queue-consumer.ts:470,558`; `services/webhook-agent-ingest/package.json:24-27` |
| app-builder | `services/app-builder/` | unassigned | None: `cloudflare/sandbox` for app preview/build | n/a | n/a | n/a | no | Sandbox product with no Kilo CLI/SDK/server usage | n/a | cloud@3de933dd `services/app-builder/Dockerfile:1-2` |
| cloud-agent-sdk + web/mobile clients | `packages/cloud-agent-sdk/`, `apps/web`, `apps/mobile` | unassigned | HTTP/relay only: consumes cloud-agent-next tRPC and the `/remote` relay | n/a | n/a | n/a | no | Client-side SDK and the web/mobile apps; `apps/web` also hosts the cloud-agent-next callers (routers + `lib/cloud-agent-next/*`). Already tracked in #14019. The "kilocode-backends prepare-session endpoint" in cloud-agent-next's README is historical naming for that web/api layer, not a separate service in this clone | n/a | cloud@3de933dd `packages/cloud-agent-sdk/src/cli-live-transport.ts:1-4`; `packages/cloud-agent-sdk/package.json:5`; `services/cloud-agent-next/README.md:299` |
| session-ingest | `services/session-ingest/` | unassigned | Contract-coupled, no runtime: receives CLI session events/ingest and backs `kilo import`; shares `@kilocode/session-ingest-contracts` with cloud-agent-next and cloud-agent-sdk | n/a (service, not the CLI) | n/a | n/a | yes (contract-coupled; does not execute the runtime) | Owner notes the CLI and session-ingest are closely tied (PR #14758, 2026-10-05): the CLI ships to session-ingest, and cloud agents, the session feature and others tap in. The CLI↔session-ingest wire contract is therefore a G1 producer concern even though session-ingest embeds no runtime | G1 (producer-side contract) | cloud@3de933dd `services/session-ingest/src/remote-session-notifications.ts:82`; `services/cloud-agent-next/wrangler.jsonc:59`; `services/cloud-agent-next/package.json:50`; `packages/cloud-agent-sdk/package.json:29`; `services/cloud-agent-next/src/kilo/client.ts:112`; PR #14758 review comment |
| kilo-ops, wasteland, mcp-gateway, images-mcp, kilo-mcp | `services/<name>/` | unassigned | None | n/a | n/a | n/a | no | No Kilo CLI/SDK/server spawn or image inclusion found | n/a | — |

## Proposed migration scope

**Proposed, pending approval by the cloud repo's owners.**

### In scope

- **cloud-agent-next** — the central hosted runtime. It embeds the v1 CLI server
  and `@kilocode/sdk`, and it is the execution path for hosted sessions and the
  PR-review/auto-fix/auto-triage/security bot flows. Pinned to `7.8.1`, so it
  cuts over on its own pin bump after G1 stabilises the v2 CLI/SDK/server
  contract. An owner confirmed the v1↔v2 API differs significantly, so this is a
  confirmed adaptation, not a no-change consumer; the concrete deltas and the
  approach are #14426/#14427.
- **auto-routing-benchmark** — executes `kilo run` from a container image built
  against `@kilocode/cli@latest`.
- **MCP catalog generator (CI)** — executes `kilo run` with an unpinned
  `@kilocode/cli` install.
- **session-ingest** — no runtime executor, but contract-coupled to the CLI: the
  v2 CLI ships session events/ingest to it and `kilo import` uses it, and
  cloud-agent-next and cloud-agent-sdk share `@kilocode/session-ingest-contracts`
  with it (owner-confirmed coupling). Its wire contract must be mapped under
  #14426 as part of the G1 producer surface.

Three of the four execute the **CLI/headless runtime surface**, not the VS Code
or JetBrains surfaces; the fourth is the CLI's session-ingest contract.
**Recommended placement: #14427 and #14428 belong to G1.** The shared adaptation
work is the v2 CLI/server/SDK/session-ingest contract; the floating consumers
must be ready or protected before v2 is published to the `latest` channel they
track. cloud-agent-next is pinned and contributes a cross-repo dependency to
#14427 but performs its own cutover under its own go/no-go, exactly like
JetBrains.

### Out of scope

- **Gastown** — owner disposition: EOL'd and slated for removal; do not invest
  effort updating it or add v2 compatibility. The runtime facts are retained in
  the inventory for completeness only; removal tracking is not yet created (see
  "EOL removal signal").
- **KiloClaw** — owner disposition: EOL'd and slated for removal; take it wholly
  out of v2 support if possible. The optional CLI use and the rescue/doctor admin
  mechanic are the only Kilo touchpoints; the owner flags the doctor mechanic as
  the most likely to break. Its runtime `@latest` self-upgrade can still pull v2
  into EOL machines without an image rebuild — recorded as an accepted residual
  risk, not a support obligation. Client-side disposition is handled by #14419
  (and inventoried by #14415); cloud-service removal is not yet tracked (see
  "EOL removal signal").
- **code-review-infra, auto-fix-infra, auto-triage-infra, security-auto-analysis,
  webhook-agent-ingest** — orchestration callers of cloud-agent-next's tRPC API
  (`prepareSession`/`initiate*`). They embed no Kilo runtime; any
  cloud-agent-next response-shape change is covered by cloud-agent-next's G1
  work. No separate gate.
- **apps/web** — hosts the cloud-agent-next callers (routers and
  `lib/cloud-agent-next/*`) but embeds no runtime; it is a web/client and
  orchestration surface, not a consumer gate. The "kilocode-backends
  prepare-session endpoint" referenced in cloud-agent-next's README is
  historical naming for that layer, not a separate service in this clone.
- **app-builder** — sandbox app host with no Kilo runtime.
- **cloud-agent-sdk and mobile** — client consumers of cloud-agent-next and the
  `/remote` relay; tracked in #14019. (`apps/web` is covered above.)
- **VS Code extension / Agent Manager** — tracked in #14016.
- **kilo-ops, wasteland, mcp-gateway, images-mcp, kilo-mcp** — no runtime
  embedding found.
- The **`kilo cloud` CLI client** in this repo — tracked separately.

## EOL removal signal

Both services are end-of-life and slated for removal. Recorded here so downstream
tasks stop building v2 compatibility for them and the removal work can be
scheduled. This is the decision record; the removal issues themselves belong in
`Kilo-Org/cloud`.

| Consumer | Decision | Existing downstream task | Removal tracking |
|---|---|---|---|
| KiloClaw | EOL; remove; not needed for v2 | kilocode #14419 records the client-side product-decision removal (its acceptance allows it) and #14415 inventories it; execution-plan Decision 5 already drops the client KiloClaw port | Missing: cloud-service removal of `services/kiloclaw` (worker/controller/container) and its satellites (`kiloclaw-billing`, `kiloclaw-inbound-email`, `kilo-chat`, the `kiloclaw_chat` path in `webhook-agent-ingest`, the `apps/web` instance UI, DB tables, Fly.io app/DNS) is untracked |
| Gastown | EOL; remove | None in either repo | Missing: removal of `services/gastown` (worker + container + deploy config) is untracked |

Cascade note: confirm whether `kilo-chat` has consumers outside KiloClaw before
including it in the KiloClaw removal; `webhook-agent-ingest` posts to it today.

Action: create the removal issue(s) in `Kilo-Org/cloud` (owner to confirm). Until
then this decision is the only record.

## Owner-confirmed findings (PR #14758 review, 2026-10-06)

| Finding | Impact | Evidence |
|---|---|---|
| The v1↔v2 message/API differs significantly | cloud-agent-next is a confirmed adaptation, not a no-change consumer. The concrete contract deltas and the adaptation approach remain #14426/#14427 work | PR #14758 review (eshurakov question; fpliger reply: "Yes, it's significantly different") |
| cloud-agent-next deploys build containers from the Dockerfiles, then Cloudflare rolls out the changes | Confirms the Cloudflare-container rollout path; the `@kilocode/cli` pin is baked at image build | PR #14758 review (eshurakov) |
| The Vercel Sandbox path exists in code but is unenrolled in the assessed config | `parseVercelSandboxEnrollment` disables it when `VERCEL_SANDBOX_ORG_IDS` is empty and `wrangler.jsonc` sets it to `""`; only the enrollment question remains open | cloud@3de933dd `services/cloud-agent-next/src/agent-sandbox/vercel/vercel-runtime-config.ts:131-133`; `wrangler.jsonc:69,483`; `scripts/vercel-snapshot.ts` |
| `@kilocode/sdk` and `@kilocode/cli` must be the same version; divergence is a bug | Recorded as a release invariant. It holds on v1 (both `7.8.x`). v2 ships no `@kilocode/sdk` package yet, so #14426/#14427 must establish the v2 lockstep pair (Kilo SDK vs `@opencode-ai/sdk`) | PR #14758 review (eshurakov); `origin/main:packages/sdk/js/package.json` (`@kilocode/sdk@7.8.3`); `kilo-v2:packages/sdk/package.json` (`@opencode-ai/sdk@1.18.4`) |

## Remaining unknowns

| Unknown | Needed to resolve | Who can answer |
|---|---|---|
| Cloud repo owners for each service | `CODEOWNERS` or owner contacts; none exist in the clone | cloud repo owners / maintainers |
| Exact currently deployed versions in dev and prod (repo pins may lag deployed images; floating consumers unverified) | Query the deployed workers/containers or read deploy artifacts | cloud repo owners / release operators |
| v2 release package name and dist-tag; whether v2 replaces `@kilocode/cli@latest` or ships under a separate name/channel | Release-channel decision for the v2 CLI | Kilo release owner / plan coordinator |
| EOL disposition and residual CLI exposure for Gastown/KiloClaw (e.g. KiloClaw's `@latest` self-upgrade reaching a v2 release) | Confirm no support obligation; decide whether to pin or disable the self-upgrade in EOL services | cloud repo owners |
| CLI↔session-ingest wire contract (session event/ingest payloads and `kilo import`) under v2 | Map the producer/consumer contract in #14426 against the v2 CLI | session-ingest owner / v2 CLI owner |
| Whether the Vercel Sandbox path is enrolled in any environment (code exists but `VERCEL_SANDBOX_ORG_IDS` is empty in the assessed `wrangler.jsonc`) | Confirm dev/prod enrollment; if unused, mark the package-time Vercel install inactive | cloud-agent-next owner |
| Other repositories or deployment configs (secrets, separate infra) outside the read-only clone that consume the runtime | Full org-level inventory | cloud repo owners |

## Proposed progress-plan row changes (for N7; do not apply here)

File: `migration-tracking/plans/kilo-opencode-v2-plan-progress.md`, section
"Remote, sharing and distribution".

1. Add a row:
   `| Cloud agent runtime consumers (hosted) | Kilo CLI / Gateway | 4, 6 | Partial | Evidence recorded; contract mapping pending #14426 | Four consumers: cloud-agent-next pinned (independent cutover) and a confirmed v2 adaptation (v1/v2 API differs); auto-routing-benchmark and the MCP catalog CI float on @kilocode/cli latest (G1); session-ingest is contract-coupled (G1). Gastown and KiloClaw EOL, out of scope (owner disposition, PR #14758). Indirect callers (incl. webhook-agent-ingest) need no gate. See technical-notes/baseline/cloud-agent-consumers.md. |`
2. Amend the existing `Cloud CLI client` row's remaining scope to point at the
   inventory and state that local `kilo cloud` fixtures do not establish
   cloud-hosted consumer compatibility.
3. Link this baseline document from the #14023 subissue list area so the epic's
   evidence is one hop from the plan.
4. Do not add v2 rows for the EOL consumers (Gastown, KiloClaw). Record them as
   product-decision removals and reference the cloud removal issue(s) once
   created (see "EOL removal signal").

Evidence links for the epic: #14425 (this discovery), #14426 (contracts),
#14427 (adaptation), #14428 (validation).
