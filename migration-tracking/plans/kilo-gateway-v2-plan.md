# Kilo Gateway v2 Implementation Plan (#14991)

- **Issue:** [#14991](https://github.com/Kilo-Org/kilocode/issues/14991) (Part of [#13750](https://github.com/Kilo-Org/kilocode/issues/13750))
- **Plan units:** `U-E1-03` (Gateway auth, profile, teams, Pass, errors, tRPC), `U-E1-04` (Gateway provider, catalog authority, routed Auto model), plus server-side client contracts for `U-E1-08` and `U-E6-08` (FIM/edit).
- **Follow-up issues pulled out:**
  - [#15108](https://github.com/Kilo-Org/kilocode/issues/15108) (`U-E1-05`): Support backend `opencode.family` and prompt overrides for aliased Gateway models (`kilo-auto/frontier`, etc.) in v2 prompt selection.
  - [#15059](https://github.com/Kilo-Org/kilocode/issues/15059): Evaluate and align Kilo v2 single-process multi-location service and live config hot-reload across all clients.
- **Target branch:** `origin/v2`

---

## 1. Architecture Decision and Rationale

We evaluated five structural options and two transport options against upstream git history (`upstream/dev` and `origin/v2`), Kilo v1 history (`origin/main`), the archived v2 port (`kilo-v2-checkpoints-2026-09`), PR [#14998](https://github.com/Kilo-Org/kilocode/pull/14998), and the deployed Gateway backend contract.

### Selected Architecture: **Option 5 (Port v1 `packages/kilo-gateway` logic into `packages/kilo-gateway-core` + Thin v2 `KiloGatewayPlugin` Adapter)**

#### Why this wins over the alternatives

1. **Reuses battle-tested v1 Gateway domain logic**:
   - On `origin/main`, `packages/kilo-gateway` has 42 source files (5,270 lines) and 16 test files (2,216 lines) shaped by 234 commits against the production Gateway.
   - **37 of those 42 files (4,755 lines) and 12 test suites have zero OpenCode dependencies**, covering model catalog fetching (`api/models.ts`), profile/balance/defaults (`api/profile.ts`), Kilo Pass (`api/kilo-pass.ts`), team modes (`api/modes.ts`), notifications (`api/notifications.ts`), tRPC (`api/trpc.ts`), speech-to-text/transcription (`fetchKiloTranscriptionModels`, `/audio/transcriptions`), image models (`fetchKiloImageModels`), FIM/edit (`fim.ts`, `edit.ts`, `autocomplete.ts`, `mistral-fim-endpoint.ts`), headers (`headers.ts`), and request body transforms (`responses.ts`).

2. **Why we keep a separate package (`packages/kilo-gateway-core`) instead of putting everything inside `packages/core/src/kilocode/`**:
   - Root `package.json` runs `lint:effect-patterns` (strict ast-grep rules: `no-json-parse-cast`, `no-star-import`, `no-import-alias`) across `packages/util/src`, `packages/core/src`, `packages/server/src`, `packages/protocol/src`, and `packages/cli/src`.
   - A separate `packages/kilo-gateway-core` package is exempt from the Effect ast-grep scan, is 100% Kilo-owned (`packages/kilo-*/**` in `script/upstream/utils/owned.ts`), enforces the [#14991](https://github.com/Kilo-Org/kilocode/issues/14991) boundary (`test/boundary.test.ts`: zero `@opencode` imports), and passes `packages/sdk/script/verify-package.ts` with a 1-line entry.

3. **Why we replace upstream `KiloPlugin` via 1 line in `provider.ts` instead of patching `kilo.ts` or copying `opencode.ts`**:
   - Upstream's `packages/core/src/plugin/provider/kilo.ts` is only 17 lines that stamp `HTTP-Referer: https://opencode.ai/` and `X-Title: opencode`. It has no Gateway logic to reuse, changed 14 times upstream, and caused **13 merge conflicts** on `main` when patched inline.
   - Upstream's `packages/core/src/plugin/provider/opencode.ts` ("cassette copy" option) is 660 lines coupled to 13 internal Core modules that changed **61 times in 5 months** (every ~2.4 days). Copying it creates high sync debt for Console features (SSO, Console MCP, WebSearch) that Kilo does not use.
   - Leaving upstream `kilo.ts` untouched and swapping 1 registration line in `packages/core/src/plugin/provider.ts` (`KiloGatewayPlugin` instead of `KiloPlugin`) keeps the shared-file footprint minimal.

4. **Dialect Routing, Request/Response Hooks & SSE Stream Metadata (Zero External `@ai-sdk/*` Dependencies Needed)**:
   - Each Gateway model selects its native `@opencode/ai` dialect package (`@opencode/ai/providers/openrouter`, `anthropic`, `openai`, or `openai-compatible`) from `opencode.ai_sdk_provider`.
   - `KiloGatewayPlugin` registers `ctx.session.hook("model.request" | "http.request" | "http.response", ..., { providerID: "kilo" })` to:
     - Inject per-request `X-KILOCODE-*` headers and `User-Agent` (`model.request`).
     - Promote `x-api-key` to `Authorization: Bearer <key>` on Anthropic `/messages`, strip leaked credential metadata keys (`server`, `organizationID`, `email`) from JSON bodies, strip `item_reference` and `id` on stateless `/responses` requests, and inject `provider.data_collection` (`http.request`).
     - Rewrite non-2xx Gateway HTTP errors and wrap 200 SSE streams (`KiloStream.transformResponse`) to extract `routedModelID` (`provider_metadata.gateway.routing.modelAttempts`, `canonicalSlug`, or response `model`) and `x-vercel-id`, stamp `routedModelID` onto SSE `usage`, and normalize mid-stream SSE error frames (`http.response`).
   - This avoids bundling four external `@ai-sdk/*` packages into `packages/kilo-gateway-core` and adds zero shared upstream file patches in PRs 2, 3, and 4.

5. **System Prompt Selection & Variants/Efforts**:
   - **Prompt selection ([#15108](https://github.com/Kilo-Org/kilocode/issues/15108))**: OpenCode v2 replaced v1's 15 static prompt files with a unified `system.txt` (`SessionSystemPrompt`) plus `OptimizePlugin` (`packages/core/src/plugin/optimize.ts`). We dropped v1's obsolete 8-literal `Prompt` enum (`"codex"`, `"beast"`, `"ling"`, etc.) from `models.ts`, mapped `opencode.family` onto `Model.Info.family`, and tracked backend `opencode.family` / prompt override support for aliased models (`kilo-auto/frontier`) in [#15108](https://github.com/Kilo-Org/kilocode/issues/15108) (`U-E1-05`).
   - **Reasoning variants and efforts**: Gateway models support v2's `Variant.resolve` (which consumes `reasoning_options` when provided by the Gateway backend) and `opencode.variants` (with dialect-specific translation per `provider-options.ts` when needed).

---

## 2. Options Comparison Matrix

| Option | Shared Upstream Patches | Upstream Sync Churn | New Code to Write | Full Authority? | Verdict |
|---|---|---|---|---|---|
| **A. Patch `kilo.ts` inline** | 1 file (`kilo.ts`, 6 blocks) | High (14 upstream commits; 13 conflicts on `main`) | Low (if backed by pkg) | Yes | Rejected: unnecessary conflicts on `kilo.ts` |
| **B. "Cassette copy" `opencode.ts`** | 1 file (`provider.ts`) | Very High (660 LOC, 61 commits / 5 mo, 13 internal deps) | High | Partial | Rejected: worst maintenance burden |
| **C. Package-only (v1 core patches)** | 8+ core files (81 files / 649 markers on `main`) | Extreme (`internal.ts` 76 commits, `aisdk.ts` 62) | Medium | Yes | Rejected: violates v2 plugin-first policy |
| **D. Rewrite all in Effect from scratch** | 6 files | Low | ~5,000 lines + 16 test suites | Yes | Rejected: too slow, high regression risk |
| **E / Option 5. Port v1 `kilo-gateway` logic into `kilo-gateway-core` + Thin v2 Plugin Adapter (CHOSEN)** | Minimal seams in PR 1 only (0 in PRs 2-4) | Lowest (`kilo.ts` untouched; `kilo-gateway-core` 100% Kilo-owned) | ~300 lines of v2 adapter glue | **Yes (100%)** | **Selected** |

---

## 3. Four Independently Testable Stacked PRs

Each PR is small, self-contained, and **manually testable on its own** in `bun dev`.

### PR 1 ([#15064](https://github.com/Kilo-Org/kilocode/pull/15064)): Login, Account/Team Selection & Provider Attribution (`gateway-login-v2`)
- **Supersedes:** PR [#14998](https://github.com/Kilo-Org/kilocode/pull/14998), rebased on current `origin/v2`.
- **What it includes:**
  - `packages/kilo-gateway-core`: server and AI Gateway URL resolution (`KILO_AI_GATEWAY_URL`, default `https://ai-gateway.kilo.ai/api/v1`, `${KILO_API_URL}/api/gateway/v1` fallback when only `KILO_API_URL` is set, and legacy `${server}/api/gateway` for custom/token-embedded servers), device OAuth (`POST /api/device-auth/codes`, polling `GET /api/device-auth/codes/{code}` with retry/backoff and timeout), `/api/profile`, default team rule (`selectedOrganizationId` else first team when `hasPersonalAccount === false`), account resolution with env precedence (`KILO_API_KEY` / `KILOCODE_TOKEN` / `KILO_AUTH_CONTENT` > stored credential; `KILO_ORG_ID` > stored team > login default), provider headers (`HTTP-Referer: https://kilocode.ai`, `X-Title: Kilo Code`, `X-KILOCODE-EDITORNAME`, `X-KILOCODE-FEATURE`, `X-KILOCODE-ORGANIZATIONID`), and `test/boundary.test.ts`.
  - `packages/core/src/kilocode/gateway.ts` & `gateway-rpc.ts`: `kilocode.gateway` plugin replacing `KiloPlugin` in `packages/core/src/plugin/provider.ts`; `device` OAuth method; signed-out `anonymous` key activation; `profile` and `organization.set` RPCs.
  - `packages/tui/src/kilocode/gateway.tsx`: Post-login `Select Account (<email>)` picker and `/teams` (`team`, `org`, `orgs`) slash command.
  - `script/dev-isolated.ts`: Remove v1 `~/.local/share/kilo/auth.json` token reuse.
  - `script/upstream/shared-patches.json`: Add entries and update limits for the touched shared files so `bun script/check-shared-patches.ts` and `bun script/check-opencode-annotations.ts` pass in CI.
- **Manual test (standalone):**
  - Run `bun dev` signed out: free model (`kilo/kilo-auto/free`) answers; paid model returns `"You need to sign in to use this model."`
  - Run `/connect` -> `Kilo Gateway (Device Authorization)`: shows verification URL and code; after login opens `Select Account (<email>)` picker; `/teams` switches active team and updates `X-KILOCODE-ORGANIZATIONID`.

### PR 2 ([#15065](https://github.com/Kilo-Org/kilocode/pull/15065)): Catalog Authority, Variants/Efforts, Team Fail-Closed & Defaults (`gateway-catalog`, stacked on PR 1)
- **What it includes:**
  - `KiloModels` (`src/models.ts`) and `KiloDefaults` (`src/defaults.ts`) in `packages/kilo-gateway-core`.
  - Map Gateway models onto v2 `Model.Info` and replace the `kilo` catalog via `editor.add` (`models.set`):
    - **Signed in (personal):** `GET ${aiGatewayBase}/models` (with 401 anonymous retry when `!organizationID`); on failure keep last good personal list (persisted in plugin storage keyed on the resolved gateway base; never `models.dev`).
    - **Signed in (team):** `GET ${aiGatewayBase}/organizations/{id}/models`; on failure **fail closed** (`models: []`, sentinel `sourceConnection`, and `model.transform` disable guard so `ConfigProviderPlugin` in `post` cannot re-enable static models).
    - **Signed out (anonymous):** filter Gateway catalog to `isFree === true`; on failure keep last good anonymous free list (never `models.dev`).
    - **Reasoning variants and efforts:** resolve variants via `Variant.resolve` (consuming `reasoning_options` when present) and map `opencode.variants` (with dialect-specific translation per `provider-options.ts` when needed).
  - Unbounded exponential backoff retry (`30 * 2^min(attempt, 4)` capped at 300s, honoring `Retry-After` and retrying empty catalogs, matching v1 `catalog-recovery.ts`) + refresh on login, logout, `credential.switched`, `organization.set`, and 5-minute timer.
  - Apply `/api/defaults` and `/api/organizations/{id}/defaults` (falling back to the first team catalog model when team defaults are unset) and map `kilo-auto/small` for `Model.small("kilo")`.
  - Expose `models` metadata RPC (`isFree`, `recommendedIndex`, `hasUserByokAvailable`, `mayTrainOnYourPrompts`, `autoRouting`, `terminalBench`, `description`, `reasoning`, `family`, `aiSDKProvider`).
- **Manual test (standalone):**
  - Open model picker (`Ctrl+X` then `M`, search `free`) signed out: only Gateway free models appear (no paid `models.dev` models).
  - Sign in and switch teams via `/teams`: model picker updates live to the personal or team catalog from the Gateway.

### PR 3 ([#15067](https://github.com/Kilo-Org/kilocode/pull/15067)): Per-Request Headers, Body Sanitization, Routed Model & Error Contract (`gateway-requests-errors`, stacked on PR 2)
- **What it includes:**
  - `KiloHeaders.request` (`src/headers.ts`), `KiloProject` (`src/project.ts`), `KiloMachine` (`src/machine.ts`), `KiloRequests` (`src/requests.ts`), `KiloErrors` (`src/errors.ts`), and `KiloStream` (`src/stream.ts`) in `packages/kilo-gateway-core`.
  - Wire per-request headers via `ctx.session.hook("model.request", ..., { providerID: "kilo" })`: `X-KILOCODE-TASKID` (`sessionID`), `X-KILOCODE-PARENT-TASKID`, `X-KILOCODE-PROJECTID`, `X-KILOCODE-MACHINEID`, `x-kilocode-mode` (lowercased), `X-KILOCODE-TESTER: SUPPRESS`, and `User-Agent: opencode-kilo-provider/<version>`.
  - Wire request body and auth normalization via `ctx.session.hook("http.request", ..., { providerID: "kilo" })`: promote `x-api-key` to `Authorization: Bearer <key>` on `/messages`, strip leaked credential metadata keys (`server`, `organizationID`, `email`, etc.) from JSON bodies, strip `item_reference` and `id` on stateless `/responses` requests, and inject `provider.data_collection`.
  - Wire error contract and SSE stream metadata via `ctx.session.hook("http.response", ..., { providerID: "kilo" })`: handle both Gateway error envelopes (`error.code` and `error_type`) for `PAID_MODEL_AUTH_REQUIRED`, `PROMOTION_MODEL_LIMIT_REACHED`, 402 `usage_limit_exceeded` (with balance and `buyCreditsUrl`), `top_up_in_progress`, `model_not_allowed`, `provider_not_allowed`, `data_collection_required`, `upgrade_required`, and `rate_limit_exceeded`; extract `routedModelID` and `x-vercel-id` on 200 SSE streams and expose `session.metadata` RPC.
- **Manual test (standalone):**
  - Prompt `kilo/kilo-auto/free` and a paid model (`kilo/deepseek/deepseek-v4.1-flash`): verify `routedModelID` metadata and full `X-KILOCODE-*` request headers, and trigger Gateway error codes to verify actionable error messages in the TUI.

### PR 4 ([#15072](https://github.com/Kilo-Org/kilocode/pull/15072)): Enterprise Account, Modes, Notifications, Media & FIM RPCs (`gateway-account-rpc`, stacked on PR 3)
- **What it includes:**
  - `KiloProfile.balance` (`src/profile.ts`), `KiloTrpc` (`src/trpc.ts`: `kiloPass`, `byokEntries`, `codingPlanSubscriptions`, `codingPlanUsage`), `KiloModes` (`src/modes.ts`), `KiloNotifications` (`src/notifications.ts`), `KiloModels.imageModels` & `transcriptionModels` (`src/models.ts`), and `KiloAutocomplete` (`src/autocomplete.ts`: `resolveFimTarget`, `resolveEditTarget`, `extractFencedBody`, `requestMistralFim`) in `packages/kilo-gateway-core`.
  - Extend `KiloGatewayRpc` with `authStatus`, `balance`, `kiloPass`, `byok`, `codingPlans`, `codingPlanUsage`, `modes`, `notifications` (`/api/users/notifications`), `models.images`, `models.transcriptions` (`${aiGatewayBase}/transcription-models`), `autocomplete.fimTarget` (`${aiGatewayBase}/fim/completions`), and `autocomplete.editTarget` (`${aiGatewayBase}/edit/completions`).
  - Add `/kilo-account` (aliases `/balance`, `/kilo-pass`) command in `packages/tui/src/kilocode/gateway.tsx`.
- **Manual test (standalone):**
  - Run `/kilo-account` (`/balance`) in the TUI signed out and signed in to verify account email, personal/team scope, credit balance, Kilo Pass usage, and organization custom modes.
