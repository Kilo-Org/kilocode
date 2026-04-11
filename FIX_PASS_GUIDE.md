# DevilCode Fix Pass Guide

**Companion to CODE_AUDIT_REPORT.md**  
**Date:** April 10, 2026  

---

## Overview

This guide provides detailed, actionable instructions for fixing the issues identified in the code audit. Fixes are organized by category and priority.

---

## Phase 1: Critical Security Fixes (Week 1)

### 1.1 Remove/Secure Hardcoded PostHog API Key

**File:** `packages/devil-telemetry/src/client.ts:5`

**Current:**
```typescript
const POSTHOG_API_KEY = "phc_REDACTED_KEY"
```

**Fix:**
```typescript
const POSTHOG_API_KEY = process.env.DEVIL_POSTHOG_API_KEY ?? ""

if (!POSTHOG_API_KEY) {
  console.warn("[Telemetry] PostHog API key not configured, telemetry disabled")
}
```

**Steps:**
1. Read the API key from environment variable
2. Add validation to warn if key is missing
3. Gracefully disable telemetry if key not available
4. Rotate the exposed key in PostHog dashboard immediately
5. Add `DEVIL_POSTHOG_API_KEY` to deployment secrets

---

### 1.2 Enable CSP in Tauri Configuration

**File:** `packages/desktop/tauri.conf.json:22`

**Current:**
```json
"csp": null
```

**Fix:**
```json
"csp": {
  "default-src": "'self'",
  "script-src": "'self' 'unsafe-inline'",
  "style-src": "'self' 'unsafe-inline'",
  "connect-src": "'self' http://localhost:* https://api.devil.ai https://app.devil.ai",
  "img-src": "'self' data: https:",
  "font-src": "'self'"
}
```

**Steps:**
1. Define CSP policy restricting resources
2. Allow localhost for development
3. Add production API domains
4. Test all app functionality with CSP enabled
5. Check browser console for CSP violations

---

### 1.3 Enable Sandbox in Electron Windows

**File:** `packages/desktop-electron/src/main/windows.ts:61,94`

**Current:**
```javascript
webPreferences: {
  sandbox: false,
  // ...
}
```

**Fix:**
```javascript
webPreferences: {
  sandbox: true,
  contextIsolation: true,
  preload: path.join(__dirname, "../preload/index.js"),
  // Remove nodeIntegration if present
}
```

**Steps:**
1. Enable `sandbox: true` for all windows
2. Ensure `contextIsolation: true` is set
3. Move all Node.js API usage to preload script
4. Expose only required APIs via `contextBridge`
5. Test all functionality thoroughly

---

### 1.4 Add Signature Verification for Downloaded Scripts

**Files:**
- `packages/desktop/src-tauri/src/cli.rs:405-408`
- `packages/desktop-electron/src/main/cli.ts:220`

**Approach:**

1. **Generate checksums** for install scripts during build:
```bash
sha256sum install.sh > install.sh.sha256
```

2. **Embed expected checksum** in app:
```typescript
// In source code
const INSTALL_SCRIPT_SHA256 = "abc123..." // Build-time injected
```

3. **Verify after download:**
```typescript
import { createHash } from 'crypto'

async function verifyScript(content: string): Promise<boolean> {
  const hash = createHash('sha256').update(content).digest('hex')
  return hash === INSTALL_SCRIPT_SHA256
}

// Before executing
if (!await verifyScript(scriptContent)) {
  throw new Error("Script verification failed - possible tampering")
}
```

4. **Alternative: GPG signature verification**
```bash
gpg --verify install.sh.sig install.sh
```

---

### 1.5 Fix OAuth Token Migration

**File:** `packages/devil-gateway/src/auth/legacy-migration.ts:84-91`

**Current:**
```typescript
await saveDevilAuth({
  type: "oauth",
  access: legacy.token,
  refresh: "",
  expires: 0,
  accountId: legacy.organizationId,
})
```

