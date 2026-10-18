---
name: kilocode-merge-minimizer
description: Use when changing shared upstream-owned files to add Kilo-specific behavior, editing `kilocode_change` markers in shared code, or moving Kilo code out of shared files into a plugin or the Kilo host to reduce upstream merge conflicts on the Kilo v2 line. Do not use for changes confined to Kilo-owned paths such as `packages/kilo-*/` or `packages/**/src/kilocode/`.
---

# Kilo Merge Minimizer (v2 line)

Use this skill whenever a normal development task on the v2 line touches shared upstream-owned code and includes Kilo-specific behavior, especially for marker cleanup, extraction work, or `kilocode_change` annotations.

Do not use this skill when all changes are confined to Kilo-owned paths. The one list of Kilo-owned paths is `script/upstream/utils/owned.ts` (`packages/kilo-*`, `packages/**/src/kilocode/`, `packages/**/test/kilocode/`, `.kilo/`, `migration-tracking/`, `script/upstream/`, `script/check-*.ts`, `script/dev-isolated.ts`, `.github/workflows/kilo-v2.yml`). Those files are not merged from upstream and need no markers. If a task also touches shared upstream-owned code, use this skill for the shared portion only.

Do not use this as the primary guide for upstream sync resolution. Syncs have their own instructions (`.kilo/agent/upstream-merge.md`, `script/upstream/README.md`).

## Goal

The main goal on v2 is to move Kilo code out of shared upstream files, into a Kilo plugin or the Kilo host. Removing or narrowing markers is not enough: a marked patch still conflicts when upstream changes the same lines. The v2 line syncs every upstream release, and seam patches age fast (in the archived port, 16 of 21 seam patches conflicted after five weeks).

Use the first option that works (`.kilo/skills/v2-migration/SKILL.md`, `migration-tracking/technical-notes/v2-fork-conventions.md`, "Plugin-first extension order"):

1. **Kilo plugin** on the public plugin API (`@opencode/plugin`: agent, provider, model, session, event, tool, permission, command, skill, mcp, rpc, storage and more). No shared-file change.
2. **Kilo host** (unit U-E0-01): plugin registration through `SdkPlugins.register`, Effect layer overrides (for example `Global.layerWith`), environment translation at the entry. The host does not exist yet. Until it lands, register a Kilo plugin in the upstream builtin list with one marked line.
3. **Seam patch** in a shared file: small and generic (widen an API, add a hook, export a value), marked `kilocode_change`, in a file that changes rarely. One generic seam is better than many small edits. Offer it upstream when it is generic.
4. **Feature patch** in a shared file: last resort, marked, with the reason in the PR that options 1 to 3 do not work.
5. **Branding and product strings**: the rename script (`script/upstream` codemods) during syncs, never hand edits.

Kilo logic packages (for example `packages/kilo-gateway-core`) import nothing from `@opencode/*`. Only thin adapters do.

## Core Rules

- `script/upstream/utils/owned.ts` defines the Kilo-owned paths. Every other path is shared.
- `script/check-opencode-annotations.ts` checks that every Kilo line in a shared file has a marker, against the pinned upstream release.
- `script/check-shared-patches.ts` counts shared patches. A new shared patch needs an entry in `script/upstream/shared-patches.json` with its rung (3 or 4) and the missing seam, and the limits go up in the same PR. When you remove a patch, lower the limits.
- For each shared file you change, state the option (1 to 5) and the missing seam in the PR.
- Use `script/upstream/fix-kilocode-markers.ts` for stale or broad markers, inspecting `--dry-run` output before applying changes.
- Avoid adding Kilo business logic directly to shared files. Keep shared-file edits as close as possible to upstream shape.
- Do not change shared files unless the change is required for Kilo functionality, fixes a Kilo bug, or is a minimal targeted upstream-quality fix.
- Do not duplicate upstream logic unless there is a concrete reason. If duplication is unavoidable, isolate the Kilo delta and keep the upstream dependency obvious.

