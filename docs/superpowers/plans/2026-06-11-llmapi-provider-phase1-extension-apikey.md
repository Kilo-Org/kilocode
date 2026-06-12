# LLMAPI Provider — Phase 1 (Extension, API-key) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `llmapi` a first-class, built-in provider in the `Spendbase/kilocode` extension — it appears in the provider list with a live model catalog fetched from `https://api.llmapi.ai/v1/models`, and users authenticate by pasting an LLMAPI API key.

**Architecture:** LLMAPI is a plain OpenAI-compatible gateway, so it reuses the already-bundled `@ai-sdk/openai-compatible` SDK. The implementation mirrors the existing **`apertis`** provider exactly: a dynamic model fetch in `model-cache.ts`, a provider entry in `models.ts`, and provider-list metadata (priority + icon). `ProviderID` is a branded string with no central union, so **no schema/enum needs editing**.

**Tech Stack:** TypeScript, Bun, Effect (effect/unstable/http), `@ai-sdk/openai-compatible`. Tests run via `bun run script/test-runner.ts` in `packages/opencode`.

---

## Reference (the template we mirror)

- `packages/opencode/src/provider/model-cache.ts` — `apertis` branches in `authOptions`, `fetchModels`, `key`, and `fetchApertisModels`.
- `packages/opencode/src/provider/models.ts` — `addApertis` adds the provider entry `{ id, name, env, api, npm, models }`.
- `packages/opencode/src/shared/...` priority + `webview-ui/.../provider-catalog.ts` for list metadata.
- `packages/opencode/test/kilocode/model-cache-effect.test.ts` — test harness with a mocked `HttpClient`.

LLMAPI specifics: base URL `https://api.llmapi.ai/v1`, env vars `LLMAPI_API_KEY` / `LLMAPI_BASE_URL`, auth header `Authorization: Bearer <key>`, model list at `GET /v1/models` returning `{ "data": [{ "id": "...", "owned_by": "..." }, ...] }` (public).

## File Structure

- **Modify:** `packages/opencode/src/provider/model-cache.ts` — add `llmapi` to the dynamic-fetch machinery; extract a shared OpenAI-compatible `/models` fetcher so `apertis` and `llmapi` don't duplicate it.
- **Modify:** `packages/opencode/src/provider/models.ts` — add an `addLlmapi` step that registers the provider entry.
- **Modify:** `packages/kilo-vscode/src/shared/provider-model.ts` — add `"llmapi"` to `PROVIDER_PRIORITY`.
- **Modify:** `packages/kilo-vscode/webview-ui/src/components/settings/provider-catalog.ts` — (optional note key; icon already falls back to `"synthetic"`).
- **Create:** `packages/opencode/test/kilocode/llmapi-model-cache.test.ts` — test the `llmapi` model fetch.

---

### Task 1: Shared OpenAI-compatible model fetcher + `llmapi` in model-cache

**Files:**
- Modify: `packages/opencode/src/provider/model-cache.ts`
- Test: `packages/opencode/test/kilocode/llmapi-model-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/opencode/test/kilocode/llmapi-model-cache.test.ts`:

