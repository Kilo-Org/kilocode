---
name: upstream-merge
description: Use this skill when merging upstream opencode changes into the Kilo CLI fork. It covers branding preservation, conflict resolution, package naming, and the step-by-step merge process.
---

## Use this when

- Merging upstream opencode releases into Kilo CLI
- Resolving merge conflicts with kilocode_change markers
- Checking branding compliance after merge

## Critical Context

This is a rebranded fork. "Kilo CLI" replaces "OpenCode" in ALL user-facing contexts. Upstream uses "opencodeZen" as their gateway; Kilo uses "kiloGateway" instead.

## Package Name Mappings

| Upstream              | Kilo               |
| --------------------- | ------------------ |
| `opencode`            | `@kilocode/cli`    |
| `@opencode-ai/plugin` | `@kilocode/plugin` |
| `@opencode-ai/sdk`    | `@kilocode/sdk`    |
| Binary: `opencode`    | Binary: `kilo`     |

Internal packages stay as-is: `@opencode-ai/script`, `@opencode-ai/util`

## Files to Accept from Upstream (no Kilo changes)

```
packages/desktop/*
nix/desktop.nix
.github/workflows/nix-desktop.yml
```

## Files to ALWAYS Keep Kilo Version

| File                                                   | Reason                             |
| ------------------------------------------------------ | ---------------------------------- |
| `packages/opencode/src/cli/logo.ts`                    | Kilo ASCII art                     |
| `packages/opencode/src/cli/ui.ts`                      | Kilo logo reference                |
| `packages/opencode/src/cli/cmd/tui/component/logo.tsx` | KiloLogo component                 |
| `package.json` (root)                                  | `"name": "@kilocode/cli"`          |
| `packages/app/src/hooks/use-providers.ts`              | `kilo` first in preferredProviders |

## Locale Key Mappings (opencodeZen -> kiloGateway)

| Upstream                         | Kilo                             |
| -------------------------------- | -------------------------------- |
| `provider.connect.opencodeZen.*` | `provider.connect.kiloGateway.*` |
| `dialog.provider.opencode.note`  | `dialog.provider.kilo.note`      |

Keep all `kiloGateway` keys. Never accept `opencodeZen` renaming.

## kilocode_change Markers

1. **Whole-file**: `// kilocode_change - new file` - Keep entire file
2. **Single-line**: `const x = 1 // kilocode_change` - Keep this line
3. **Block**: `// kilocode_change start` ... `// kilocode_change end` - Keep block
4. **Deletion**: `// kilocode_change - deleted` - Reject upstream re-additions

## Merge Process

```bash
# Step 1: Prepare upstream branch
git remote add upstream git@github.com:sst/opencode.git 2>/dev/null || true
git fetch upstream --tags
git checkout -b upstream-prepared-<version> <version>
bun run ./scripts/kilocode/opencode_merge_transform_packages.ts
git add -A && git commit -m "chore: prepare upstream <version> for kilo merge"

# Step 2: Merge
git checkout dev  # or your working branch
git merge upstream-prepared-<version> --no-edit

# Step 3: Run scripts
./scripts/kilocode/opencode_merge_01_cleanup.sh
bun run ./scripts/kilocode/opencode_merge_02_package_json.ts
./scripts/kilocode/opencode_merge_03_fix_branding.sh

# Step 4: Resolve remaining conflicts manually

# Step 5: Validate
bun install
bun run typecheck
cd packages/opencode && bun run test
```

## Available Scripts

| Script                                 | Purpose                        |
| -------------------------------------- | ------------------------------ |
| `opencode_merge_01_cleanup.sh`         | Reset branding files, cleanup  |
| `opencode_merge_02_package_json.ts`    | Resolve package.json conflicts |
| `opencode_merge_03_fix_branding.sh`    | Verify locale branding         |
| `opencode_merge_transform_packages.ts` | Transform package names        |

## Common Mistakes

1. Accepting upstream `logo.ts` - replaces Kilo logo
2. Accepting upstream `preferredProviders` - removes `kilo` from first position
3. Accepting `kiloGateway->opencodeZen` rename - breaks Kilo provider config
4. Accepting upstream version bumps - keep Kilo versions
5. Keeping `README.it.md`, `README.th.md` - delete these
6. Forgetting `popularProviders` alias - upstream may use it

## Uncertainty Handling

If conflict resolution is unclear:

1. Add `// TODO: MERGE_REVIEW_NEEDED` comment
2. Document in PR description
3. When in doubt, preserve Kilo changes

## PR Format

- **Title**: `refactor: merge opencode <version>`
- **Body**: List upstream changes and conflicts resolved
