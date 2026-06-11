# LLMAPI Provider — Phase 2 (Backend device-authorization grant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan executes in the `llmapi-router` repo (`/home/roman/projects/llmapi-router`), plus a small page in `llmapi-app`.**

**Goal:** Add an OAuth 2.0 device-authorization grant (RFC 8628) to the LLMAPI management API so an external app (Kilo Code) can let a user "Sign in with LLMAPI" and receive a normal, revocable project API key. Plus a `/device` approval page in the dashboard.

**Architecture:** Three endpoints under `/auth/device/*` on `cmd/api`, with pending state in **Redis** (10-min TTL). On approval, reuse the existing `APIKeyService.Create` path to mint a `llmapi_...` key bound to the approving user + chosen project. The gateway is unchanged. Mirrors existing patterns: route groups in `routes.go`, `redis.Client` injection (as in `admin/ip_ban.go`), session extraction via `middleware.GetUserID`, and handler tests via `fiber.App.Test`.

**Tech Stack:** Go 1.25, Fiber v3, `github.com/redis/go-redis/v9`, zerolog, stdlib `testing` + `httptest`.

---

## File Structure

- **Create:** `internal/api/dto/device_auth.go` — request/response DTOs.
- **Create:** `internal/services/device_auth.go` — `DeviceAuthService` (Redis state + key minting).
- **Create:** `internal/api/handlers/device_auth.go` — `DeviceAuthHandler` (3 endpoints).
- **Create:** `internal/api/handlers/device_auth_test.go` — handler tests (mock service + `app.Test`).
- **Modify:** `internal/api/routes.go` — construct service+handler, register routes.
- **Frontend (separate, llmapi-app):** new `/device` route in the dashboard app (Task 6).

## Redis data model

- `device:code:<device_code>` → JSON `{user_code, status, project_id, api_key}` — TTL 600s. `status ∈ {pending, approved, denied}`.
- `device:user:<user_code>` → `<device_code>` — TTL 600s (reverse lookup for approve).
- `device:poll:<device_code>` → `"1"` — TTL = `interval` seconds; presence triggers `slow_down`.

---

### Task 1: DTOs

**Files:**
- Create: `internal/api/dto/device_auth.go`

- [ ] **Step 1: Write the DTOs**

```go
package dto

// DeviceCodeResponse is returned by POST /auth/device/code (RFC 8628 §3.2).
type DeviceCodeResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

// ApproveDeviceRequest is the body of POST /auth/device/approve (session-authed).
type ApproveDeviceRequest struct {
	UserCode  string `json:"user_code"`
	ProjectID string `json:"project_id"`
}

// DeviceTokenRequest is the body of POST /auth/device/token (RFC 8628 §3.4).
type DeviceTokenRequest struct {
	DeviceCode string `json:"device_code"`
	GrantType  string `json:"grant_type"`
}

// DeviceTokenResponse is returned when the device has been approved.
type DeviceTokenResponse struct {
	APIKey    string `json:"api_key"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
}

// DeviceErrorResponse carries an RFC 8628 error code.
type DeviceErrorResponse struct {
	Error string `json:"error"`
}
```

- [ ] **Step 2: Build**

Run: `cd /home/roman/projects/llmapi-router && go build ./internal/api/dto/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add internal/api/dto/device_auth.go
git commit -m "feat(device-auth): add device-authorization DTOs"
```

---

### Task 2: DeviceAuthService

**Files:**
- Create: `internal/services/device_auth.go`

The service depends only on a `*redis.Client`, a key-minting interface (satisfied by `*APIKeyService`), and the dashboard base URL.

- [ ] **Step 1: Write the service**

```go
package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"llmapi-router/internal/api/dto"
	repository "llmapi-router/internal/repositories"
)