```typescript
// kilocode_change - new file
import { expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

type Hit = { readonly url: string; readonly auth: string | undefined }

const auth = Layer.mock(Auth.Service)({ get: () => Effect.succeed(undefined) })
const it = testEffect(Layer.empty)

function layer(hits: Ref.Ref<Hit[]>) {
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(hits, (list) => [
        ...list,
        { url: request.url, auth: request.headers["authorization"] },
      ])
      return HttpClientResponse.fromWeb(
        request,
        Response.json({ data: [{ id: "gpt-4o-mini", owned_by: "openai" }] }),
      )
    }),
  )
  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(TestConfig.layer()),
    Layer.provide(auth),
    Layer.provide(ModelCache.kiloModelsLayer),
  )
}

it.live("fetches llmapi models from /v1/models with the bearer key", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const models = yield* ModelCache.Service.use((cache) =>
      cache.fetch("llmapi", { apiKey: "sk-test", baseURL: "https://api.llmapi.test/v1" }),
    ).pipe(Effect.provide(layer(hits)))

    expect(Object.keys(models)).toEqual(["gpt-4o-mini"])
    const recorded = yield* Ref.get(hits)
    expect(recorded.map((h) => h.url)).toEqual(["https://api.llmapi.test/v1/models"])
    expect(recorded[0]?.auth).toBe("Bearer sk-test")
  }),
)

it.live("returns no models for llmapi without an api key", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const models = yield* ModelCache.Service.use((cache) => cache.fetch("llmapi", {})).pipe(
      Effect.provide(layer(hits)),
    )
    expect(models).toEqual({})
    expect(yield* Ref.get(hits)).toEqual([])
  }),
)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun run script/test-runner.ts test/kilocode/llmapi-model-cache.test.ts`
Expected: FAIL — `llmapi` is not handled, so `cache.fetch("llmapi", ...)` returns `{}` and makes no HTTP call (first test fails on `["gpt-4o-mini"]` vs `[]`).

- [ ] **Step 3: Extract a shared OpenAI-compatible fetcher**

In `packages/opencode/src/provider/model-cache.ts`, replace the `APERTIS_BASE_URL`/`ApertisItem`/`ApertisResponse` constants region (lines ~49-52) with a shared, provider-agnostic version and add the LLMAPI base URL:

```typescript
const APERTIS_BASE_URL = "https://api.apertis.ai/v1"
const LLMAPI_BASE_URL = "https://api.llmapi.ai/v1"
const OpenAICompatItem = Schema.Struct({ id: Schema.String, owned_by: Schema.optional(Schema.String) })
const OpenAICompatModels = Schema.Struct({ data: Schema.optional(Schema.Array(OpenAICompatItem)) })
type OpenAICompatItem = Schema.Schema.Type<typeof OpenAICompatItem>
```

- [ ] **Step 4: Replace `aperture`/`fetchApertisModels` with a shared mapper + fetcher**

Replace the `aperture` mapper (lines ~78-90) and `fetchApertisModels` (lines ~92-113) with:

```typescript
const toModel = (item: OpenAICompatItem): Models[string] => ({
  id: item.id,
  name: item.id,
  family: item.owned_by ?? "",
  release_date: "",
  attachment: true,
  reasoning: false,
  temperature: true,
  tool_call: true,
  cost: { input: 0, output: 0 },
  limit: { context: 128000, output: 4096 },
  modalities: { input: ["text", "image"], output: ["text"] },
})

const fetchOpenAICompatModels = Effect.fn("ModelCache.fetchOpenAICompatModels")(function* (
  defaultBaseURL: string,
  options: Options,
) {
  const baseURL = options.baseURL ?? defaultBaseURL
  if (!options.apiKey) {
    log.debug("no API key, skipping model fetch", { baseURL })
    return {}
  }

  const url = `${baseURL.replace(/\/+$/, "")}/models`
  const response = yield* HttpClientRequest.get(url).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(options.apiKey),
    http.execute,
    Effect.timeout("10 seconds"),
  )
  if (response.status < 200 || response.status >= 300) {
    log.error("openai-compatible model fetch failed", { url, status: response.status })
    return {}
  }

  const json = yield* HttpClientResponse.schemaBodyJson(OpenAICompatModels)(response)
  return Object.fromEntries((json.data ?? []).map((item) => [item.id, toModel(item)]))
})
```

- [ ] **Step 5: Add `llmapi` to `authOptions`, `fetchModels`, and `key`**

