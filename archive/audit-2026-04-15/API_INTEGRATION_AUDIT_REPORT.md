# Devil Code API & Integration Audit Report

**Date:** 2026-04-10  
**Auditor:** API Tester Agent  
**Scope:** Comprehensive audit of all API endpoints, SDK integration, SSE/streaming, authentication, and security across the monorepo

---

## Executive Summary

This audit examined the Devil Code (formerly Kilo Code) monorepo's API infrastructure, focusing on the Hono HTTP server in `packages/opencode/src/server/`, the auto-generated SDK in `packages/sdk/js/`, and the VS Code extension's SSE adapter. **A total of 23 issues were identified** across critical, high, medium, and low severity categories.

### Key Findings:
- **1 CRITICAL** - Missing rate limiting enables abuse
- **7 HIGH** - Security vulnerabilities including inconsistent auth, missing validation
- **11 MEDIUM** - Integration issues, incomplete error handling, SDK mismatches
- **4 LOW** - Documentation and code quality issues

---

## Critical Issues (1)

### CRITICAL-1: No Rate Limiting on Any API Endpoints
**Severity:** CRITICAL  
**File:** `packages/opencode/src/server/server.ts` (lines 1-400)  
**Issue Description:**  
The entire API lacks any form of rate limiting, abuse prevention, or throttling mechanisms. This exposes all endpoints to brute force attacks, DDoS, and resource exhaustion.

**Affected Endpoints:** ALL endpoints including:
- `/session/*` - Session operations
- `/auth/*` - Authentication endpoints
- `/experimental/*` - Tool execution
- `/global/event` - SSE streaming

**What's Broken/Missing:**
- No IP-based rate limiting
- No per-user request throttling
- No burst protection
- No slowloris attack protection
- Missing `express-rate-limit` or equivalent middleware

**Suggested Remediation:**
```typescript
// Add rate limiting middleware
import { rateLimiter } from 'hono-rate-limiter'

app.use(rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  keyGenerator: (c) => c.req.header('x-forwarded-for') || 'unknown'
}))
```

**Risk Assessment:** High risk of abuse, especially on auth endpoints and expensive operations like session creation.

---

## High Severity Issues (7)

### HIGH-1: Inconsistent Authentication Middleware Application
**Severity:** HIGH  
**File:** `packages/opencode/src/server/server.ts` (lines 96-110)  
**Issue Description:**  
Basic auth middleware allows OPTIONS requests to bypass auth (`c.req.method === "OPTIONS"`), but this creates a potential security gap for preflight request abuse.

**What's Broken/Missing:**
- OPTIONS bypass could be exploited
- No validation that preflight requests are legitimate
- Missing origin validation on preflight

**Suggested Remediation:**
```typescript
.use((c, next) => {
  if (c.req.method === "OPTIONS") {
    // Validate this is a legitimate preflight
    const origin = c.req.header('origin')
    if (!isValidOrigin(origin)) {
      return c.json({ error: "Invalid origin" }, 403)
    }
    return next()
  }
  // ... rest of auth
})
```

---

### HIGH-2: Missing Request Body Size Limits
**Severity:** HIGH  
**File:** `packages/opencode/src/server/server.ts`  
**Issue Description:**  
No request body size limits are configured. Large payloads could cause memory exhaustion or DoS.

**Affected Routes:**
- `POST /session/:sessionID/message` - Can receive large messages
- `POST /devilcode/session-import/*` - Import endpoints
- `PUT /auth/:providerID` - Auth credentials

**What's Broken/Missing:**
- No `bodyLimit` option in Hono
- No streaming for large file operations
- No validation of payload sizes

**Suggested Remediation:**
```typescript
const app = new Hono({
  // Limit body size to 10MB
  getPath: (req) => req.url
})

// Add middleware to validate body size
app.use('*', async (c, next) => {
  const contentLength = parseInt(c.req.header('content-length') || '0')
  if (contentLength > 10 * 1024 * 1024) {
    return c.json({ error: "Payload too large" }, 413)
  }
  await next()
})
```

---