const (
	deviceCodeTTL     = 10 * time.Minute
	devicePollSeconds = 5
	deviceKeyName     = "Kilo Code"

	statusPending  = "pending"
	statusApproved = "approved"
	statusDenied   = "denied"

	// RFC 8628 error codes.
	ErrCodeAuthorizationPending = "authorization_pending"
	ErrCodeSlowDown             = "slow_down"
	ErrCodeExpiredToken         = "expired_token"
	ErrCodeAccessDenied         = "access_denied"

	// userCodeAlphabet excludes ambiguous characters (no 0/O/1/I).
	userCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

// ErrDeviceCodeNotFound is returned by Approve when the user_code is unknown/expired.
var ErrDeviceCodeNotFound = errors.New("device code not found")

// apiKeyCreator is the subset of APIKeyService the device flow needs.
type apiKeyCreator interface {
	Create(ctx context.Context, userID, projectID string, req dto.CreateAPIKeyRequest) (*repository.APIKey, error)
}

type deviceRecord struct {
	UserCode  string `json:"user_code"`
	Status    string `json:"status"`
	ProjectID string `json:"project_id,omitempty"`
	APIKey    string `json:"api_key,omitempty"`
}

// DeviceAuthService implements an RFC 8628 device-authorization grant on top of Redis.
type DeviceAuthService struct {
	redis        *redis.Client
	keys         apiKeyCreator
	dashboardURL string
}

// NewDeviceAuthService constructs the service. dashboardURL is the public dashboard
// base (UI_URL), e.g. "https://app.llmapi.ai".
func NewDeviceAuthService(rc *redis.Client, keys apiKeyCreator, dashboardURL string) *DeviceAuthService {
	return &DeviceAuthService{redis: rc, keys: keys, dashboardURL: strings.TrimRight(dashboardURL, "/")}
}

func codeKey(deviceCode string) string { return "device:code:" + deviceCode }
func userKey(userCode string) string   { return "device:user:" + userCode }
func pollKey(deviceCode string) string  { return "device:poll:" + deviceCode }

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func randomUserCode() (string, error) {
	out := make([]byte, 8)
	max := big.NewInt(int64(len(userCodeAlphabet)))
	for i := range out {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = userCodeAlphabet[idx.Int64()]
	}
	return string(out[:4]) + "-" + string(out[4:]), nil
}

// RequestCode issues a fresh device_code/user_code pair and stores a pending record.
func (s *DeviceAuthService) RequestCode(ctx context.Context) (dto.DeviceCodeResponse, error) {
	deviceCode, err := randomHex(32)
	if err != nil {
		return dto.DeviceCodeResponse{}, err
	}
	userCode, err := randomUserCode()
	if err != nil {
		return dto.DeviceCodeResponse{}, err
	}

	rec := deviceRecord{UserCode: userCode, Status: statusPending}
	payload, err := json.Marshal(rec)
	if err != nil {
		return dto.DeviceCodeResponse{}, err
	}
	if err := s.redis.Set(ctx, codeKey(deviceCode), payload, deviceCodeTTL).Err(); err != nil {
		return dto.DeviceCodeResponse{}, err
	}
	if err := s.redis.Set(ctx, userKey(userCode), deviceCode, deviceCodeTTL).Err(); err != nil {
		return dto.DeviceCodeResponse{}, err
	}

	verify := s.dashboardURL + "/device"
	return dto.DeviceCodeResponse{
		DeviceCode:              deviceCode,
		UserCode:                userCode,
		VerificationURI:         verify,
		VerificationURIComplete: verify + "?user_code=" + userCode,
		ExpiresIn:               int(deviceCodeTTL.Seconds()),
		Interval:                devicePollSeconds,
	}, nil
}

func (s *DeviceAuthService) loadByDeviceCode(ctx context.Context, deviceCode string) (deviceRecord, error) {
	raw, err := s.redis.Get(ctx, codeKey(deviceCode)).Result()
	if errors.Is(err, redis.Nil) {
		return deviceRecord{}, ErrDeviceCodeNotFound
	}
	if err != nil {
		return deviceRecord{}, err
	}
	var rec deviceRecord
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		return deviceRecord{}, err
	}
	return rec, nil
}

func (s *DeviceAuthService) save(ctx context.Context, deviceCode string, rec deviceRecord) error {
	payload, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	// Preserve remaining TTL rather than resetting it.
	ttl, err := s.redis.TTL(ctx, codeKey(deviceCode)).Result()
	if err != nil || ttl <= 0 {
		ttl = deviceCodeTTL
	}
	return s.redis.Set(ctx, codeKey(deviceCode), payload, ttl).Err()
}

// Approve mints a key for the approving user+project and marks the device approved.
func (s *DeviceAuthService) Approve(ctx context.Context, userID, userCode, projectID string) error {
	deviceCode, err := s.redis.Get(ctx, userKey(userCode)).Result()
	if errors.Is(err, redis.Nil) {
		return ErrDeviceCodeNotFound
	}
	if err != nil {
		return err
	}
	rec, err := s.loadByDeviceCode(ctx, deviceCode)
	if err != nil {
		return err
	}
	if rec.Status == statusApproved {
		return nil // idempotent
	}

	key, err := s.keys.Create(ctx, userID, projectID, dto.CreateAPIKeyRequest{
		ProjectID:   projectID,
		Description: deviceKeyName,
	})
	if err != nil {
		return err
	}

	rec.Status = statusApproved
	rec.ProjectID = projectID
	rec.APIKey = key.Token
	return s.save(ctx, deviceCode, rec)
}

