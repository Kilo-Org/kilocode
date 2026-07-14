# Infrastructure Review: PR #12204

## Scope and method

Reviewed the checked-out `review/upstream-12204-latest` snapshot at current PR HEAD `472247daa9063cf7dfea423bec64c46cea44ba36` against base `c49560af0f94459015d3fa4e1efa23ad9b291955` (972 changed paths; 40,251 additions and 26,427 deletions). I re-inventoried every changed path by name/status and diff statistics, re-read the infrastructure-relevant diffs, compared this HEAD to the previously reviewed force-pushed-away `2ca787fa4d`, and inspected final CI status and failed job logs. The force-push delta changed only `packages/http-recorder/package.json` and MCP source; all other infrastructure diffs are unchanged.

## Findings

### High: the upstream test command overwrite disables Kilo's JUnit/reporting infrastructure

`.github/workflows/test.yml:134-164` still publishes and uploads `packages/*/.artifacts/unit/junit.xml`, but its two execution steps were changed from `bun turbo test:ci` to `bun turbo test`. At the same time, `test:ci` and its JUnit reporter were removed from `packages/core/package.json:8-13`, `packages/effect-drizzle-sqlite/package.json:8-10`, `packages/http-recorder/package.json:29-33`, and `packages/ui/package.json:30-35`; the generic and UI `test:ci` outputs were also removed from `turbo.json`. This is a merge-resolution choice in `68b59571a0`, not a necessary consequence of the upstream code.

The CLI retains its Kilo-only `test:ci` path and `--ci` XML merge implementation (`packages/opencode/package.json`, `packages/opencode/script/test-runner.ts`), but the workflow no longer invokes it. Therefore neither CLI nor non-CLI jobs create the reports consumed by the following Kilo steps. The loss is silent because `action-junit-report` is non-blocking and `upload-artifact` has `if-no-files-found: ignore`. Restore Kilo's `test:ci` invocations and JUnit-producing package scripts/Turbo task, or deliberately replace both the report producer and consumers as one coherent change. Human verification is required if dropping PR annotations, retained test artifacts, and Kilo's test-health data was intentional.

Current CI confirms the impact: the completed test workflow has only the separately produced `unit-jetbrains-1` artifact and no general unit XML artifacts despite every general unit job running. The unit jobs' report/upload steps therefore retained no structured diagnostics for the failures.

### High: extracted TUI workspace breaks CLI subprocess startup

The new `packages/tui` workspace is wired into the monorepo and passes typecheck, but final Linux CI logs show normal CLI and `serve` subprocesses failing before startup with `Cannot find module 'react/jsx-dev-runtime' from 'packages/tui/src/config/index.tsx'`. This breaks read-only CLI smoke commands, `kilo run`, and server startup. `packages/tui/tsconfig.json:5-6` correctly selects `@opentui/solid`, and `packages/tui/bunfig.toml` preloads it when commands execute from that package, but subprocesses launched from `packages/opencode` import the workspace source without applying the TUI package's JSX configuration. The runtime then lowers JSX using React instead of OpenTUI/Solid.

Treat this as workspace/build infrastructure, not only a test failure: the extracted package must remain executable when consumed from the CLI package and in compiled release binaries. Preserve the JSX import source across workspace boundaries, then rerun direct source CLI/serve smoke tests and a release CLI build. This is a merge blocker.

### Medium: the merge silently changes the JetBrains runtime CLI pin

`packages/kilo-jetbrains/package.json:11` moves from `7.4.5` to `7.4.7`. This field is not ordinary workspace version metadata: `packages/kilo-jetbrains/script/build.ts:10-11` and the package instructions define it as the exact GitHub CLI release downloaded and used for generated API/runtime behavior. Kilo's release process intentionally excludes this file from bulk version syncing and normally advances it in a dedicated, tested `chore(jetbrains): bump CLI pin` PR. The change instead came from conflict resolution in `68b59571a0`.

The `v7.4.7` Kilo release and expected platform assets exist, and current JetBrains typecheck and test jobs pass, so this is not an immediate compatibility or 404 failure. It still bypasses the dedicated pin-bump review flow. Human verification is required to explicitly accept the pin in this upstream merge or revert to `7.4.5` and land the normal pin PR.

