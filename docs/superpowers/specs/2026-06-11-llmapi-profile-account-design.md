# LLMAPI Account on the Profile screen — Design

- **Date:** 2026-06-11
- **Status:** Draft (awaiting review)
- **Repos touched:** `Spendbase/kilocode` (extension + opencode backend), `llmapi-router` (gateway)
- **Builds on:** the LLMAPI provider + device-authorization work (specs/plans `2026-06-11-llmapi-provider-*`). Phases 1–3 must be in place (the `llmapi` provider and its device flow).

## 1. Goal

Make the extension's **Profile** screen an **LLMAPI account** view, fully replacing
the Kilo account. After this change the Profile:

- Logs in with **LLMAPI** (the device-authorization flow from the provider work), not Kilo.
- Shows the signed-in **user (email/name)**, the **organization** the key belongs to,
  and that org's **credit balance** — organization shown **read-only** (no switcher).
- Logs out of LLMAPI.
- Links to the LLMAPI dashboard (`app.llmapi.ai`) instead of `app.kilo.ai`.

## 2. Background / current state

The Profile is the **Kilo account** view (`packages/kilo-vscode/webview-ui/src/components/profile/ProfileView.tsx`, SolidJS). It is wired to Kilo:

- **Login** (`KiloProvider.ts` → `kilo-provider/handlers/auth.ts:handleLogin`) calls the
  generic `client.provider.oauth.authorize({ providerID: "kilo", ... })` + `callback`,
  then fetches the account via `client.kilo.profile()`.
- **Refresh / set-org / logout** call `client.kilo.profile()`,
  `client.kilo.organization.set()`, `client.auth.remove({ providerID: "kilo" })`.
- Account data (`fetchProfile`/`fetchBalance` in `@kilocode/kilo-gateway`) hits
  `https://api.kilo.ai/api/profile` and `/api/profile/balance` with the Kilo token.
- Webview types (`ProfileData`, `DeviceAuthState`) are provider-agnostic.

**Key constraints discovered:**

- The login path is **already generic** — `provider.oauth.authorize({ providerID })` —
  so `"llmapi"` reuses the device flow already built (Phases 2–3).
- The LLMAPI credential obtained is a **gateway API key bound to one project → one org**.
  Unlike the Kilo user-token, it is **single-org** — hence no org switcher.
- LLMAPI's `/user/me`, `/orgs`, and balance are **session-cookie** auth; the gateway key
  cannot read them, and **no key-authenticated "who am I" endpoint exists yet**. One must
  be added.
- The gateway auth middleware already resolves `api_key → project → organization`
  (with `organization.credits`) into request locals; only the **creator user** (email/name,
  via `api_key.created_by`) is not currently loaded.

## 3. Architecture

```
 Profile (ProfileView, SolidJS)
   login  → provider.oauth.authorize({providerID:"llmapi"}) + callback   ← device flow (Phase 2/3)
   data   → profileData message  ◀── backend fetch of GET /v1/me (Bearer llmapi key)
                                          │
 llmapi-router gateway (cmd/server)  ─────┘
   GET /v1/me   (key-authed; existing Authenticate() middleware)
     resolves api_key → project → organization(credits) [already in locals]
     + loads creator user (email/name) via api_key.created_by
     → { user{email,name}, organization{id,name,credits}, project{id,name} }
```

## 4. Backend — `llmapi-router`: new `GET /v1/me`

A new **key-authenticated** endpoint on the gateway (`cmd/server`), placed in the
authenticated `/v1` group so it reuses `authMiddleware.Authenticate()` (which already
loads `apiKey`, `project`, `organization` into `c.Locals`).

- **Route:** `GET /v1/me` (new), in the protected `v1` group in `cmd/server/main.go`.
  - It should sit before the credit/usage/rate-limit middlewares, or be exempt from them
    (reading account info must work even at zero balance / over usage limit). Concretely:
    register `/v1/me` on a group that has `Authenticate()` but **not**
    `CreditBalanceMiddleware`/`UsageLimitMiddleware`/`rateLimiter`.
- **Handler:** new `internal/gateway/handlers/account.go` → `GetMe`.
  - Reads `organization` (id, name, credits) and `project` (id, name) from locals.
  - Loads the creator user (email/name) from `api_key.created_by`. The gateway's lightweight
    `db.APIKey` does not currently carry `created_by`; the handler resolves it via a
    user lookup by the key's `created_by` (a small repo/service method — the management
    layer already exposes creator email/name; the plan pins the exact call).
