# Config Regression Review

## Scope and Method

Reviewed PR #12460 at `51d8031c9997bd5478bcde715562169f732d04d4` against `origin/main` (`b367105c8d648c8e05b62c2d27a28a95a4772f61`), with `v1.17.9` as the upstream comparison point. The audit covered changed additions plus executable configuration discovery/loading, directory resolution, TUI configuration, agent/command/skill/plugin discovery, environment overrides, migration behavior, and user-facing help.

I traced path candidates to readers rather than treating package names, test fixtures, `.opencode-version`, or legacy migration inputs as live `.opencode` directory fallback behavior.

## Findings

Finding 1: no configuration fallback regression found. Severity: none. Confidence: high.

The PR does not restore live `.opencode` directory discovery or remove/reorder the Kilo directory lookup. The relevant live-reader paths are unchanged from `origin/main`:

- `packages/core/src/config.ts:177-205` discovers only `.kilo` and legacy `.kilocode` directories, filters directories to those two names, and loads their documents before configuration plugins consume agents, commands, skills, and providers. It does not include `.opencode`.
- `packages/opencode/src/config/paths.ts:24-40` remains the Kilo override of upstream v1.17.9's `.opencode` path helper: both project and home scans target only `.kilocode` and `.kilo`; explicit directory configuration is only `KILO_CONFIG_DIR`.
- `packages/opencode/src/config/tui.ts:184-231` continues to resolve TUI configuration from global files, `KILO_TUI_CONFIG`, root `tui.json(c)`, and `.kilo`/`.kilocode` directories. It filters out `.opencode` before reads.
- `packages/opencode/src/kilocode/config/config.ts:445-448` accepts only `.kilo`, `.kilocode`, or explicit `KILO_CONFIG_DIR` as a configuration directory. `:459-505` probes `.opencode` only to emit the migration notification, and `packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts:325-345` only appends that notification.
- `packages/core/src/config/plugin/agent.ts:103-114`, `packages/core/src/config/plugin/command.ts:53-68`, and `packages/core/src/config/plugin/skill.ts:20-46` read only directories supplied by the above `Config` service. Therefore none creates an independent `.opencode` agent, command, or skill fallback.

Expected behavior remains: only `.kilo` configuration directories are canonical; `.kilocode` remains the intentional legacy directory fallback; `.opencode` directories are not read as configuration, TUI, agent, command, skill, or plugin sources.

## Notable Non-Findings

- `packages/core/src/plugin/skill/customize-opencode.md` adds OpenCode command-path documentation, and `packages/core/src/plugin/skill.ts:24-29` updates its trigger text. This is an upstream-facing embedded help asset, not a path resolver. More importantly, `packages/core/src/plugin/boot.ts:99-112` does not add `SkillPlugin.Plugin`; only `ConfigSkillPlugin.Plugin` is registered. Its `.opencode` examples cannot activate a live fallback in the current CLI boot path. The separately retained `packages/core/test/plugin/skill.test.ts` exercises manual registration only.
- The two new `opencode.json` writes in changed HTTP integration tests configure temporary upstream-compatible test fixtures. They do not alter production discovery or add a candidate to a production reader.
- Root/global `opencode.json(c)` filenames remain intentional legacy compatibility inputs in the Kilo configuration chain. They are distinct from `.opencode` directories and were present before this PR. Existing precedence remains Kilo filenames before legacy OpenCode filenames, including `packages/opencode/src/kilocode/config/config.ts:40-79` and `packages/opencode/src/config/config.ts:191-200, 360-366`.
- The upstream v1.17.9 baseline scans `.opencode` in `packages/opencode/src/config/paths.ts`; reviewed HEAD preserves Kilo's prior override to `.kilo`/`.kilocode`. No upstream fallback was restored by this merge.
- The PR does not modify live configuration modules under `packages/opencode/src/kilocode/config/`, `packages/opencode/src/kilocode/tui/`, `packages/core/src/config.ts`, or the Kilo path override in `packages/opencode/src/config/paths.ts`. The only changed file under `packages/core/src/config/` is provider application logic (`packages/core/src/config/plugin/provider.ts`), which consumes already-discovered entries and introduces no filesystem reads.

## Command Outputs

```text
git merge-base origin/main 51d8031c9997bd5478bcde715562169f732d04d4
3572898618a5a3082ae5d476e62d1e091e79be62

git diff --quiet origin/main...51d8031c -- [live config/discovery modules]
config-discovery-diff-exit=0

bun test test/kilocode/config/config.test.ts test/kilocode/server/tui-config.test.ts test/skill/skill.test.ts
54 pass
0 fail
148 expect() calls
Ran 54 tests across 3 files. [31.39s]
```

The relevant passing coverage explicitly asserts `.kilo` wins over `.kilocode` and `.opencode` is ignored (`packages/opencode/test/kilocode/config/config.test.ts:551-637`), that TUI config ignores `.opencode` (`packages/opencode/test/kilocode/server/tui-config.test.ts:46-63`), and that skill discovery ignores `.opencode` (`packages/opencode/test/skill/skill.test.ts:197-229`).

## Limitations

- This was a static call-chain audit plus targeted automated tests, not an end-to-end manually launched CLI or extension session with every environment/global configuration combination.
- Legacy root/global `opencode.json(c)` compatibility is pre-existing, intentional behavior outside the requested `.opencode` directory fallback regression check. It was checked for ordering regressions, not proposed for removal.
- The inactive `customize-opencode` built-in help asset was assessed from its registration path. If a future boot path registers `SkillPlugin.Plugin`, its upstream-only guidance should be reviewed again separately for product-facing Kilo configuration advice.

Summary: no PR-introduced `.opencode` directory fallback or `.kilo` lookup regression found. Report: `CONFIG_REGRESSION.md`.
