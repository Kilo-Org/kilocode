# LLMAPI Account on the Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Executes across `llmapi-router` (branch `feat/device-auth`) and `kilocode` (branch `feat/llmapi-provider`). Builds on the LLMAPI provider + device-auth work (Phases 1–3).

**Goal:** Turn the extension's Profile screen into an **LLMAPI account** view — log in with the LLMAPI device flow, show the signed-in user + the key's organization + its credit balance (read-only), fully replacing Kilo.

**Architecture:** Add a key-authenticated `GET /v1/me` to the LLMAPI gateway returning user/org/project. Repurpose the opencode backend's existing `GET /kilo/profile` handler to serve the LLMAPI account (read the stored `llmapi` key → fetch `/v1/me` → map to the existing `ProfileWithBalance` shape) — this keeps the SDK surface (`client.kilo.profile()`) unchanged, so **no SDK regeneration**. Rewire the extension's profile handlers to `providerID:"llmapi"`, drop the org switcher, and rebrand the dashboard link.

**Tech Stack:** Go 1.25 / Fiber v3 (gateway); TypeScript / Effect (opencode backend); SolidJS (webview). Tests: `go test`; `bun run script/test-runner.ts` / `bun test`.

---

## File Structure

- **llmapi-router** — Create `internal/gateway/handlers/account.go` (`GetMe`); modify `cmd/server/main.go` (route); reuse the existing api-key→org→user resolution. New DTO inline or in `internal/gateway/handlers`.
- **kilocode / opencode backend** — Modify `packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts` (the `profile` handler) to serve the LLMAPI account; add a small `/v1/me` fetch helper.
- **kilocode / extension** — Modify `packages/kilo-vscode/src/kilo-provider/handlers/auth.ts` (providerID, drop set-org) and `packages/kilo-vscode/src/KiloProvider.ts` (drop `setOrganization` case).
- **kilocode / webview** — Modify `packages/kilo-vscode/webview-ui/src/components/profile/ProfileView.tsx` (remove org switcher, rebrand) and `stories/profile.stories.tsx`.

---

### Task 1: Gateway `GET /v1/me` (llmapi-router)

**Files:**
- Create: `internal/gateway/handlers/account.go`
- Modify: `cmd/server/main.go`

The auth middleware already puts `*db.APIKey`, `*db.Project`, `*db.Organization` (with `Credits`) into locals. The handler also needs the key creator's email/name via `api_key.created_by`.

- [ ] **Step 1: Confirm how to resolve the creator user**

Read `internal/db/repository.go` (the gateway `GetAPIKey`) and `internal/repositories/api_key.go` (`APIKeyCreator{ID,Name,Email}` + the method that loads it). Decide the call to fetch `{email,name}` for `apiKey.CreatedBy`: prefer an existing repo method that returns the creator; if the gateway `db.APIKey` lacks `created_by`, add a `GetUserByID(ctx, id) (email, name string, error)` to the gateway repo or reuse `db.Repository`. Use whichever the gateway already wires.

- [ ] **Step 2: Write the handler**

Create `internal/gateway/handlers/account.go`:

```go
package handlers

import (
	"github.com/gofiber/fiber/v3"

	"llmapi-router/internal/db"
)

// AccountResponse is the key-authenticated account view returned by GET /v1/me.
type AccountResponse struct {
	User         AccountUser    `json:"user"`
	Organization AccountOrg     `json:"organization"`
	Project      AccountProject `json:"project"`
}

type AccountUser struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

type AccountOrg struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Credits float64 `json:"credits"`
}

type AccountProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// userLookup resolves a creator's email/name by user id.
type userLookup interface {
	GetUserBasicByID(ctx fiber.Ctx, userID string) (email, name string, err error)
}

// AccountHandler serves the key-authenticated account view.
type AccountHandler struct {
	users userLookup
}

func NewAccountHandler(users userLookup) *AccountHandler {
	return &AccountHandler{users: users}
}

// GetMe godoc
//
//	@Summary  Account info for the authenticated API key
//	@Tags     Account
//	@Produce  json
//	@Success  200  {object}  AccountResponse
//	@Security ApiKeyAuth
//	@Router   /v1/me [get]
func (h *AccountHandler) GetMe(c fiber.Ctx) error {
	apiKey, _ := c.Locals("apiKey").(*db.APIKey)
	project, _ := c.Locals("project").(*db.Project)
	org, _ := c.Locals("organization").(*db.Organization)
	if apiKey == nil || project == nil || org == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": fiber.Map{"message": "unauthenticated", "type": "auth_error"},
		})
	}

	var email, name string
	if h.users != nil && apiKey.CreatedBy != "" {
		if e, n, err := h.users.GetUserBasicByID(c, apiKey.CreatedBy); err == nil {
			email, name = e, n
		}
	}

	return c.JSON(AccountResponse{
		User:         AccountUser{Email: email, Name: name},
		Organization: AccountOrg{ID: org.ID, Name: org.Name, Credits: org.Credits},
		Project:      AccountProject{ID: project.ID, Name: project.Name},
	})
}
```

> Adjust `apiKey.CreatedBy` access to the actual field/lookup confirmed in Step 1 (the gateway `db.APIKey` may not carry `created_by`; if so, resolve via a repo method keyed by `apiKey.ID`). Keep the response shape exactly as above.

- [ ] **Step 3: Register the route (not behind credit/usage gates)**

In `cmd/server/main.go`, where the protected `v1` group is built, register `/v1/me` on a group that has `Authenticate()` but **not** the credit/usage/rate-limit middlewares (the account view must work at zero balance):

```go
	accountH := handlers.NewAccountHandler(/* user lookup wired from repo */)
	// Authenticated but ungated: account info must be readable even at zero credits.
	v1Me := app.Group("/v1")
	v1Me.Use(authMiddleware.Authenticate())
	v1Me.Get("/me", accountH.GetMe)
```

- [ ] **Step 4: Build + vet**

Run: `cd /home/roman/projects/llmapi-router && go build ./... && go vet ./internal/gateway/handlers/`
Expected: PASS.

- [ ] **Step 5: Test the handler**

Create `internal/gateway/handlers/account_test.go` mirroring the device-auth handler test style (fiber `app.Test`, locals seeded by a pre-handler, a fake `userLookup`):

```go
package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"

	"llmapi-router/internal/db"
)

type fakeUserLookup struct{ email, name string }

func (f fakeUserLookup) GetUserBasicByID(_ fiber.Ctx, _ string) (string, string, error) {
	return f.email, f.name, nil
}

func TestGetMe_ReturnsAccount(t *testing.T) {
	h := NewAccountHandler(fakeUserLookup{email: "a@b.com", name: "Ada"})
	app := fiber.New()
	app.Get("/v1/me", func(c fiber.Ctx) error {
		c.Locals("apiKey", &db.APIKey{ID: "k1", CreatedBy: "u1"})
		c.Locals("project", &db.Project{ID: "p1", Name: "default"})
		c.Locals("organization", &db.Organization{ID: "o1", Name: "Acme", Credits: 12.5})
		return c.Next()
	}, h.GetMe)

	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", resp.StatusCode, body)
	}
	var got AccountResponse
	_ = json.Unmarshal(body, &got)
	if got.User.Email != "a@b.com" || got.Organization.Credits != 12.5 || got.Project.Name != "default" {
		t.Fatalf("unexpected: %+v", got)
	}
}
```

> Match `db.APIKey`/`db.Project`/`db.Organization` field names to the real structs (confirm `CreatedBy` exists on the gateway struct; if not, adapt the test + handler to the resolution chosen in Step 1).

Run: `cd /home/roman/projects/llmapi-router && go test ./internal/gateway/handlers/ -run TestGetMe -v`
Expected: PASS.

- [ ] **Step 6: Regenerate swagger + commit**

```bash
make swag-gen-api
git add internal/gateway/handlers/account.go internal/gateway/handlers/account_test.go cmd/server/main.go cmd/api/docs/
git commit -m "feat(gateway): add key-authenticated GET /v1/me account endpoint"
```