### Medium: the Kilo `dev:local` launcher is orphaned

Root `package.json:8-22` removes `"dev:local": "bun run packages/opencode/script/dev-local.ts"`, while the Kilo-only launcher remains at `packages/opencode/script/dev-local.ts` and still documents `bun dev:local` as its entry point. No replacement reference exists. This makes the local cloud/CLI development workflow unreachable through its advertised command and is another accidental upstream package-script overwrite. Restore the root script unless the local cloud workflow is intentionally being retired; if retired, remove/migrate the launcher and its documentation in a separate explicit change.

### Medium: the retained fff patch targets a version no workspace installs

`package.json:155-157` adds a patched dependency for `@ff-labs/fff-bun@0.9.3`, and `patches/@ff-labs%2Ffff-bun@0.9.3.patch` adds compiled-binary resolution needed by the CLI build. However, both `packages/core/package.json:126` and `packages/opencode/package.json` require `0.9.4`, and `bun.lock` resolves only `0.9.4`; upstream's `e9e2612706` explicitly removed the `0.9.3` patch when upgrading. The stale declaration cannot patch the installed package and leaves a misleading build workaround in the repository. It also contains trailing whitespace reported by `git diff --check` at patch lines 7 and 29.

Human verification is required before deleting it: determine whether Kilo's compiled multi-platform CLI still needs this binary-resolution workaround on `0.9.4`. If needed, port and validate the patch against `0.9.4` and update the key/filename; otherwise remove both the declaration and obsolete patch. The new `FFF_LIBC` define and all-platform install in `packages/opencode/script/build.ts` should be validated with at least one glibc, musl, macOS, and Windows release build because this is native packaging infrastructure.

### Medium: `@opencode-ai/http-recorder` becomes publicly publishable without a Kilo release path

`packages/http-recorder/package.json:1-60` removes `private: true` and adds `publishConfig.access: public`. The current force-push corrected repository/homepage/bugs metadata from upstream OpenCode URLs to Kilo URLs, and the forbidden-string guard now passes; that part of the previous finding is resolved. The package gains build/pack/consumer-verification scripts, but this PR does not add the upstream release workflow or changeset that originally accompanied public beta publication; upstream itself subsequently removed that dedicated automation in `effd27b239`. Kilo's general release script does not publish this package, but removing `private` still makes accidental/manual publication possible.

Human verification is required on product ownership: if Kilo does not intend to publish this package, retain `private: true` and treat the build scripts as internal verification only. If Kilo intends to publish it, define release ownership and credentials, include or intentionally omit `CHANGELOG.md` from the package (it is listed in `files` but absent), and add an explicit release/changeset path. The package archive check run during review contained only `package.json`, `LICENSE`, and `README.md` because `dist` had not been built, confirming that direct packing without the new `pack.ts` path yields no runtime code.

### Low: supply-chain quarantine is substantially widened

`bunfig.toml:5` adds `@ai-sdk/anthropic`, GitLab providers/auth, all `fff` native packages, OpenTUI spinner, and Electron builder packages to `minimumReleaseAgeExcludes`. The global quarantine duration remains Kilo's longer 410,520 seconds, but these exceptions permit fresh releases to bypass it. Most additions correspond to dependency upgrades in this sync, so this may be operationally necessary, but native binaries and release tooling are particularly sensitive. Human verification should confirm each exception is still required after the lockfile is settled and that temporary exceptions are removed rather than permanently inherited from upstream.

### Low: CODEOWNERS is replaced with upstream owners for paths Kilo does not currently ship

`.github/CODEOWNERS:1-3` replaces Kilo's existing owners with `@Hona @Brendonovich` and drops the `packages/tauri/` and `packages/desktop/src-tauri/` rules. The referenced app/desktop/tauri packages do not exist in this checkout, and both proposed owners currently have read-only repository permission, so these rules cannot presently enforce approving ownership. This is not an immediate coverage regression for an existing path, but it is upstream repository automation copied into Kilo without an obvious Kilo policy decision. Human verification should either keep the file aligned with Kilo's engineering ownership policy or remove stale rules until those packages exist.

## Notable non-findings