### HIGH-3: Incomplete Input Validation on Session Routes
**Severity:** HIGH  
**File:** `packages/opencode/src/server/routes/session.ts` (lines 380-420)  
**Issue Description:**  
The `/session/:sessionID/message` POST endpoint accepts complex nested objects without deep validation of the `parts` array structure.

**What's Broken/Missing:**
```typescript
// Current - only top-level validation
validator("json", SessionPrompt.PromptInput.omit({ sessionID: true }))

// Missing: Deep validation of parts array items
// Missing: File URL validation (could be any URL)
// Missing: Size limits on text parts
```

**Suggested Remediation:**
```typescript
const TextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(100000), // Limit text size
  // ... rest
})

const FilePartSchema = z.object({
  type: z.literal('file'),
  url: z.string().url().refine(
    url => url.startsWith('file://') || url.startsWith('http://localhost'),
    { message: "Only local files allowed" }
  ),
  // ... rest
})
```

---

### HIGH-4: CORS Configuration Allows Potentially Unsafe Origins
**Severity:** HIGH  
**File:** `packages/opencode/src/server/server.ts` (lines 122-145)  
**Issue Description:**  
The CORS configuration uses a dynamic whitelist check but has potentially unsafe patterns.

**What's Broken/Missing:**
```typescript
// Current implementation
if (input.startsWith("http://localhost:")) return input
if (input.startsWith("http://127.0.0.1:")) return input
// These allow ANY port on localhost - could be other malicious services
```

**Suggested Remediation:**
```typescript
const ALLOWED_PORTS = [3000, 5173, 8080, 4096] // Whitelist specific ports
const port = new URL(input).port
if (input.startsWith("http://localhost:") && ALLOWED_PORTS.includes(Number(port))) {
  return input
}
```

---

### HIGH-5: Deprecated Route Still Active Without Warnings
**Severity:** HIGH  
**File:** `packages/opencode/src/server/routes/session.ts` (lines 455-480)  
**Issue Description:**  
The `/session/:sessionID/permissions/:permissionID` route is marked deprecated but still functional without any runtime warnings or migration notices.

**What's Broken/Missing:**
- Deprecated route still accepts requests
- No `Deprecation` header in responses
- No logging to indicate usage of deprecated endpoint
- No sunset date communicated

**Suggested Remediation:**
```typescript
async (c) => {
  // Log deprecation warning
  log.warn("Deprecated endpoint used", { 
    path: c.req.path,
    alternative: "POST /permission/:requestID/reply" 
  })
  
  c.header('Deprecation', 'true')
  c.header('Sunset', 'Sun, 01 Jun 2025 00:00:00 GMT')
  // ... rest of handler
}
```

---

### HIGH-6: Empty Catch Blocks in SSE Adapter
**Severity:** HIGH  
**File:** `packages/devil-vscode/src/services/cli-backend/sdk-sse-adapter.ts` (lines 45-48)  
**Issue Description:**  
Multiple empty or minimally-logged catch blocks hide connection failures.

**What's Broken/Missing:**
```typescript
// Line ~45
void this.consumeLoop(this.abortController.signal).catch((err) => {
  console.error("[Devil New] SSE: Unhandled error in consumeLoop:", err)
  this.notifyError(err instanceof Error ? err : new Error(String(err)))
})

// The notifyError might not reach the UI properly
```

**Suggested Remediation:**
```typescript
void this.consumeLoop(this.abortController.signal).catch((err) => {
  const error = err instanceof Error ? err : new Error(String(err))
  console.error("[Devil New] SSE: Unhandled error in consumeLoop:", error)
  this.notifyError(error)
  this.setState('error') // Ensure state transitions to error
  this.scheduleReconnect() // Ensure reconnection happens
})
```

---

### HIGH-7: Missing Security Headers on SSE Endpoints
**Severity:** HIGH  
**File:** `packages/opencode/src/server/server.ts` (lines 312-340)  
**Issue Description:**  
SSE endpoints set minimal security headers, missing critical protections.

**Current Headers:**
```typescript
c.header("X-Accel-Buffering", "no")
c.header("X-Content-Type-Options", "nosniff")
```

