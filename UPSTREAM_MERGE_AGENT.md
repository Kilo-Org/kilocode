# Upstream Merge Agent Prompt

## Overview

You are an autonomous merge agent responsible for synchronizing the Kilo CLI repository with upstream changes from the opencode repository. Your goal is to perform a clean merge that preserves Kilo-specific functionality while incorporating all upstream improvements.

**CRITICAL**: This is a rebranded fork. "Kilo CLI" replaces "OpenCode" in ALL user-facing contexts. The merge MUST preserve Kilo branding, logos, and provider configurations. Upstream uses "opencodeZen" as their gateway provider; Kilo uses "kiloGateway" instead. Do NOT remove zed-related code, but ensure Kilo Gateway is the primary/default gateway for our users.

## Repository Setup

- **Upstream remote**: `git@github.com:sst/opencode.git` (add as `upstream` if not exists)
- **Default branch**: `dev`
- **Upstream branch to merge**: Specified by user (e.g., `v1.1.42`)

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

## FILES TO ACCEPT FROM UPSTREAM (No Kilo-specific changes)

These files have no Kilo-specific modifications and can safely accept upstream changes:

```
packages/desktop/*                         # Entire Tauri desktop app
nix/desktop.nix                            # Nix desktop build config
.github/workflows/nix-desktop.yml          # Desktop CI workflow
```

---

## CRITICAL FILES - ALWAYS KEEP KILO VERSION

These files MUST be kept from the `dev` branch (ours), NOT upstream:

### Branding Files (NEVER accept upstream changes)

| File                                                   | Reason                              |
| ------------------------------------------------------ | ----------------------------------- |
| `packages/opencode/src/cli/logo.ts`                    | Contains Kilo ASCII art logo        |
| `packages/opencode/src/cli/ui.ts`                      | References the Kilo logo            |
| `packages/opencode/src/cli/cmd/tui/component/logo.tsx` | TUI logo returns KiloLogo           |
| `package.json` (root)                                  | Must have `"name": "@kilocode/cli"` |