- **Response DTO:**
```json
{
  "user": { "email": "a@b.com", "name": "Ada" },
  "organization": { "id": "org_x", "name": "Acme", "credits": 12.34 },
  "project": { "id": "proj_x", "name": "default" }
}
```
- **Swagger:** annotate + `make swag-gen-api`.

## 5. Extension — rewire the Profile to LLMAPI

All in `packages/kilo-vscode`:

- **Login** (`kilo-provider/handlers/auth.ts:handleLogin`): change `providerID` from `"kilo"`
  to `"llmapi"` in the `authorize`/`callback` calls. The `deviceAuthStarted` parsing of the
  user code from `instructions` stays (Phase 3 emits the same `Open <url> and enter code: X`
  format).
- **Account fetch:** replace `client.kilo.profile()` with a fetch of `GET /v1/me` using the
  stored LLMAPI key, mapped into the existing `ProfileData` shape:
  - `profile.email`/`name` ← `user`
  - `profile.organizations` ← `[{ id, name, role: "" }]` (single org) — used only for display
  - `balance.balance` ← `organization.credits`
  - `currentOrgId` ← `organization.id`
  - **Mechanism:** mirror the existing `kilo.profile()` path. The plan finalizes whether this
    is a new opencode server route + SDK method (`llmapi.profile()`) or a direct host-side
    fetch using the stored key — decided after inspecting how `client.kilo.profile()` is
    implemented on the backend. Either way the webview contract (`profileData` message) is
    unchanged.
- **Refresh** (`handleRefreshProfile`): same fetch.
- **Logout** (`handleLogout`): `client.auth.remove({ providerID: "llmapi" })`.
- **Set organization** (`handleSetOrganization`): **removed** — a key is single-org. The
  `setOrganization` message + handler are dropped.
- **Branding:** `handleDashboard` URL → `https://app.llmapi.ai`. Replace Kilo-specific
  labels on the profile with LLMAPI equivalents (i18n strings).

## 6. Webview — `ProfileView.tsx`

- Keep the `ProfileData`/`DeviceAuthState` types unchanged (data source changes only).
- **Remove the organization `Select` switcher**; render the single org **name + balance**
  read-only. Keep the user header (name/email), balance card, login/logout, and the
  `DeviceAuthCard` (the device-code UI is provider-agnostic).
- Update the dashboard link + any "Kilo" copy to LLMAPI.

## 7. Data flow (login)

1. User clicks **Login** → `provider.oauth.authorize({ providerID: "llmapi" })` →
   browser opens the dashboard `/device` page; `DeviceAuthCard` shows the code.
2. User approves (picks a project) → backend mints the key (Phase 2) → callback resolves,
   key stored as `{ type: "api", key }`.
3. Extension fetches `GET /v1/me` with that key → `profileData` posted to the webview.
4. Profile shows user + org + balance. Logout removes the `llmapi` auth.

## 8. Testing

- **Backend:** unit/integration test for `GET /v1/me` — happy path (user+org+credits+project
  resolved from a key), and that it works at zero balance / over usage limit (not gated by
  the credit/usage middlewares). Mirror existing gateway handler tests.
- **Extension:** the profile handlers post the correct `profileData` from a mocked `/v1/me`;
  login uses `providerID:"llmapi"`; logout removes `llmapi`. Update/trim the SolidJS
  `profile.stories.tsx` to drop the org switcher.
- **Manual e2e** (deferred, needs deployment): login on the profile → approve → see
  email/org/balance → logout.

## 9. Out of scope / non-goals

- Multi-org switching on the profile (the key is single-org; switch by re-signing in and
  choosing a different project).
- Changing the rest of the app's Kilo branding (this spec covers the Profile only).
- Editing balance / billing actions from the extension (read-only view).

## 10. Open items (finalized during planning)

- Exact mechanism for the extension→`/v1/me` fetch (new SDK route mirroring `kilo.profile()`
  vs. host-side fetch) — decided after reading the `client.kilo.profile()` backend implementation.
- Exact repo/service call to resolve creator email/name from `api_key.created_by` in the
  gateway handler.
- LLMAPI dashboard URL host (`app.llmapi.ai` assumed; confirm prod host) and whether it's
  config-driven like `UI_URL`.
