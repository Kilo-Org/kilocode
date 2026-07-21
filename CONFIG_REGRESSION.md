# Config Regression Review: OpenCode v1.17.5 Merge (PR #12404)

## Scope and Methodology

Reviewed the PR tip `06d871409b` (`marius-kilocode/review-opencode-v1.17.5`) against `origin/main` (`0cf9f902e0`) for configuration discovery, loading, path resolution, and config-adjacent discovery. The supplied comparison trees were also inspected:

- Pristine upstream: `.worktrees/opencode-merge/opencode` at `8d78715d64` (`v1.17.5`).
- Kilo merge base: `.worktrees/opencode-merge/kilo-main` at `12147d1602`.

The review covered `packages/opencode/src/config/`, `packages/opencode/src/kilocode/config/`, `packages/core/src/config.ts`, global/flag paths, MCP config writes, instructions, skills, agents, commands, TUI/theme/keybind migration, and ignore files. No source files were edited. This report is the only file created by the review.

## Findings

### High: Automatic `opencode.json*` and legacy `config.json` loading remains in the reviewed tree

**Classification:** Pre-existing in `origin/main` and the supplied Kilo merge base. This is **not introduced by the v1.17.5 PR diff**, but it conflicts with the stated `.kilo`/`kilo.json`-only policy and should be resolved separately or explicitly accepted by a human.

The main v1 loader still reads legacy files automatically:

- `packages/opencode/src/config/config.ts:193` chooses a global update target from `kilo.jsonc`, `kilo.json`, `opencode.jsonc`, `opencode.json`, and `config.json`.
- `packages/opencode/src/config/config.ts:360-366` merges global `config.json`, `kilo.json`, `kilo.jsonc`, `opencode.json`, and `opencode.jsonc`.
- `packages/opencode/src/config/config.ts:628-645` walks both root-level `kilo.json*` and `opencode.json*` project files.
- `packages/opencode/src/config/config.ts:679-701` loads `KilocodeConfig.ALL_CONFIG_FILES` from every `.kilo` / `.kilocode` config directory, and that constant includes both `opencode.jsonc` and `opencode.json`.
- `packages/opencode/src/config/config.ts:816-825` also accepts those OpenCode files from the managed config directory.
- `packages/opencode/src/kilocode/config/config.ts:41-44` defines `ALL_CONFIG_FILES = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"]`.

This is observable behavior, not merely an obsolete comment or a notification scan: a present OpenCode-named file is parsed and merged as config. Its `// kilocode_change` annotations establish that it is deliberate Kilo-side compatibility code rather than v1.17.5 upstream code.

The unmerged branch `fix-opencode-configs-used-for-kilo` contains commit `8f6a2cd04d` (`fix(cli): remove automatic OpenCode config support, use Kilo config files only`). Its diff removes these readers by restricting the loader to `KILO_CONFIG_FILES`. That branch is not an ancestor of `origin/main` (the ancestry check exited `1`), which explains why the reviewed PR and base retain this behavior.

### High: The v2/core config service independently reads the same OpenCode fallback files

**Classification:** Pre-existing in `origin/main` and the supplied Kilo merge base. Not a v1.17.5 merge delta.

`packages/core/src/config.ts` has a separate discovery path from the v1 loader:

- `:142` defines `names = ["config.json", "kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc"]`.
- `:164-170` loads every filename in that list from the global and discovered config directories.
- `:177-205` searches root-level files and `.kilo`/`.kilocode` directories, then applies the loaded documents in precedence order.

Consequently, even if the v1 loader were restricted, this service would still automatically consume `opencode.json*` and `config.json` at the global, project-root, `.kilo`, and `.kilocode` locations. The supplied Kilo-base copy is byte-identical to the PR for this file; pristine v1.17.5 differs because it uses upstream OpenCode paths rather than Kilo's modified mixed candidate list.

### High: Settings overlay and `mcp add` can select and write an existing OpenCode-named config file

**Classification:** Pre-existing in `origin/main` and the supplied Kilo merge base. Not a v1.17.5 merge delta.

The configuration-management surfaces preserve the same fallback policy:

- `packages/opencode/src/kilocode/config/overlay.ts:76,132-144,179-195` discovers `opencode.json*` at project root, in `.kilo`/`.kilocode`, and in the global config directory. It can select such a file as the active settings write target.
- `packages/opencode/src/cli/cmd/mcp.ts:406-436` checks existing `opencode.json*` files at project root and inside `.kilo`/`.kilocode`, then returns the first match as the file that `mcp add` modifies.
- `packages/opencode/src/kilocode/config/sources.ts:60,121-159` reports OpenCode-named global, project, and config-directory files as config sources.
- `packages/opencode/src/kilocode/config/global-stamp.ts:6` monitors `config.json`, `opencode.json`, and `opencode.jsonc`, so changes to them invalidate the global config cache.

`packages/opencode/src/kilocode/permission/config-paths.ts:23` also treats root-level `opencode.json*` as protected config. That protection alone does not load the files, but it corroborates that the current product regards them as active config paths.

### Medium, needs human verification: macOS MDM preferences still use the OpenCode bundle identifier

