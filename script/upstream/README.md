# Upstream Merge Automation

Scripts for automating the merge of upstream opencode changes into Kilo.

## Quick Start

```bash
# Install dependencies (from script/upstream directory)
cd script/upstream
bun install

# List available upstream versions
bun run list-versions.ts

# Analyze changes for a specific version (without merging)
bun run analyze.ts --version v1.1.49

# Run the full merge process
bun run merge.ts --version v1.1.49

# Dry-run to preview what would happen
bun run merge.ts --version v1.1.49 --dry-run

# Use a different base branch (e.g., for incremental merges)
bun run merge.ts --version v1.1.50 --base-branch catrielmuller/kilo-opencode-v1.1.44
```

## Scripts

### Main Scripts

| Script | Description |
|---|---|
| `merge.ts` | Main orchestration script for upstream merges |
| `list-versions.ts` | List available upstream versions |
| `analyze.ts` | Analyze changes without merging |
| `fix-kilocode-markers.ts` | Rebuild `kilocode_change` markers for one file against the last merged upstream |
| `reset-to-upstream.ts` | Reset one file to the transformed last merged upstream version |

### Transform Scripts

| Script | Description |
|---|---|
| `transforms/package-names.ts` | Transform opencode package names to kilo |
| `transforms/preserve-versions.ts` | Preserve Kilo's package versions |
| `transforms/keep-ours.ts` | Keep Kilo's version of specific files |
| `transforms/skip-files.ts` | Skip/remove files that shouldn't exist in Kilo |
| `transforms/transform-i18n.ts` | Transform i18n files with Kilo branding |
| `transforms/transform-take-theirs.ts` | Take upstream + apply Kilo branding for branding-only files |
| `transforms/transform-package-json.ts` | Enhanced package.json with Kilo dependency injection |
| `transforms/transform-scripts.ts` | Transform script files with GitHub API references |
| `transforms/transform-extensions.ts` | Transform extension files (Zed, etc.) |
| `transforms/transform-web.ts` | Transform web/docs files (.mdx) |

### Codemods (AST-based)

| Script | Description |
|---|---|
| `codemods/transform-imports.ts` | Transform import statements using ts-morph |
| `codemods/transform-strings.ts` | Transform string literals |

## Merge Process

The merge automation follows this process, applying **all transformations BEFORE the merge** to minimize conflicts:

1. **Validate environment**
   - Check for upstream remote
   - Ensure working directory is clean

2. **Fetch upstream** and determine target version

3. **Generate conflict report** analyzing which files will conflict

4. **Create branches**
   - `backup/<branch>-<timestamp>` - Backup of current state
   - `<author>/kilo-opencode-<version>` - Merge target branch
   - `<author>/opencode-<version>` - Transformed upstream branch

5. **Apply ALL transformations to upstream branch (PRE-MERGE)**:
   - Remove files that should not exist in Kilo (`skipFiles`)
   - Transform package names (opencode-ai -> @kilocode/cli)
   - Preserve Kilo's versions
   - Transform i18n files with Kilo branding
   - Transform branding-only files (UI components, configs)
   - Transform package.json files (names, deps, Kilo injections)
   - Transform script files (GitHub API references)
   - Transform extension files (Zed, etc.)
   - Transform web/docs files
   - Reset Kilo-specific files

6. **Merge** transformed upstream into Kilo branch
   - Since all branding transforms are applied pre-merge, conflicts should be minimal
   - Remaining conflicts are files with actual code differences (kilocode_change markers)

7. **Auto-resolve** any remaining conflicts
   - Skip files that shouldn't exist in Kilo
   - Keep Kilo's version of specific files
   - Fallback transforms for edge cases

8. **Push** and generate final report

## Configuration

Configuration is defined in `utils/config.ts`:

```typescript
{
  // Package name mappings
  packageMappings: [
    { from: "opencode-ai", to: "@kilocode/cli" },
    { from: "@opencode-ai/cli", to: "@kilocode/cli" },
    // ...
  ],

  // Files to always keep Kilo's version (never take upstream)
  keepOurs: [
    "README.md",
    "CONTRIBUTING.md",
    "AGENTS.md",
    ".github/workflows/publish.yml",  // GitHub workflows - manual review
    // ...
  ],

  // Files to skip entirely (remove from merge)
  skipFiles: [
    "README.*.md",  // Translated READMEs
    "STATS.md",
    ".github/workflows/update-nix-hashes.yml",
    // ...
  ],

  // Files to take upstream + apply Kilo branding transforms
  takeTheirsAndTransform: [
    "packages/ui/src/**/*.tsx",
    // ...
  ],

  // Kilo-specific directories (preserved)
  kiloDirectories: [
    "packages/opencode/src/kilocode",
    "packages/kilo-gateway",
    "packages/kilo-telemetry",
    // ...
  ],
}
```

## Pre-Merge Transformation Strategy

**Key insight**: By applying all branding transforms to the upstream branch BEFORE merging, we eliminate most conflicts that would otherwise occur due to branding differences (OpenCode -> Kilo).

### Transform Order (Pre-Merge)

The following transforms are applied to the opencode branch before merging:

1. **Skip files** - Remove upstream-only packages/files that should not exist in Kilo
2. **Package names** - `opencode-ai` -> `@kilocode/cli`, etc.
3. **Versions** - Preserve Kilo's version numbers
4. **i18n files** - OpenCode -> Kilo in user-visible strings
5. **Branding files** - UI components, configs with branding only
6. **package.json** - Names, dependencies, Kilo injections
7. **Scripts** - GitHub API references
8. **Extensions** - Zed, etc.
9. **Web/docs** - Documentation files

### Post-Merge Strategies

After merging, any remaining conflicts are handled based on file type:

| File Type | Strategy | Description |
|---|---|---|
| i18n files | `i18n-transform` | Take upstream, apply Kilo branding |
| UI components | `take-theirs-transform` | Take upstream, apply branding (no logic changes) |
| package.json | `package-transform` | Take upstream, transform names, inject Kilo deps |
| Script files | `script-transform` | Take upstream, transform GitHub references |
| Extensions | `extension-transform` | Take upstream, apply branding |
| Web/docs | `web-transform` | Take upstream, apply branding |
| README/docs | `keep-ours` | Keep Kilo's version |
| GitHub workflows | `keep-ours` | Keep Kilo's version (manual review) |
| Code with markers | `manual` | Has `kilocode_change` markers, needs review |

### Why This Reduces Conflicts

Previously, conflicts occurred because:

- Upstream had `OpenCode` branding
- Kilo had `Kilo` branding
- Git saw these as conflicting changes

Now:

- We transform upstream to `Kilo` branding BEFORE merge
- Both branches have the same branding
- Git sees no conflict for branding-only files

The only remaining conflicts are files with **actual code differences** - files with `kilocode_change` markers that contain Kilo-specific logic.

## CLI Options

### merge.ts

```
Options:
  --version <version>    Target upstream version (e.g., v1.1.49)
  --commit <hash>        Target upstream commit hash
  --base-branch <name>   Base branch to merge into (default: main)
  --dry-run              Preview changes without applying them
  --no-push              Don't push branches to remote
  --no-worktrees         Don't create reference worktrees
  --report-only          Only generate conflict report
  --verbose              Enable verbose logging
  --author <name>        Author name for branch prefix
```

By default, `merge.ts` also prepares prompt-friendly reference worktrees under `.worktrees/opencode-merge/`:

| Path | Snapshot |
|---|---|
| `.worktrees/opencode-merge/opencode` | Pristine upstream opencode at the requested version or commit |
| `.worktrees/opencode-merge/kilo-main` | The Kilo base branch snapshot used for the merge |
| `.worktrees/opencode-merge/auto-merge` | The automated merge result before final lockfile or SDK regeneration |

If conflicts remain after automation, `auto-merge` is a committed local snapshot branch that may intentionally contain conflict markers as normal file content. The real merge branch remains unresolved so manual resolution can continue with accurate git conflict state.