// ExchangeToken returns the minted key once approved, or an RFC 8628 error code.
// On success it deletes the record so the key is delivered exactly once.
func (s *DeviceAuthService) ExchangeToken(ctx context.Context, deviceCode string) (dto.DeviceTokenResponse, string, error) {
	// slow_down if polled faster than the advertised interval.
	set, err := s.redis.SetNX(ctx, pollKey(deviceCode), "1", devicePollSeconds*time.Second).Result()
	if err == nil && !set {
		return dto.DeviceTokenResponse{}, ErrCodeSlowDown, nil
	}

	rec, err := s.loadByDeviceCode(ctx, deviceCode)
	if errors.Is(err, ErrDeviceCodeNotFound) {
		return dto.DeviceTokenResponse{}, ErrCodeExpiredToken, nil
	}
	if err != nil {
		return dto.DeviceTokenResponse{}, "", err
	}

	switch rec.Status {
	case statusDenied:
		return dto.DeviceTokenResponse{}, ErrCodeAccessDenied, nil
	case statusApproved:
		s.redis.Del(ctx, codeKey(deviceCode), userKey(rec.UserCode))
		return dto.DeviceTokenResponse{
			APIKey:    rec.APIKey,
			ProjectID: rec.ProjectID,
			Name:      deviceKeyName,
		}, "", nil
	default:
		return dto.DeviceTokenResponse{}, ErrCodeAuthorizationPending, nil
	}
}
```

- [ ] **Step 2: Build**

Run: `cd /home/roman/projects/llmapi-router && go build ./internal/services/`
Expected: PASS. (If `dto.CreateAPIKeyRequest` field names differ, align them — confirm against `internal/api/dto`.)

- [ ] **Step 3: Commit**

```bash
git add internal/services/device_auth.go
git commit -m "feat(device-auth): add DeviceAuthService backed by Redis"
```

---

### Task 3: DeviceAuthHandler

**Files:**
- Create: `internal/api/handlers/device_auth.go`

- [ ] **Step 1: Write the handler**

```go
package handlers

import (
	"context"
	"errors"

	"github.com/gofiber/fiber/v3"
	"github.com/rs/zerolog/log"

	"llmapi-router/internal/api/dto"
	"llmapi-router/internal/api/middleware"
	"llmapi-router/internal/services"
)

// deviceAuthService is the subset of service.DeviceAuthService the handler uses.
type deviceAuthService interface {
	RequestCode(ctx context.Context) (dto.DeviceCodeResponse, error)
	Approve(ctx context.Context, userID, userCode, projectID string) error
	ExchangeToken(ctx context.Context, deviceCode string) (dto.DeviceTokenResponse, string, error)
}

// DeviceAuthHandler exposes the RFC 8628 device-authorization endpoints.
type DeviceAuthHandler struct {
	svc deviceAuthService
}

func NewDeviceAuthHandler(svc deviceAuthService) *DeviceAuthHandler {
	return &DeviceAuthHandler{svc: svc}
}

// RequestCode godoc
//
//	@Summary  Begin device authorization
//	@Tags     Auth
//	@Produce  json
//	@Success  200  {object}  dto.DeviceCodeResponse
//	@Router   /auth/device/code [post]
func (h *DeviceAuthHandler) RequestCode(c fiber.Ctx) error {
	resp, err := h.svc.RequestCode(c.Context())
	if err != nil {
		log.Error().Err(err).Msg("device code request failed")
		return dto.ErrInternal(c, "")
	}
	return c.JSON(resp)
}

