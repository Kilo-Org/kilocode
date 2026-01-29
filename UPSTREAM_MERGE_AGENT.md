# Upstream Merge Agent Prompt

## Overview

You are an autonomous merge agent responsible for synchronizing the Kilo CLI repository with upstream changes from the opencode repository. Your goal is to perform a clean merge that preserves Kilo-specific functionality while incorporating all upstream improvements.

**CRITICAL**: This is a rebranded fork. "Kilo CLI" replaces "OpenCode" in ALL user-facing contexts. The merge MUST preserve Kilo branding, logos, and provider configurations.

## Repository Setup

- **Upstream remote**: `git@github.com:sst/opencode.git` (add as `upstream` if not exists)
- **Default branch**: `dev`
- **Upstream branch to merge**: Specified by user (e.g., `dev` or a specific tag/commit)

## Package Naming Conventions

The following package name mappings must be maintained:

| Upstream (opencode)   | Kilo                  |
| --------------------- | --------------------- | ---------------------- |
| `opencode`            | `@kilocode/cli`       |
| `@opencode-ai/plugin` | `@kilocode/plugin`    |
| `@opencode-ai/sdk`    | `@kilocode/sdk`       |
| `@opencode-ai/script` | `@opencode-ai/script` | (keep as-is, internal) |
| `@opencode-ai/util`   | `@opencode-ai/util`   | (keep as-is, internal) |

Binary names:

- `opencode` -> `kilo`

Kilo-specific packages (not in upstream):

- `@kilocode/kilo-gateway`
- `@kilocode/kilo-telemetry`

---

## CRITICAL FILES - ALWAYS KEEP KILO VERSION

These files MUST be kept from the `dev` branch (ours), NOT upstream:

### P0 - Branding Files (NEVER accept upstream changes)

| File                                | Reason                              |
| ----------------------------------- | ----------------------------------- |
| `packages/opencode/src/cli/logo.ts` | Contains Kilo ASCII art logo        |
| `packages/opencode/src/cli/ui.ts`   | References the Kilo logo            |
| `package.json` (root)               | Must have `"name": "@kilocode/cli"` |

### P0 - Provider Configuration

| File                                      | What to Preserve                                    |
| ----------------------------------------- | --------------------------------------------------- |
| `packages/app/src/hooks/use-providers.ts` | `preferredProviders` array must have `"kilo"` FIRST |

The `preferredProviders` array MUST be:

```typescript
export const preferredProviders = [
  "kilo", // MUST be first
  "opencode",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
```

### P0 - Locale/i18n Files

For ALL files in `packages/app/src/i18n/*.ts`, these keys MUST use "Kilo" branding:

| Key                                    | Required Value                                         |
| -------------------------------------- | ------------------------------------------------------ |
| `dialog.provider.kilo.note`            | `"Access 500+ AI models"`                              |
| `dialog.model.unpaid.freeModels.title` | `"Free models provided by Kilo CLI"`                   |
| `provider.connect.apiKey.description`  | Must reference "Kilo CLI" not "OpenCode"               |
| `provider.connect.kiloGateway.*`       | Keep all `kiloGateway` keys (not `opencodeZen`)        |
| `dialog.server.description`            | `"Switch which Kilo CLI server this app connects to."` |
| `toast.update.description`             | `"A new version of Kilo CLI..."`                       |
| `error.page.report.prefix`             | `"Please report this error to the Kilo CLI team"`      |
| `sidebar.gettingStarted.line1`         | `"Kilo CLI includes free models..."`                   |
| `settings.general.row.*.description`   | Must reference "Kilo CLI" not "OpenCode"               |

**IMPORTANT**: Do NOT accept upstream locale changes that:

- Replace `kiloGateway` with `opencodeZen`
- Replace "Kilo CLI" with "OpenCode" in user-facing strings
- Remove `dialog.provider.kilo.note` key
- Remove `dialog.provider.group.recommended` key with kilocode_change marker

### P1 - Files to Delete After Merge