**Fix:**
```typescript
// Option 1: Set expiration and require immediate refresh
const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000 // 5 minutes
await saveDevilAuth({
  type: "oauth",
  access: legacy.token,
  refresh: legacy.refreshToken ?? "", // Include if available
  expires: Date.now() + TOKEN_EXPIRY_BUFFER,
  accountId: legacy.organizationId,
})

// Trigger immediate token refresh
await refreshTokenIfNeeded()

// Option 2: Invalidate and require re-auth
await saveDevilAuth({
  type: "invalid",
  reason: "migration_requires_reauth",
  accountId: legacy.organizationId,
})
```

**Steps:**
1. Determine migration strategy (refresh vs re-auth)
2. Update migration function
3. Add migration tracking to prevent loops
4. Test with expired legacy tokens

---

### 1.6 Restrict HTTP Permissions in Tauri

**File:** `packages/desktop/capabilities/default.json:46-50`

**Current:**
```json
"permissions": [
  "http://*",
  "https://*",
  "http://*:*/*"
]
```

**Fix:**
```json
"permissions": [
  "http://localhost:*",
  "https://api.devil.ai/*",
  "https://app.devil.ai/*",
  "https://github.com/*",
  "https://*.posthog.com/*"
]
```

**Steps:**
1. Identify all required external domains
2. Add explicit permissions for each
3. Remove wildcard permissions
4. Test all API integrations
5. Document required domains

---

## Phase 2: Critical Stability Fixes (Week 2)

### 2.1 Fix Type Safety in Chat Model

**File:** `packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts:374`

**Current:**
```typescript
// MUST FIX - type safety lost
const chunk: any = /* ... */
```

**Investigation Steps:**
1. Read file to understand context
2. Identify what caused type inference loss
3. Check if error schema is interfering
4. Restore proper typing

**Possible Fix:**
```typescript
// Define proper union type
interface ChatChunk {
  type: "text" | "tool_call" | "error"
  content?: string
  toolCall?: ToolCall
  error?: ErrorInfo
}

const chunk: ChatChunk = parseChunk(rawChunk)
// Use type guards
if (chunk.type === "text") {
  // chunk.content is string
}
```

---

### 2.2 Fix Unhandled Promise Rejections

**File:** `packages/devil-vscode/src/KiloProvider.ts`

**Pattern to Fix:**
```typescript
// Before (bad)
this.continueInWorktree(sessionId).catch((e) => {
  console.error("Failed to continue in worktree", e)
})

// After (good)
try {
  await this.continueInWorktree(sessionId)
} catch (e) {
  console.error("Failed to continue in worktree", e)
  vscode.window.showErrorMessage(`Failed to continue in worktree: ${e.message}`)
}
```

**Steps:**
1. Search for all `.catch()` calls
2. Determine if they should be awaited
3. Add proper error handling UI
4. Use error boundaries for fire-and-forget operations

---

### 2.3 Fix Unsafe Type Casting

**File:** `packages/devil-vscode/webview-ui/src/components/chat/AssistantMessage.tsx`

**Current:**
```typescript
const toolPart = props.part as unknown as ToolPart
```

**Fix:**
```typescript
// Add type guard
function isToolPart(part: MessagePart): part is ToolPart {
  return part.type === "tool" && 
         typeof (part as ToolPart).toolName === "string"
}

// Usage
if (isToolPart(props.part)) {
  // props.part is now typed as ToolPart
  const toolPart = props.part
}
```

---

### 2.4 Fix Session Management Race Conditions

**File:** `packages/opencode/src/session/index.ts:763-769`

**Current:**
```typescript
// Cancel processor before delete to avoid FK errors
await cancelProcessor(sessionId)
await deleteSession(sessionId)
```

**Fix:**
```typescript
// Use transaction
await db.transaction(async (trx) => {
  // Lock session row
  const session = await trx.query.sessions
    .forUpdate()
    .where({ id: sessionId })
    .first()
  
  if (!session) throw new Error("Session not found")
  
  // Cancel processor
  await cancelProcessor(sessionId, trx)
  
  // Delete session
  await trx.delete(sessions).where({ id: sessionId })
})
```

---

## Phase 3: High Priority Fixes (Weeks 3-4)

### 3.1 Add Error Logging to Empty Catch Blocks

