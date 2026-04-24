# Sync Execution Plan — KiloCode MAOS Edition

> **Date:** 2026-04-24  
> **Current Version:** v7.2.21-EVO2  
> **Target:** Update to latest upstream + MAOS branding + Windows VSIX  

---

## Phase 0 — Pre-Execution Setup

### 0.1 Preserve Current State
```bash
# Create safety checkpoint
git stash push -m "Pre-upstream-sync-WIP"
git branch backup/pre-sync-$(date +%Y%m%d)
```

### 0.2 Create Integration Branch
```bash
git checkout -b integration/upstream-sync-2026-04-24
```

### 0.3 Fetch Upstream
```bash
git fetch upstream --tags
git log --oneline upstream/main..HEAD --reverse > upstream-changes-to-review.txt
```

---

## Phase 1 — Branding Update (MAOS Identity)

**Execute BEFORE merging upstream** to establish baseline.

### 1.1 Update package.json Display Name
**File:** `packages/kilo-vscode/package.json`

**Changes:**
```json
{
  "name": "kilocode",
  "displayName": "KiloCode MAOS Edition",
  "description": "Multi-Agent Operating System for VS Code"
}
```

### 1.2 Update About Tab
**File:** `packages/kilo-vscode/webview-ui/src/components/settings/AboutKiloCodeTab.tsx`

**Changes:**
- Title: "KiloCode MAOS Edition"
- Subtitle: "Multi-Agent Operating System"
- Version: Keep v7.2.21-EVO2 or update to new scheme

### 1.3 Update README
**File:** `README.md`

**Changes:**
- Header: "KiloCode MAOS Edition"
- Add MAOS description
- Keep upstream credits

### 1.4 Commit Branding
```bash
git add -A
git commit -m "branding: Update to KiloCode MAOS Edition naming"
```

---

## Phase 2 — Upstream Sync (Selective)

### 2.1 Analyze Upstream Delta
```bash
# Get list of upstream commits since last merge
git log --oneline --graph --left-right upstream/main...HEAD > upstream-delta.txt
```

### 2.2 Batch A — Build/Tooling (Bucket A)
**Scope:** Safe upstream infrastructure

```bash
# Identify safe commits (CI, docs, non-code)
git log --oneline upstream/main...HEAD -- .github/ | head -20

# Cherry-pick if needed, or merge with --squash for clean history
git merge upstream/main --squash --no-commit --no-ff
```

**Verify:**
- [ ] `bun install` works
- [ ] No build errors

### 2.3 Batch B — Extension Core (Bucket B)
**Scope:** VS Code extension improvements

**Approach:**
1. Review each upstream commit affecting `packages/kilo-vscode/src/`
2. Cherry-pick safe improvements
3. Skip changes conflicting with MAOS deltas

```bash
# Example cherry-pick (do for each safe commit)
git cherry-pick <commit-sha>
```

**Files to Review:**
- `packages/kilo-vscode/src/extension.ts` ⚠️ Conflict risk
- `packages/kilo-vscode/src/services/` (non-Hermes)
- `packages/kilo-vscode/webview-ui/src/` (non-AboutTab)

### 2.4 Batch C — Agent System (Bucket B + C)
**Scope:** Agent/runtime updates

**Critical Check:**
Compare upstream agent system with MAOS 21-agent system.

**Decision Matrix:**
| Upstream Change | MAOS Compatibility | Action |
|-----------------|-------------------|--------|
| Agent loading | ✅ Compatible | Cherry-pick |
| New agents | ⚠️ Review | Port manually if useful |
| Agent removal | ❌ Conflict | Skip |
| Orchestration | ⚠️ Review | Test before merging |

---

## Phase 3 — Conflict Resolution (Bucket D)

### 3.1 Extension Entry Point
**File:** `packages/kilo-vscode/src/extension.ts`

**Resolution Strategy:**
1. Create three-way diff
2. Identify upstream improvements
3. Port improvements manually to MAOS version
4. Preserve MAOS boot sequence

### 3.2 Extension Manifest
**File:** `packages/kilo-vscode/package.json`

