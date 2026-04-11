# Security Audit Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address validated critical and high-priority security, stability, and type safety issues from the April 2026 code audit.

**Architecture:** This plan is organized into 4 phases: Critical Security (immediate), Critical Stability (week 2), High Priority Error Handling (weeks 3-4), and Architecture Cleanup (weeks 5-6). Each phase produces independently shippable improvements.

**Tech Stack:** TypeScript, Rust (Tauri), Electron, Hono, SolidJS

---

## Audit Validation Summary

I validated the audit claims against actual source code. Here's what was confirmed:

### Validated Critical Issues (All Confirmed)

| # | Issue | File | Status |
|---|-------|------|--------|
| 1 | Hardcoded PostHog API Key | `devil-telemetry/src/client.ts:5` | **CONFIRMED** - Key exposed in git |
| 2 | CSP Disabled (Tauri) | `desktop/src-tauri/tauri.conf.json:22` | **CONFIRMED** - `"csp": null` |
| 3 | Sandbox Disabled (Electron) | `desktop-electron/src/main/windows.ts:61,95` | **CONFIRMED** - 2 occurrences |
| 4 | Remote Script Without Verification | `desktop/src-tauri/src/cli.rs:406` | **CONFIRMED** - `curl \| bash` |
| 5 | OAuth Migration Invalid Sessions | `devil-gateway/src/auth/legacy-migration.ts:84-91` | **CONFIRMED** - `expires: 0` |
| 6 | Overly Permissive HTTP | `desktop/src-tauri/capabilities/default.json:47-48` | **CONFIRMED** - `http://*`, `https://*` |
| 7 | Empty JetBrains Plugin | `devil-jetbrains/` | **CONFIRMED** - No Kotlin/Java source |
| 8 | Type Safety Lost | `opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts:374` | **CONFIRMED** - "MUST FIX" comment |

### Validated High Priority Issues

| Issue | Count | Notes |
|-------|-------|-------|
| Empty `catch {}` blocks | 75+ in opencode/src | Many in tests (OK), ~20 in production code |
| `any` type usage | 120+ in opencode/src | Some legitimate (logging), most need fixing |
| Silent `.catch(() => {})` | 20+ | Half in tests, half in production |

### Audit Inaccuracies Found

| Claim | Reality |
|-------|---------|
| "50+ silent failures" | Actual production count ~25; rest are in test files |
| "70+ any types" | Actually 120+ in opencode alone, understated |
| "JetBrains 100% missing" | Has build infrastructure, better described as "incomplete" |

---

## Phase 1: Critical Security (Immediate - 1 Day)

### Task 1: Secure PostHog API Key

**Files:**
- Modify: `packages/devil-telemetry/src/client.ts:1-20`
- Create: `packages/devil-telemetry/.env.example`

**Context:** The PostHog API key is hardcoded and visible in git history. Even after rotation, anyone who cloned the repo has the old key.

- [ ] **Step 1: Rotate the API key immediately**

Log into PostHog dashboard, rotate the API key `phc_REDACTED_KEY`. This invalidates the exposed key.

- [ ] **Step 2: Update client.ts to use environment variable**

```typescript
import { PostHog } from "posthog-node"
import { Identity } from "./identity.js"
import { TelemetryEvent } from "./events.js"

const POSTHOG_API_KEY = process.env.DEVIL_POSTHOG_API_KEY ?? ""
const POSTHOG_HOST = process.env.DEVIL_POSTHOG_HOST ?? "https://us.i.posthog.com"

export namespace Client {
  let client: PostHog | null = null
  let enabled = true

  export function init() {
    if (!POSTHOG_API_KEY) {
      console.warn("[Telemetry] PostHog API key not configured, telemetry disabled")
      enabled = false
      return
    }
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      disableGeoip: false,
    })
  }
```

- [ ] **Step 3: Create .env.example**

```bash
# PostHog telemetry (optional - disabled if not set)
DEVIL_POSTHOG_API_KEY=
DEVIL_POSTHOG_HOST=https://us.i.posthog.com
```

- [ ] **Step 4: Add to deployment secrets**

Add `DEVIL_POSTHOG_API_KEY` to:
- CI/CD environment variables
- Production deployment secrets
- Local `.env` files (gitignored)