---

### Task 2: opencode backend — serve the LLMAPI account from `/kilo/profile`

**Files:**
- Modify: `packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts` (the `profile` handler)

The existing `profile` handler reads `auth.get("kilo")` (oauth) and calls `fetchProfile/fetchBalance`. Repurpose it to serve the LLMAPI account from the stored `llmapi` key + `GET /v1/me`. The returned shape (`{ profile, balance, currentOrgId }`) and the route (`/kilo/profile`) stay the same, so the SDK and webview contract are unchanged.

- [ ] **Step 1: Add an `/v1/me` fetch helper**

At the top of the handler module (after imports), add:

```typescript
const LLMAPI_BASE_URL = "https://api.llmapi.ai/v1"

interface LlmapiAccount {
  user?: { email?: string; name?: string }
  organization?: { id?: string; name?: string; credits?: number }
  project?: { id?: string; name?: string }
}

async function fetchLlmapiAccount(key: string): Promise<LlmapiAccount> {
  const base = (process.env.LLMAPI_BASE_URL ?? LLMAPI_BASE_URL).replace(/\/+$/, "")
  const res = await fetch(`${base}/me`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  })
  if (!res.ok) throw new Error(`llmapi /v1/me failed: ${res.status}`)
  return (await res.json()) as LlmapiAccount
}
```

- [ ] **Step 2: Repurpose the `profile` handler**

Replace the body of the `profile` Effect fn with the LLMAPI version:

```typescript
    const profile = Effect.fn("KiloGatewayHttpApi.profile")(function* () {
      const info = yield* auth.get("llmapi").pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      if (!info || info.type !== "api") return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const account = yield* Effect.tryPromise({
        try: () => fetchLlmapiAccount(info.key),
        catch: () => new HttpApiError.BadRequest({}),
      })

      const orgId = account.organization?.id ?? null
      return {
        profile: {
          email: account.user?.email ?? "",
          name: account.user?.name,
          organizations: orgId
            ? [{ id: orgId, name: account.organization?.name ?? "", role: "" }]
            : [],
        },
        balance: account.organization?.credits !== undefined ? { balance: account.organization.credits } : null,
        currentOrgId: orgId,
      }
    })
```

> This satisfies the existing `ProfileWithBalance` schema in `../groups/kilo-gateway` (Profile{email,name,organizations}, Balance{balance}, currentOrgId). Leave the other handlers (modes/fim/edit/sessions) unchanged.

- [ ] **Step 3: Typecheck**

Run: `cd /home/roman/projects/kilocode/packages/opencode && bun run typecheck`
Expected: PASS. (If `fetchProfile`/`fetchBalance` imports become unused, remove them per the no-unused-imports rule.)

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts
git commit -m "feat(profile): serve LLMAPI account from /kilo/profile via /v1/me"
```

---

### Task 3: Extension — rewire profile handlers to LLMAPI

**Files:**
- Modify: `packages/kilo-vscode/src/kilo-provider/handlers/auth.ts`
- Modify: `packages/kilo-vscode/src/KiloProvider.ts`

- [ ] **Step 1: Switch login/logout to `providerID:"llmapi"`**

In `auth.ts`, change `handleLogin` and `handleLogout`:

```typescript
  // handleLogin: authorize + callback with the LLMAPI provider
  const { data: auth } = await ctx.client.provider.oauth.authorize(
    { providerID: "llmapi", method: 0, directory: dir },
    { throwOnError: true },
  )
  // ... (instructions parsing unchanged) ...
  await ctx.client.provider.oauth.callback(
    { providerID: "llmapi", method: 0, directory: dir },
    { throwOnError: true },
  )
  // profile fetch unchanged: client.kilo.profile() now returns the LLMAPI account
```

```typescript
  // handleLogout
  await ctx.client.auth.remove({ providerID: "llmapi" }, { throwOnError: true })