In `authOptions` (line ~115), broaden the guard and add the `llmapi` branch (it shares apertis's `apiKey`/`baseURL` shape):

```typescript
const authOptions = Effect.fn("ModelCache.authOptions")(function* (providerID: string) {
  if (providerID !== "kilo" && providerID !== "apertis" && providerID !== "llmapi") return {}
  const config = yield* cfg.get()
  const options: Options = {}

  if (providerID === "kilo") {
    // ... unchanged kilo branch ...
  }

  if (providerID === "apertis" || providerID === "llmapi") {
    const item = config.provider?.[providerID]
    if (item?.options?.apiKey) options.apiKey = item.options.apiKey
    if (item?.options?.baseURL) options.baseURL = item.options.baseURL

    const info = yield* auth.get(providerID)
    if (info?.type === "api") options.apiKey = info.key

    const envKey = providerID === "apertis" ? "APERTIS_API_KEY" : "LLMAPI_API_KEY"
    const envBase = providerID === "apertis" ? "APERTIS_BASE_URL" : "LLMAPI_BASE_URL"
    if (process.env[envKey]) options.apiKey = process.env[envKey]
    if (process.env[envBase]) options.baseURL = process.env[envBase]
    log.debug("openai-compatible auth options resolved", {
      providerID,
      hasKey: !!options.apiKey,
      hasBaseURL: !!options.baseURL,
    })
  }

  return options
})
```

> Note: delete the old `apertis`-only branch; the merged branch above replaces it.

Update `fetchModels` (line ~160):

```typescript
const fetchModels = (providerID: string, options: Options): Effect.Effect<Result, unknown> => {
  if (providerID === "kilo") return kilo.fetch(options)
  if (providerID === "apertis")
    return fetchOpenAICompatModels(APERTIS_BASE_URL, options).pipe(Effect.map((models) => ({ models })))
  if (providerID === "llmapi")
    return fetchOpenAICompatModels(LLMAPI_BASE_URL, options).pipe(Effect.map((models) => ({ models })))
  log.debug("provider not implemented", { providerID })
  return Effect.succeed({ models: {} })
}
```

Update `key` (line ~179) so `llmapi` cache cells key on baseURL+apiKey like apertis:

```typescript
const key = (providerID: string, options?: Options) => {
  if (providerID === "kilo") {
    return JSON.stringify([providerID, options?.baseURL, options?.kilocodeOrganizationId, options?.kilocodeToken])
  }
  if (providerID === "apertis" || providerID === "llmapi")
    return JSON.stringify([providerID, options?.baseURL, options?.apiKey])
  return providerID
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/opencode && bun run script/test-runner.ts test/kilocode/llmapi-model-cache.test.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Ensure apertis tests still pass after the refactor**

Run: `cd packages/opencode && bun run script/test-runner.ts test/kilocode/model-cache-effect.test.ts`
Expected: PASS (the apertis behavior is unchanged; the shared fetcher returns the same shape).

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/provider/model-cache.ts packages/opencode/test/kilocode/llmapi-model-cache.test.ts
git commit -m "feat(provider): fetch llmapi model catalog via shared openai-compatible fetcher"
```

---

### Task 2: Register the `llmapi` provider entry in `models.ts`

**Files:**
- Modify: `packages/opencode/src/provider/models.ts`

- [ ] **Step 1: Add the `addLlmapi` step mirroring `addApertis`**

In the `get` effect of `packages/opencode/src/provider/models.ts`, define `addLlmapi` next to `addApertis` (use the config-driven baseURL like apertis does):

```typescript
const llmapi = cfg.provider?.llmapi?.options
const llmapiURL = llmapi?.baseURL ?? "https://api.llmapi.ai/v1"
const llmapiOpts = llmapi?.baseURL ? { baseURL: llmapi.baseURL } : {}

const addLlmapi = Effect.fnUntraced(function* () {
  if (providers.llmapi) return
  const models = yield* cache.fetch("llmapi", llmapiOpts).pipe(Effect.catch(() => Effect.succeed({})))
  providers.llmapi = {
    id: "llmapi",
    name: "LLMAPI",
    env: ["LLMAPI_API_KEY"],
    api: llmapiURL,
    npm: "@ai-sdk/openai-compatible",
    models,
  }
  if (Object.keys(models).length === 0)
    yield* cache.refresh("llmapi", llmapiOpts).pipe(Effect.ignore, Effect.forkDetach)
})
```

- [ ] **Step 2: Call `addLlmapi` everywhere `addApertis` is called**

In the same function, `addApertis()` is invoked on both the early-return (`!allowed`) path and the main path. Add `yield* addLlmapi()` immediately after each `yield* addApertis()` so llmapi is always registered:

```typescript
      if (!allowed) {
        yield* addApertis()
        yield* addLlmapi()
        return providers
      }
      // ... kilo block ...
      yield* addApertis()
      yield* addLlmapi()
      return providers
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/opencode && bun run typecheck`
Expected: PASS (no type errors). The `Provider` shape matches `apertis`.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/provider/models.ts
git commit -m "feat(provider): register llmapi as a built-in openai-compatible provider"
```

---

### Task 3: Provider-list metadata (priority + catalog)

**Files:**
- Modify: `packages/kilo-vscode/src/shared/provider-model.ts`
- Modify: `packages/kilo-vscode/webview-ui/src/components/settings/provider-catalog.ts`

- [ ] **Step 1: Add `llmapi` to `PROVIDER_PRIORITY`**

In `packages/kilo-vscode/src/shared/provider-model.ts`, add `"llmapi"` to the `PROVIDER_PRIORITY` array (place it where you want it ranked in the list — e.g. just after `KILO_PROVIDER_ID`):

```typescript
export const PROVIDER_PRIORITY = [
  KILO_PROVIDER_ID,
  "llmapi",
  "anthropic",
  "deepseek",
  "openai",
  "google",
  "openrouter",
  "vercel",
] as const
```

- [ ] **Step 2: (Optional) Add a provider note**

`providerIcon()` already falls back to `"synthetic"` for unknown ids, so no icon change is required. If you want a help note under the provider, add a branch in `providerNoteKey()` in `provider-catalog.ts` and a matching i18n string; otherwise leave it (returns `undefined`, which renders no note). Skipping for Phase 1.

- [ ] **Step 3: Typecheck the webview**

Run: `cd packages/kilo-vscode && bun run typecheck` (or the repo's root typecheck task if that's the convention — check `package.json`).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/kilo-vscode/src/shared/provider-model.ts
git commit -m "feat(ui): rank llmapi in the provider list"
```

---

### Task 4: Full verification

- [ ] **Step 1: Run the opencode provider test suite**

Run: `cd packages/opencode && bun run script/test-runner.ts test/kilocode`
Expected: PASS (no regressions in provider/model-cache tests).

- [ ] **Step 2: Manual smoke test against dev**

1. Build/run the extension (per repo `README`/`TESTING.md`).
2. Open provider settings → `LLMAPI` appears in the list.
3. Choose it, paste a real LLMAPI key (or set `LLMAPI_API_KEY`).
4. Confirm the model dropdown populates from `GET /v1/models`.
5. Send a chat message; confirm a completion round-trips via `https://api.llmapi.ai/v1/chat/completions`.

To point at dev instead of prod, set `LLMAPI_BASE_URL=https://<dev-gateway>/v1`.

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore(provider): finalize llmapi phase 1 (api-key)"
```

---

## Self-Review notes

- **Spec coverage:** Covers §6.1 (registration — no union needed), §6.2 (OpenAI-compatible definition via `npm: @ai-sdk/openai-compatible`), §6.4 (loader/key + `/v1/models` fetch), §8 (model catalog with apertis-style default mapping). OAuth (§6.3) and backend (§4/§5) are Phases 2–3.
- **Inference path:** `apertis` is shipped and works with this exact wiring (no entry in `kiloCustomLoaders`), so `llmapi` inference works the same way; the custom-loader path is unnecessary for Phase 1.
- **Open item carried forward:** richer model metadata (context window, pricing, tool support) from `/v1/models` — Phase 1 uses apertis-style defaults; refine the `toModel` mapper once the `/v1/models` response fields are confirmed.