- [ ] **Step 5: Test telemetry still works**

```bash
cd packages/devil-telemetry
DEVIL_POSTHOG_API_KEY=<new-key> bun test
```

- [ ] **Step 6: Commit**

```bash
git add packages/devil-telemetry/src/client.ts packages/devil-telemetry/.env.example
git commit -m "fix(telemetry): move PostHog API key to environment variable

SECURITY: Rotated exposed API key. Old key is now invalid."
```

---

### Task 2: Enable Content Security Policy (Tauri)

**Files:**
- Modify: `packages/desktop/src-tauri/tauri.conf.json:21-24`

**Context:** CSP null allows any content to load, creating XSS risk. Need to restrict to required domains only.

- [ ] **Step 1: Identify required domains**

Based on the codebase, the app needs:
- `localhost:*` for dev
- `api.devil.ai` for API
- `app.devil.ai` for web app
- `us.i.posthog.com` for telemetry
- `github.com` for OAuth
- `models.dev` for model metadata

- [ ] **Step 2: Update tauri.conf.json**

Replace lines 21-24:

```json
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:* https://api.devil.ai https://app.devil.ai https://us.i.posthog.com https://github.com https://models.dev; img-src 'self' data: https:; font-src 'self'"
    },
```

- [ ] **Step 3: Test app functionality with CSP enabled**

```bash
cd packages/desktop
bun run tauri dev
```

Test: Login flow, API calls, telemetry, model loading. Check browser console for CSP violations.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/tauri.conf.json
git commit -m "fix(desktop): enable Content Security Policy

SECURITY: Restricts content sources to required domains only."
```

---

### Task 3: Enable Electron Sandbox

**Files:**
- Modify: `packages/desktop-electron/src/main/windows.ts:59-62,93-96`

**Context:** `sandbox: false` removes process isolation. The preload script must handle all Node.js APIs.

- [ ] **Step 1: Verify preload script exists and is sufficient**

```bash
cat packages/desktop-electron/src/preload/index.ts
```

Check that all required APIs are exposed via `contextBridge`.

- [ ] **Step 2: Enable sandbox in both window definitions**

Update lines 59-62:
```javascript
    webPreferences: {
      preload: join(root, "../preload/index.mjs"),
      sandbox: true,
      contextIsolation: true,
    },
```

Update lines 93-96:
```javascript
    webPreferences: {
      preload: join(root, "../preload/index.mjs"),
      sandbox: true,
      contextIsolation: true,
    },
```

- [ ] **Step 3: Test Electron app**

```bash
cd packages/desktop-electron
bun run dev
```

Test all functionality. If anything breaks, the preload script needs to expose additional APIs via contextBridge.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-electron/src/main/windows.ts
git commit -m "fix(desktop-electron): enable renderer sandbox

SECURITY: Enables process isolation between renderer and main process."
```

---

### Task 4: Restrict HTTP Permissions (Tauri)

**Files:**
- Modify: `packages/desktop/src-tauri/capabilities/default.json:46-49`

**Context:** Wildcards allow HTTP requests to any domain. Restrict to known-good domains.

- [ ] **Step 1: Update capabilities**

Replace lines 46-49:
```json
    {
      "identifier": "http:default",
      "allow": [
        { "url": "http://localhost:*" },
        { "url": "https://api.devil.ai/*" },
        { "url": "https://app.devil.ai/*" },
        { "url": "https://us.i.posthog.com/*" },
        { "url": "https://github.com/*" },
        { "url": "https://models.dev/*" },
        { "url": "https://ingest.devilsessions.ai/*" }
      ]
    },
```

- [ ] **Step 2: Test all HTTP integrations**

```bash
cd packages/desktop
bun run tauri dev
```

Test: API calls, auth flow, telemetry, model fetching.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/capabilities/default.json
git commit -m "fix(desktop): restrict HTTP permissions to required domains