```

> `method: 0` selects the first auth method. The LLMAPI plugin declares `api` first, then `oauth`. For the **profile login button** we want the device flow → set `method` to the index of the `oauth` method (1). Confirm the order in `packages/opencode/src/plugin/llmapi.ts` and pass the oauth method's index.

- [ ] **Step 2: Remove the org switcher handler**

In `auth.ts`, delete `handleSetOrganization` (the key is single-org). In `KiloProvider.ts`, remove the `case "setOrganization":` block.

- [ ] **Step 3: Rebrand the dashboard link**

In `ProfileView.tsx` `handleDashboard`, change the URL to `https://app.llmapi.ai/` (Task 4 also covers this; do it wherever the host link is emitted).

- [ ] **Step 4: Typecheck**

Run: `cd /home/roman/projects/kilocode/packages/kilo-vscode && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kilo-vscode/src/kilo-provider/handlers/auth.ts packages/kilo-vscode/src/KiloProvider.ts
git commit -m "feat(profile): drive the profile account with the llmapi provider"
```

---

### Task 4: Webview — remove org switcher + rebrand

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/components/profile/ProfileView.tsx`
- Modify: `packages/kilo-vscode/webview-ui/src/stories/profile.stories.tsx`

- [ ] **Step 1: Remove the organization `Select` switcher**

In `ProfileView.tsx`, delete the org-selector `Card` (the `Show when={orgOptions().length > 0}` block with `<Select .../>`) and the `selectOrg`/`setOrganization` plumbing + `target()`/`switching()` signals tied to org switching. Replace with a read-only org line inside the user/account card when an org name is present:

```tsx
<Show when={props.profileData?.profile.organizations?.[0]}>
  {(org) => (
    <p style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-descriptionForeground)", margin: "4px 0 0 0" }}>
      {org().name}
    </p>
  )}
</Show>
```

Keep the user header, balance card, login/logout, and `DeviceAuthCard` as-is.

- [ ] **Step 2: Rebrand**

Change the dashboard link to `https://app.llmapi.ai/` and update any "Kilo" copy on the profile to "LLMAPI" (via the i18n strings used here, e.g. `profile.*`).

- [ ] **Step 3: Update the story**

In `profile.stories.tsx`, drop the org-switcher-specific story/props so it matches the new read-only profile.

- [ ] **Step 4: Typecheck + lint**

Run: `cd /home/roman/projects/kilocode/packages/kilo-vscode && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/components/profile/ProfileView.tsx packages/kilo-vscode/webview-ui/src/stories/profile.stories.tsx
git commit -m "feat(profile): read-only LLMAPI account view, drop org switcher"
```

---

### Task 5: Verification

- [ ] **Step 1: Backend**

Run: `cd /home/roman/projects/llmapi-router && go build ./... && go test ./internal/gateway/handlers/ -run TestGetMe`
Expected: PASS.

- [ ] **Step 2: Extension/backend typecheck sweep**

Run: `cd /home/roman/projects/kilocode/packages/opencode && bun run typecheck` and `cd ../kilo-vscode && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual e2e (deferred — needs deployment)**

Profile → Login → device approve (pick project) → profile shows email + org name + balance; Logout clears it. Confirm `GET /v1/me` returns the account at zero balance.

---

## Self-Review notes

- **Spec coverage:** §4 → Task 1 (`/v1/me`, ungated). §5 → Tasks 2–3 (providerID llmapi, `/v1/me`-backed profile, drop set-org, dashboard link). §6 → Task 4 (remove switcher, read-only org, rebrand). §8 testing → Tasks 1/4/5.
- **Mechanism resolved (spec §10):** repurpose the existing `/kilo/profile` handler (no SDK regen) rather than add a new SDK route — lowest-risk, keeps `client.kilo.profile()` working.
- **Flagged confirmations (not placeholders):** the exact creator-user lookup in the gateway (`api_key.created_by` resolution) and the `oauth` method index in the llmapi plugin (1) — both have explicit confirm steps with the surrounding code shown.
- **Naming caveat:** the backend route stays `/kilo/profile` for now (serves the LLMAPI account); a later cleanup can rename it + regen the SDK if desired.