**Pattern:**
```typescript
// Before
} catch {
  return []
}

// After
} catch (error) {
  logger.warn("Failed to fetch notifications", { 
    error: error instanceof Error ? error.message : String(error),
    context: "NotificationService.getNotifications"
  })
  return []
}
```

**Files to Fix:**
- `packages/opencode/src/control-plane/sse.ts:50`
- `packages/opencode/src/devilcode/workflow/state.ts:36,59,70,112`
- `packages/devil-gateway/src/api/notifications.ts:61-62`
- `packages/devil-gateway/src/server/routes.ts:281-282`
- `packages/app/src/components/prompt-input/submit.ts:96`

---

### 3.2 Replace `any` Types with Proper Typing

**Strategy:**

1. **Enable strict mode temporarily:**
```json
// tsconfig.json
"strict": true,
"noImplicitAny": true,
"strictNullChecks": true
```

2. **Run type check and fix errors:**
```bash
bun run typecheck 2>&1 | grep "error TS" | head -100
```

3. **Common replacements:**
```typescript
// Instead of any[] for variadic args
function log(...args: unknown[]): void

// Instead of any for unknown data
interface ApiResponse<T> {
  data: T
  error?: ErrorInfo
}

// Use unknown with type guards
function process(data: unknown): void {
  if (typeof data === "string") {
    // data is string here
  }
}
```

---

### 3.3 Add Error Boundaries to UI Components

**Create ErrorBoundary component:**
```typescript
// packages/ui/src/components/error-boundary.tsx
import { Component, JSX } from "solid-js"

interface Props {
  fallback: (error: Error) => JSX.Element
  children: JSX.Element
}

export const ErrorBoundary: Component<Props> = (props) => {
  // Implementation using SolidJS error boundary
}
```

**Apply to major components:**
```typescript
// In exports
export function withErrorBoundary<T extends object>(
  Component: Component<T>
): Component<T> {
  return (props) => (
    <ErrorBoundary fallback={(e) => <ErrorDisplay error={e} />}>
      <Component {...props} />
    </ErrorBoundary>
  )
}
```

---

### 3.4 Make Hardcoded Values Configurable

**Strategy:**

1. **Create config constants file:**
```typescript
// packages/opencode/src/config/constants.ts
export const CONFIG = {
  TS_CHECK_TIMEOUT_MS: 30_000,
  CODE_SEARCH_TIMEOUT_MS: 30_000,
  MODEL_REFRESH_INTERVAL_MS: 5 * 60 * 1000,
  HEARTBEAT_INTERVAL_MS: 10_000,
  ORPHAN_WATCH_INTERVAL_MS: 30_000,
  COMMIT_MESSAGE_TIMEOUT_MS: 120_000,
} as const

// Allow environment override
export function getConfig() {
  return {
    TS_CHECK_TIMEOUT_MS: 
      parseInt(process.env.DEVIL_TS_CHECK_TIMEOUT_MS ?? "") || 
      CONFIG.TS_CHECK_TIMEOUT_MS,
    // ... other configs
  }
}
```

2. **Replace hardcoded usages:**
```typescript
// Before
const TIMEOUT = 30_000

// After  
import { getConfig } from "../config/constants"
const { TS_CHECK_TIMEOUT_MS } = getConfig()
```

---

### 3.5 Add Rate Limiting to Gateway

**File:** `packages/devil-gateway/src/server/routes.ts`

**Implementation:**
```typescript
import { rateLimiter } from "hono-rate-limiter"

// Apply to all routes
app.use(rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  keyGenerator: (c) => c.req.header("authorization") ?? c.req.ip
}))

// Stricter limits for auth endpoints
app.use("/auth/*", rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5 // 5 attempts per 15 min
}))
```

---

## Phase 4: Medium Priority Fixes (Weeks 5-6)

### 4.1 Resolve Circular Dependencies

**Detection:**
```bash
# Install dependency cruiser
npm install -g dependency-cruiser

# Analyze
dependency-cruiser --config .dependency-cruiser.js packages/opencode/src
```

**Resolution Strategies:**