SECURITY: Removes wildcard HTTP permissions."
```

---

### Task 5: Fix OAuth Migration

**Files:**
- Modify: `packages/devil-gateway/src/auth/legacy-migration.ts:82-97`

**Context:** Migrated OAuth tokens have `refresh: ""` and `expires: 0`, creating permanently invalid sessions.

- [ ] **Step 1: Update migration to set proper expiration**

Replace lines 82-97:
```typescript
  // Migrate to new format
  // Use OAuth format if organization ID present, otherwise API format
  if (legacy.organizationId) {
    // Set a short expiration to force immediate token refresh
    const MIGRATION_TOKEN_LIFETIME_MS = 5 * 60 * 1000 // 5 minutes
    await saveDevilAuth({
      type: "oauth",
      access: legacy.token,
      refresh: "", // Will trigger refresh flow on first use
      expires: Date.now() + MIGRATION_TOKEN_LIFETIME_MS,
      accountId: legacy.organizationId,
      migrated: true, // Flag for tracking
    })
    // Log migration for debugging
    console.log("[Auth] Migrated legacy OAuth token, will refresh within 5 minutes")
  } else {
    await saveDevilAuth({
      type: "api",
      key: legacy.token,
    })
  }
```

- [ ] **Step 2: Add type definition for migrated flag**

Check if `DevilAuth` type needs updating to include `migrated?: boolean`.

- [ ] **Step 3: Test migration flow**

```bash
cd packages/devil-gateway
bun test -- --grep "migration"
```

- [ ] **Step 4: Commit**

```bash
git add packages/devil-gateway/src/auth/legacy-migration.ts
git commit -m "fix(gateway): set proper expiration on migrated OAuth tokens