**Classification:** Pre-existing, not a PR diff.

`packages/opencode/src/config/managed.ts:8,53-65` reads `ai.opencode.managed.plist` through `MANAGED_PLIST_DOMAIN = "ai.opencode.managed"`. `packages/opencode/src/kilocode/config/sources.ts:254-271` surfaces the same OpenCode-named managed preference locations. These files are parsed as high-precedence managed configuration.

This might be an intentional deployment-compatibility identifier rather than a filesystem fallback that the `.kilo`-only rule aims to remove. A human should decide whether existing MDM profiles must remain supported. If not, it is another automatic OpenCode configuration input that needs migration/removal.

## Notable Non-Findings

- **No v1.17.5 PR regression relative to `origin/main`:** `git diff origin/main...HEAD` contains no changes in the principal config loaders/path resolvers, `packages/core/src/config.ts`, flags/global paths, settings overlay, MCP resolver, instructions, skills, TUI config, or ignore migration. The supplied Kilo merge-base copies of the reviewed v1 loader, Kilo config helper, overlay, sources, global stamp, core config service, and MCP resolver are also unchanged from the PR where compared.
- **No `.opencode` directory loading:** `packages/opencode/src/config/paths.ts:23-40` discovers only `.kilo` and `.kilocode`; `KilocodeConfig.isConfigDir` accepts only those directories or `KILO_CONFIG_DIR`. `detectOpencodeConfig` only calls `existsSync` to show a migration notification, not to load the directory.
- **No `OPENCODE_CONFIG*` flag fallback:** `packages/core/src/flag/flag.ts:45-46,131-142` exposes `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, `KILO_CONFIG_DIR`, and `KILO_DISABLE_PROJECT_CONFIG`; no `OPENCODE_CONFIG*` equivalents remain in the reviewed runtime config flags.
- **Instructions remain Kilo-oriented:** `packages/opencode/src/session/instruction.ts:62-93,147-158` uses global/project `AGENTS.md` (with optional Claude interoperability) and `KILO_CONFIG_DIR`; it does not discover OpenCode-specific instruction filenames or `.opencode` directories.
- **Skills, agents, and commands use Kilo config directories:** skills are scanned from `.kilo`/`.kilocode` config directories (`packages/opencode/src/skill/index.ts:240-255`), while command/agent discovery is driven by those same directories. External `.claude` and `.agents` skill support is separate interoperability behavior, not OpenCode config fallback.
- **Ignore-file handling is `.kilocodeignore` only:** `packages/opencode/src/kilocode/ignore-migrator.ts:10-12,156-172` reads global/project `.kilocodeignore`; no `.opencodeignore` reader was found.
- **TUI/keybind/theme discovery is Kilo-only in behavior:** `packages/opencode/src/config/tui.ts:184-231` uses global/project `tui.json*`, `.kilo`, `.kilocode`, and `KILO_TUI_CONFIG`. `packages/opencode/src/config/tui-migrate.ts:126-145` has stale OpenCode wording/function naming, but its candidates are `kilo.json*`, not `opencode.json*`.
- **Global runtime config directory is Kilo:** `packages/core/src/global.ts:12,22-25,75-86` resolves `$XDG_CONFIG_HOME/kilo` and honors only `KILO_CONFIG_DIR`.

## Command Output Excerpts

```text
$ git -C .worktrees/opencode-merge/opencode describe --tags --exact-match
v1.17.5

$ git rev-parse --short origin/main
0cf9f902e0

$ git rev-parse --short HEAD
06d871409b
```

```text
$ git diff --name-status origin/main...HEAD -- \
  packages/opencode/src/config packages/opencode/src/kilocode/config \
  packages/core/src/config.ts packages/core/src/global.ts \
  packages/core/src/flag/flag.ts packages/opencode/src/session/instruction.ts \
  packages/opencode/src/skill packages/opencode/src/kilocode/ignore-migrator.ts \
  packages/opencode/src/cli/cmd/mcp.ts packages/opencode/src/kilocode/permission/config-paths.ts
# no output
```

The requested added-line scan did not find added functional OpenCode config candidates. Its literal pipeline output was only a diff header and an unrelated temporary-directory name:

```text
+++ b/.opencode-version
+  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-core-migration-"))
```

```text
$ git merge-base --is-ancestor fix-opencode-configs-used-for-kilo origin/main; printf '%s\n' $?
1

$ git log --oneline --max-count=3 fix-opencode-configs-used-for-kilo
76bca926e1 refactor(cli): centralize Kilo config candidates
4289a220be test(cli): update Kilo config path fixtures
8f6a2cd04d fix(cli): remove automatic OpenCode config support, use Kilo config files only
```

## Limitations

- This was a static source and Git-history review. It did not execute the CLI with fixture directories containing both Kilo and OpenCode config files.
- The report attributes regressions relative to `origin/main`, as requested. Existing fallback behavior is therefore called out separately rather than attributed to PR #12404.
- No source code was edited, no commits were created, and no changes were pushed. The pre-existing untracked file `upstream-merge-report-1.17.5.md` was left untouched.
