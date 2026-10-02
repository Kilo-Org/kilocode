# Cloud agent consumers — inventory and migration scope

Discovery for Kilo-Org/kilocode#14425 (parent epic #14023). Discovery only: no
source changes in any repository.

## Header

| Item | Value |
|---|---|
| Date | 2026-10-02 |
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

Already tracked elsewhere, not re-assessed here: the `kilo cloud` CLI client
(`origin/main:packages/opencode/src/kilocode/cloud/` and
`packages/kilo-cli/src/cloud/`); the `/remote` relay contract consumed by
`cloud-agent-sdk` (#14019); the VS Code Agent Manager (#14016).

## Inventory

Scope is **proposed, pending approval by the cloud repo's owners** (no
`CODEOWNERS` exists in the clone; all owners are recorded as `unassigned`).

| Consumer | Repo + path | Owner | Kilo dependency | How obtained and pinned | Deployed runtime | Update / rollout | In scope? | Rationale | Recommended gate | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| cloud-agent-next (hosted cloud agent; all `agent_*`/`workspace_*` sessions, incl. PR-review/auto-fix bot sandboxes) | `Kilo-Org/cloud` `services/cloud-agent-next/` | unassigned | Binary + SDK + HTTP: wrapper spawns `kilo serve` and imports `@kilocode/sdk` and `@kilocode/sdk/v2` | `@kilocode/cli@7.8.1` npm-global in sandbox image (Dockerfile `ARG KILOCODE_CLI_VERSION`); `KILOCODE_CLI_VERSION` in `wrangler.jsonc` `image_vars`/`build_vars` for every container class; `@kilocode/sdk@7.8.1` in `package.json` and `wrapper/package.json`; single source `src/shared/kilo-cli-version.ts` | 7.8.1 | Bump `KILO_CLI_VERSION` + manifests; `wrangler deploy` rebuilds Cloudflare Containers (changed-worker matrix in `deploy-workers.yml`; `deploy-production.yml`/`deploy-staging.yml`); `rollout_active_grace_period 1800` | yes | Primary hosted runtime; embeds the v1 CLI server + SDK; every hosted agent flow executes here | G1 for adaptation; independent cutover (pinned, own go/no-go) | cloud@3de933dd `services/cloud-agent-next/Dockerfile:6,64`; `src/shared/kilo-cli-version.ts:1`; `wrangler.jsonc:182,277`; `wrapper/package.json:11`; `wrapper/src/control-plane/kilo-runtime.ts:184`; `wrapper/src/control/worktree-runtime.ts:379` |
| auto-routing-benchmark (decider benchmark runner) | `services/auto-routing-benchmark/container/` | unassigned | Binary: spawns `kilo run --format json` | `npm install -g @kilocode/cli@latest` resolved at image build; no version pin | latest at last image build (7.8.x as of the assessed SHA; exact build unverified) | `wrangler deploy` builds/pushes the container image; each deploy re-pins to that day's `latest` | yes | Floats on `@kilocode/cli@latest`, so a v2 `latest` reaches it automatically | G1 | cloud@3de933dd `services/auto-routing-benchmark/container/Dockerfile:12`; `container/server.mjs:64`; `wrangler.jsonc:32-39` |
| Gastown (agent orchestration via Durable Objects + container) | `services/gastown/container/` | unassigned | Binary + SDK: spawns `kilo serve` via `createKilo()`; ships `@kilocode/plugin` for plugin discovery | `@kilocode/cli@7.2.14` (+ `cli-linux-x64`, `cli-linux-x64-musl`, `@kilocode/plugin@7.2.14`) in Dockerfile; `@kilocode/sdk@7.2.14`, `@kilocode/plugin@7.2.52` in `container/package.json` | 7.2.14 | `pnpm --filter cloudflare-gastown deploy:prod` → `container:prepare` + container build + `wrangler deploy`; `max_instances 500` | yes | Hosted agent runner embedding the v1 CLI server; pinned, so migrates on its own bump | G1 for adaptation; independent cutover (pinned, own go/no-go) | cloud@3de933dd `services/gastown/container/Dockerfile:80-81`; `container/package.json:15-16`; `container/src/process-manager.ts:9,664` |
| KiloClaw (per-user OpenClaw runtimes on Fly.io) | `services/kiloclaw/` | unassigned | Binary: ships `@kilocode/cli` in the Fly image and spawns `kilo run --auto`; controller also configures the `kilo` provider | Baked `@kilocode/cli@7.2.31` in Dockerfile; controller runs background `npm install -g @kilocode/cli@latest` 3h after boot when `KILOCLAW_KILO_CLI=true` | baked 7.2.31, then per-instance self-upgrade to `latest` | `deploy-kiloclaw.yml` builds/pushes the Fly image; each machine self-upgrades at runtime | yes (cloud-side runtime; the plan's "KiloClaw not needed" applies to the client, not this service) | Executes the CLI and runtime-floats to `@latest`, so a v2 `latest` reaches machines without an image rebuild | G1 | cloud@3de933dd `services/kiloclaw/Dockerfile:93`; `controller/src/index.ts:638-646`; `controller/src/routes/kilo-cli-run.ts:120,159`; `docs/instance-features.md:29` |
| MCP catalog generator (CI) | `.github/workflows/kilo-mcp-catalog.yml` + `apps/web/src/scripts/mcp-catalog/catalog.ts` | unassigned | Binary: `kilo run --model … --variant … --format json` | `npm install -g @kilocode/cli` (unpinned) inside the workflow | workflow-run `latest` | Runs on every PR and main push; a required `catalog (PR)` check | yes (CI consumer executing the runtime) | Floats on `@latest`; generates summaries used by `services/kilo-mcp` | G1 | cloud@3de933dd `.github/workflows/kilo-mcp-catalog.yml:115,371`; `apps/web/src/scripts/mcp-catalog/catalog.ts:714,722` |
| code-review-infra | `services/code-review-infra/` | unassigned | HTTP only: calls cloud-agent-next `prepareSession`/`initiate` and `interruptSession` | n/a (no Kilo package) | n/a | n/a | no | Indirect caller: no runtime embed; cloud-agent-next owns execution and the response contract | n/a | cloud@3de933dd `services/code-review-infra/src/code-review-orchestrator.ts:1243,1262` |
| auto-fix-infra | `services/auto-fix-infra/` | unassigned | HTTP only: calls cloud-agent-next prepare/initiate | n/a | n/a | n/a | no | Same as code-review-infra | n/a | cloud@3de933dd `services/auto-fix-infra/src/fix-orchestrator.ts:259,270` |
| auto-triage-infra | `services/auto-triage-infra/` | unassigned | HTTP only: calls cloud-agent-next prepare/initiate + callback | n/a | n/a | n/a | no | Same as code-review-infra | n/a | cloud@3de933dd `services/auto-triage-infra/src/triage-orchestrator.ts:378,387` |
| security-auto-analysis (remediation) | `services/security-auto-analysis/` | unassigned | HTTP only: calls cloud-agent-next `prepareSession`/`interruptSession` | n/a | n/a | n/a | no | Same as code-review-infra | n/a | cloud@3de933dd `services/security-auto-analysis/src/remediation.ts:1202,1091` |
| app-builder | `services/app-builder/` | unassigned | None: `cloudflare/sandbox` for app preview/build | n/a | n/a | n/a | no | Sandbox product with no Kilo CLI/SDK/server usage | n/a | cloud@3de933dd `services/app-builder/Dockerfile:1-2` |
| cloud-agent-sdk + web/mobile clients | `packages/cloud-agent-sdk/`, `apps/web`, `apps/mobile` | unassigned | HTTP/relay only: consumes cloud-agent-next tRPC and the `/remote` relay | n/a | n/a | n/a | no | Client-side SDK, already tracked in #14019 | n/a | cloud@3de933dd `packages/cloud-agent-sdk/src/cli-live-transport.ts:1-4`; `packages/cloud-agent-sdk/package.json:5` |
| session-ingest | `services/session-ingest/` | unassigned | None: receives CLI session events and backs `kilo import` | n/a | n/a | n/a | no | Adjacent service dependency of cloud-agent-next cold start, not a runtime consumer | n/a | cloud@3de933dd `services/session-ingest/src/remote-session-notifications.ts:82`; `services/cloud-agent-next/src/kilo/client.ts:112` |
| kilo-ops, wasteland, mcp-gateway, images-mcp, kilo-mcp | `services/<name>/` | unassigned | None | n/a | n/a | n/a | no | No Kilo CLI/SDK/server spawn or image inclusion found | n/a | — |

## Proposed migration scope

**Proposed, pending approval by the cloud repo's owners.**

### In scope

- **cloud-agent-next** — the central hosted runtime. It embeds the v1 CLI server
  and `@kilocode/sdk`, and it is the execution path for hosted sessions and the
  PR-review/auto-fix/auto-triage/security bot flows. Pinned to `7.8.1`, so it
  cuts over on its own pin bump after G1 stabilises the v2 CLI/SDK/server
  contract.
- **Gastown** — second hosted runtime embedding the v1 CLI server, pinned to
  `7.2.14`.
- **KiloClaw** — ships and executes the `kilo` CLI in each Fly machine, and
  self-upgrades to `@kilocode/cli@latest` at runtime.
- **auto-routing-benchmark** — executes `kilo run` from a container image built
  against `@kilocode/cli@latest`.
- **MCP catalog generator (CI)** — executes `kilo run` with an unpinned
  `@kilocode/cli` install.

All five consume the **CLI/headless runtime surface**, not the VS Code or
JetBrains surfaces. **Recommended placement: #14427 and #14428 belong to G1.**
The shared adaptation work is the v2 CLI/server/SDK contract; the floating
consumers must be ready or protected before v2 is published to the `latest`
channel they track. The pinned consumers (cloud-agent-next, Gastown) contribute
cross-repo dependencies to #14427 but perform their own cutover under their own
go/no-go, exactly like JetBrains.

### Out of scope

- **code-review-infra, auto-fix-infra, auto-triage-infra, security-auto-analysis**
  — orchestration callers of cloud-agent-next's tRPC API. They embed no Kilo
  runtime; any cloud-agent-next response-shape change is covered by
  cloud-agent-next's G1 work. No separate gate.
- **app-builder** — sandbox app host with no Kilo runtime.
- **cloud-agent-sdk, web, mobile** — client consumers of cloud-agent-next and
  the `/remote` relay; tracked in #14019.
- **session-ingest** — adjacent session-event/import dependency of
  cloud-agent-next; not an execution consumer.
- **VS Code extension / Agent Manager** — tracked in #14016.
- **kilo-ops, wasteland, mcp-gateway, images-mcp, kilo-mcp** — no runtime
  embedding found.
- The **`kilo cloud` CLI client** in this repo — tracked separately.

## Remaining unknowns

| Unknown | Needed to resolve | Who can answer |
|---|---|---|
| Cloud repo owners for each service | `CODEOWNERS` or owner contacts; none exist in the clone | cloud repo owners / maintainers |
| Exact currently deployed versions in dev and prod (repo pins may lag deployed images; floating consumers unverified) | Query the deployed workers/containers or read deploy artifacts | cloud repo owners / release operators |
| v2 release package name and dist-tag; whether v2 replaces `@kilocode/cli@latest` or ships under a separate name/channel | Release-channel decision for the v2 CLI | Kilo release owner / plan coordinator |
| Whether v2 keeps the `kilo serve` HTTP API and `@kilocode/sdk` surface compatible (cloud-agent-next imports `@kilocode/sdk/v2`) | v2 SDK/server contract from #14426 | v2 core/server owner |
| Per-instance KiloClaw CLI versions and whether `KILOCLAW_KILO_CLI` / `kilo-cli` is enabled for users | Admin query of instances and feature flags | KiloClaw owner |
| Whether every cloud-agent-next container class rebuilds from the same repo SHA (Vercel Sandbox snapshot path installs the same pin separately) | Deploy configuration audit | cloud-agent-next owner |
| Whether `@kilocode/sdk` is versioned in lockstep with `@kilocode/cli` (both `7.8.1` here) or follows its own release train | SDK release policy | v2 SDK owner |
| Other repositories or deployment configs (secrets, separate infra) outside the read-only clone that consume the runtime | Full org-level inventory | cloud repo owners |

## Proposed progress-plan row changes (for N7; do not apply here)

File: `migration-tracking/plans/kilo-opencode-v2-plan-progress.md`, section
"Remote, sharing and distribution".

1. Add a row:
   `| Cloud agent runtime consumers (hosted) | Kilo CLI / Gateway | 4, 6 | Partial | Evidence recorded; contract mapping pending #14426 | Five consumers: cloud-agent-next and Gastown pinned (independent cutover); KiloClaw, auto-routing-benchmark and the MCP catalog CI float on @kilocode/cli latest (G1). See technical-notes/baseline/cloud-agent-consumers.md. |`
2. Amend the existing `Cloud CLI client` row's remaining scope to point at the
   inventory and state that local `kilo cloud` fixtures do not establish
   cloud-hosted consumer compatibility.
3. Link this baseline document from the #14023 subissue list area so the epic's
   evidence is one hop from the plan.

Evidence links for the epic: #14425 (this discovery), #14426 (contracts),
#14427 (adaptation), #14428 (validation).