// Approve godoc
//
//	@Summary   Approve a pending device authorization
//	@Tags      Auth
//	@Accept    json
//	@Produce   json
//	@Param     body  body  dto.ApproveDeviceRequest  true  "approval"
//	@Security  SessionAuth
//	@Router    /auth/device/approve [post]
func (h *DeviceAuthHandler) Approve(c fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == "" {
		return dto.ErrUnauthorized(c, "Missing session")
	}
	var req dto.ApproveDeviceRequest
	if err := c.Bind().JSON(&req); err != nil {
		return err
	}
	if req.UserCode == "" || req.ProjectID == "" {
		return dto.ErrBadRequest(c, "user_code and project_id are required")
	}

	err := h.svc.Approve(c.Context(), userID, req.UserCode, req.ProjectID)
	if errors.Is(err, services.ErrDeviceCodeNotFound) {
		return dto.ErrNotFound(c, "Device code not found or expired")
	}
	if errors.Is(err, services.ErrForbidden) {
		return dto.ErrForbidden(c, "Not a member of this organization")
	}
	if err != nil {
		log.Error().Err(err).Msg("device approve failed")
		return dto.ErrInternal(c, "")
	}
	return c.JSON(fiber.Map{"status": "approved"})
}

// ExchangeToken godoc
//
//	@Summary  Poll for the device-authorization result
//	@Tags     Auth
//	@Accept   json
//	@Produce  json
//	@Param    body  body  dto.DeviceTokenRequest  true  "poll"
//	@Success  200   {object}  dto.DeviceTokenResponse
//	@Failure  400   {object}  dto.DeviceErrorResponse
//	@Router   /auth/device/token [post]
func (h *DeviceAuthHandler) ExchangeToken(c fiber.Ctx) error {
	var req dto.DeviceTokenRequest
	if err := c.Bind().JSON(&req); err != nil {
		return err
	}
	if req.DeviceCode == "" {
		return c.Status(fiber.StatusBadRequest).JSON(dto.DeviceErrorResponse{Error: "invalid_request"})
	}

	resp, errCode, err := h.svc.ExchangeToken(c.Context(), req.DeviceCode)
	if err != nil {
		log.Error().Err(err).Msg("device token exchange failed")
		return dto.ErrInternal(c, "")
	}
	if errCode != "" {
		return c.Status(fiber.StatusBadRequest).JSON(dto.DeviceErrorResponse{Error: errCode})
	}
	return c.JSON(resp)
}
```

- [ ] **Step 2: Build**

Run: `cd /home/roman/projects/llmapi-router && go build ./internal/api/handlers/`
Expected: PASS. (Confirm `dto.ErrBadRequest`, `dto.ErrNotFound`, `dto.ErrUnauthorized`, `dto.ErrInternal` exist — they're used in `keys_api.go`.)

- [ ] **Step 3: Commit**

```bash
git add internal/api/handlers/device_auth.go
git commit -m "feat(device-auth): add DeviceAuthHandler endpoints"
```

---

### Task 4: Handler tests

**Files:**
- Create: `internal/api/handlers/device_auth_test.go`

- [ ] **Step 1: Write failing tests (mock service + fiber app.Test)**

```go
package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"

	"llmapi-router/internal/api/dto"
	"llmapi-router/internal/api/middleware"
	"llmapi-router/internal/services"
)

type mockDeviceSvc struct {
	code        dto.DeviceCodeResponse
	approveErr  error
	tokenResp   dto.DeviceTokenResponse
	tokenErr    string
	approveCall struct{ userID, userCode, projectID string }
}

func (m *mockDeviceSvc) RequestCode(_ context.Context) (dto.DeviceCodeResponse, error) {
	return m.code, nil
}
func (m *mockDeviceSvc) Approve(_ context.Context, userID, userCode, projectID string) error {
	m.approveCall.userID, m.approveCall.userCode, m.approveCall.projectID = userID, userCode, projectID
	return m.approveErr
}
func (m *mockDeviceSvc) ExchangeToken(_ context.Context, _ string) (dto.DeviceTokenResponse, string, error) {
	return m.tokenResp, m.tokenErr, nil
}

func doJSON(t *testing.T, app *fiber.App, method, path string, body any) (*http.Response, []byte) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	out, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	return resp, out
}

func TestRequestCode_ReturnsCodes(t *testing.T) {
	mock := &mockDeviceSvc{code: dto.DeviceCodeResponse{DeviceCode: "dc", UserCode: "WDJB-MJHT", Interval: 5}}
	h := NewDeviceAuthHandler(mock)
	app := fiber.New()
	app.Post("/auth/device/code", h.RequestCode)

	resp, body := doJSON(t, app, http.MethodPost, "/auth/device/code", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", resp.StatusCode, body)
	}
	var got dto.DeviceCodeResponse
	_ = json.Unmarshal(body, &got)
	if got.UserCode != "WDJB-MJHT" {
		t.Fatalf("want user_code WDJB-MJHT, got %q", got.UserCode)
	}
}

