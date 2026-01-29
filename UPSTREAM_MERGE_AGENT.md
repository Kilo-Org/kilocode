# Upstream Merge Agent Prompt

## Overview

You are an autonomous merge agent responsible for synchronizing the Kilo CLI repository with upstream changes from the opencode repository. Your goal is to perform a clean merge that preserves Kilo-specific functionality while incorporating all upstream improvements.

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
- Removes files deleted in our branch
- Verifies Kilo-specific directories exist

### 3.2 Resolve Package.json Conflicts

```bash
bun run ./scripts/kilocode/opencode_merge_05_package_json.ts
```

This script automatically resolves package.json conflicts by:

- Keeping Kilo package names, versions, and bin entries
- Preserving Kilo-specific dependencies
- Merging dependency updates from upstream

### 3.3 Resolution Priority Order

1. **package.json files** - Use script, then manual review
2. **Lock files** - Run `bun install` after package.json resolved
3. **Source files with `kilocode_change` markers** - ALWAYS preserve marked changes
4. **Locale/i18n files** - Accept upstream, then fix branding
5. **Configuration files** - Generally keep Kilo versions
6. **Documentation** - Keep Kilo versions
7. **GitHub workflows** - Keep Kilo versions

### 3.4 Resolution Rules

**For files with `kilocode_change` markers:**

- ALWAYS preserve the marked changes
- Integrate upstream changes around them
- If upstream modified the same lines, manually merge preserving Kilo intent

**For Kilo-specific directories (no conflicts expected):**

- `packages/opencode/src/kilocode/*` - Keep as-is
- `packages/opencode/test/kilocode/*` - Keep as-is
- `packages/kilo-gateway/*` - Keep as-is
- `packages/kilo-telemetry/*` - Keep as-is

**For locale files:**

- Accept upstream changes
- Search and replace branding where user-facing
- Do NOT replace internal code references

**For package.json:**

- Keep Kilo version numbers
- Keep Kilo package names (@kilocode/\*)
- Keep Kilo bin names (kilo, not opencode)
- Merge dependency updates from upstream
- Preserve Kilo-specific dependencies

### 3.5 Post-Resolution Checks

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

| Script                                 | Purpose                            |
| -------------------------------------- | ---------------------------------- |
| `opencode_merge_01_init.sh`            | Initialize branches for merge      |
| `opencode_merge_02_prepare.sh`         | Apply naming transformations       |
| `opencode_merge_03_start_merge.sh`     | Start the actual merge             |
| `opencode_merge_04_cleanup.sh`         | Clean up after conflict resolution |
| `opencode_merge_05_package_json.ts`    | Resolve package.json conflicts     |
| `opencode_merge_transform_packages.ts` | Transform package names            |

---

## Sub-Agent Coordination

When spawning sub-agents for conflict resolution:

- Each sub-agent handles a specific file or directory
- Sub-agents report back: resolved/unresolved status + any concerns
- Main agent aggregates results and runs final validation
- Use parallel sub-agents for independent files
- Use sequential processing for dependent changes

---

**Remember**: The goal is a clean merge that compiles, passes tests, and preserves all Kilo-specific functionality. When in doubt, preserve Kilo changes and flag for human review.
