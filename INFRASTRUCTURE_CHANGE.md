safe after specific fixes

# Infrastructure Change Review: PR #12901

## Scope and provenance

Reviewed exact PR head `c69ce6caf638617169509f09e3f5d620eb702146` on `johnnyeric/kilo-opencode-v1.18.0`, with target branch `main`, supplied and verified merge base `b135b4e10a9028983497bf69cded47b6ce4572ff`, and pristine upstream v1.18.0 `32696c425fc0fa1ec285389346cfa1fbe22b670a`. The local tag and authoritative `upstream` remote both resolve `refs/tags/v1.18.0` directly to `32696c425f`.

The flattened Kilo-base-to-head diff is 262 files (`169695` insertions, `70035` deletions) across 297 commits, with three first-parent commits. Merge commit `2847475275` has parents `b135b4e10a` and `32696c425f`; resolution commit `88083fb5c5` has parents `2847475275` and adaptation `76783409bf`. The exact tree delta from the prior reviewed head `42d86e50af` to this force-updated head is one line in `packages/opencode/test/kilocode/issue-8656-stall.test.ts`, so it does not alter the infrastructure conclusions; every finding below was nevertheless rechecked at `c69ce6ca`.

I compared Kilo base to pristine upstream, Kilo base to PR head, pristine upstream to PR head, and the merge/adaptation commits. The relevant groups were GitHub Actions and templates, release/container/Nix automation, root workspaces and scripts, package CI scripts, changesets, SDK generation, `bun.lock`, patches, and trusted dependencies.

## Findings

### P2: Kilo CI silently skips five package test suites

**Provenance:** merge/adaptation regression. Four suites had Kilo `test:ci` coverage at the merge base; codemode is a new upstream package whose suite was never integrated into Kilo CI. **Direction:** restore Kilo's non-CLI CI contract and preserve it in future merge transforms.

`packages/client/package.json:11-16`, `packages/httpapi-codegen/package.json:9-12`, `packages/sdk-next/package.json:10-13`, and `packages/session-ui/package.json:23-26` lost their baseline `test:ci` scripts. New `packages/codemode/package.json:12-15` also has only `test`. Kilo's retained workflow invokes non-CLI packages exclusively with `bun turbo test:ci` at `.github/workflows/test.yml:144-149`, while `script/upstream/transforms/transform-package-json.ts:281-295` preserves this Kilo-specific script for six other shared packages but omits these five.

**Evidence:** a focused Turbo dry run reports `Command = <NONEXISTENT>` for all five packages. Executing codemode's `test:ci` task exits successfully with `WARNING No tasks were executed`. Direct package runs execute 27 files and all 411 tests pass: codemode 263, client 16, HTTP API codegen 67, SDK Next 5, and session UI 60. Current GitHub unit checks can therefore be green while these suites are absent.

**Risk:** regressions in the generated client, HTTP API generator, next SDK, shared session UI, and code-mode runtime can merge without assertions or JUnit reports.

**Fix direction:** add JUnit-producing `test:ci` scripts to all five packages, extend `PRESERVE_SCRIPTS` and its transform test for them, and assert that Turbo schedules nonzero tasks and produces non-empty reports.

### P2: inherited `translate:app` automation cannot run in Kilo's workspace

**Provenance:** upstream automation retained without Kilo adaptation. **Direction:** omit it, or deliberately adapt it to Kilo-owned locale surfaces and the Kilo executable.

Root `package.json:19` exposes `translate:app`, but `script/translate-app.ts:86-91` always imports `packages/app` and usually `packages/desktop`; Kilo intentionally does not ship those upstream products (`package.json:25-29`, `script/upstream/transforms/transform-package-json.ts:305-310`). The operational dry run fails on missing `packages/app/src/i18n/en.ts`. The write/model paths additionally spawn `opencode` at `script/translate-app.ts:375-410` and `:467-470`, so fixing only file paths would still invoke the wrong product binary.

**Risk:** the root presents a maintenance command that is unusable in this repository and could target OpenCode rather than Kilo if only partially repaired.

**Fix direction:** remove `translate:app` and its three files through the merge transform, or adapt and integration-test the command against Kilo's actual translations and `kilo` CLI. Its 12 unit tests do not exercise repository integration.

### P3: adaptation removed two documented root development entrypoints

**Provenance:** Kilo behavior lost during package-script reconciliation. **Direction:** retain Kilo's root aliases.

Baseline root scripts `extension:isolated` and `extension:isolated:clean` are absent from `package.json:8-24`; the first exits with `error: Script not found "extension:isolated"`. The implementation and package-local aliases remain at `packages/kilo-vscode/package.json:1227-1229`, while `AGENTS.md:14`, `CONTRIBUTING.md:117-128`, extension guidance, and Kilo docs continue to prescribe the root commands.

**Risk:** the documented isolated VS Code/Kilo test workflow fails from the repository root, encouraging testing against personal IDE state.

