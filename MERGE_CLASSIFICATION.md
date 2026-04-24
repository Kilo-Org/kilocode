# Merge Classification — KiloCode MAOS Edition

> **Date:** 2026-04-24  
> **Branch:** feat/azure-voice-studio  
> **Purpose:** Classify all meaningful diffs into merge buckets  

---

## Classification Summary

| Bucket | Count | Status |
|--------|-------|--------|
| **A — Safe Upstream Fast-Follow** | ~50 files | Ready to merge |
| **B — Selective Upstream Donor** | ~30 files | Cherry-pick candidates |
| **C — Protected MAOS Deltas** | 45+ files | DO NOT OVERWRITE |
| **D — Conflict Zones** | 8 files | Requires manual resolution |

---

## Bucket A — Safe Upstream Fast-Follow

### Build / Tooling / Dependency Fixes
**Low-risk infrastructure updates from upstream:**

- `.github/workflows/*.yml` — CI/CD improvements
- `package.json` (root) — Dependency bumps
- `bun.lock` / `package-lock.json` — Lockfile updates
- `.husky/` — Git hooks
- `.editorconfig` — Editor settings
- `.prettierignore` — Formatting rules

**Rationale:** These are build system and tooling changes that don't affect MAOS functionality.

### Documentation Updates
- `CODE_OF_CONDUCT.md` — Community guidelines
- `CONTRIBUTING.md` — Contribution guidelines
- `SECURITY.md` — Security policy
- `docs/` (upstream-specific) — Non-MAOS documentation

---

## Bucket B — Selective Upstream Donor Candidates

### VS Code Extension Improvements
**Carefully review before cherry-picking:**

- `packages/kilo-vscode/src/` — Core extension logic
  - **CONFLICT RISK:** HermesClient.ts has MAOS modifications
  - **REVIEW:** extension.ts entry point
  - **REVIEW:** Any new providers/settings

- `packages/kilo-vscode/package.json` — Extension manifest
  - **CHECK:** Display name changes (preserve "MAOS Edition")
  - **CHECK:** Version numbering

### UI/Webview Improvements
- `packages/kilo-vscode/webview-ui/src/` — React components
  - **CONFLICT ZONE:** AboutKiloCodeTab.tsx has MAOS branding
  - **SAFE:** Other UI components (settings, panels)

### Agent/Runtime Updates
- `packages/opencode/src/kilocode/agent/index.ts`
  - **CRITICAL:** Compare with MAOS 21-agent system
  - **ACTION:** Cherry-pick only if compatible with kc-main + kc-01..kc-20

---

## Bucket C — Protected MAOS Custom Deltas

### 🚫 NEVER OVERWRITE — MAOS Core

#### 1. 21-Agent System
**Files:**
```
.kilo/agents/
├── kc-main.md
├── kc-01.md through kc-20.md
└── (21 total agent definitions)

.kilo/governance.json
```

**Protected:** The complete MAOS workforce
- kc-main (coordinator)
- kc-01 through kc-20 (specialists)

**Upstream Status:** Upstream likely has different/no agent definitions

#### 2. MAOS Integration Handlers
**Files:**
```
packages/kilo-vscode/src/kilo-provider/handlers/
├── hermes-webview.ts      ← Hermes Discord bot integration
├── memory-webview.ts      ← Shiba Memory integration
├── vps-webview.ts         ← VPS webview handler
└── zeroclaw-webview.ts    ← ZeroClaw integration
```

**Protected:** Custom MAOS surface integrations

#### 3. Custom Panels
**Files:**
```
packages/kilo-vscode/src/panels/
├── (MAOS-specific panel implementations)
```

**Protected:** Custom UI panels for MAOS workflow

#### 4. About Tab Branding
**File:** `packages/kilo-vscode/webview-ui/src/components/settings/AboutKiloCodeTab.tsx`

**Protected:** Must display "KiloCode MAOS Edition"
**Action:** Merge upstream changes carefully, preserve branding strings

