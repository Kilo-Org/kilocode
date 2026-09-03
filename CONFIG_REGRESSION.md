# CONFIG_REGRESSION Review

**Verdict: safe after one specific fix.** I found one P2 config-diagnostic regression. I found no reintroduced filesystem fallback to `~/.config/opencode`, `.opencode`, `OPENCODE_CONFIG*`, or another OpenCode config directory, and no breakage of `.kilo`-only configuration.

## Scope And Method

Reviewed only configuration discovery, loading, parsing, path resolution, precedence, and their relevant callers/tests for PR #13368:

- Base: `6175210c0fd0092a86aa475e4d8d7616711a1464`
- Head: `5d120f0696a83b354804e0848f1c1af4b0088a4f`
- Pristine upstream v1.18.18: `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d` (`v1.18.18^{}` resolves exactly to this SHA)
- Local `origin/main`: `e1198adeb3ba914991a0f042ce9eb42e660e5b37`
- Merge base of base/head: the supplied base SHA
- PR size: 48 files, 885 insertions, 159 deletions; 53 commits in `base..head`

I compared base to head, pristine upstream to head, the merge result before/after follow-up `5d120f0696`, and `origin/main` where useful. I also inspected unchanged discovery helpers and callers outside the diff. The supplied pristine upstream commit is the verified tag target and the second parent of merge commit `6b9a826e03`, so it is an ancestor of head; conclusions also use direct content comparisons to distinguish upstream changes from Kilo adaptations.

## Finding

### P2: Unknown-field warnings disappear for explicit environment config sources

**Provenance:** introduced by incomplete Kilo adaptation to upstream's permissive unknown-field parser.

Upstream v1.18.18 intentionally changed schema decoding to ignore excess properties. Head correctly preserves that behavior in `packages/opencode/src/config/parse.ts:35-45`: known fields decode and unknown fields are discarded. This is parser behavior, not filesystem fallback behavior.

Kilo's follow-up attempts to retain typo diagnostics by collecting excess keys in `packages/opencode/src/config/config.ts:315-348`, but it only emits the warning when `configWarnings` is passed. Project root files pass the accumulator at `packages/opencode/src/config/config.ts:700-717`, while these user-facing sources do not:

- `KILO_CONFIG`: `packages/opencode/src/config/config.ts:682-697`
- Trusted `KILO_CONFIG_DIR`: `packages/opencode/src/config/config.ts:741-769` passes `undefined` at line 763
- `KILO_CONFIG_CONTENT`: `packages/opencode/src/config/config.ts:823-846`

Concrete real-CLI reproduction at head:

```text
KILO_CONFIG_CONTENT='{"model":"test/known","unknownField":true}' ... kilo config check
No config warnings.

KILO_CONFIG=<file containing the same object> ... kilo config check
No config warnings.
```

`debug config` in the same disposable environment showed `"model": "test/known"`, proving permissive parsing retained the valid sibling while silently dropping `unknownField`. In contrast, the `.kilo/kilo.json` implementation test applies `model` and records a warning containing `unknownField`.

Base's `ConfigParse.schema` rejected unknown top-level keys before merge (`packages/opencode/src/config/parse.ts` at base lines 40-51), so the existing `catchDefect` paths for `KILO_CONFIG` and `KILO_CONFIG_CONTENT` converted the error into `Config.Service.warnings()`. Head removed that throw but did not pass the new warning accumulator into these calls. Users relying on `kilo config check`, including clients that inject configuration through `KILO_CONFIG_CONTENT`, can now have misspelled settings silently ignored while being told there are no warnings.

