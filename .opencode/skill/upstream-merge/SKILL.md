---
name: upstream-merge
description: Step-by-step process for merging upstream opencode releases into Kilo CLI. Load this skill when executing a merge.
---

## Pre-Merge Checklist

- [ ] Know the target upstream version (e.g., `v1.1.48`)
- [ ] Working branch is based on `dev`
- [ ] No uncommitted changes

## Step 1: Prepare Upstream Branch

```bash
# Add upstream remote if needed
git remote add upstream git@github.com:sst/opencode.git 2>/dev/null || true
git fetch upstream --tags

# Create preparation branch from upstream version
git checkout -b upstream-prepared-<version> <version>

# Transform package names to Kilo conventions
bun run ./scripts/kilocode/opencode_merge_transform_packages.ts

# Commit preparation
git add -A && git commit -m "chore: prepare upstream <version> for kilo merge"
```

## Step 2: Start Merge

```bash
git checkout dev  # or your working branch
git merge upstream-prepared-<version> --no-edit
```

## Step 3: Run Cleanup Script

```bash
./scripts/kilocode/opencode_merge_01_cleanup.sh
```

This resets critical branding files and removes unwanted files. Check output for warnings.

## Step 4: Resolve Package.json Conflicts

```bash
bun run ./scripts/kilocode/opencode_merge_02_package_json.ts
```

## Step 5: Check Branding

```bash
./scripts/kilocode/opencode_merge_03_fix_branding.sh
```

Fix any warnings about `opencodeZen` or missing `kiloGateway` keys.

## Step 6: Resolve Remaining Conflicts

For files with `kilocode_change` markers:

- **Whole-file** (`// kilocode_change - new file`): Keep our version entirely
- **Single-line** (`// kilocode_change`): Keep that line, accept other changes
- **Block** (`start`/`end`): Keep block, accept changes outside
- **Deletion marker**: Reject upstream re-additions

For locale files (`packages/app/src/i18n/*.ts`):

- Keep `kiloGateway` keys (reject `opencodeZen`)
- Keep `dialog.provider.kilo.note`
- User-facing strings should say "Kilo CLI" not "OpenCode"

For zed extension:

- Keep Kilo GitHub URLs (`Kilo-Org/kilo`)
- Update version number to match upstream

## Step 7: Validate

```bash
bun install
bun run typecheck
cd packages/opencode && bun run test
```

## Step 8: Commit & PR

```bash
git add -A
git commit -m "refactor: merge opencode <version>"
git push -u origin <branch-name>
gh pr create --title "refactor: merge opencode <version>" --base dev
```

PR body should list:

- Upstream changes included
- Conflicts resolved
- Branding verification (all checks passed)

## Quick Reference: Scripts

| Script                                 | Purpose                          |
| -------------------------------------- | -------------------------------- |
| `opencode_merge_transform_packages.ts` | Transform package names (Step 1) |
| `opencode_merge_01_cleanup.sh`         | Reset branding, cleanup (Step 3) |
| `opencode_merge_02_package_json.ts`    | Resolve package.json (Step 4)    |
| `opencode_merge_03_fix_branding.sh`    | Check locale branding (Step 5)   |

## Common Mistakes

1. Accepting upstream `logo.ts` → replaces Kilo logo
2. Accepting `preferredProviders` change → removes `kilo` from first position
3. Accepting `kiloGateway→opencodeZen` rename → breaks provider config
4. Forgetting `popularProviders` alias → add if upstream uses it
5. Keeping `README.it.md`, `README.th.md` → delete these

## If Uncertain

1. Add `// TODO: MERGE_REVIEW_NEEDED` comment
2. Preserve Kilo changes (safer default)
3. Document in PR description