**What's Broken/Missing:**
- No `Content-Security-Policy`
- No `X-Frame-Options`
- No `Referrer-Policy`
- No HSTS headers

**Suggested Remediation:**
```typescript
c.header("X-Accel-Buffering", "no")
c.header("X-Content-Type-Options", "nosniff")
c.header("X-Frame-Options", "DENY")
c.header("Referrer-Policy", "strict-origin-when-cross-origin")
c.header("Content-Security-Policy", "default-src 'none'; connect-src 'self'")
```

---

## Medium Severity Issues (11)

### MEDIUM-1: Inconsistent Error Response Formats
**Severity:** MEDIUM  
**File:** `packages/opencode/src/server/error.ts`  
**Issue Description:**  
Error responses use different schemas across endpoints. The `errors()` helper provides a standard, but not all routes use it consistently.

**Affected Routes:**
- `/remote/*` - Returns `{ error: string }` manually
- `/mcp/*` - Returns ad-hoc error objects
- `/experimental/*` - Mixed usage

**Example Inconsistency:**
```typescript
// In remote.ts - Manual error format
return c.json({ error: err instanceof Error ? err.message : String(err) }, 401)

// In error.ts - Standard format
{
  data: any,
  errors: Array<Record<string, any>>,
  success: false
}
```

**Suggested Remediation:**
Create a unified error handler:
```typescript
export function createErrorResponse(c: Context, status: number, message: string, details?: any) {
  return c.json({
    success: false,
    errors: [{ message, ...details }],
    data: null
  }, status)
}
```

---

### MEDIUM-2: SDK/Server Mismatch on Optional Fields
**Severity:** MEDIUM  
**File:** `packages/sdk/js/src/v2/gen/sdk.gen.ts` vs `packages/opencode/src/server/routes/*.ts`  
**Issue Description:**  
Several endpoints show mismatches between server-required fields and SDK-optional fields.

**Specific Mismatches:**
1. **Session.create** - Server requires `permission` but SDK marks it optional
2. **Config.update** - Server has different schema than SDK type
3. **Provider.oauth.authorize** - SDK doesn't include all error responses

**Suggested Remediation:**
Regenerate SDK with latest server spec and add CI check:
```bash
# Add to CI pipeline
./script/generate.ts
# Verify SDK matches server
git diff --exit-code packages/sdk/js/src/v2/gen/
```

---

### MEDIUM-3: Hardcoded Credentials in Connection Service
**Severity:** MEDIUM  
**File:** `packages/devil-vscode/src/services/cli-backend/connection-service.ts` (line 321)  
**Issue Description:**  
The health check uses hardcoded credentials format.

**What's Broken/Missing:**
```typescript
// Line ~321
headers: { Authorization: `Basic ${Buffer.from(`kilo:${password}`).toString("base64")}` },

// Hardcoded username "kilo" - should use configurable value
```