**Fix direction:** pass the instance `warnings` accumulator to `loadFile`/`loadConfig` for `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, and trusted `KILO_CONFIG_DIR` sources. Keep `onExcessProperty: "ignore"`; restoring strict parser failure would regress upstream compatibility.

## Notable Non-Findings

- No `.opencode` directory fallback was added or restored. `packages/opencode/src/config/paths.ts:23-40` discovers only `Global.Path.config`, `.kilocode`, `.kilo`, and `KILO_CONFIG_DIR`; this file is byte-identical between base and head.
- `Global.Path.config` remains XDG config plus `kilo`, not `opencode`: `packages/core/src/global.ts:12-25` sets `app = "kilo"` and derives `config` from it.
- `.opencode` references in `packages/opencode/src/kilocode/config/config.ts:631-675` are detection/notification only and explicitly state that Kilo no longer reads those directories. `isConfigDir` accepts only `.kilo`, `.kilocode`, or the explicit flag directory at lines 618-621.
- OpenCode-named files are still intentionally accepted inside Kilo-controlled locations and at project roots. `packages/opencode/src/kilocode/config/config.ts:40-62` lists both `kilo.json[c]` and `opencode.json[c]`, while the directory candidates remain Kilo-only. This is filename compatibility, not fallback to OpenCode directories.
- Project root discovery order remains `kilo` then `opencode` at `packages/opencode/src/config/config.ts:700-717`. Directory order remains global, primary-checkout Kilo directories, active Kilo directories, then explicit `KILO_CONFIG_DIR`, with later merges winning (`packages/opencode/src/config/config.ts:724-775`). No order delta exists from base to head.
- `.kilo` remains higher precedence than legacy `.kilocode`, and `.opencode` content is ignored for config, commands, agents, plugins, source metadata, and TUI configuration. The real implementation tests below exercised these paths.
- `KILO_DISABLE_PROJECT_CONFIG` still suppresses project root and `.kilo` sources while leaving explicit environment sources available.
- Schema and path behavior are distinct: unknown fields are ignored by `ConfigParse.schema` (`packages/opencode/src/config/parse.ts:35-45`), while explicit validation still warns via `Excess` (`packages/opencode/src/kilocode/config-validation.ts:52-65`). Neither code path expands filesystem candidates.
- Global and managed config also use permissive parsing without the new warning accumulator (`packages/opencode/src/config/config.ts:398-421` and `892-920`). I did not grade that as an introduced warning regression: base's cached global loader converted a strict unknown-field failure into an empty global config rather than reliably adding it to `Config.Service.warnings()`, while head now at least preserves known siblings. Product owners should decide separately whether `config check` should diagnose excess properties in administrator-controlled sources.

## Commands And Results

- `git merge-base 6175210... 5d120f0...` -> `6175210c0fd0092a86aa475e4d8d7616711a1464`.
- `git tag --points-at 31406c... && git rev-parse 'v1.18.18^{}'` -> `v1.18.18` and exact supplied upstream SHA.
- `git diff --quiet 6175210... 5d120f0... -- <discovery/loading surface>` -> exit 0 for `config/paths.ts`, `kilocode/config/config.ts`, `kilocode/config/sources.ts`, `kilocode/config/overlay.ts`, TUI config, and TUI migration files.
- `bun test test/kilocode/config/config.test.ts --test-name-pattern 'prefers .kilo over legacy .kilocode and ignores .opencode|keeps KILO_CONFIG_DIR above the primary fallback'` -> 2 passed, 0 failed, 48 filtered.
- `bun test test/kilocode/config-resilience.test.ts --test-name-pattern 'collects warnings for invalid schema in .kilo directory config|returns empty warnings when config is valid'` -> 2 passed, 0 failed, 11 filtered.
- `bun test test/kilocode/config-validation.test.ts --test-name-pattern 'reports schema validation errors for unknown fields|validates valid JSONC config'` -> 2 passed, 0 failed, 8 filtered.
- `bun test test/config/config.test.ts --test-name-pattern 'config parser preserves permission order while ignoring unknown top-level keys|does not create global config when KILO_CONFIG_DIR is set|KILO_CONFIG_DIR still works when flag is set'` -> 3 passed, 0 failed, 105 filtered.
- `bun test test/kilocode/server/config-sources.test.ts --test-name-pattern 'lists source metadata in load order without config contents|shows project config disabled by environment'` -> 2 passed, 0 failed, 25 assertions.
- `bun test test/kilocode/server/tui-config.test.ts --test-name-pattern 'loads legacy .kilocode TUI config and ignores .opencode'` -> 1 passed, 0 failed.
- Three disposable real CLI runs of `bun run --conditions=browser ./src/index.ts config check`, using `KILO_CONFIG_CONTENT`, `KILO_CONFIG`, and global `XDG_CONFIG_HOME/kilo/kilo.json`, all reproduced `No config warnings.` Exit was 0 in all cases. Only the first two are part of the introduced finding for the reason above.
- Disposable `bun run --conditions=browser ./src/index.ts debug config` with the same inline config showed `model: test/known` and no `unknownField`.
- `bun run typecheck` in `packages/opencode` -> passed (`tsgo --noEmit`).
- `git diff --check 6175210... 5d120f0... -- <focused config files>` -> passed, no output.
- `bun run script/check-opencode-annotations.ts --base 6175210...` -> guard intentionally skipped because it detected an upstream merge.
- One initial `config-sources` test selector used stale names and matched 0 tests; the corrected command above ran both tests successfully.

## Limitations

- This was only the CONFIG_REGRESSION lens; no unrelated merge behavior was reviewed.
- I did not access real user configuration, credentials, or state. All CLI reproductions used disposable HOME/XDG directories and disabled network-adjacent features.
- `KILO_CONFIG_DIR` unknown-field silence is static proof from the missing accumulator argument; the real CLI reproductions directly covered `KILO_CONFIG` and `KILO_CONFIG_CONTENT`.
- No GitHub state was queried or mutated. No commit or push was made.
- The worktree already contained unrelated untracked `OPENCODE_MENTIONS.md`; this review did not modify it.