func TestApprove_MintsForSessionUser(t *testing.T) {
	mock := &mockDeviceSvc{}
	h := NewDeviceAuthHandler(mock)
	app := fiber.New()
	app.Post("/auth/device/approve", func(c fiber.Ctx) error {
		c.Locals(middleware.CtxKeyUserID, "user-123")
		return c.Next()
	}, h.Approve)

	resp, body := doJSON(t, app, http.MethodPost, "/auth/device/approve",
		dto.ApproveDeviceRequest{UserCode: "WDJB-MJHT", ProjectID: "proj-1"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", resp.StatusCode, body)
	}
	if mock.approveCall.userID != "user-123" || mock.approveCall.projectID != "proj-1" {
		t.Fatalf("approve got %+v", mock.approveCall)
	}
}

func TestApprove_NotFound(t *testing.T) {
	mock := &mockDeviceSvc{approveErr: services.ErrDeviceCodeNotFound}
	h := NewDeviceAuthHandler(mock)
	app := fiber.New()
	app.Post("/auth/device/approve", func(c fiber.Ctx) error {
		c.Locals(middleware.CtxKeyUserID, "user-123")
		return c.Next()
	}, h.Approve)

	resp, _ := doJSON(t, app, http.MethodPost, "/auth/device/approve",
		dto.ApproveDeviceRequest{UserCode: "NOPE-NOPE", ProjectID: "proj-1"})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404, got %d", resp.StatusCode)
	}
}