SECURITY: Prevents permanently invalid sessions from migration."
```

---

## Phase 2: Critical Stability (Week 2)

### Task 6: Fix Type Safety in Chat Model

**Files:**
- Modify: `packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts:365-395`

**Context:** The "MUST FIX" comment indicates type safety was intentionally disabled. Need to restore proper typing.

- [ ] **Step 1: Read the current implementation to understand the issue**

```bash
cat packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts | head -n 400 | tail -n 50
```

- [ ] **Step 2: Investigate the chunk schema**

Find `this.chunkSchema` definition and understand why type inference fails.

- [ ] **Step 3: Add explicit type annotation**

```typescript
          transform(chunk: ParseResult<z.infer<typeof this.chunkSchema>>, controller) {
            // Type guard for successful parsing
            if (!chunk.success) {
              finishReason = "error"
              controller.enqueue({ type: "error", error: chunk.error })
              return
            }
            
            // Now chunk.value has proper type
            const value = chunk.value
```

- [ ] **Step 4: Run type check**

```bash
cd packages/opencode
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts
git commit -m "fix(cli): restore type safety in chat model chunk processing"
```

---

### Task 7: Handle JetBrains Plugin Status

**Files:**
- Modify: `packages/devil-jetbrains/README.md`
- Possibly: Remove from marketplace/release

**Context:** Plugin has build infrastructure but no actual IDE integration code (no Kotlin/Java source files).

- [ ] **Step 1: Decide strategy**

Options:
A) Mark as "Coming Soon" and remove from any marketplace listings
B) Implement minimal viable plugin
C) Remove package entirely

Recommendation: Option A - mark clearly as incomplete.

- [ ] **Step 2: Update README with clear status**

Add to top of README:
```markdown
> **Status: Work in Progress**
> 
> This plugin currently only bundles the CLI binary. IDE integration features are not yet implemented.
> Do not release to JetBrains Marketplace until Kotlin implementation is complete.
```

- [ ] **Step 3: Commit**

```bash
git add packages/devil-jetbrains/README.md
git commit -m "docs(jetbrains): clarify plugin is work-in-progress"
```

---

## Phase 3: High Priority Error Handling (Weeks 3-4)

### Task 8: Add Logging to Silent Catch Blocks

**Files (production code only):**
- Modify: `packages/app/src/pages/session/use-session-commands.tsx:311`
- Modify: `packages/app/src/components/prompt-input/submit.ts:96`
- Modify: `packages/devil-ui/src/components/grow-box.tsx:117,150`
- Modify: `packages/devil-ui/src/components/rolling-results.tsx:118,147`
- Modify: `packages/devil-ui/src/components/tool-utils.ts:257`

**Context:** `.catch(() => {})` swallows errors silently. Add logging to aid debugging.

- [ ] **Step 1: Fix use-session-commands.tsx:311**

Replace:
```typescript
await sdk.client.session.abort({ sessionID }).catch(() => {})
```

With:
```typescript
await sdk.client.session.abort({ sessionID }).catch((error) => {
  console.warn("[Session] Failed to abort session:", sessionID, error)
})
```

- [ ] **Step 2: Fix submit.ts:96**

Replace `.catch(() => {})` with:
```typescript
.catch((error) => {
  console.warn("[Submit] Operation failed:", error)
})
```

- [ ] **Step 3: Fix grow-box.tsx:117,150**

Replace both `.catch(() => {})` with:
```typescript
.catch((error) => {
  // Animation failures are non-critical, log at debug level
  if (import.meta.env.DEV) {
    console.debug("[GrowBox] Animation failed:", error)
  }
})
```

- [ ] **Step 4: Fix rolling-results.tsx:118,147**

Same pattern as grow-box - animation failures are non-critical.

- [ ] **Step 5: Fix tool-utils.ts:257**

Replace:
```typescript
anim.finished.catch(() => {}).finally(clear)
```

With:
```typescript
anim.finished
  .catch((error) => {
    if (import.meta.env.DEV) {
      console.debug("[ToolUtils] Animation interrupted:", error)
    }
  })
  .finally(clear)
```

- [ ] **Step 6: Run tests**

```bash
cd packages/app && bun test
cd packages/devil-ui && bun test
```

- [ ] **Step 7: Commit**

```bash
git add packages/app/src packages/devil-ui/src
git commit -m "fix(ui): add logging to silent catch blocks"
```

---

### Task 9: Replace Critical `any` Types

**Target files (highest impact):**
- `packages/opencode/src/plugin/copilot.ts` (10+ `any`)
- `packages/opencode/src/provider/provider.ts` (15+ `any`)
- `packages/opencode/src/util/log.ts` (10 `any`)

**Context:** This is a large task. Focus on type-unsafe code paths that could cause runtime errors.

- [ ] **Step 1: Audit copilot.ts for dangerous any usage**

```bash
grep -n ": any" packages/opencode/src/plugin/copilot.ts
```

- [ ] **Step 2: Replace with `unknown` and add type guards**

For function parameters that accept anything:
```typescript
// Before
function process(data: any): void

// After  
function process(data: unknown): void {
  if (typeof data === "object" && data !== null) {
    // Type-safe access
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd packages/opencode && bun run typecheck
```

- [ ] **Step 4: Commit incrementally**

```bash
git add packages/opencode/src/plugin/copilot.ts
git commit -m "fix(cli): replace any types in copilot plugin"
```

---

## Phase 4: Architecture Cleanup (Weeks 5-6)

### Task 10: Document Remote Script Risk (Tauri)

**Files:**
- Modify: `packages/desktop/src-tauri/src/cli.rs:405-408`

**Context:** Full fix requires signature verification infrastructure. For now, add warning and documentation.

- [ ] **Step 1: Add warning comment**

```rust
// SECURITY: This downloads and executes a remote script without verification.
// TODO: Implement checksum or signature verification before production release.
// See: https://github.com/devilcode/devilcode/issues/XXX
```

- [ ] **Step 2: Create tracking issue**

Create GitHub issue titled "Security: Add verification for remote install scripts"

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/cli.rs
git commit -m "docs(desktop): document remote script security risk

Adds TODO for implementing script verification.
Refs #XXX"
```

---

## Success Criteria

After completing all phases:

- [ ] `bun turbo typecheck` passes with zero errors
- [ ] No hardcoded secrets in source (grep for API keys, tokens)
- [ ] CSP enabled in Tauri config
- [ ] Sandbox enabled in Electron windows
- [ ] HTTP permissions restricted to allowlist
- [ ] OAuth migration sets proper expiration
- [ ] JetBrains plugin clearly marked as incomplete
- [ ] No silent `.catch(() => {})` in production code paths
- [ ] Critical `any` types replaced with proper typing

---

## Files Changed Summary

| Phase | Files Modified |
|-------|----------------|
| Phase 1 | 5 files (security) |
| Phase 2 | 2 files (stability) |
| Phase 3 | 8+ files (error handling) |
| Phase 4 | 1 file + docs |

**Total: ~16 files across 4 phases**

---

*Generated: 2026-04-11*
