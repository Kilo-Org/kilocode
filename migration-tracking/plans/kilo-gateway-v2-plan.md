# Kilo Gateway v2 Implementation Plan (#14991)

- **Issue:** [#14991](https://github.com/Kilo-Org/kilocode/issues/14991) (Part of [#13750](https://github.com/Kilo-Org/kilocode/issues/13750))
- **Plan units:** `U-E1-03` (Gateway auth, profile, teams, Pass, errors, tRPC), `U-E1-04` (Gateway provider, catalog authority, routed Auto model), plus server-side client contracts for `U-E1-08` and `U-E6-08` (FIM/edit).
- **Target branch:** `origin/v2`

---

## 1. Architecture Decision and Rationale

We evaluated five structural options and two transport options against upstream git history (`upstream/dev` and `origin/v2`), Kilo v1 history (`origin/main`), the archived v2 port (`kilo-v2-checkpoints-2026-09`), PR [#14998](https://github.com/Kilo-Org/kilocode/pull/14998), and the deployed Gateway backend contract.

### Selected Architecture: **Option 5 (Port v1 `packages/kilo-gateway` into `packages/kilo-gateway-core` + Thin v2 `KiloGatewayPlugin` Adapter)** with **Transport Option 1 (Vercel AI SDK `createKilo` via `ctx.aisdk.hook("sdk")`)**

#### Why this wins over the alternatives

1. **80% less new code to write (reuses battle-tested v1 code)**:
   - On `origin/main`, `packages/kilo-gateway` has 42 source files (5,270 lines) and 16 test files (2,216 lines) shaped by 234 commits against the production Gateway.
   - **37 of those 42 files (4,755 lines) and 12 test suites have zero OpenCode dependencies** (pure TypeScript + `fetch` + `zod`), covering model catalog fetching (`api/models.ts`), profile/balance/defaults (`api/profile.ts`), Kilo Pass (`api/kilo-pass.ts`), team modes (`api/modes.ts`), notifications (`api/notifications.ts`), tRPC (`api/trpc.ts`), speech-to-text/transcription (`fetchKiloTranscriptionModels`, `/api/gateway/v1/audio/transcriptions`), image models (`fetchKiloImageModels`), FIM/edit (`fim.ts`, `edit.ts`, `autocomplete.ts`, `mistral-fim-endpoint.ts`), headers (`headers.ts`), and request body transforms (`responses.ts`).
   - Rewriting all of those in Effect from scratch (the trajectory started in PR [#14998](https://github.com/Kilo-Org/kilocode/pull/14998)) only covered ~20% of the surface and would require rewriting ~4,500 lines and 12 test suites with high wire-regression risk.

2. **Why we keep a separate package (`packages/kilo-gateway-core`) instead of putting everything inside `packages/core/src/kilocode/`**:
   - Root `package.json` runs `lint:effect-patterns` (strict ast-grep rules: `no-json-parse-cast`, `no-star-import`, `no-import-alias`) across `packages/util/src`, `packages/core/src`, `packages/server/src`, `packages/protocol/src`, and `packages/cli/src`. Porting v1's `zod` + `fetch` modules into `packages/core/src/kilocode/` trips those lint rules across dozens of files.
   - A separate `packages/kilo-gateway-core` package is exempt from the Effect ast-grep scan, is 100% Kilo-owned (`packages/kilo-*/**` in `script/upstream/utils/owned.ts`), enforces the [#14991](https://github.com/Kilo-Org/kilocode/issues/14991) boundary (`test/boundary.test.ts`: zero `@opencode` imports), and passes `packages/sdk/script/verify-package.ts` with a 1-line entry.

3. **Why we replace upstream `KiloPlugin` via 1 line in `provider.ts` instead of patching `kilo.ts` or copying `opencode.ts`**:
   - Upstream's `packages/core/src/plugin/provider/kilo.ts` is only 17 lines that stamp `HTTP-Referer: https://opencode.ai/` and `X-Title: opencode`. It has no Gateway logic to reuse, changed 14 times upstream, and caused **13 merge conflicts** on `main` when patched inline.
   - Upstream's `packages/core/src/plugin/provider/opencode.ts` ("cassette copy" option) is 660 lines coupled to 13 internal Core modules that changed **61 times in 5 months** (every ~2.4 days). Copying it creates high sync debt for Console features (SSO, Console MCP, WebSearch) that Kilo does not use.
   - Leaving upstream `kilo.ts` untouched and swapping 1 registration line in `packages/core/src/plugin/provider.ts` (`KiloGatewayPlugin` instead of `KiloPlugin`) keeps the shared-file footprint minimal.

4. **Why we use Vercel AI SDK (`createKilo` via `ctx.aisdk.hook("sdk")`) instead of OpenCode's `@opencode/ai` routes**:
   - OpenCode v2 still supports `aisdk:*` and `ctx.aisdk.hook("sdk")` / `ctx.aisdk.hook("language")` (used by `github-copilot.ts`), and `AISDK.modelFromLanguage` (`packages/core/src/aisdk.ts:412-413, 722-747`) runs both `StreamOptions.http` middleware and custom `options.fetch`.
   - However, `AISDKNative.PACKAGES` (`packages/core/src/aisdk-native.ts:59-80`) rewrites standard specifiers (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@openrouter/ai-sdk-provider`) to OpenCode's native `@opencode/ai/providers/*`, which **drops `GatewayMetadata.wrap` (`provider_metadata.gateway.routing` and gateway usage used for `routedModelID`)**.
   - By setting `package: "aisdk:@kilocode/gateway-core"` (which is not in `AISDKNative.PACKAGES`) and hooking `ctx.aisdk.hook("sdk")` + `ctx.aisdk.hook("language")` to v1's `createKilo`, we keep the **exact Vercel AI SDK providers**, `wrappedFetch` (`buildKiloHeaders`, `Bearer` auth, `transformRequestBody` for `data_collection` and `/responses` item stripping), and `GatewayMetadata.wrap` that the deployed Gateway backend is tested against.

---

## 2. Options Comparison Matrix

| Option | Shared Upstream Patches | Upstream Sync Churn | New Code to Write | Full Authority? | Verdict |
|---|---|---|---|---|---|
| **A. Patch `kilo.ts` inline** | 1 file (`kilo.ts`, 6 blocks) | High (14 upstream commits; 13 conflicts on `main`) | Low (if backed by pkg) | Yes | Rejected: unnecessary conflicts on `kilo.ts` |
| **B. "Cassette copy" `opencode.ts`** | 1 file (`provider.ts`) | Very High (660 LOC, 61 commits / 5 mo, 13 internal deps) | High | Partial | Rejected: worst maintenance burden |
| **C. Package-only (v1 core patches)** | 8+ core files (81 files / 649 markers on `main`) | Extreme (`internal.ts` 76 commits, `aisdk.ts` 62) | Medium | Yes | Rejected: violates v2 plugin-first policy |
| **D. Rewrite all in Effect from scratch** | 6 files | Low | ~5,000 lines + 16 test suites | Yes | Rejected: too slow, high regression risk |
| **E / Option 5. Port v1 `kilo-gateway` into `kilo-gateway-core` + Thin v2 Plugin Adapter (CHOSEN)** | Minimal seams (tracked in `shared-patches.json`) | Lowest (`kilo.ts` untouched; `kilo-gateway-core` 100% Kilo-owned) | ~300 lines of v2 adapter glue (copies 4,755 tested v1 lines) | **Yes (100%)** | **Selected** |

---

## 3. Four Independently Testable Stacked PRs

Each PR is small, self-contained, and **manually testable on its own** in `bun dev`.

### PR 1: Login, Account/Team Selection & Provider Attribution (`gateway-login`)
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

### PR 2: Catalog Authority, Variants/Efforts, Team Fail-Closed & Defaults (`gateway-catalog`, stacked on PR 1)
- **What it includes:**
  - Copy `api/models.ts`, `api/constants.ts`, `api/url.ts`, and `fetchDefaultModel` (`api/profile.ts`) + unit tests from `origin/main:packages/kilo-gateway` into `packages/kilo-gateway-core`.
  - Map Gateway models onto v2 `Model.Info` and replace the `kilo` catalog via `providers.models.set("kilo", ...)` (`editor.add`):
    - **Signed in (personal):** `GET ${aiGatewayBase}/models` (with 401 anonymous retry when `!organizationID`); on failure keep last good personal list (persisted in plugin storage; never `models.dev`).
    - **Signed in (team):** `GET ${aiGatewayBase}/organizations/{id}/models`; on failure **fail closed** (`models: []`, sentinel `sourceConnection`, and `model.transform` disable guard so `ConfigProviderPlugin` in `post` cannot re-enable static models).
    - **Signed out (anonymous):** filter Gateway catalog to `isFree === true`; on failure keep last good anonymous free list (never `models.dev`).
    - **Reasoning variants and efforts:** pass Gateway `reasoning_options` (when provided by the backend) into v2's `Variant.resolve(base, supports)`, and translate legacy OpenRouter-shaped `opencode.variants` (`{ reasoning: { enabled, effort }, verbosity }`) into dialect-specific settings (`openrouter`, `anthropic`, `openai`, `openai-compatible`), matching v1 `packages/opencode/src/kilocode/provider-options.ts`.
  - Refresh on login, logout, `credential.switched`, `organization.set`, and periodic timer.
  - Apply `/api/defaults` and `/api/organizations/{id}/defaults` for default model and `kilo-auto/small` for small tasks (`Model.small`).
  - Expose `models` metadata RPC (`isFree`, `recommendedIndex`, `hasUserByokAvailable`, `mayTrainOnYourPrompts`, `autoRouting`, `terminalBench`).
- **Manual test (standalone):**
  - Open model picker (`Ctrl+X` then `M`) signed out: only Gateway free models appear (no paid `models.dev` models).
  - Sign in and switch teams via `/teams`: model picker updates live to the personal or team catalog from the Gateway.

### PR 3: Vercel AI SDK `createKilo`, Per-Request Headers & Error Contract (`gateway-requests-errors`, stacked on PR 2)
- **What it includes:**
  - Copy `provider.ts` (`createKilo`), `gateway-metadata.ts` (`GatewayMetadata.wrap` reading `provider_metadata.gateway.routing` and gateway usage), `responses.ts` (`provider.data_collection` + stateless `/responses` `item_reference`/`id` stripping), and `headers.ts` (`buildKiloHeaders`) from `origin/main:packages/kilo-gateway` into `packages/kilo-gateway-core`, plus pure error-contract parsing (`errors.ts` adapted from v1 `kilo-errors.ts` and `provider/error.ts` without `@opencode` imports).
  - Wire `createKilo` in `packages/core/src/kilocode/gateway.ts` via `ctx.aisdk.hook("sdk")` and `ctx.aisdk.hook("language")` (selecting `openrouter`, `anthropic`, `openai`, or `openai-compatible` per model's `opencode.ai_sdk_provider`), and persist `routedModelID` in `providerState`.
  - Wire per-request headers via `ctx.session.hook("model.request", ..., { providerID: "kilo" })`: `X-KILOCODE-TASKID` (`sessionID`), `X-KILOCODE-PARENT-TASKID`, `X-KILOCODE-PROJECTID`, `X-KILOCODE-MACHINEID`, `x-kilocode-mode`, `X-KILOCODE-TESTER: SUPPRESS`, and `User-Agent: opencode-kilo-provider/<version>`.
  - Wire error contract via `ctx.session.hook("http.response", ..., { providerID: "kilo" })` and stream error parsing for both Gateway error envelopes (`error.code` and `error_type`): `PAID_MODEL_AUTH_REQUIRED`, `PROMOTION_MODEL_LIMIT_REACHED`, 402 `usage_limit_exceeded` (with balance and `buyCreditsUrl`), `top_up_in_progress`, `model_not_allowed`, `provider_not_allowed`, `data_collection_required`, `upgrade_required`, and `rate_limit_exceeded`.
- **Manual test (standalone):**
  - Prompt `kilo/kilo-auto/free` and a paid model (`kilo/deepseek/deepseek-v4.1-flash`): verify `routedModelID` metadata and full `X-KILOCODE-*` request headers via local capture proxy, and trigger Gateway error codes to verify actionable error messages in the TUI.

### PR 4: Enterprise Account, Modes, Notifications, Media & FIM RPCs (`gateway-account-rpc`, stacked on PR 3)
- **What it includes:**
  - Copy `api/kilo-pass.ts`, `api/modes.ts`, `api/notifications.ts`, `api/trpc.ts`, `api/embedding-models.ts`, `autocomplete.ts`, `fim.ts`, `edit.ts`, `mistral-fim-endpoint.ts`, and their unit test files from `origin/main:packages/kilo-gateway` into `packages/kilo-gateway-core`.
  - Extend `KiloGatewayRpc` with `balance`, `kiloPass`, `authStatus`, `byok`, `codingPlans`, `modes`, `notifications` (`/api/users/notifications`), `models.images`, `models.transcriptions` (`/api/gateway/transcription-models`), `audio.transcribe` (`/api/gateway/v1/audio/transcriptions`), `fim`, and `edit`.
- **Manual test (standalone):**
  - Invoke each RPC endpoint in a signed-in session and verify real responses for balance, Kilo Pass state, team modes, notifications, transcription/image models, and FIM completions.