### Provider Configuration

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
// Alias for upstream compatibility
export const popularProviders = preferredProviders
```

### Locale/i18n Files (packages/app/src/i18n/)

For ALL files in `packages/app/src/i18n/*.ts`, these keys MUST use "Kilo" branding:

| Key                                    | Required Value                                         |
| -------------------------------------- | ------------------------------------------------------ |
| `dialog.provider.kilo.note`            | `"Access 500+ AI models"`                              |
| `dialog.model.unpaid.freeModels.title` | `"Free models provided by Kilo CLI"`                   |
| `provider.connect.apiKey.description`  | Must reference "Kilo CLI" not "OpenCode"               |
| `provider.connect.kiloGateway.*`       | Keep all `kiloGateway` keys (NOT `opencodeZen`)        |
| `dialog.server.description`            | `"Switch which Kilo CLI server this app connects to."` |
| `toast.update.description`             | `"A new version of Kilo CLI..."`                       |
| `error.page.report.prefix`             | `"Please report this error to the Kilo CLI team"`      |
| `sidebar.gettingStarted.line1`         | `"Kilo CLI includes free models..."`                   |
| `settings.general.row.*.description`   | Must reference "Kilo CLI" not "OpenCode"               |

**IMPORTANT Provider Key Mapping**: When upstream uses `opencodeZen`, Kilo uses `kiloGateway`:

| Upstream (opencode)              | Kilo                             |
| -------------------------------- | -------------------------------- |
| `provider.connect.opencodeZen.*` | `provider.connect.kiloGateway.*` |
| `dialog.provider.opencode.note`  | `dialog.provider.kilo.note`      |

**IMPORTANT**: Do NOT accept upstream locale changes that:

- Replace `kiloGateway` with `opencodeZen`
- Replace "Kilo CLI" with "OpenCode" in user-facing strings
- Remove `dialog.provider.kilo.note` key
- Remove `dialog.provider.group.recommended` key with kilocode_change marker

### Files to Delete After Merge

Remove these files that upstream adds but Kilo doesn't need:

```bash
git rm -f README.it.md README.th.md 2>/dev/null || true
```

### Version Management

- Keep Kilo's version numbers in all `package.json` files
- Do NOT accept upstream version bumps (e.g., `1.1.42` -> keep Kilo's version)
- Run `bun install` AFTER fixing package.json versions to update bun.lock correctly

---

## Merge Process

### Step 1: Prepare the Upstream Branch

```bash
# Add upstream remote if needed
git remote add upstream git@github.com:sst/opencode.git 2>/dev/null || true
git fetch upstream --tags

# Create preparation branch from upstream version
git checkout -b upstream-prepared-<version> <version>

# Transform package names to Kilo conventions
bun run ./scripts/kilocode/opencode_merge_transform_packages.ts

# Commit preparation
git add -A
git commit -m "chore: prepare upstream <version> for kilo merge"
```

### Step 2: Start the Merge

From your working branch (based on `dev`):

```bash
git merge upstream-prepared-<version> --no-edit
```

This will create conflicts that need resolution.

### Step 3: Run Cleanup Script

```bash
./scripts/kilocode/opencode_merge_01_cleanup.sh
```

This script:

- Resets files we maintain separately (README, CHANGELOG, .github)
- **Resets critical branding files** (logo.ts, ui.ts, use-providers.ts) to Kilo versions
- Removes unwanted README translations (README.it.md, README.th.md)
- Removes files deleted in our branch
- Verifies Kilo-specific directories exist
- **Runs branding verification checks** and reports any issues

### Step 4: Resolve Package.json Conflicts

```bash
bun run ./scripts/kilocode/opencode_merge_02_package_json.ts
```

This script automatically resolves package.json conflicts by:

- Keeping Kilo package names, versions, and bin entries
- Preserving Kilo-specific dependencies
- Merging dependency updates from upstream

### Step 5: Fix Branding Issues

```bash
./scripts/kilocode/opencode_merge_03_fix_branding.sh
```

This script checks locale files for branding issues:

- Verifies critical Kilo branding keys exist
- Warns about OpenCode references that should be Kilo
- Warns about opencodeZen references that should be kiloGateway

### Step 6: Resolve Remaining Conflicts Manually

Common conflict patterns:

**Source files with `kilocode_change` markers:**

There are different types of markers - handle each appropriately:

1. **Whole-file markers** - File starts with `// kilocode_change - new file`
   - This entire file is Kilo-specific, keep our version entirely
   - Reject any upstream changes to this file

2. **Single-line markers** - Line ends with `// kilocode_change`

   ```typescript
   const value = 42 // kilocode_change
   ```

   - Keep this specific line from our version
   - Upstream changes to other lines in the file can be accepted

3. **Multi-line block markers** - `// kilocode_change start` and `// kilocode_change end`

   ```typescript
   // kilocode_change start
   const foo = 1
   const bar = 2
   // kilocode_change end
   ```

   - Keep the entire block between start/end markers
   - Upstream changes outside the block can be accepted

4. **Deletion markers** - `// kilocode_change - deleted` or removed code with marker
   - If upstream re-adds code we intentionally removed, reject the addition
   - Check git history if unclear whether deletion was intentional

**Resolution strategy:**

- ALWAYS preserve the marked changes
- Integrate upstream changes around them
- If upstream modified the same lines, manually merge preserving Kilo intent

**Import conflicts (SDK packages):**

```typescript
// Keep Kilo imports:
import type { X } from "@kilocode/sdk/v2" // kilocode_change
// NOT:
import type { X } from "@opencode-ai/sdk/v2"
```

**Locale file conflicts (kiloGateway vs opencodeZen):**

- Keep `kiloGateway` keys, reject `opencodeZen` renaming
- Keep `dialog.provider.kilo.note` key

**Config files (tauri, zed extension):**

- Keep Kilo branding (product name, identifiers)
- Update version numbers to match upstream
- Keep Kilo GitHub URLs (`Kilo-Org/kilo`)

### Step 7: Validation

```bash
bun install
bun run typecheck
cd packages/opencode && bun run test
```

The cleanup script (Step 3) already runs branding verification checks. Fix any warnings it reports before proceeding.

---

## PR Creation

- **Title**: `refactor: merge opencode <version>`
- **Body**: List upstream changes included and any conflicts that required manual resolution

---

## Available Scripts

| Script                                 | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `opencode_merge_01_cleanup.sh`         | Reset branding files + cleanup after merge |
| `opencode_merge_02_package_json.ts`    | Resolve package.json conflicts             |
| `opencode_merge_03_fix_branding.sh`    | Verify/fix locale branding                 |
| `opencode_merge_transform_packages.ts` | Transform package names (for prep branch)  |

---

## Common Mistakes to AVOID

1. **Accepting upstream logo.ts** - This replaces Kilo logo with OpenCode logo
2. **Accepting upstream preferredProviders** - This removes `kilo` from first position or removes it entirely
3. **Accepting upstream locale branding** - This replaces "Kilo CLI" with "OpenCode" in user-facing text
4. **Accepting upstream kiloGateway->opencodeZen rename** - This breaks Kilo-specific provider config
5. **Accepting upstream version bumps** - Keep Kilo's version numbers
6. **Keeping upstream README translations** - Delete README.it.md, README.th.md etc.
7. **Forgetting popularProviders alias** - Upstream code may use `popularProviders`, add alias for compatibility

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

**Remember**: The goal is a clean merge that compiles, passes tests, and preserves all Kilo-specific functionality. When in doubt, preserve Kilo changes and flag for human review. Branding is CRITICAL - this is a rebranded fork and user-facing strings must say "Kilo CLI" not "OpenCode".