**Resolution Strategy:**
1. Use JSON merge tool
2. Preserve MAOS fields:
   - `displayName`: "KiloCode MAOS Edition"
   - Any MAOS-specific settings
3. Accept upstream updates:
   - Version numbers
   - New contributions
   - Dependencies

### 3.3 Hermes Client
**File:** `packages/kilo-vscode/src/services/hermes/HermesClient.ts`

**Resolution Strategy:**
1. Compare upstream service client pattern
2. Port improvements to MAOS HermesClient
3. Keep MAOS-specific Discord bot integration

---

## Phase 4 — Re-Assert MAOS Defaults

### 4.1 Verify 21-Agent System
```bash
# Check agents exist
ls -la .kilo/agents/ | wc -l
# Expected: 21+ files

# Check governance
ls .kilo/governance.json
```

### 4.2 Verify MiniMax Default
**Check:** Default provider/model settings

**Files:**
- `packages/kilo-vscode/package.json` — Default settings
- Agent definitions — Model references

**Expected:**
- Primary: MiniMax M2.7-highspeed
- Fallback: LM Studio 100.117.190.97:1234

### 4.3 Verify Hub/WebUI Bindings
**Check:** Integration points

**Files:**
- `packages/kilo-vscode/src/kilo-provider/handlers/vps-webview.ts`
- Hermes, Memory, ZeroClaw handlers

### 4.4 Verify About Tab
**Manual Check:**
1. Build extension
2. Open About tab
3. Verify: "KiloCode MAOS Edition" + "Multi-Agent Operating System"

---

## Phase 5 — Build & VSIX Rebuild

### 5.1 Clean Build
```bash
# Clean previous builds
rm -rf out/
rm -rf dist/

# Install dependencies
bun install

# Build all packages
bun run build
```

### 5.2 Extension Build
```bash
cd packages/kilo-vscode

# Build production
npm run build

# Package VSIX
npm run package
```

### 5.3 VSIX Verification
```bash
# Check VSIX created
ls -la *.vsix

# Extract and verify metadata
unzip -p kilocode-*.vsix extension/package.json | jq '.displayName, .version, .name'

# Expected output:
# "KiloCode MAOS Edition"
# "7.2.21-EVO2" (or new version)
# "kilocode"
```

### 5.4 VSIX Metadata Check
Verify inside the VSIX:
- `extension/package.json` — Display name, version
- `extension/out/` — Compiled JS exists
- `extension/.kilo/agents/` — 21 agent definitions

---

## Phase 6 — Validation

### 6.1 Git Validation
- [ ] No unresolved conflicts
- [ ] Clean branch state
- [ ] Accurate commit log

### 6.2 Build Validation
- [ ] Production build succeeds
- [ ] VSIX packages successfully
- [ ] No missing assets

### 6.3 Runtime Validation
- [ ] Extension loads in VS Code
- [ ] About tab shows MAOS branding
- [ ] 21 agents visible
- [ ] Settings panels work

### 6.4 Regression Validation
- [ ] Upstream fixes included
- [ ] MAOS deltas preserved
- [ ] No known issues reintroduced

---

## Execution Timeline

| Phase | Estimated Time | Actual |
|-------|---------------|--------|
| 0 — Setup | 15 min | |
| 1 — Branding | 30 min | |
| 2 — Upstream Sync | 60-120 min | |
| 3 — Conflict Resolution | 60-90 min | |
| 4 — MAOS Defaults | 30 min | |
| 5 — Build/VSIX | 45 min | |
| 6 — Validation | 30 min | |
| **Total** | **4-6 hours** | |

---

## Rollback Plan

If any phase fails:

```bash
# Hard reset to pre-sync state
git checkout feat/azure-voice-studio
git reset --hard backup/pre-sync-20260424

# Or restore stashed changes
git stash pop
```

---

## Success Criteria

- ✅ Branding: "KiloCode MAOS Edition" everywhere
- ✅ Upstream: Latest safe changes merged
- ✅ MAOS: 21 agents, Hermes, MiniMax defaults preserved
- ✅ Build: Clean production build
- ✅ VSIX: Rebuilt Windows package
- ✅ Validation: Extension loads, branding correct

---

*Ready to execute. Begin with Phase 0.*