Remove these files that upstream adds but Kilo doesn't need:

```bash
git rm -f README.it.md README.th.md 2>/dev/null || true
```

### P1 - Version Management

- Keep Kilo's version numbers in all `package.json` files
- Do NOT accept upstream version bumps (e.g., `1.1.42` -> keep Kilo's version)
- Run `bun install` AFTER fixing package.json versions to update bun.lock correctly

---

## Phase 1: Preparation

### 1.1 Run Initialization Script

```bash
./scripts/kilocode/opencode_merge_01_init.sh <version> [prefix]
# Example: ./scripts/kilocode/opencode_merge_01_init.sh v1.1.42
# Example with prefix: ./scripts/kilocode/opencode_merge_01_init.sh v1.1.42 my_name
```

This script:

1. Ensures upstream remote is configured
2. Fetches latest changes and tags
3. Creates `upstream-at-<version>` branch at the target version
4. Creates `upstream-prepared-<version>` branch for transformations

### 1.2 Run Preparation Script

```bash
./scripts/kilocode/opencode_merge_02_prepare.sh
```

This script runs on the preparation branch and:

1. Executes package.json transformations (renames packages to Kilo conventions)
2. Renames binary files (`opencode` -> `kilo`)
3. Commits the preparation changes

### 1.3 Start the Merge

```bash
./scripts/kilocode/opencode_merge_03_start_merge.sh <version> [prefix]
```

This script:

1. Creates merge branch `opencode-<version>` from `dev`
2. Initiates merge with prepared upstream branch

---

## Phase 2: Research (Parallel Sub-Agents)

Launch two sub-agents concurrently:

### Sub-Agent A: Upstream Feature Research

Research merged PRs in the upstream opencode repository since our last merge:

```bash
# Find the last merge commit
git log --oneline --grep="merge opencode" -1

# Get PRs merged since then
gh pr list --repo sst/opencode --state merged --limit 50 --json number,title,mergedAt
```

Document each feature/fix with:

- PR number and title
- Files affected
- Summary of changes
- Any breaking changes or API modifications

### Sub-Agent B: Kilo Feature Research

Research Kilo-specific features that must be preserved:

```bash
# Find all kilocode_change markers
grep -r "kilocode_change" --include="*.ts" --include="*.tsx" packages/

# List Kilo-specific directories
ls -la packages/kilo-gateway/
ls -la packages/kilo-telemetry/
ls -la packages/opencode/src/kilocode/
```

Document:

- Files with `kilocode_change` markers
- Contents of Kilo-specific directories
- Any Kilo-specific test files

---

## Phase 3: Conflict Resolution

### 3.1 Run Cleanup Script

```bash
./scripts/kilocode/opencode_merge_04_cleanup.sh
```

This script:

- Resets files we maintain separately (README, CHANGELOG, .github)
- **Resets critical branding files** (logo.ts, ui.ts, use-providers.ts) to Kilo versions
- Removes unwanted README translations (README.it.md, README.th.md)
- Removes files deleted in our branch
- Verifies Kilo-specific directories exist
- **Runs branding verification checks** and reports any issues

### 3.2 Resolve Package.json Conflicts

```bash
bun run ./scripts/kilocode/opencode_merge_05_package_json.ts
```

This script automatically resolves package.json conflicts by:

- Keeping Kilo package names, versions, and bin entries
- Preserving Kilo-specific dependencies
- Merging dependency updates from upstream

### 3.3 Verify Locale Branding

```bash
./scripts/kilocode/opencode_merge_06_fix_branding.sh
```

This script checks locale files for branding issues:

- Verifies critical Kilo branding keys exist
- Warns about OpenCode references that should be Kilo
- Warns about opencodeZen references that should be kiloGateway

### 3.4 Resolution Priority Order

1. **package.json files** - Use script, then manual review
2. **Lock files** - Run `bun install` after package.json resolved
3. **Source files with `kilocode_change` markers** - ALWAYS preserve marked changes
4. **Branding files (logo.ts, ui.ts)** - ALWAYS keep Kilo version
5. **Provider configuration (use-providers.ts)** - ALWAYS keep `kilo` first in preferredProviders
6. **Locale/i18n files** - Accept upstream structure, but restore Kilo branding strings
7. **Configuration files** - Generally keep Kilo versions
8. **Documentation** - Keep Kilo versions
9. **GitHub workflows** - Keep Kilo versions

### 3.5 Resolution Rules

**For files with `kilocode_change` markers:**

- ALWAYS preserve the marked changes
- Integrate upstream changes around them
- If upstream modified the same lines, manually merge preserving Kilo intent

**For Kilo-specific directories (no conflicts expected):**

- `packages/opencode/src/kilocode/*` - Keep as-is
- `packages/opencode/test/kilocode/*` - Keep as-is
- `packages/kilo-gateway/*` - Keep as-is
- `packages/kilo-telemetry/*` - Keep as-is

**For logo.ts and ui.ts:**

- ALWAYS checkout from `dev` (ours): `git checkout --ours packages/opencode/src/cli/logo.ts packages/opencode/src/cli/ui.ts`
- These files contain Kilo ASCII art that MUST NOT be replaced with OpenCode logo

**For use-providers.ts:**

- Keep the `kilocode_change` markers around `preferredProviders`
- Ensure `"kilo"` is FIRST in the array
- Accept other upstream changes in the file

**For locale files:**

- Accept upstream structural changes (new keys, reorganization)
- RESTORE Kilo branding in user-facing strings
- Keep `kiloGateway` keys, do NOT rename to `opencodeZen`
- Keep `dialog.provider.kilo.note` key
- Keep `dialog.provider.group.recommended` with kilocode_change marker

**For package.json:**

- Keep Kilo version numbers
- Keep Kilo package names (@kilocode/\*)
- Keep Kilo bin names (kilo, not opencode)
- Merge dependency updates from upstream
- Preserve Kilo-specific dependencies

### 3.6 Post-Resolution Checks

Search for and address:

```bash
# Check for remaining conflict markers
grep -r "<<<<<<" --include="*.ts" --include="*.tsx" --include="*.json" .

# Check for opencode references that should be kilo (user-facing)
grep -r "opencode" --include="*.json" packages/*/package.json

# Check for upstream repo URLs
grep -r "sst/opencode\|anomalyco/opencode" --include="*.json" .
```

---

## Phase 4: Validation

### 4.1 Install Dependencies

```bash
bun install
```

### 4.2 Build Verification

```bash
bun run build
```

### 4.3 Type Check

```bash
bun run typecheck
```

### 4.4 Test Verification

```bash
cd packages/opencode && bun run test
```

### 4.5 Marker Audit

```bash
# Verify kilocode_change markers weren't accidentally removed
git diff dev --stat | grep -E "kilocode" || echo "Check kilocode changes manually"

# Compare marker count
git grep -c "kilocode_change" dev -- "*.ts" "*.tsx" | wc -l
git grep -c "kilocode_change" HEAD -- "*.ts" "*.tsx" | wc -l
```

### 4.6 CRITICAL: Branding Verification Checklist

**You MUST verify each of these before creating the PR:**

```bash
# 1. Root package.json name
grep '"name":' package.json | head -1
# MUST show: "@kilocode/cli"

# 2. Logo file has Kilo branding
head -5 packages/opencode/src/cli/logo.ts
# MUST contain "KILO" ASCII art, NOT "OPEN CODE"

# 3. Provider priority
grep -A10 "preferredProviders" packages/app/src/hooks/use-providers.ts
# MUST have "kilo" as FIRST entry

# 4. Locale branding - check for OpenCode references that should be Kilo
grep -r "OpenCode" packages/app/src/i18n/*.ts | grep -v "opencode.ai\|opencode.json" | head -20
# User-facing strings should say "Kilo CLI" not "OpenCode"

# 5. kiloGateway keys exist (not renamed to opencodeZen)
grep "kiloGateway" packages/app/src/i18n/en.ts
# MUST return results

# 6. Kilo provider note exists
grep "dialog.provider.kilo.note" packages/app/src/i18n/en.ts
# MUST return: "dialog.provider.kilo.note": "Access 500+ AI models"

# 7. No unwanted localized READMEs
ls README.*.md 2>/dev/null
# Should NOT include README.it.md or README.th.md (delete if present)
```

**If ANY of these checks fail, fix them before proceeding.**

---

## Phase 5: PR Creation

Create a pull request with:

- **Title**: `refactor: merge opencode <version>`
- **Body**:

  ```markdown
  ## Summary

  Merges upstream opencode changes from version <version>.

  ## Upstream Changes Included

  - [List key features/fixes from upstream]

  ## Conflicts Resolved

  - [List files with conflicts and how they were resolved]

  ## Manual Decisions

  - [Any non-obvious choices made during merge]

  ## Branding Verification

  - [ ] Root package.json has name `@kilocode/cli`
  - [ ] logo.ts contains Kilo ASCII art
  - [ ] use-providers.ts has `kilo` first in preferredProviders
  - [ ] Locale files have Kilo branding (not OpenCode) in user-facing strings
  - [ ] kiloGateway keys preserved (not renamed to opencodeZen)
  - [ ] dialog.provider.kilo.note key exists
  - [ ] No unwanted README translations (it, th)

  ## Verification

  - [ ] Build passes
  - [ ] Tests pass
  - [ ] Type check passes
  - [ ] kilocode_change markers preserved
  - [ ] Kilo-specific packages intact
  ```

- **Important**: Do NOT squash merge - preserve upstream commit history

---

## Uncertainty Handling

If you encounter a conflict where:

- The correct resolution is unclear
- Both Kilo and upstream changes seem important
- You cannot determine intent from `kilocode_change` markers

Then:

1. Document the conflict clearly
2. Leave a `// TODO: MERGE_REVIEW_NEEDED` comment
3. Continue with other resolutions
4. Report all unresolved items in the final PR description

---

## Available Scripts

| Script                                 | Purpose                        |
| -------------------------------------- | ------------------------------ |
| `opencode_merge_01_init.sh`            | Initialize branches for merge  |
| `opencode_merge_02_prepare.sh`         | Apply naming transformations   |
| `opencode_merge_03_start_merge.sh`     | Start the actual merge         |
| `opencode_merge_04_cleanup.sh`         | Reset branding files + cleanup |
| `opencode_merge_05_package_json.ts`    | Resolve package.json conflicts |
| `opencode_merge_06_fix_branding.sh`    | Verify/fix locale branding     |
| `opencode_merge_transform_packages.ts` | Transform package names        |

---

## Sub-Agent Coordination

When spawning sub-agents for conflict resolution:

- Each sub-agent handles a specific file or directory
- Sub-agents report back: resolved/unresolved status + any concerns
- Main agent aggregates results and runs final validation
- Use parallel sub-agents for independent files
- Use sequential processing for dependent changes

---

## Common Mistakes to AVOID

1. **Accepting upstream logo.ts** - This replaces Kilo logo with OpenCode logo
2. **Accepting upstream preferredProviders** - This removes `kilo` from first position or removes it entirely
3. **Accepting upstream locale branding** - This replaces "Kilo CLI" with "OpenCode" in user-facing text
4. **Accepting upstream kiloGateway->opencodeZen rename** - This breaks Kilo-specific provider config
5. **Accepting upstream version bumps** - Keep Kilo's version numbers
6. **Keeping upstream README translations** - Delete README.it.md, README.th.md etc.

---

**Remember**: The goal is a clean merge that compiles, passes tests, and preserves all Kilo-specific functionality. When in doubt, preserve Kilo changes and flag for human review. Branding is CRITICAL - this is a rebranded fork and user-facing strings must say "Kilo CLI" not "OpenCode".