**Fix direction:** restore both root aliases and add them to root `PRESERVE_SCRIPTS` at `script/upstream/transforms/transform-package-json.ts:284-286` with transform coverage.

### P3: the v1.18.0 user-facing merge has no release changeset

**Provenance:** merge/adaptation omission. **Direction:** add the normal Kilo upstream-sync release note, or document an intentional exception.

`.opencode-version` advances from `v1.17.13` to `v1.18.0`, but `.changeset/` is byte-identical to the merge base. Its existing upstream-sync note covers only v1.17.9 through v1.17.13.

**Risk:** changeset-driven Kilo versioning and release notes omit this merge's user-visible CLI/TUI changes.

## Notable non-findings

- Kilo retained its infrastructure rather than accepting upstream replacements: `.github/workflows/`, issue and PR templates, `.changeset/`, container/Docker, Nix, Turbo, `RELEASING.md`, and publish/release automation are byte-identical to the Kilo merge base. `check-workflows` confirms the retained 29-workflow allowlist.
- The only GitHub action delta is upstream's pinned Node 24 setup at `.github/actions/setup-bun/action.yml:11-16`; Kilo's frozen installs, Windows retry/cache policy, and native-header setup remain. Non-Windows now sets up Node twice because Kilo's retained second setup at `:55-61` is mutable `actions/setup-node@v6`. No functional failure was demonstrated; deduplicating and pinning the retained action is a supply-chain maintenance follow-up, not a merge blocker.
- Bun 1.3.14, Turbo 2.10.2, OpenTUI 0.4.3, codemode registration, dependency upgrades, trusted dependencies, and patch versions are internally represented in `package.json` and `bun.lock`. `bun install --frozen-lockfile --ignore-scripts` accepted the graph with no changes. Kilo patches remain registered; virtual-core moves to 3.17.3, the obsolete solid-virtual patch is retired, and the MCP patch retains Kilo content while incorporating upstream pagination-cache handling.
- SDK generation automation and generated JS SDK files are unchanged from Kilo base. The only SDK artifact delta is `packages/sdk/openapi.json` adding `x-websocket: true` to PTY, matching `packages/protocol/src/groups/pty.ts:128-134`; codemode consumes that marker to reject unsupported WebSocket operations. No source/artifact mismatch was found statically.
- `artifacts/glm52-rise-video/bun.lock` is outside the root workspaces and cannot change root package resolution. Because setup-bun hashes `**/bun.lock`, it can invalidate dependency caches when the promotional artifact changes; that is cache hygiene rather than a correctness defect.
- The model/tool network guard passes with four classified client sites, confirming the v1.18 MCP adaptation did not disable Kilo's policy-boundary check.

## Commands and results

- Provenance: `git rev-parse`, `git merge-base`, `git show --format='%H%n%P%n%s'`, `git rev-list`, and `git ls-remote upstream refs/tags/v1.18.0` confirmed the SHAs, parent graph, 297-commit/three-first-parent counts, and upstream tag above.
- Diff: `git diff --shortstat b135...c69c` returned `262 files changed, 169695 insertions(+), 70035 deletions(-)`; infrastructure-scoped `git diff --check` produced no output.
- `bun run script/check-workflows.ts`: `check-workflows: ok (29 workflows).`
- `bun run script/check-model-tool-network.ts`: `4 classified client site(s), policy-aware tool and MCP boundaries verified.`
- `bun install --frozen-lockfile --ignore-scripts`: passed, `Checked 2056 installs across 2317 packages (no changes)`; tracked state remained unchanged.
- `bun test ./transforms/transform-package-json.test.ts` from `script/upstream`: 21 passed, 0 failed.
- Focused Turbo `test:ci --dry=text`: all five commands `<NONEXISTENT>`; codemode `test:ci`: 0 tasks with successful exit.
- Direct omitted suites: 411 passed, 0 failed across 27 files (263 + 16 + 67 + 5 + 60).
- `bun test ./translate-app.test.ts` from `script`: 12 passed, 0 failed; `bun run translate:app -- fr --dry-run`: failed on missing `packages/app/src/i18n/en.ts`.
- `bun run extension:isolated -- --help`: failed with `error: Script not found "extension:isolated"`.
- Final GitHub query: PR head remained `c69ce6ca`; GitHub reported `MERGEABLE` but `BLOCKED`, with all 29 reported repository checks successful, one neutral CodeQL check, and one skipped external check.

## Limitations

- I did not execute GitHub-hosted release/deploy, Windows retry, Docker/container, Nix, or publication workflows, and did not access secrets or registries. Their retention is established by baseline identity and current CI metadata, not live publication.
- I did not regenerate the SDK twice; static source/OpenAPI agreement and unchanged Kilo generation automation were verified, while the hosted source-freshness and typecheck checks passed.
- Direct package tests ran on macOS; the GitHub Linux, macOS, and all four Windows unit shards completed successfully.
- No GitHub state was modified, no real user state or credentials were accessed, and no tracked source file was changed. This report is the only file authored by this review; other pre-existing untracked review reports were left untouched.