func TestExchangeToken_PendingReturns400Code(t *testing.T) {
	mock := &mockDeviceSvc{tokenErr: services.ErrCodeAuthorizationPending}
	h := NewDeviceAuthHandler(mock)
	app := fiber.New()
	app.Post("/auth/device/token", h.ExchangeToken)

	resp, body := doJSON(t, app, http.MethodPost, "/auth/device/token",
		dto.DeviceTokenRequest{DeviceCode: "dc", GrantType: "urn:ietf:params:oauth:grant-type:device_code"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", resp.StatusCode)
	}
	var e dto.DeviceErrorResponse
	_ = json.Unmarshal(body, &e)
	if e.Error != "authorization_pending" {
		t.Fatalf("want authorization_pending, got %q", e.Error)
	}
}

func TestExchangeToken_ApprovedReturnsKey(t *testing.T) {
	mock := &mockDeviceSvc{tokenResp: dto.DeviceTokenResponse{APIKey: "llmapi_abc", ProjectID: "proj-1", Name: "Kilo Code"}}
	h := NewDeviceAuthHandler(mock)
	app := fiber.New()
	app.Post("/auth/device/token", h.ExchangeToken)

	resp, body := doJSON(t, app, http.MethodPost, "/auth/device/token",
		dto.DeviceTokenRequest{DeviceCode: "dc"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", resp.StatusCode, body)
	}
	var got dto.DeviceTokenResponse
	_ = json.Unmarshal(body, &got)
	if got.APIKey != "llmapi_abc" {
		t.Fatalf("want key llmapi_abc, got %q", got.APIKey)
	}
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /home/roman/projects/llmapi-router && go test ./internal/api/handlers/ -run TestRequestCode\|TestApprove\|TestExchangeToken -v`
Expected: all PASS. (If the handler interface signatures differ from the mock, align them — the mock defines the contract.)

- [ ] **Step 3: Commit**

```bash
git add internal/api/handlers/device_auth_test.go
git commit -m "test(device-auth): handler tests for the device-authorization endpoints"
```

---

### Task 5: Wire routes

**Files:**
- Modify: `internal/api/routes.go`

- [ ] **Step 1: Construct the service + handler and register routes**

After the API key service is constructed (around `apiKeySvc := service.NewAPIKeyService(...)`, line ~357), add:

```go
	// Device-authorization grant (RFC 8628) for external apps (e.g. Kilo Code).
	deviceAuthSvc := service.NewDeviceAuthService(deps.Redis, apiKeySvc, dashboardBaseURL(deps.Config))
	deviceAuthH := handlers.NewDeviceAuthHandler(deviceAuthSvc)
```

In the `authGroup` block (around line 230), register:

```go
	authGroup.Post("/device/code", authRL, deviceAuthH.RequestCode)
	authGroup.Post("/device/approve", auth, deviceAuthH.ApproveLimited(authRL), deviceAuthH.Approve) // see note
	authGroup.Post("/device/token", authRL, deviceAuthH.ExchangeToken)
```

> Simpler form if you don't need a second limiter on approve: `authGroup.Post("/device/approve", auth, deviceAuthH.Approve)`. Use the existing `authRL` rate limiter already defined in this file (same one applied to `/sign-in/email`).

- [ ] **Step 2: Add the dashboard URL helper**

`NewDeviceAuthService` needs the public dashboard base URL (`UI_URL`). Add a small helper near the top of `routes.go` (or inline it) that reads it from the loaded config — the value is the same `UI_URL` env that `internal/auth/config.go` reads as `AppURL`:

```go
func dashboardBaseURL(cfg *config.Config) string {
	// UI_URL is the public dashboard base used for device-flow verification links.
	if v := os.Getenv("UI_URL"); v != "" {
		return v
	}
	return "https://app.llmapi.ai"
}
```

> If `config.Config` already surfaces `UI_URL` as a field, prefer reading it from `cfg` instead of `os.Getenv`. Confirm the field name in `internal/config/config.go` and use it; the `os.Getenv` fallback above keeps the build green if not.

- [ ] **Step 3: Build the whole API**

Run: `cd /home/roman/projects/llmapi-router && go build ./cmd/api/ && go vet ./internal/...`
Expected: PASS.

- [ ] **Step 4: Regenerate Swagger**

Run: `cd /home/roman/projects/llmapi-router && make swag-gen-api`
Expected: `cmd/api/docs/` updated with the three `/auth/device/*` operations.

- [ ] **Step 5: Commit**

```bash
git add internal/api/routes.go cmd/api/docs/
git commit -m "feat(device-auth): register /auth/device/* routes and regenerate swagger"
```

---

### Task 6: Dashboard `/device` approval page (llmapi-app)

**Files (in `/home/roman/projects/llmapi-app`, dashboard app):**
- Create a `/device` route/page in the dashboard app.

> Frontend specifics are owned on the frontend side. The page contract is fixed by this plan:

- [ ] **Step 1:** Read `user_code` from the query string; pre-fill it (allow manual entry too).
- [ ] **Step 2:** Require auth — if no session, redirect to login and return to `/device?user_code=...`.
- [ ] **Step 3:** Show the `user_code` for visual confirmation; render an **org → project selector** (reuse existing org/project hooks from the dashboard).
- [ ] **Step 4:** On **Approve**, `POST /auth/device/approve` with `{ user_code, project_id }` (credentials: include the session cookie). Show success / `404 not-found-or-expired` / error states. Never display an API key on this page.
- [ ] **Step 5:** Manual check against dev: open `verification_uri_complete` from a `POST /auth/device/code` call, approve, and confirm a `200 {"status":"approved"}`.
- [ ] **Step 6: Commit (in llmapi-app)**

```bash
git add <device page files>
git commit -m "feat(dashboard): device-authorization approval page"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1:** Run the API locally (per `llm-local-cluster` or the repo's run instructions) with Redis available.
- [ ] **Step 2:** `curl -XPOST $API/auth/device/code` → capture `device_code`, `user_code`, `verification_uri_complete`.
- [ ] **Step 3:** Poll `curl -XPOST $API/auth/device/token -d '{"device_code":"..."}'` → expect `{"error":"authorization_pending"}`, then `{"error":"slow_down"}` if polled twice within 5s.
- [ ] **Step 4:** Open `verification_uri_complete`, log in, approve with a project.
- [ ] **Step 5:** Poll `/auth/device/token` again → expect `200 {"api_key":"llmapi_...","project_id":"...","name":"Kilo Code"}`. Confirm the key appears in the dashboard and authenticates against `GET /v1/models`/`/v1/chat/completions`. Poll once more → `expired_token` (record consumed).

---

## Self-Review notes

- **Spec coverage:** §4.1 `RequestCode`, §4.2 `Approve` (session-authed, mints via `APIKeyService.Create`), §4.3 `ExchangeToken` (RFC 8628 codes incl. `slow_down`), §4.4 security (high-entropy device_code, single-use, TTL, key bound to approving user+project), §5 approval page contract.
- **Known-unknowns flagged explicitly:** the exact `dto.CreateAPIKeyRequest` field names and the `config.Config` field for `UI_URL` — both have concrete confirm-and-align steps with safe fallbacks, not placeholders.
- **Test strategy:** handler tests use the repo's established mock-service + `app.Test` pattern (no new deps). A Redis-backed `DeviceAuthService` integration test with `miniredis` is optional follow-up — check `go.mod` for `github.com/alicebob/miniredis/v2` before adding.
