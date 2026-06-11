# LLMAPI as a first-class Kilo Code provider — Design

- **Date:** 2026-06-11
- **Status:** Draft (awaiting review)
- **Repos touched:** `Spendbase/kilocode` (extension), `llmapi-router` (Go backend), `llmapi-app` (dashboard frontend)

## 1. Goal

Add `llmapi` as a **built-in, first-class provider** in the `Spendbase/kilocode`
fork. It is an OpenAI-compatible provider pointed at the LLMAPI gateway
(`https://api.llmapi.ai/v1`). Users authenticate in one of two ways:

1. **Paste an API key** (works against the gateway today — no backend change).
2. **Sign in with LLMAPI** — a device-authorization flow that mints a normal,
   revocable project API key for the user.

The second method does not exist in the backend yet and is the gating new work.
This spec covers both halves so they can be implemented together.

## 2. Background / current state

Findings from exploring the three repos:

- **Gateway is ready for API-key auth.** `GET https://api.llmapi.ai/v1/models` is
  public (no auth, 30s cache); the gateway accepts `Authorization: Bearer <key>`.
  - `llmapi-router/internal/gateway/handlers/models.go`
  - `llmapi-router/internal/gateway/middleware/auth.go`
- **No device / CLI OAuth exists in `llmapi-router`.** The only OAuth is
  Google/GitHub browser-redirect login that sets a `better-auth.session_token`
  cookie for the dashboard. There is no device-authorization grant, no short-code
  polling, and no endpoint that exchanges a session/login for a gateway API key.
  - `llmapi-router/internal/api/routes.go`, `internal/auth/handler.go`
- **API keys are minted only via session-authed `POST /keys/api`**, returning the
  `sk-...` token once.
  - `llmapi-router/internal/api/handlers/keys_api.go`
- **Kilo's own "Sign in with Kilo" is the reference pattern.** It works because the
  Kilo backend exposes `POST /api/device-auth/codes` + a poll endpoint that returns
  an API key. The opencode-based extension already has all the client-side
  machinery for this (auth plugin, authorize/callback, a localhost callback server,
  auth storage). We mirror it for `llmapi`.
  - `packages/kilo-gateway/src/auth/device-auth.ts`
  - `packages/opencode/src/provider/auth.ts`
  - `packages/kilo-vscode/webview-ui/src/components/settings/ProviderConnectDialog.tsx`

## 3. Architecture

```
 Kilo Code extension (kilocode)            llmapi-router (Go)            llmapi-app (dashboard)
 ───────────────────────────────          ──────────────────           ──────────────────────
 provider "llmapi"                         cmd/api (api.llmapi.ai)       /device approval page
   auth: api  | oauth (device)               POST /auth/device/code
   loader: Bearer key + /v1/models           POST /auth/device/approve  ◀── session-authed
   OAuth plugin ─── poll ───────────────▶    POST /auth/device/token
                                             (state in Redis, ~15m TTL)
   stored key ─── Bearer ──▶ cmd/server gateway  /v1/chat/completions, /v1/models
```

The gateway is **unchanged**: it keeps authenticating by API key. The device flow's
only job is to hand the extension a normal `sk-...` key.

## 4. Backend — `llmapi-router` device-authorization grant (RFC 8628)

New endpoints on the management API (`cmd/api`). Pending state stored in **Redis**
with a TTL (~15 min). The flow follows RFC 8628 so it is predictable and testable.

### 4.1 `POST /auth/device/code` — public

Request (optional fields): `{ "client_id": "kilo-code", "scope": "gateway" }`

Response:
```json
{
  "device_code": "<high-entropy opaque>",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://<dashboard>/device",
  "verification_uri_complete": "https://<dashboard>/device?user_code=WDJB-MJHT",
  "expires_in": 900,
  "interval": 5
}
```
- `user_code`: short, human-readable, ambiguity-free alphabet (no `0/O`, `1/I`).
- `verification_uri` host is config-driven (dashboard URL; dev vs prod).

### 4.2 `POST /auth/device/approve` — session-authed

Called by the dashboard `/device` page after the user confirms. Requires a valid
`better-auth.session_token`.

Request: `{ "user_code": "WDJB-MJHT", "project_id": "<project>" }`

Behaviour:
- Look up the pending record by `user_code`; reject if expired/already used.
- Mint a project API key (reuse existing key-creation path) named e.g.
  `"Kilo Code"`, bound to the approving user + chosen project.
- Store the minted key (or its reference) against the device record, mark approved.

Response: `{ "status": "approved" }` (the key itself is never returned to the
browser — only to the polling extension).

### 4.3 `POST /auth/device/token` — public, polled

Request: `{ "device_code": "...", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" }`

Responses (RFC 8628 error codes):
- Pending: `400 { "error": "authorization_pending" }`
- Too fast: `400 { "error": "slow_down" }` (and bump interval)
- Expired: `400 { "error": "expired_token" }`
- Denied: `400 { "error": "access_denied" }`
- Success: `200 { "api_key": "sk-...", "project_id": "...", "name": "Kilo Code" }`

### 4.4 Security

- High-entropy `device_code`; single-use; TTL-bound.
- Enforce `interval` / emit `slow_down` on over-polling; rate-limit the token endpoint.
- Minted key bound to the approving user + project; appears in the dashboard and is
  fully revocable like any other key.
- `client_id` recorded for auditing; no secret required for a public client.

