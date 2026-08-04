# Config Regression Audit

## Scope and methodology

Reviewed PR #12695 at head `054ee594915b93546d0613a45e0671edd43905ee` against base/merge-base `0b8f749ae13388cf7a38ea7fb9183acaac99eef8`, with pristine upstream v1.17.13 parent `10c894bdeef3618f5666fb506ef7f9491bb964d8` as the third comparison. The range contains 525 commits (6 merges) and changes 1,237 files (`101898` insertions, `41085` deletions), so this audit was bounded to config discovery/loading/path resolution, related docs/specs and tests, and downstream directory consumers for agents, commands, skills, plugins, TUI config, migrations, and global/XDG paths.

I compared the lookup predicates and order in `packages/core/src/config.ts`, `packages/opencode/src/config/{config,paths,tui,tui-migrate}.ts`, Kilo config helpers/overlays/source reporting, `Global.Path`, config environment flags, and resource-directory consumers. I also searched the three revisions for `.opencode`, `opencode.json`, config aliases, and path construction, separating provider/package/protocol identifiers and migration detection from active filesystem fallback.

## Findings

### P3: The newly restored v2 config spec documents the forbidden upstream `.opencode` lookup

- **Path/line:** `specs/v2/config.md:16`, with related stale statements at `specs/v2/config.md:110` and `specs/v2/config.md:204`.
- **Violated invariant:** Kilo intentionally does not read project `.opencode` or the sibling global opencode config directory; Kilo config directories are `.kilo` and legacy `.kilocode` only.
- **Candidate flow claimed by the spec:** global config directory -> ancestor `opencode.json[c]` -> ancestor `.opencode/opencode.json[c]`, with `.opencode` plugin directories and policy precedence treated as active/open behavior.
- **Actual head flow:** `packages/core/src/config.ts:143,178-206` uses filenames `config.json`, `kilo.json[c]`, and `opencode.json[c]`, but directory targets are only `.kilo` and `.kilocode`; `packages/opencode/src/config/paths.ts:23-40` has the same directory restriction. `packages/core/test/config/config.test.ts` creates `.opencode` and expects its config to be ignored; `packages/opencode/test/kilocode/config/config.test.ts:694-781` additionally proves config, commands, agents, and plugins under `.opencode` are ignored.
- **Base/head/upstream evidence:** base already had the Kilo-only runtime predicates and did not contain the line at `specs/v2/config.md:16`. Head adds that sentence in commit `898f0dc40b` while retaining the base predicates. Pristine upstream `10c894b...` is the source of the claimed behavior: its `packages/core/src/config.ts` searches `targets: [".opencode", ...]`. This is therefore a conflict-adaptation documentation regression, not an active runtime fallback regression.
- **Affected users/platforms:** contributors implementing v2 config and any future Kilo client/runtime wired to the spec, on macOS, Linux, and Windows. Following the spec would reintroduce loading repository-controlled `.opencode` agents, commands, skills, plugins, and policy/config values.
- **Fix/verification:** rewrite the three statements to name `.kilo` and legacy `.kilocode`, state that `.opencode` is deliberately excluded, and describe Kilo's accepted legacy filenames separately from directory fallback. Keep the existing core and opencode negative controls; a reviewer should also verify future v2 config work against `packages/kilo-docs/pages/getting-started/settings/index.md:30-35` rather than importing these upstream statements.

## Notable non-findings

