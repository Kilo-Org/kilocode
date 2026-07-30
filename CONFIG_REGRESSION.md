# Config Regression Review

## Methodology

Reviewed base `70eeaff3837e29529e26c7c090767df0a3768249` and head `518501a994bcd660e8c6d061b450c32412104004` using two-dot, three-dot, and merge-parent diffs. Traced V1 and V2 candidate construction through loading, precedence, update targets, managed/global/environment directories, source reporting, docs, and focused tests. Also compared the result with policy commit `8f6a2cd04d` (`fix(cli): remove automatic OpenCode config support, use Kilo config files only`) because the supplied base and head are not in a direct ancestor relationship.

## Findings

1. **High: V1 automatic OpenCode fallback is restored across every main config scope.** `packages/opencode/src/config/config.ts:355-378` reads global `config.json`, `opencode.json`, and `opencode.jsonc`; `:657-674` discovers ancestor/root `opencode.json[c]`; and `:697-730`, `:845-853` load OpenCode filenames from `.kilo`, `.kilocode`, `KILO_CONFIG_DIR`, and managed directories through `ALL_CONFIG_FILES`. `packages/opencode/src/kilocode/config/config.ts:41-44` explicitly reintroduces those names. This reverses the Kilo-only policy and lets ignored legacy files affect runtime configuration.

2. **High: restored ordering lets OpenCode files override Kilo files, including inside `.kilo`.** V1 config-directory iteration uses `ALL_CONFIG_FILES = [kilo.jsonc, kilo.json, opencode.jsonc, opencode.json]`, so later OpenCode documents win and JSON can also beat JSONC (`packages/opencode/src/kilocode/config/config.ts:43-44`, `packages/opencode/src/config/config.ts:708-725`). The overlay duplicates that order and candidate set (`packages/opencode/src/kilocode/config/overlay.ts:76,124-143`). V2 similarly loads `[config.json, kilo.json, kilo.jsonc, opencode.json, opencode.jsonc]`, making `opencode.jsonc` highest within global, `.kilo`, and `.kilocode` directories (`packages/core/src/config.ts:143,165-206`). This recreates the reported `.kilo/opencode.json` overriding `.kilo/kilo.jsonc` class of bug.

3. **High: V2 restores ancestor/root and global OpenCode filename discovery.** `packages/core/src/config.ts:143-206` adds `opencode.json[c]` and `config.json` to both global directory loading and the ancestor walk. The final merge keeps `.kilo`/`.kilocode` directory traversal, but loads OpenCode-named documents from those directories and direct project ancestors. Human verification is required on whether V2 is presently user-reachable in all clients, but its config service is wired as a location node and its tests exercise the behavior.

4. **Medium: writers and migrations can select or mutate ignored OpenCode files.** `globalConfigFile()` can choose an existing OpenCode/generic file (`packages/opencode/src/config/config.ts:196-204`); project updates and settings overlay targets include OpenCode candidates (`packages/opencode/src/kilocode/config/config.ts:67-79`, `packages/opencode/src/kilocode/config/overlay.ts:132-143`); and `kilo mcp add` can write existing root or `.kilo`/`.kilocode` OpenCode files (`packages/opencode/src/cli/cmd/mcp.ts:396-425`). Bash-permission migration also scans and may rewrite OpenCode/generic global files (`packages/opencode/src/kilocode/config/config.ts:336-394`). Source inventory and global change stamps likewise treat them as active (`packages/opencode/src/kilocode/config/sources.ts:59-74,121-159`, `packages/opencode/src/kilocode/config/global-stamp.ts:5-21`).

5. **Medium: tests and docs normalize contradictory fallback behavior instead of guarding Kilo-only lookup.** V2 tests now positively require OpenCode/global/generic loading and OpenCode files inside Kilo directories (`packages/core/test/config/config.test.ts:203-272,733-841`), replacing the prior Kilo-only assertions from `8f6a2cd04d`. `specs/v2/config.md:16` claims `.opencode` discovery even though the final implementation excludes that directory. User docs still say Kilo no longer falls back to `.opencode`, but no longer state that same-location OpenCode filenames are merged (`packages/kilo-docs/pages/getting-started/settings/index.md:28-34`), while runtime does merge them. Add explicit negative tests for global, ancestor/root, `.kilo`, `.kilocode`, managed, update-target, and MCP-writer OpenCode candidates after restoring Kilo-only behavior.

## Notable Non-Findings

- No final V1 or V2 traversal of project `.opencode` directories was found. Both retain `.kilo` and legacy `.kilocode` directory discovery, and existing tests still check that `.opencode` directory content is ignored.
- `Global` remains Kilo-based (`app = "kilo"`), and `KILO_CONFIG_DIR` remains the explicit global/config-directory override; no automatic `~/.config/opencode` global-directory fallback was found.
- `.kilo` directory discovery itself was not removed. The damage is the restored filename set and precedence inside Kilo/global/project/managed locations.
- Explicit `KILO_CONFIG` remains an arbitrary user-selected file path; that is not automatic fallback.

## Commands

- `git diff --name-status 70eeaff3837e29529e26c7c090767df0a3768249 518501a994bcd660e8c6d061b450c32412104004`
- `git diff`/`git show` on config loaders, path helpers, overlays, source inventory, docs, and tests for the supplied range and merge parents
- `git show --unified=30 8f6a2cd04d -- packages/core/src/config.ts packages/core/test/config/config.test.ts`
- `git grep -n -i -E '(opencode\.json|\.opencode|OPENCODE_CONFIG|OPENCODE_CONFIG_DIR|KILO_CONFIG|\.kilo|kilo\.json)'` at base and head
- `bun test test/config/config.test.ts` from `packages/core`
- `bun test test/kilocode/config/config.test.ts` from `packages/opencode`

## Limitations

- Focused runtime tests could not start in this checkout: `packages/core` could not resolve `effect`, and `packages/opencode` could not resolve preload `@opentui/solid/preload`. Findings are therefore based on static control-flow, candidate-order, merge-parent, prior-policy, docs, and test-code inspection.
- The supplied base is not an ancestor of the head, so classification as newly introduced versus conflict-restored used merge-parent comparison and policy commit `8f6a2cd04d`; uncertain reachability of the V2 path should be verified by a maintainer.
