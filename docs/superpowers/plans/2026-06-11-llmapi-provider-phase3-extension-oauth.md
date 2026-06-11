# LLMAPI Provider — Phase 3 (Extension "Sign in with LLMAPI") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Depends on Phase 2 being deployed** (the `/auth/device/*` endpoints must exist). Executes in `/home/roman/projects/kilocode`.

**Goal:** Add a "Sign in with LLMAPI" auth method (plus an explicit API-key method) to the `llmapi` provider via an opencode auth plugin that drives the Phase 2 device-authorization flow and stores the minted key.

**Architecture:** A new auth plugin (`LLMAPIAuthPlugin`) declares two methods for provider `llmapi`: `api` (paste a key) and `oauth` (device flow). The `oauth` `authorize()` calls `POST /auth/device/code`, opens the browser at `verification_uri_complete`, and returns a `callback()` that polls `POST /auth/device/token` until it yields an `api_key`, which opencode stores as `{ type: "api", key }`. The plugin's `loader` feeds that key to the `@ai-sdk/openai-compatible` SDK. Mirrors `KiloAuthPlugin` (`packages/kilo-gateway/src/plugin.ts`) and `authenticateWithDeviceAuthTUI` (`packages/kilo-gateway/src/auth/device-auth-tui.ts`).

**Tech Stack:** TypeScript, Bun, `@kilocode/plugin` (`Plugin`, `AuthOuathResult` types).

---

## File Structure

- **Create:** `packages/opencode/src/kilocode/llmapi/device-auth.ts` — device-flow client + `authenticateWithLlmapiDeviceAuth()`.
- **Create:** `packages/opencode/src/kilocode/llmapi/plugin.ts` — `LLMAPIAuthPlugin`.
- **Modify:** `packages/opencode/src/plugin/index.ts` — register `LLMAPIAuthPlugin` in the builtin list (next to `KiloAuthPlugin`, line ~64).
- **Create:** `packages/opencode/test/kilocode/llmapi-device-auth.test.ts` — test the poll/callback state machine.

LLMAPI management API base: `https://api.llmapi.ai` (override `LLMAPI_API_URL`). Endpoints: `POST /auth/device/code`, `POST /auth/device/token`.

---

### Task 1: Device-flow client + authorize helper

**Files:**
- Create: `packages/opencode/src/kilocode/llmapi/device-auth.ts`
- Test: `packages/opencode/test/kilocode/llmapi-device-auth.test.ts`

- [ ] **Step 1: Write the failing test**

The helper accepts injectable `fetch` and `openBrowser` so it's testable without network/UI.

```typescript
// kilocode_change - new file
import { expect, test } from "bun:test"
import { authenticateWithLlmapiDeviceAuth } from "../../src/kilocode/llmapi/device-auth"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

test("returns success with the minted key after approval", async () => {
  const calls: string[] = []
  let polls = 0
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    calls.push(u)
    if (u.endsWith("/auth/device/code")) {
      return jsonResponse(200, {
        device_code: "dc-1",
        user_code: "WDJB-MJHT",
        verification_uri: "https://app.test/device",
        verification_uri_complete: "https://app.test/device?user_code=WDJB-MJHT",
        expires_in: 900,
        interval: 0,
      })
    }
    // token endpoint: pending twice, then approved
    polls += 1
    if (polls < 3) return jsonResponse(400, { error: "authorization_pending" })
    return jsonResponse(200, { api_key: "llmapi_minted", project_id: "p1", name: "Kilo Code" })
  }) as unknown as typeof fetch

  let opened = ""
  const result = await authenticateWithLlmapiDeviceAuth({
    apiBaseURL: "https://api.test",
    fetchImpl,
    openBrowser: (url) => {
      opened = url
    },
    pollIntervalMs: 1,
  })

  expect(opened).toBe("https://app.test/device?user_code=WDJB-MJHT")
  expect(result.method).toBe("auto")
  const final = await result.callback()
  expect(final).toEqual({ type: "success", key: "llmapi_minted" })
})

test("returns failed when the device is denied", async () => {
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url)
    if (u.endsWith("/auth/device/code")) {
      return jsonResponse(200, {
        device_code: "dc-1",
        user_code: "AAAA-BBBB",
        verification_uri: "https://app.test/device",
        verification_uri_complete: "https://app.test/device?user_code=AAAA-BBBB",
        expires_in: 900,
        interval: 0,
      })
    }
    return jsonResponse(400, { error: "access_denied" })
  }) as unknown as typeof fetch

  const result = await authenticateWithLlmapiDeviceAuth({
    apiBaseURL: "https://api.test",
    fetchImpl,
    openBrowser: () => {},
    pollIntervalMs: 1,
  })
  const final = await result.callback()
  expect(final).toEqual({ type: "failed" })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/kilocode/llmapi-device-auth.test.ts`