- No PR-introduced active `.opencode` fallback was found. Base and head have identical lookup roots in both config implementations. The static control `git diff --exit-code 0b8f749ae13388cf7a38ea7fb9183acaac99eef8..054ee594915b93546d0613a45e0671edd43905ee -G'\.opencode|targets:|directories|const names' -- packages/core/src/config.ts packages/opencode/src/config/paths.ts packages/opencode/src/kilocode/config/config.ts` returned `exit=0`.
- Kilo-only global path selection remains intact. `packages/core/src/global.ts:12-25` resolves XDG/AppData locations under `kilo`, and `Global.make()` uses `KILO_CONFIG_DIR` or that Kilo path. Head config flags expose `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, and `KILO_CONFIG_DIR`; no `OPENCODE_CONFIG*` filesystem alias was found in the audited flag/load path.
- Legacy filenames remain intentionally accepted only inside Kilo-selected locations. Both loaders may read `opencode.json[c]` from the project ancestry, `.kilo`/`.kilocode`, `KILO_CONFIG_DIR`, or `${XDG_CONFIG_HOME}/kilo`; docs explicitly distinguish this filename compatibility from the removed `.opencode` directory fallback. This is not a read from `${XDG_CONFIG_HOME}/opencode`.
- `packages/opencode/src/kilocode/config/config.ts:562-574` reads filesystem existence for `${XDG_CONFIG_HOME}/opencode` and project `.opencode` solely to build a migration notification. It does not parse or merge their contents. The one-time TOML/bash/auth/data migration paths found likewise do not add an active opencode config fallback.
- V2 directory consumers receive only the `Config.Directory` entries produced from global Kilo config plus `.kilo`/`.kilocode`, so agents, commands, skills, local plugins, references, and policy configuration do not gain an indirect `.opencode` path through generic helpers. The v1 TUI filter also explicitly accepts only `.kilo`, `.kilocode`, or `KILO_CONFIG_DIR`.
- Remaining `opencode` strings in provider IDs, npm package names, `@opencode-ai/*` imports, `.well-known/opencode`, plugin engine metadata, install/uninstall detection, plan compatibility permissions, and `.opencode-version` cache markers are not config-directory fallback candidates. The embedded upstream `customize-opencode` skill text is stale but pre-existing at the base and is not registered by Kilo's internal v2 plugin boot (`packages/core/src/plugin/internal.ts` skips that skill), so it is not a PR regression in this range.

## Exact commands and results

- `git merge-base 0b8f749ae13388cf7a38ea7fb9183acaac99eef8 054ee594915b93546d0613a45e0671edd43905ee` -> `0b8f749ae13388cf7a38ea7fb9183acaac99eef8`.
- `git diff --shortstat 0b8f749ae13388cf7a38ea7fb9183acaac99eef8..054ee594915b93546d0613a45e0671edd43905ee` -> `1237 files changed, 101898 insertions(+), 41085 deletions(-)`.
- `git rev-list --count 0b8f749ae13388cf7a38ea7fb9183acaac99eef8..054ee594915b93546d0613a45e0671edd43905ee` -> `525`; the same command with `--merges --count` -> `6`.
- Three-revision `git grep` control for config targets showed base/head `.kilo` + `.kilocode`, while upstream `10c894b...` showed `.opencode` in core, opencode config paths, and TUI filtering.
- From `packages/core`: `bun test test/config/config.test.ts test/config/plugin.test.ts` -> `21 pass, 0 fail`, 87 expectations, 2 files.
- From `packages/opencode`: `bun test test/kilocode/config/config.test.ts test/skill/skill.test.ts` -> `55 pass, 0 fail`, 146 expectations, 2 files.
- From `packages/opencode`: `bun test test/config/tui.test.ts test/kilocode/server/tui-config.test.ts test/kilocode/server/config-sources.test.ts test/kilocode/server/config-overlay.test.ts` -> `74 pass, 3 skip, 0 fail`, 227 expectations, 4 files.

## Limitations

- Tests ran on macOS; Windows AppData path behavior was verified statically, not executed on Windows. XDG behavior was exercised through existing isolated test environments.
- I did not run the complete monorepo suite or manually launch every client. The focused tests cover both config implementations and downstream v1 TUI/config-source/overlay behavior; v2 server reachability was traced statically through `LocationServiceMap` and internal config plugins.
- The worktree began with unrelated untracked `vscode-self-test.config.json`; concurrent reviewers may create or remove other report files. I did not read or modify them. This audit creates only `CONFIG_REGRESSION.md` and does not mutate GitHub, commit, or push.
