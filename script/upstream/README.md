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
| `decisions.ts` | Record manual merge decisions and reviewer rationale |

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
3. Review `script/upstream/reports/manual-decisions-<version>.md`; each file
   section shows the original diff3 conflict (ours/base/theirs) that remained
   after automation stopped.
4. From the merge branch worktree, optionally start the project slash command:
   ```bash
   kilo run --command upstream-manual-merge v1.1.50
   ```
   The command is defined in `.kilo/command/upstream-manual-merge.md` and is
   discovered from the repository root. It is available when Kilo is started in
   the merge worktree; it will not appear if Kilo is started from one of the
   reference worktrees under `.worktrees/opencode-merge/`.
5. Resolve conflicts, keeping Kilo-specific changes
6. Record each manual decision with rationale:
   ```bash
   bun script/upstream/decisions.ts add --version v1.1.50 \
     --file packages/opencode/src/config/config.ts \
     --kind hybrid \
     --risk medium \
     --summary "Kept Kilo config fields and adopted upstream validation changes" \
     --rationale "Taking upstream would drop Kilo config support; keeping ours would miss upstream parser updates" \
     --alternative "take upstream: rejected because Kilo config fields would be removed" \
     --alternative "keep ours: rejected because upstream validation changes would be lost" \
     --verification "bun turbo typecheck"
   ```
7. Check the ledger is complete:
   ```bash
   git add -A
   bun script/upstream/decisions.ts check --version v1.1.50
   ```
8. Commit:
   ```bash
   git commit -m "resolve merge conflicts"
   ```

The merge script initializes the decision ledger automatically when it stops for
manual conflicts. The ledger stores a local JSON source of truth and markdown
report under `script/upstream/reports/`; these reports are gitignored so merge
PRs do not accumulate process artifacts. The markdown is the detailed local
review artifact: for every manual file it includes the original diff3 conflict,
the resolved content snapshot, hashes for base/ours/theirs/resolution, and the
agent or human rationale. Paste the PR-ready per-file review summary from:

```bash
bun script/upstream/decisions.ts pr-body --version v1.1.50
```

Decision kinds are `hybrid`, `take-ours`, `take-theirs`, `regenerated`,
`removed`, `renamed`, and `other`. Mark decisions as `high` risk when they touch
auth, billing, data deletion, public APIs, config schemas, migrations, provider
routing, or security behavior.
For `renamed` decisions, include `--target <new-path>` so the checker can
verify the new file exists and record its resolution hash.

### Common Pitfalls

These come up repeatedly during manual resolution and are easy to miss. Read
through before starting:

1. **Auto-merged code outside the conflict can depend on declarations inside
   it.** When picking between ours / theirs / hybrid, scan the non-conflicting
   parts of the same file for references whose declaration lives in the
   conflict block. Example from v1.14.30: `sync.tsx` had an auto-merged call to
   `sessionListQuery()` that used `kv.get(...)`, while `const kv = useKV()` sat
   inside the conflict block on the upstream side. A naive `take-ours`
   resolution would leave `kv` undeclared. Always run typecheck after each
   decision batch to catch these.

2. **Related files can need edits even when they are not listed as unmerged.**
   Upstream refactors sometimes split a file into siblings (e.g. v1.14.30 split
   `httpapi/permission.ts` into `groups/permission.ts` + `handlers/permission.ts`).
   The ledger only tracks the file that remained unmerged, but Kilo behavior
   must be ported into the new sibling. Mention every touched sibling in the
   decision rationale so reviewers can find the diff. `decisions.ts check` will
   not flag changes to non-unmerged files.

3. **`renamed` is stricter than it sounds.** Use `renamed` only when the
   resolution moves content to a different file from the ledger entry. If git
   already recorded the rename during automerge (so the ledger entry is already
   at the new path) and the work is just adapting content, use `hybrid`. The
   `renamed` kind makes `decisions.ts check` fail with "original path still
   exists after renamed decision" if the old path is still tracked.

4. **Function signatures can drift across a conflict boundary.** Automerge can
   pick one side of a paired change without noticing that a non-conflicting
   consumer relied on the other side's shape. Example from v1.14.30: our
   `parse()` returned `tree.rootNode`, upstream's returns the full `tree` and
   accesses `tree.rootNode` at the call site inside the conflict block.
   Auto-merge kept the new return type, so the old call site would have been
   broken if we had taken ours. Re-read call sites after resolving, not only
   the conflict block itself.

5. **Always run full turbo typecheck before declaring done.** Visually clean
   resolutions can still break typing at an unrelated call site (e.g. taking
   upstream's `Msg = string | ArrayBuffer | Uint8Array` broke `ws.send()`
   because Uint8Array is not assignable to `BufferSource` on the queue replay
   path). `bun run typecheck` from the repo root is the cheapest catch-all.
   Targeted per-package typechecks are not enough — the failing call site can
   live in a non-conflicted file.

6. **The ledger is gitignored.** JSON and markdown under
   `script/upstream/reports/` do not get added by `git add -A`. If the reviewer
   wants the decision artifacts in the PR, force-add them in a separate commit:
   ```bash
   git add -f script/upstream/reports/manual-decisions-<version>.{json,md}
   git commit -m "docs(upstream): record v<version> manual merge decision ledger"
   ```

### Reviewing Manual Decisions

Use the generated markdown to verify each conflict resolution without replaying
the agent session:

1. Open the file's `Original diff3 conflict` block. It preserves the conflict
   shown to the resolver: `<<<<<<< ours`, `||||||| base`, `=======`, and
   `>>>>>>> theirs`.
2. Compare it with the `Resolved content` block captured when
   `decisions.ts add` ran. The block is truncated for very large files, but the
   full resolved file remains in the merge commit and is tied to the
   `Resolution Hash`.
3. Read `Decision`, `Summary`, `Rationale`, and `Alternatives` next to the
   conflict. The rationale should explain why the resolution preserves Kilo
   behavior while accepting compatible upstream changes.
4. Treat `High Risk Decisions` or missing fields as reviewer focus areas before
   approving the upstream merge PR.

### Agent-Assisted Manual Resolution

Use `/upstream-manual-merge v1.1.50` after `merge.ts` stops. The command asks
the agent to inspect the generated ledger, plan the remaining resolutions,
resolve each conflict, record the rationale with `decisions.ts add`, and finish
with `decisions.ts check`.

If the command does not appear in Kilo, make sure the active session was started
from the merge branch worktree that contains `.kilo/command/upstream-manual-merge.md`.
You can also invoke the same command non-interactively from that directory with
`kilo run --command upstream-manual-merge v1.1.50`.

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