1. **Extract interfaces:**
```typescript
// types.ts (no implementation)
export interface Session {
  id: string
  // ...
}

// session.ts
import type { Session } from "./types"

// prompt.ts
import type { Session } from "./types" // No circular dep
```

2. **Use dependency injection:**
```typescript
// Instead of direct import
class SessionManager {
  constructor(private promptService: PromptService) {}
}
```

3. **Lazy imports:**
```typescript
// For type-only circular deps
const getPromptService = () => import("./prompt")
```

---

### 4.2 Complete or Remove Stub Implementations

**Decision Matrix:**

| Stub | Priority | Action |
|------|----------|--------|
| JetBrains Plugin | Critical | Complete or remove from release |
| LSP ts-client | High | Implement or remove |
| WSL config | Medium | Implement or return proper error |
| Linux app check | Low | Implement proper check |

---

### 4.3 Remove Dead Code

**Detection:**
```bash
# Use knip to find unused code
npx knip --production

# Or ts-prune
npx ts-prune
```

**Files to Remove:**
- Commented-out code blocks
- Unused imports
- Empty if blocks
- Legacy migration code (if safe)

---

### 4.4 Deduplicate SDK v1/v2

**Strategy:**

1. **Extract common module:**
```typescript
// packages/sdk/js/src/common/client-base.ts
export abstract class BaseClient {
  protected constructor(protected config: Config) {}
  abstract connect(): Promise<void>
  // Common methods
}
```

2. **Have v2 extend v1:**
```typescript
// packages/sdk/js/src/v2/client.ts
import { Client as V1Client } from "../client"

export class Client extends V1Client {
  constructor(config: Config & { experimental_workspaceID?: string }) {
    super(config)
    this.workspaceID = config.experimental_workspaceID
  }
}
```

---

## Phase 5: Polish (Week 7+)

### 5.1 Add Comprehensive Documentation

**README Template:**
```markdown
# @devilcode/{package-name}

## Installation
\`\`\`bash
bun add @devilcode/{package-name}
\`\`\`

## Usage
\`\`\`typescript
import { something } from "@devilcode/{package-name}"

// Example
\`\`\`

## API Reference

### Function Name
Description...

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|

## License
MIT
```

---

### 5.2 Add JSDoc Comments

**Example:**
```typescript
/**
 * Creates a lazy-initialized value that is computed only on first access.
 * 
 * @template T The type of the lazy value
 * @param fn - Factory function that creates the value
 * @returns A function that returns the lazily-computed value
 * 
 * @example
 * const expensiveValue = lazy(() => computeExpensiveThing())
 * // computeExpensiveThing() is not called yet
 * 
 * const result = expensiveValue() // Now it's computed and cached
 */
export function lazy<T>(fn: () => T): () => T {
  // ...
}
```

---

### 5.3 Standardize Package Namespaces

**Migration:**
```json
// Before
"name": "@opencode-ai/script"

// After
"name": "@devilcode/script"
```

**Steps:**
1. Update package.json name
2. Update all imports in monorepo
3. Update lockfile
4. Publish with new name
5. Deprecate old package

---

## Testing Checklist

After each phase, verify:

- [ ] All TypeScript errors resolved (`bun run typecheck`)
- [ ] All tests passing (`bun test`)
- [ ] Security scan clean (`npm audit`)
- [ ] No new console errors in dev tools
- [ ] All API integrations working
- [ ] Desktop apps launch and function
- [ ] VSCode extension activates
- [ ] Web app builds and deploys

---

## Tools & Scripts

### Run Type Check Across All Packages
```bash
bun run typecheck
```

### Find All TODO/FIXME Comments
```bash
grep -r "TODO\|FIXME\|HACK\|XXX" packages/*/src --include="*.ts" --include="*.tsx"
```

### Find All `any` Types
```bash
grep -r ": any" packages/*/src --include="*.ts" --include="*.tsx" | head -50
```

### Find Empty Catch Blocks
```bash
grep -r "catch {" packages/*/src --include="*.ts" -A 1 | grep -E "catch {|^\s*}$"
```

### Check Circular Dependencies
```bash
npx madge --circular packages/opencode/src/index.ts
```

---

*End of Fix Pass Guide*