## Shared File Structure

- Do not refactor, rename, split files, or extract helpers in shared files just to improve readability or make Kilo extraction cleaner.
- Avoid structural changes that make upstream behavior harder to compare or hide semantic dependency on upstream code.

## Shared File Style

- Preserve upstream formatting and import style in shared files, even when it differs from Kilo style.
- Put Kilo-only imports on separate marked lines instead of reorganizing upstream imports.

## Decision Rules

Move Kilo logic to a plugin or the host (options 1 and 2) when:

- The change is an additive Kilo feature or integration, not a modification of existing upstream behavior.
- The plugin API or an Effect layer can express it, even when that needs one generic seam (option 3) instead of the feature code in the shared file.

Extract Kilo logic into Kilo-owned code behind a narrow seam (option 3) when:

- The shared-file change has meaningful Kilo-owned behavior, not just a tiny condition, import, registration, or field.
- The code has loops, branching, error handling, async workflows, storage access, network calls, UI rendering, or telemetry.
- The shared file can become a small orchestrator that calls Kilo helpers.
- The Kilo code is independent enough that extraction will not hide future upstream fixes or behavior changes.

Keep the change inline (option 3 or 4, marked) when:

- The Kilo delta is a single field, import, call, simple condition, or small registry entry.
- Extraction would reshape upstream code more than the Kilo change itself.
- The change modifies an upstream algorithm, ordering, heuristic, control flow, or bug fix.
- Extraction would duplicate upstream logic or hide semantic dependency on upstream behavior.
- The Kilo helper closes over upstream-local state. Keep closure-scoped helpers inline and contiguous in one narrow marker block.
- The shared file owns the only route table, enum, schema, switch, or registry where the hook must exist.
- The change restores upstream shape or removes a stale Kilo divergence.

Always preserve upstream behavior order unless the Kilo behavior change is intentional and tested.

## Marker Rules

- Mark only Kilo-specific diff lines in shared upstream files.
- Prefer inline markers for single-line changes: `const value = 42 // kilocode_change`.
- Use block markers only for adjacent Kilo-specific lines:

```ts
// kilocode_change start
registerKiloFeature(app)
// kilocode_change end
```

- Use the file's native comment style: JSX block comments inside JSX, `#` for YAML, TOML and shell, `<!-- kilocode_change -->` for Markdown.
- A file that cannot carry markers (JSON) needs an `unmarked` reason in `script/upstream/shared-patches.json`.
- Do not add markers in Kilo-owned paths.
- Remove stale markers when upstream already contains the behavior or when touching Kilo-owned files that still have old markers.
- Use `// kilocode_change - new file` only for unavoidable new Kilo-specific files inside shared upstream paths. Prefer a Kilo-owned path.

## Tests

- Put Kilo-specific tests in Kilo-owned test paths (`packages/**/test/kilocode/`, `packages/kilo-*`).
- Move tests out of shared upstream test paths when the behavior under test is Kilo-specific.
- Tests should cover the real failing path, not private or unstable APIs chosen only for convenience.
- Do not add skip gates for required regression coverage.

## Verification

After editing shared files or marker comments, run:

```bash
bun script/check-opencode-annotations.ts --worktree
bun script/check-shared-patches.ts --worktree
```

On committed changes, run them without `--worktree`. Both compare with the pinned upstream release (the newest `chore(upstream): sync` merge, or the initial base of `v2`).

For stale or broad markers in one shared file, inspect the dry run before applying:

```bash
bun script/upstream/fix-kilocode-markers.ts <repo-relative-file> --dry-run
```

Before finishing, confirm:

- Each shared-file change uses the highest option that works, and the PR states the option and the missing seam.
- Shared files contain minimal integration points only.
- Kilo logic and tests live in Kilo-owned paths.
- Markers are narrow, and stale markers are removed.
- Both checks passed, or the reason they could not run is reported.