#### 5. MAOS Documentation
**Files:**
```
KILOCODE_HANDOFF_FOR_WINDSURF.md
START_HERE.md
VOICE_FIX_CONTINUE.md
AGENTS.md
```

**Protected:** MAOS-specific documentation

#### 6. Agent System Scripts
**Files:**
```
agent_00_integration_lead.py
agent_dispatcher.py
agent_monitor_dashboard.py
generate_handoff.py
```

**Protected:** Custom MAOS tooling

---

## Bucket D — Conflict Zones

### High-Risk Files Requiring Manual Resolution

#### 1. Extension Entry Point
**File:** `packages/kilo-vscode/src/extension.ts`
- **Upstream:** Likely has initialization changes
- **MAOS:** Has MAOS-specific boot sequence
- **Action:** Three-way merge, test thoroughly

#### 2. Extension Manifest
**File:** `packages/kilo-vscode/package.json`
- **Upstream:** Version bumps, new contributions, settings
- **MAOS:** Custom display name, MAOS-specific settings
- **Action:** Merge JSON carefully, preserve MAOS fields

#### 3. Hermes Client
**File:** `packages/kilo-vscode/src/services/hermes/HermesClient.ts`
- **Upstream:** May have service client improvements
- **MAOS:** Custom Hermes integration for Discord bots
- **Action:** Diff both versions, merge carefully

#### 4. Agent System Core
**File:** `packages/opencode/src/kilocode/agent/index.ts`
- **Upstream:** Agent loading, orchestration changes
- **MAOS:** 21-agent MAOS system integration
- **Action:** Review upstream changes for compatibility

#### 5. Bun Lockfile
**File:** `bun.lock`
- **Status:** Modified in working directory
- **Action:** Regenerate after dependency updates

#### 6. Type Definitions
**File:** `packages/app/src/custom-elements.d.ts`
- **Status:** Deleted in working directory
- **Action:** Verify if intentional or needs restoration

#### 7. OpenAPI Spec
**File:** `packages/sdk/js/openapi.json`
- **Status:** Deleted in working directory
- **Action:** Check if upstream has updates

---

## Merge Strategy by Bucket

### Bucket A (Safe)
```bash
# Fast-forward merge approach
# No conflicts expected
```

### Bucket B (Selective)
```bash
# Cherry-pick individual commits
# Review each change for MAOS compatibility
# Test after each cherry-pick
```

### Bucket C (Protected)
```bash
# DO NOT MERGE — Preserve as-is
# If upstream has improvements, manually port
```

### Bucket D (Conflict)
```bash
# Three-way merge required
# Manual conflict resolution
# Full regression test after merge
```

---

## Recommended Merge Order

1. **Bucket A** — Build tooling (establishes baseline)
2. **Bucket B (non-conflict)** — Safe upstream features
3. **Bucket D** — Resolve conflicts (requires attention)
4. **Bucket B (conflict-risk)** — Agent system, UI
5. **Verify Bucket C** — Ensure MAOS deltas preserved

---

## Pre-Merge Checklist

- [ ] Stash or commit current working directory changes
- [ ] Create integration branch: `git checkout -b integration/upstream-sync`
- [ ] Fetch upstream: `git fetch upstream`
- [ ] Identify upstream commits since last merge (Apr 22)
- [ ] Review each commit against classification buckets
- [ ] Prepare conflict resolution strategy for Bucket D

---

## Post-Merge Verification

### Must Verify After Any Merge:
1. **21 agents still load** — Check `.kilo/agents/` presence
2. **MAOS branding intact** — Check About tab
3. **Hermes integration works** — Test Discord bot connectivity
4. **Extension builds** — `npm run build` succeeds
5. **VSIX packages** — `npm run package` succeeds
6. **No runtime errors** — Extension loads without crashes

---

*Next: Create SYNC_EXECUTION_PLAN.md with detailed execution steps.*