Expected: FAIL — module `src/kilocode/llmapi/device-auth` does not exist.

- [ ] **Step 3: Implement the helper**

```typescript
// kilocode_change - new file
import { execFile } from "child_process"
import type { AuthOuathResult } from "@kilocode/plugin"

interface DeviceCodeResponse {
  readonly device_code: string
  readonly user_code: string
  readonly verification_uri: string
  readonly verification_uri_complete: string
  readonly expires_in: number
  readonly interval: number
}

interface TokenSuccess {
  readonly api_key: string
  readonly project_id?: string
  readonly name?: string
}

export interface LlmapiDeviceAuthOptions {
  /** Management API base, e.g. "https://api.llmapi.ai". */
  readonly apiBaseURL?: string
  readonly fetchImpl?: typeof fetch
  readonly openBrowser?: (url: string) => void
  readonly pollIntervalMs?: number
}

const DEFAULT_API_BASE = "https://api.llmapi.ai"

function defaultOpenBrowser(url: string): void {
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url]
  execFile(cmd, args, { windowsHide: true }, () => {})
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * RFC 8628 device-authorization flow against the LLMAPI management API.
 * Returns the URL + instructions to display and a callback that polls until the
 * backend mints an API key (or the user denies / it expires).
 */
export async function authenticateWithLlmapiDeviceAuth(
  options: LlmapiDeviceAuthOptions = {},
): Promise<AuthOuathResult> {
  const apiBase = (options.apiBaseURL ?? process.env.LLMAPI_API_URL ?? DEFAULT_API_BASE).replace(/\/+$/, "")
  const doFetch = options.fetchImpl ?? fetch
  const openBrowser = options.openBrowser ?? defaultOpenBrowser

  const codeResp = await doFetch(`${apiBase}/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: "kilo-code" }),
  })
  if (!codeResp.ok) throw new Error(`Failed to start LLMAPI sign-in: ${codeResp.status}`)
  const data = (await codeResp.json()) as DeviceCodeResponse

  openBrowser(data.verification_uri_complete)

  const intervalMs = options.pollIntervalMs ?? Math.max(data.interval, 1) * 1000
  const deadline = Date.now() + data.expires_in * 1000

  return {
    url: data.verification_uri_complete,
    instructions: `Open ${data.verification_uri} and enter code: ${data.user_code}`,
    method: "auto",
    async callback() {
      let wait = intervalMs
      while (Date.now() < deadline) {
        await delay(wait)
        const resp = await doFetch(`${apiBase}/auth/device/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_code: data.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        })

        if (resp.ok) {
          const ok = (await resp.json()) as TokenSuccess
          if (ok.api_key) return { type: "success", key: ok.api_key }
          return { type: "failed" }
        }

        const err = (await resp.json().catch(() => ({}))) as { error?: string }
        if (err.error === "authorization_pending") continue
        if (err.error === "slow_down") {
          wait += 5000
          continue
        }
        // access_denied, expired_token, or anything else → stop.
        return { type: "failed" }
      }
      return { type: "failed" }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/opencode && bun test test/kilocode/llmapi-device-auth.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/kilocode/llmapi/device-auth.ts packages/opencode/test/kilocode/llmapi-device-auth.test.ts
git commit -m "feat(llmapi): device-authorization client for Sign in with LLMAPI"
```

---

### Task 2: The auth plugin

**Files:**
- Create: `packages/opencode/src/kilocode/llmapi/plugin.ts`

- [ ] **Step 1: Confirm the `Plugin` / api-method shape**

Read `packages/kilo-gateway/src/plugin.ts` (the `KiloAuthPlugin` template, already captured in the spec) and the `Plugin` / `AuthOuathResult` types from `@kilocode/plugin`. Confirm the field names for an `api`-type method that renders a key prompt (the `prompts` array with a `text` prompt keyed `apiKey`). The plugin below mirrors `KiloAuthPlugin` exactly except for provider id, base URL, and the added `api` method.

- [ ] **Step 2: Write the plugin**

```typescript
// kilocode_change - new file
import type { Plugin } from "@kilocode/plugin"
import { authenticateWithLlmapiDeviceAuth } from "./device-auth"

export const LLMAPIAuthPlugin: Plugin = async () => {
  return {
    auth: {
      provider: "llmapi",
      async loader(getAuth) {
        const auth = await getAuth()
        if (!auth) return {}
        if (auth.type === "api") {
          return { apiKey: auth.key }
        }
        // The device flow stores its result as an api key (see callback above),
        // so oauth-typed storage is not expected here; handle defensively.
        if (auth.type === "oauth") {
          return { apiKey: (auth as { access?: string }).access ?? "" }
        }
        return {}
      },
      methods: [
        {
          type: "api",
          label: "API Key",
          prompts: [{ type: "text", key: "apiKey", message: "LLMAPI API Key" }],
        },
        {
          type: "oauth",
          label: "Sign in with LLMAPI",
          async authorize() {
            return await authenticateWithLlmapiDeviceAuth()
          },
        },
      ],
    },
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/opencode && bun run typecheck`
Expected: PASS. If the `api`-method `prompts` shape is rejected, align it with how another provider declares an `api` method (search the plugins for `type: "api"`); the `oauth` method shape is verified by the `KiloAuthPlugin` template.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/kilocode/llmapi/plugin.ts
git commit -m "feat(llmapi): auth plugin with API-key and Sign-in methods"
```

---

### Task 3: Register the plugin

**Files:**
- Modify: `packages/opencode/src/plugin/index.ts`

- [ ] **Step 1: Import and register**

Mirror the `KiloAuthPlugin` registration. Near line 29 add the import:

```typescript
import { KiloAuthPlugin } from "@kilocode/kilo-gateway" // kilocode_change
import { LLMAPIAuthPlugin } from "../kilocode/llmapi/plugin" // kilocode_change
```

In the builtin plugins array (where `KiloAuthPlugin,` appears, ~line 64) add:

```typescript
  KiloAuthPlugin,
  LLMAPIAuthPlugin, // kilocode_change
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/opencode && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the kilocode test suite**

Run: `cd packages/opencode && bun run script/test-runner.ts test/kilocode`
Expected: PASS — no regressions; the provider-auth lifecycle tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/plugin/index.ts
git commit -m "feat(llmapi): register LLMAPIAuthPlugin as a builtin plugin"
```

---

### Task 4: End-to-end verification

- [ ] **Step 1:** With Phase 2 running on dev (`LLMAPI_API_URL=https://<dev-api>`), build/run the extension.
- [ ] **Step 2:** Provider settings → `LLMAPI` → it now offers **API Key** and **Sign in with LLMAPI**.
- [ ] **Step 3:** Choose **Sign in with LLMAPI** → browser opens the dashboard `/device` page with the code → approve with a project.
- [ ] **Step 4:** The extension finishes auth; confirm the stored auth is `{ type: "api", key: "llmapi_..." }` and the model list loads from `/v1/models`.
- [ ] **Step 5:** Send a chat message; confirm it round-trips through the gateway using the minted key.
- [ ] **Step 6:** Verify the **API Key** method still works (paste a key directly).

---

## Self-Review notes

- **Spec coverage:** §6.3 — both `api` and `oauth` methods; `authorize()` → `/auth/device/code`; poll `/auth/device/token`; store as `{type:"api", key}` (the `"key" in result` branch in `packages/opencode/src/provider/auth.ts` `callback()`); loader attaches the key to the openai-compatible SDK.
- **Dependency:** requires Phase 2's endpoints live. The injectable `fetch`/`openBrowser` make the flow unit-testable without them.
- **One confirm step (not a placeholder):** the exact `api`-method `prompts` shape — Task 2 Step 1/Step 3 verify it against the `Plugin` type and existing usages; the `oauth` path is fully pinned by the `KiloAuthPlugin` and `authenticateWithDeviceAuthTUI` templates.
- **Note:** Phase 1 already makes `llmapi` usable via `LLMAPI_API_KEY` env / generic key entry; this phase adds the polished in-app key prompt and the one-click sign-in.