- No Dockerfile, Docker Compose, Nix/flake, deploy script, release workflow, issue/PR template, Dependabot/Renovate configuration, root changelog, or `.changeset` file changed in the checked-out diff.
- Only `.github/workflows/test.yml` changed; no workflow was added or deleted, and `bun run script/check-workflows.ts` passed with all 27 workflows allowlisted.
- Kilo's CLI build customizations remain present in `packages/opencode/script/build.ts`: Kilo output naming/user agent, Kilo workers, sandbox/bubblewrap and release-build behavior are retained. The upstream TUI worker path move and `fff` native dependency/`FFF_LIBC` additions are coherent at source level, subject to the patch/version and platform-build validation above.
- The standalone `packages/tui` workspace addition is represented in `package.json`'s existing `packages/*` workspace glob and `bun.lock`; no separate workspace-list update is needed. Its runtime JSX consumption is broken as described above.
- The `@npmcli/agent` patch was renamed from `4.0.0` to `4.0.2` with identical content, and both `package.json` and `bun.lock` reference `4.0.2`; this appears consistent.
- Generated `packages/sdk/openapi.json`, `packages/sdk/js/src/v2/gen/{sdk.gen,types.gen}.ts`, and the small manual compatibility seam in `packages/sdk/js/src/v2/client.ts` changed together with server/API changes. Source-link freshness, typecheck, and HttpApi CI pass at current HEAD. I found no standalone evidence of an accidental generated-file overwrite, though I did not regenerate the full SDK locally.
- `.opencode-version` advances from `v1.16.2` to `v1.17.4`, matching the PR's declared upstream range. `specs/v2/schema-changelog.md` records the material durable/API contract changes.
- The broader package/lock changes add the extracted TUI workspace, OpenTUI `0.3.4`, `fff-bun` `0.9.4` platform binaries, GitLab updates, and Anthropic `3.0.82`. I found no Kilo workspace deletion in the lockfile.

## Commands and limitations

Principal commands used:

```sh
git status --short --branch
git diff --name-status c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD
git diff --stat c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD
git diff --check c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD
git diff --name-status 2ca787fa4de21f0d00eb16f95b38e214d2e18242..HEAD
git log --oneline --no-merges c49560af0f94459015d3fa4e1efa23ad9b291955..HEAD
git show 68b59571a0 -- .github/workflows/test.yml turbo.json package.json packages/kilo-jetbrains/package.json
bun run script/check-workflows.ts
gh pr view 12204 --repo Kilo-Org/kilocode --json headRefOid,statusCheckRollup,mergeStateStatus
gh pr checks 12204 --repo Kilo-Org/kilocode
gh api repos/Kilo-Org/kilocode/actions/jobs/<job>/logs
gh api repos/Kilo-Org/kilocode/actions/runs/29360349529/artifacts
gh release view v7.4.7 --repo Kilo-Org/kilocode --json assets,publishedAt,url
```

CI at current HEAD is complete. Passing: forbidden strings, shared annotations, workflow/action CodeQL, Java/Kotlin and JavaScript/TypeScript CodeQL, typechecks, docs, source links, visual tests, VS Code tests, JetBrains tests, and HttpApi. Failing: both Linux unit shards, macOS, all four Windows unit shards, and the required aggregate unit/test checks. Linux logs confirm the TUI JSX runtime failure above and also show `TuiPathsProvider` missing, `AppRuntime.dispose` missing, synchronous execution of asynchronous Effects, ACP subprocess timeouts, stale provider/agent expectations, and other source/test regressions; Windows logs show overlapping failures plus path/snapshot issues. The macOS CLI task exits with code 2 before useful test diagnostics. These failures confirm the merge is not releasable. Only the JetBrains JUnit artifact exists for run `29360349529`, which independently confirms the general JUnit/reporting regression.

A prior review attempt at `bun install --frozen-lockfile --dry-run` was inconclusive because Bun 1.3.12 resolved dependencies, executed postinstall despite `--dry-run`, and failed when `husky` was unavailable; the repository declares Bun 1.3.14. I did not rerun install during current-HEAD revalidation. CI supplied the complete unit matrix, but no full CLI cross-platform release build, SDK regeneration, or release dry run was performed locally. Concurrent untracked reports/files in the shared worktree were not modified.