### 4.5 Files (indicative)

- Routes: `llmapi-router/internal/api/routes.go`
- New handlers: `llmapi-router/internal/api/handlers/device_auth.go`
- Reuse key minting: `llmapi-router/internal/api/handlers/keys_api.go`
- Redis store: follow existing Redis usage in the repo.
- Swagger annotations on the handlers → `make swag-gen-api` (these are backend-only;
  the extension does not consume the Orval client, so no `bun generate` needed).

## 5. Frontend — `llmapi-app` device approval page

New `/device` route in the **dashboard** app:

- Reads `user_code` from the query string (from `verification_uri_complete`),
  pre-fills it; also allows manual entry.
- Requires login; if unauthenticated, redirect to login and return to `/device`.
- Shows the `user_code` for visual confirmation, an **org/project selector**, and an
  **Approve** button calling `POST /auth/device/approve`.
- Renders success / expired / error states inline. No API key is ever shown here.

(UI specifics owned on the frontend side per the standing arrangement.)

## 6. Extension — `kilocode` provider `llmapi`

### 6.1 Register the provider id

- `packages/core/src/provider.ts` — add `llmapi` to the provider id schema.
- `packages/opencode/src/provider/schema.ts` — add `llmapi` to `ProviderID`.
- `packages/kilo-vscode/src/shared/provider-model.ts` — add to `PROVIDER_PRIORITY`
  for ordering.
- `packages/kilo-vscode/webview-ui/src/components/settings/provider-catalog.ts` —
  catalog entry: name `"LLMAPI"`, `env: ["LLMAPI_API_KEY"]`, icon (synthetic
  fallback initially; a real icon can be added later).

### 6.2 Provider definition (OpenAI-compatible)

- New file `packages/llm/src/providers/llmapi.ts`, exported from
  `packages/llm/src/providers/index.ts`. Modelled on the existing
  `openai-compatible.ts` / `openrouter.ts`.
- `baseURL = https://api.llmapi.ai/v1` (config-driven for dev), auth header
  `Authorization: Bearer <key>`.

### 6.3 Auth methods + OAuth plugin

- Declare two auth methods so `ProviderConnectDialog` shows both:
  - `api` — an API-key prompt (paste a key).
  - `oauth` — "Sign in with LLMAPI".
- OAuth plugin (mirroring the `kilo` device-auth machinery):
  - `authorize()` → `POST /auth/device/code`; return
    `Authorization{ url: verification_uri_complete, method: "auto", instructions }`
    (open the URL in the browser, show the `user_code` in instructions).
  - poll / `callback()` → `POST /auth/device/token` on `interval`, handling
    `authorization_pending` / `slow_down` / `expired_token` / `access_denied`.
  - On success, store `{ type: "api", key }` in the opencode auth store
    (`packages/opencode/src/auth/index.ts`).

### 6.4 Custom loader

- Attaches the stored key as `Authorization: Bearer`.
- Fetches the model catalog from `GET /v1/models` (public) for the live list.

## 7. Data flow — sign-in (end to end)

1. User picks "Sign in with LLMAPI" → extension `authorize()` → `POST /auth/device/code`.
2. Extension opens `verification_uri_complete` in the browser and shows the `user_code`.
3. User logs in (if needed), confirms the code, selects an org/project, clicks Approve
   → `POST /auth/device/approve` mints the key.
4. Extension polls `POST /auth/device/token` until it returns `api_key`.
5. Key stored in the opencode auth store; the loader sends it as Bearer to the gateway.

## 8. Model catalog

`GET /v1/models` populates the model list (no auth needed to list).

**Detail to verify during implementation:** whether `/v1/models` returns the
context-window / pricing / tool-capability fields the Kilo model schema expects
(`packages/opencode/src/kilocode/provider/provider.ts` model schema extensions).
Where fields are absent, the mapping applies sensible defaults. If `/v1/models`
lacks needed metadata, fall back to a static/curated model list for the provider.

## 9. Testing

- **Router:** unit + integration tests for the three device endpoints — happy path,
  `authorization_pending`, `slow_down`, `expired_token`, `access_denied`, and that the
  minted key is bound to the approving user + chosen project. Verify TTL expiry and
  single-use of `device_code`.
- **Extension:** provider registration; loader builds the correct baseURL/headers;
  `/v1/models` parsing → model schema mapping; OAuth poll state machine handles each
  RFC 8628 status.
- **Manual e2e:** sign in from the extension against dev (`*.dev.llmapi.ai`) before
  prod; confirm a chat completion round-trips and the minted key appears in the
  dashboard and can be revoked.

## 10. Phasing

The pieces are independently shippable and can land in this order:

1. **Provider (API-key only)** — extension changes in §6.1, §6.2, §6.4 plus the
   `api` auth method. Fully usable immediately (paste a key).
2. **Backend device flow** — §4 endpoints + §5 approval page.
3. **OAuth method in the extension** — §6.3 wiring against the new endpoints.

## 11. Open items / decisions deferred to implementation

- Exact dashboard URL used for `verification_uri` (dev vs prod config).
- Whether `/v1/models` metadata is sufficient or a curated fallback list is needed (§8).
- Real provider icon vs. synthetic fallback.
- Whether to record/limit number of "Kilo Code" keys minted per user (avoid key sprawl
  on repeated sign-ins — e.g. reuse or rotate an existing extension-minted key).