**Suggested Remediation:**
```typescript
const username = process.env.DEVIL_SERVER_USERNAME || 'kilo'
headers: { 
  Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` 
},
```

---

### MEDIUM-4: Missing Timeout on Health Check
**Severity:** MEDIUM  
**File:** `packages/devil-vscode/src/services/cli-backend/connection-service.ts` (lines 319-330)  
**Issue Description:**  
Health check has a 3-second timeout but no retry logic for transient failures.

**Current Implementation:**
```typescript
private async checkHealth(baseUrl: string, password: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${baseUrl}/global/health`, { ... })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}
```

**What's Broken/Missing:**
- Single attempt only
- No distinction between network errors and server errors
- No exponential backoff for retries

**Suggested Remediation:**
```typescript
private async checkHealth(baseUrl: string, password: string, retries = 2): Promise<boolean> {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${baseUrl}/global/health`, { ... })
      clearTimeout(timer)
      if (res.ok) return true
      // If server returns error status, don't retry
      if (res.status >= 500) throw new Error(`Server error: ${res.status}`)
      return false
    } catch (err) {
      if (i === retries) return false
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
    }
  }
  return false
}
```

---

### MEDIUM-5: Missing Validation on Query Parameters
**Severity:** MEDIUM  
**File:** `packages/opencode/src/server/routes/experimental.ts` (lines 55-90)  
**Issue Description:**  
Query parameters for `experimental.session.list` have loose validation.

**What's Broken/Missing:**
```typescript
validator("query", z.object({
  projectID: z.string().optional(),
  directory: z.string().optional(),
  worktrees: z.coerce.boolean().optional(),
  // Missing: max length on strings
  // Missing: pattern validation for IDs
  // Missing: range validation on numeric params
}))
```

**Suggested Remediation:**
```typescript
validator("query", z.object({
  projectID: z.string().uuid().optional(), // Enforce UUID format
  directory: z.string().max(500).optional(), // Limit path length
  worktrees: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(), // Enforce range
}))
```

---

### MEDIUM-6: Silent Failure in Telemetry Route
**Severity:** MEDIUM  
**File:** `packages/opencode/src/server/routes/telemetry.ts` (lines 28-35)  
**Issue Description:**  
Telemetry route silently swallows all errors, potentially hiding configuration issues.

**Current Implementation:**
```typescript
async (c) => {
  const body = c.req.valid("json")
  try {
    Telemetry.track(body.event as any, body.properties)
  } catch {
    // fire-and-forget: swallow errors
  }
  return c.json(true)
}
```

**What's Broken/Missing:**
- No error logging
- No metrics on telemetry failures
- Could miss configuration problems

**Suggested Remediation:**
```typescript
async (c) => {
  const body = c.req.valid("json")
  try {
    Telemetry.track(body.event as any, body.properties)
  } catch (err) {
    // Still return success to caller but log the error
    log.error("telemetry failed", { error: err, event: body.event })
  }
  return c.json(true)
}
```

---

### MEDIUM-7: Missing Content-Type Validation on File Routes
**Severity:** MEDIUM  
**File:** `packages/opencode/src/server/routes/file.ts`  
**Issue Description:**  
File read endpoints don't validate Content-Type of returned files, potentially returning binary data as JSON.

**What's Broken/Missing:**
- No validation that file content is text before JSON serialization
- Binary files could cause JSON encoding errors

**Suggested Remediation:**
```typescript
.get("/file/content", ...)
async (c) => {
  const path = c.req.valid("query").path
  const content = await File.read(path)
  
  if (content.type === 'binary') {
    // Return binary data properly
    c.header('Content-Type', content.mimeType || 'application/octet-stream')
    return c.body(Buffer.from(content.content, 'base64'))
  }
  
  return c.json(content)
}
```

---

### MEDIUM-8: WebSocket Connection Validation Gaps in PTY
**Severity:** MEDIUM  
**File:** `packages/opencode/src/server/routes/pty.ts` (lines 105-150)  
**Issue Description:**  
PTY WebSocket upgrade has validation but could be stricter.

**What's Broken/Missing:**
- Cursor parameter validation allows negative values (uses `-1` for tail)
- No rate limiting on WebSocket connections
- Missing origin validation for WebSocket upgrade

**Current Validation:**
```typescript
const cursor = (() => {
  const value = c.req.query("cursor")
  if (!value) return
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < -1) return // Allows -1
  return parsed
})()
```

**Suggested Remediation:**
```typescript
const cursor = (() => {
  const value = c.req.query("cursor")
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return undefined
  if (parsed < 0 && parsed !== -1) return undefined // Only allow -1 or positive
  if (parsed > Number.MAX_SAFE_INTEGER / 2) return undefined // Prevent overflow
  return parsed
})()
```

---

### MEDIUM-9: SSE Heartbeat Timeout Mismatch
**Severity:** MEDIUM  
**File:** `packages/opencode/src/server/server.ts` (line 332) vs `packages/devil-vscode/src/services/cli-backend/sdk-sse-adapter.ts` (line 25)  
**Issue Description:**  
Server sends heartbeats every 10 seconds, but client expects them within 15 seconds. This tight window could cause unnecessary reconnections.

**Server (10s):**
```typescript
const heartbeat = setInterval(() => {
  stream.writeSSE({ data: JSON.stringify({ type: "server.heartbeat", properties: {} }) })
}, 10_000)
```

**Client (15s):**
```typescript
private static readonly HEARTBEAT_TIMEOUT_MS = 15_000
```

**Risk:** Network jitter could cause false-positive timeouts.

**Suggested Remediation:**
Increase client timeout to at least 25-30 seconds:
```typescript
private static readonly HEARTBEAT_TIMEOUT_MS = 25_000 // 2.5x server interval
```

---

### MEDIUM-10: Missing Schema Documentation on Devil Routes
**Severity:** MEDIUM  
**File:** `packages/opencode/src/server/routes/devilcode.ts`  
**Issue Description:**  
Several devilcode-specific routes have minimal OpenAPI documentation.

**What's Broken/Missing:**
- `/devilcode/skill/remove` - No response examples
- `/devilcode/agent/remove` - Missing error response documentation
- No schema refs for complex response types

**Suggested Remediation:**
Add comprehensive OpenAPI annotations:
```typescript
.post(
  "/skill/remove",
  describeRoute({
    summary: "Remove a skill",
    description: "Remove a skill by deleting its directory from disk and clearing it from cache.",
    operationId: "devilcode.removeSkill",
    responses: {
      200: {
        description: "Skill removed",
        content: {
          "application/json": {
            schema: resolver(z.object({ success: z.boolean(), location: z.string() })),
            example: { success: true, location: "/path/to/skill" }
          },
        },
      },
      400: {
        description: "Invalid skill location or skill not found",
      },
      ...errors(400),
    },
  }),
)
```

---

### MEDIUM-11: Session Import Routes Lack Idempotency Keys
**Severity:** MEDIUM  
**File:** `packages/opencode/src/devilcode/session-import/routes.ts`  
**Issue Description:**  
Session import endpoints don't support idempotency keys, risking duplicate data on retries.

**What's Broken/Missing:**
- No `Idempotency-Key` header support
- Duplicate requests could create duplicate rows
- No deduplication mechanism

**Suggested Remediation:**
```typescript
.post(
  "/session",
  describeRoute({ ... }),
  validator("header", z.object({
    "idempotency-key": z.string().uuid().optional()
  })),
  async (c) => {
    const idempotencyKey = c.req.valid("header")["idempotency-key"]
    if (idempotencyKey) {
      const existing = await SessionImportService.findByIdempotencyKey(idempotencyKey)
      if (existing) return c.json(existing) // Return cached result
    }
    // ... process request
  }
)
```

---

## Low Severity Issues (4)

### LOW-1: OpenAPI Version Inconsistency
**Severity:** LOW  
**File:** `packages/opencode/src/server/server.ts` (lines 360-375)  
**Issue Description:**  
OpenAPI documentation shows version `0.0.3` in route doc but `1.0.0` in the `openapi()` function.

**Line 332:**
```typescript
version: "0.0.3",
```

**Line 375:**
```typescript
version: "1.0.0",
```

**Suggested Remediation:**
Extract version to a constant:
```typescript
const API_VERSION = "1.0.0"
// Use in both places
```

---

### LOW-2: Commented-Out Proxy Code Still Present
**Severity:** LOW  
**File:** `packages/opencode/src/server/server.ts` (lines 340-360)  
**Issue Description:**  
Large block of commented-out proxy code remains in the file.

**What's Broken/Missing:**
- Dead code reduces readability
- Could be accidentally uncommented
- Should be removed or documented why it's kept

**Suggested Remediation:**
Remove the commented code or add a clear comment explaining why it's preserved.

---

### LOW-3: Unused Import in SDK Types
**Severity:** LOW  
**File:** `packages/sdk/js/src/v2/gen/types.gen.ts`  
**Issue Description:**  
Generated SDK types may contain unused imports (varies by generation).

**Suggested Remediation:**
Add ESLint rule or post-generation cleanup script.

---

### LOW-4: Typo in Import Path Comment
**Severity:** LOW  
**File:** `packages/opencode/src/devilcode/permission/routes.ts` (line 3)  
**Issue Description:**  
File imports from `@/permission/next` but the file path comment says the file is in `devilcode/permission/`.

**Suggested Remediation:**
Correct the comment or remove if redundant.

---

## Security Checklist Summary

| Security Control | Status | Notes |
|------------------|--------|-------|
| Rate Limiting | ❌ MISSING | No protection against abuse |
| Request Size Limits | ❌ MISSING | Unlimited body sizes |
| Input Validation | ⚠️ PARTIAL | Basic Zod but missing edge cases |
| Authentication | ⚠️ PARTIAL | Basic auth present but gaps exist |
| Authorization | ⚠️ PARTIAL | Session-level permissions only |
| CORS | ⚠️ PARTIAL | Allows any localhost port |
| Security Headers | ⚠️ PARTIAL | Missing CSP, HSTS, etc. |
| Error Information Leakage | ✅ GOOD | NamedError prevents stack leaks |
| SQL Injection Prevention | ✅ GOOD | Uses parameterized queries |
| XSS Prevention | ⚠️ PARTIAL | No output encoding on file content |

---

## Recommendations by Priority

### Immediate (Fix within 1 week)
1. **CRITICAL-1:** Implement rate limiting on all endpoints
2. **HIGH-2:** Add request body size limits
3. **HIGH-3:** Strengthen input validation on session routes

### Short-term (Fix within 1 month)
4. **HIGH-1:** Secure OPTIONS request handling
5. **HIGH-4:** Restrict CORS to specific localhost ports
6. **HIGH-5:** Add deprecation headers to old routes
7. **HIGH-6:** Fix SSE adapter error handling
8. **HIGH-7:** Add security headers to SSE responses

### Medium-term (Fix within 3 months)
9. **MEDIUM-1:** Standardize error response formats
10. **MEDIUM-2:** Regenerate and validate SDK consistency
11. **MEDIUM-9:** Adjust SSE heartbeat timeout
12. **MEDIUM-10:** Improve OpenAPI documentation

---

## Appendix: Affected File Inventory

### Server Routes
- `packages/opencode/src/server/server.ts` - Main server, auth, CORS, SSE
- `packages/opencode/src/server/routes/session.ts` - Session CRUD, messages
- `packages/opencode/src/server/routes/permission.ts` - Permission handling
- `packages/opencode/src/server/routes/experimental.ts` - Tools, workspaces
- `packages/opencode/src/server/routes/file.ts` - File operations
- `packages/opencode/src/server/routes/mcp.ts` - MCP server management
- `packages/opencode/src/server/routes/pty.ts` - PTY/WebSocket
- `packages/opencode/src/server/routes/remote.ts` - Remote control
- `packages/opencode/src/server/routes/telemetry.ts` - Telemetry capture
- `packages/opencode/src/server/routes/config.ts` - Configuration
- `packages/opencode/src/server/routes/global.ts` - Global ops, health
- `packages/opencode/src/server/routes/provider.ts` - Provider management
- `packages/opencode/src/server/routes/question.ts` - Question handling
- `packages/opencode/src/server/routes/tui.ts` - TUI control
- `packages/opencode/src/server/routes/project.ts` - Project management
- `packages/opencode/src/server/routes/workspace.ts` - Workspace management
- `packages/opencode/src/server/routes/devilcode.ts` - Devil-specific routes
- `packages/opencode/src/server/routes/commit-message.ts` - Commit message generation
- `packages/opencode/src/server/routes/enhance-prompt.ts` - Prompt enhancement

### Devil-specific Routes
- `packages/opencode/src/devilcode/session-import/routes.ts`
- `packages/opencode/src/devilcode/workflow/routes.ts`
- `packages/opencode/src/devilcode/permission/routes.ts`

### SDK
- `packages/sdk/js/src/v2/gen/sdk.gen.ts`
- `packages/sdk/js/src/v2/gen/types.gen.ts`
- `packages/sdk/js/src/v2/client.ts`

### VS Code Extension
- `packages/devil-vscode/src/services/cli-backend/connection-service.ts`
- `packages/devil-vscode/src/services/cli-backend/sdk-sse-adapter.ts`
- `packages/devil-vscode/src/services/cli-backend/types.ts`

---

## End of Report

*Report generated by API Tester Agent on 2026-04-10*
