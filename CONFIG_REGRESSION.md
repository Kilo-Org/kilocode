# Config Regression Review: PR #12088

## Scope and methodology

Reviewed `origin/main...HEAD` for config discovery, loading, precedence, path resolution, environment overrides, and command/agent/skill registration. I searched added and changed lines for Kilo and OpenCode config paths, compared the current implementations with `origin/main`, and traced both the v1 CLI loader and the core v2 loader through plugin boot and HTTP route assembly. Generated SDK/OpenAPI changes were used only to confirm route exposure.

## Finding

### High: the expanded v2 config surface loads `.opencode` resources and does not load `.kilo`

The PR adds config-backed v2 commands, agents, and skills, but wires them to the upstream-oriented core loader rather than Kilo's config discovery contract.

- Kilo's retained contract says project config directories are `.kilocode` then `.kilo` (with `.kilo` winning), and explicitly says `.opencode` directories are not loaded (`packages/opencode/src/kilocode/skills/kilo-config.md:342-379`).
- `packages/core/src/config.ts:135-196` recognizes only `config.json`, `opencode.json`, and `opencode.jsonc`, discovers `.opencode` directories, emits those directories as config entries, and applies `.opencode` entries after direct project files. It has no `.kilo`, `.kilocode`, or `kilo.json` candidate.
- The new/expanded readers consume every emitted directory: commands scan `{command,commands}/**/*.md` (`packages/core/src/config/plugin/command.ts:22-29,53-57`), agents scan `{agent,agents}/**/*.md` and `{mode,modes}/*.md` (`packages/core/src/config/plugin/agent.ts:42-57,104-114`), and skills append `skill/` and `skills/` (`packages/core/src/config/plugin/skill.ts:20-31`). The skill test explicitly fixes `.opencode` as the expected source (`packages/core/test/config/skill.test.ts:30-66`), while the config integration test fixes `.opencode` discovery and precedence (`packages/core/test/config/config.test.ts:610-668`).
- `PluginBoot` now registers all three readers (`packages/core/src/plugin/boot.ts:92-105`), and the new server package exposes their results through `/api/agent`, `/api/command`, and `/api/skill` (`packages/server/src/api.ts:16-31`, `packages/server/src/handlers.ts:36-55`). These routes are mounted into the CLI server by `packages/opencode/src/server/routes/instance/httpapi/api.ts:97-103` and `packages/opencode/src/server/routes/instance/httpapi/server.ts:151-166`.

Consequently, a project can newly influence these v2 registries through `.opencode/agent`, `.opencode/command`, and `.opencode/skill(s)`, while equivalent `.kilo` resources are invisible. The same loader also ignores `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, and `KILO_DISABLE_PROJECT_CONFIG`; `KILO_CONFIG_DIR` reaches it only because `Global.make()` replaces `global.config` with that directory (`packages/core/src/global.ts:74-86`), rather than following the v1 loader's additive ordering. This makes the new v2 discovery inconsistent with both Kilo path policy and Kilo environment semantics.

The `.opencode` literal and direct `opencode.json` loading already existed in the core v2 loader on `origin/main`, where v2 model/provider/session routes used it. The PR regression is the addition and exposure of command/agent/skill readers over those entries, plus the continued omission of `.kilo` while broadening the v2 runtime. It is not merely an internal package-name compatibility issue.

Recommended fix: give the core v2 loader Kilo-specific discovery inputs matching the v1 loader, or adapt the new readers to Kilo's existing directory list. Add focused coverage proving `.opencode` directories are ignored, `.kilo` wins over `.kilocode`, and the four Kilo config environment controls retain their documented behavior. Human verification is needed only if the experimental v2 API is intentionally exempt from Kilo config policy; if so, that exception should be explicit before these routes are consumed by Kilo clients.

## Notable non-findings

- The active v1 CLI loader did not restore `.opencode` directory fallback. `packages/opencode/src/config/paths.ts:23-40` still discovers `Global.Path.config`, project/home `.kilocode` and `.kilo`, then `KILO_CONFIG_DIR`; its diff is an `AppFileSystem` to `FSUtil` migration. The primary-worktree insertion and `.kilo` ordering in `packages/opencode/src/config/config.ts:568-680` are unchanged in substance.
- Existing support for `opencode.json` filenames inside Kilo roots or as direct project files is legacy filename compatibility, not an `~/.config/opencode` or `.opencode` directory fallback introduced by this PR.
- `@opencode-ai/*` imports, `@opencode/*` service identifiers, the `opencode` provider ID, API names, and auth username are package/protocol compatibility identifiers and do not themselves read OpenCode config paths.
- The added `customize-opencode` embedded skill text mentions `.opencode`, but `packages/core/src/plugin/boot.ts:97` deliberately does not register that upstream skill in Kilo; those strings do not create a filesystem read.
- The core global XDG application name remains `kilo` (`packages/core/src/global.ts:11-24`). No new `~/.config/opencode` global fallback was found.

## Commands and limitations

Key commands included `git status --short`, `git diff --name-status origin/main...HEAD`, `git diff --stat origin/main...HEAD`, `git log --oneline origin/main..HEAD`, focused `git diff -G`/`git diff --unified` searches, `git grep` against `origin/main`, and source/reference searches across `packages/core`, `packages/opencode`, and `packages/server`.

Focused tests were attempted with:

```sh
cd packages/core
bun test ./test/config/config.test.ts ./test/config/command.test.ts ./test/config/agent.test.ts ./test/config/skill.test.ts
```

They did not start because dependencies are not installed in this worktree (`Cannot find package 'effect'`). This is therefore a static review; no live CLI or HTTP request was exercised. The branch contains 1,206 changed files, so generated outputs and unrelated migrations were not reviewed exhaustively after path-focused searches and call-chain tracing.