### analyze.ts

```
Options:
  --version <version>    Target upstream version
  --commit <hash>        Target commit hash
  --base-branch <name>   Base branch to analyze from (default: main)
  --output <file>        Output file for report
```

### fix-kilocode-markers.ts

```
Usage:
  bun run script/upstream/fix-kilocode-markers.ts <repo-relative-file> [--dry-run]

Options:
  --dry-run              Show what would change without writing the file
```

The command finds the newest upstream tag already merged into `HEAD`, reads that upstream version of the file, applies the same branding transforms used by upstream merge automation, strips existing `kilocode_change` markers from the current file, and adds fresh markers around the remaining lines that differ from upstream.

### reset-to-upstream.ts

```
Usage:
  bun run script/upstream/reset-to-upstream.ts <repo-relative-file> [--dry-run]

Options:
  --dry-run              Show what would change without writing the file
```

The command finds the newest upstream tag already merged into `HEAD`, reads that upstream version of the file, applies the same branding transforms used by upstream merge automation for text files, and writes the result to the working tree. Binary files are restored as raw upstream bytes without text transforms. If the file does not exist upstream, the local file is deleted.

## Using Custom Base Branches

By default, upstream merges start from the `main` branch. However, you can use `--base-branch` to start from a different branch. This is useful for:

### Incremental Merges

When working on multiple upstream versions, you can create a chain of merge PRs:

```bash
# First merge: v1.1.44 into main
bun run merge.ts --version v1.1.44

# Create PR: catrielmuller/kilo-opencode-v1.1.44 -> main

# Second merge: v1.1.50 based on the previous PR (without waiting for approval)
bun run merge.ts --version v1.1.50 --base-branch catrielmuller/kilo-opencode-v1.1.44

# Create PR: catrielmuller/kilo-opencode-v1.1.50 -> catrielmuller/kilo-opencode-v1.1.44
# OR: catrielmuller/kilo-opencode-v1.1.50 -> main (once first PR is merged)
```

### Benefits

- **Work in parallel**: Don't wait for PR approval to start the next merge
- **Isolation**: Each merge is independent and easier to review
- **Flexibility**: Can adjust the PR chain as needed
- **Cleaner history**: Related merges can be grouped together

### Example Workflow

```bash
# 1. Analyze next version from your WIP branch
bun run analyze.ts --version v1.1.50 --base-branch catrielmuller/kilo-opencode-v1.1.44

# 2. Run the merge
bun run merge.ts --version v1.1.50 --base-branch catrielmuller/kilo-opencode-v1.1.44

# 3. Create PR from catrielmuller/kilo-opencode-v1.1.50
#    - Target: catrielmuller/kilo-opencode-v1.1.44 (if first PR not merged yet)
#    - Target: main (if first PR is already merged)
```

## Manual Conflict Resolution

After running the merge script, you may have remaining conflicts. To resolve:

1. Open each conflicted file
2. Look for `kilocode_change` markers to identify Kilo-specific code
3. Resolve conflicts, keeping Kilo-specific changes
4. Stage and commit:
   ```bash
   git add -A
   git commit -m "resolve merge conflicts"
   ```

## Rollback

If something goes wrong:

```bash
# Find your backup branch
git branch | grep backup

# Reset to backup
git checkout main
git reset --hard backup/main-<timestamp>
```

## Adding New Transformations

### String-based (simple)

Edit `transforms/package-names.ts` and add patterns to `PACKAGE_PATTERNS`.

### AST-based (robust)

1. Create a new file in `codemods/`
2. Use ts-morph for TypeScript AST manipulation
3. Export transform functions
4. Add to the merge orchestration if needed

## Troubleshooting

### "No upstream remote found"

```bash
git remote add upstream git@github.com:anomalyco/opencode.git
```

### "Working directory has uncommitted changes"

```bash
git stash
# or
git commit -am "WIP"
```

### Merge conflicts after auto-resolution

Some files require manual review. Check the generated report for guidance.
