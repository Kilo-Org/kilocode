# Infrastructure Change Review: PR #11090

## Scope and Methodology

Reviewed the complete three-dot diff from base `b90ab85c3b4ad5097fe11e431d0319f31f935d6e` (`origin/main`) to head `6a1377abaa88902b741f3ffff276aa6b743f3a3c`. The merge base is the reviewed base, so `origin/main...HEAD` is the complete PR delta: 270 files, 7,733 insertions, and 3,901 deletions.

The review enumerated the full name/status diff, inspected every net infrastructure-related hunk, checked infrastructure path categories with no net changes, and compared the release/build/install changes both to the base and to upstream tag `v1.15.4`. This separates intentional v1.15.4 behavior from accidental replacement of Kilo-owned infrastructure. Intermediate branch commits were not treated as final changes when their effects cancel out in `origin/main...HEAD`.

## Findings

### [Medium, human verification required] The npm package install and publish lifecycle materially changes

References: `packages/opencode/script/postinstall.mjs:12`, `packages/opencode/script/postinstall.mjs:26`, `packages/opencode/script/postinstall.mjs:97`, `packages/opencode/script/postinstall.mjs:120`, `packages/opencode/script/postinstall.mjs:128`, `packages/opencode/script/postinstall.mjs:156`, `packages/opencode/script/postinstall.mjs:164`, `packages/opencode/script/publish.ts:36`, `packages/opencode/script/publish.ts:52`, `packages/opencode/script/publish.ts:59`, `packages/opencode/script/build.ts:385`, `packages/opencode/test/cli/install-artifact.test.ts:21`

The PR ports the upstream v1.15.4 installer design into Kilo's package layout:

- Postinstall now reads the published package's `optionalDependencies`, selects native/baseline/musl variants, probes AVX2 on Windows as well as macOS/Linux, verifies the copied binary with `--version`, and falls back to a temporary `npm install` when resolving or copying an optional native package fails.
- Kilo's required sidecars remain preserved: tree-sitter and console resources are copied beside the cached `.kilo` binary.
- The universal package now runs postinstall with Node only and declares `os`/`cpu` constraints. Per-platform packages gain `preferUnplugged: true`, which is consistent with a postinstall process that writes and executes a native binary.
- The artifact test was adapted to provide package metadata and an executable test binary. The targeted test passes.

This is an intentional v1.15.4 build/install change, not an accidental replacement with OpenCode packaging. Kilo package names, wrapper commands, `.kilo` cache, sidecar resources, npm provenance, GHCR image, AUR package, Homebrew tap, and Kilo release URLs remain intact. See `packages/opencode/script/publish.ts:23`, `packages/opencode/script/publish.ts:45`, `packages/opencode/script/publish.ts:78`, `packages/opencode/script/publish.ts:80`, `packages/opencode/script/publish.ts:97`, and `packages/opencode/script/publish.ts:148`.

Human verification is still required before release because the local test covers only the current non-Windows platform and a preinstalled native dependency. It does not exercise a real packed artifact, Windows's postinstall no-op, Linux glibc/musl, x64 baseline selection, Yarn/PnP unplugging, or the network fallback path. Verify installation and `kilo --version` from a packed prerelease with npm, pnpm, and Bun on the supported release matrix.

### [Low, human verification required] Generated OpenAPI and SDK output changes are broad but the generator is unchanged

References: `packages/sdk/openapi.json:8218`, `packages/sdk/openapi.json:21916`, `packages/sdk/openapi.json:24726`, `packages/sdk/openapi.json:26193`, `packages/sdk/js/src/v2/gen/sdk.gen.ts:5041`, `packages/sdk/js/src/v2/gen/sdk.gen.ts:5065`, `packages/sdk/js/src/v2/gen/types.gen.ts:3269`, `packages/sdk/js/src/v2/gen/types.gen.ts:3334`, `packages/sdk/js/src/v2/gen/types.gen.ts:3813`, `packages/sdk/js/src/v2/gen/types.gen.ts:7572`

Generated output changes by 2,252 additions/364 deletions in `packages/sdk/openapi.json`, 738 additions/179 deletions in generated types, and six additions/six deletions in generated client methods. The output adds the new event model and changes v2 model/provider query input from `instance` to `location`.

No SDK/build generation script changes in this PR: `script/generate.ts` is unchanged. The generated delta is consistent with the PR's server/event refactor rather than a replacement of Kilo generation infrastructure. Because regeneration was not run under the report-only constraint, an API owner should verify that the expanded event unions and the `instance` to `location` client break are intended and that checked-in output was produced by the repository generator.

### [Info] v1.15.4 dependency and build metadata updates are intentional

References: `.opencode-version:1`, `package.json:35`, `package.json:81`, `packages/plugin/package.json:24`, `bun.lock:749`, `bun.lock:1594`, `bun.lock:5068`

The upstream tracking marker moves from `v1.14.51` to `v1.15.4`. The root catalog and plugin peer minimums move OpenTUI core, solid, and keymap from `0.2.10` to `0.2.11`, with matching lockfile updates. The lockfile retains nested OpenTUI `0.2.10` packages for `opentui-spinner`; this is resolver output for that dependency, not a rollback of the direct catalog upgrade.

The Bun pin remains `1.3.14`, workspace membership is unchanged, and Kilo's root postinstall still runs `fix-node-pty` plus `script/setup-git.ts`. These are expected dependency/build changes, not imported upstream workspace infrastructure.

### [Info] Upstream merge automation now explicitly rejects upstream PR-cleanup automation

References: `script/upstream/utils/config.ts:119`, `script/upstream/utils/config.ts:125`, `script/upstream/utils/config.ts:128`

The merge skip list adds upstream `.github/workflows/close-prs.yml` and `script/github/close-prs.ts`, documenting that Kilo uses `.github/workflows/kilo-auto-close.yml` instead. This is a protective Kilo infrastructure change and reduces the chance that a future upstream merge replaces Kilo's PR cleanup automation.

### [Info] The Effect CI guard allowlist follows the runtime refactor

References: `script/check-opencode-promise-facades.ts:22`, `script/check-opencode-promise-facades.ts:31`, `script/check-opencode-promise-facades.ts:41`, `script/check-opencode-promise-facades.ts:44`

The guard removes the migrated `session/compaction.ts` runtime exception, updates existing test counts, and classifies two additional integration tests. The guard passes with six classified runtime sites and 52 classified test references. This changes repository validation data only; it does not disable or remove the guard.

### [Info] CLI self-update keeps Kilo's package-manager restriction

References: `packages/opencode/src/cli/upgrade.ts:8`, `packages/opencode/src/cli/upgrade.ts:12`, `packages/opencode/src/cli/upgrade.ts:18`, `packages/opencode/src/cli/upgrade.ts:44`

Update notifications move from the per-instance bus to `GlobalBus` as part of the event-system refactor. The actual infrastructure policy remains Kilo-specific: automatic upgrades are still limited to npm, pnpm, and Bun because `@kilocode/cli` is published through the npm registry. No OpenCode installer target or package name replaces Kilo behavior.

### [Info] A patch changeset is added for the Kilo compatibility restoration

Reference: `.changeset/restore-kilo-cli-commands.md:1`

The new changeset requests a patch release of `@kilocode/cli` and describes restoration of Kilo branding, fork-specific commands, and lifecycle initialization after upstream merges. Changesets configuration and changelog automation are otherwise unchanged.

## Notable Non-Findings

- No net `.github/**` change exists in `origin/main...HEAD`: no GitHub Actions workflow, action definition, issue template, pull request template, or CI configuration is added, removed, or changed. The head merge commit touched `.github/workflows/kilo-auto-close.yml` relative to its first parent, but its final content matches the reviewed base.
- No Dockerfile, Docker directory, `flake.nix`, Nix expression, `nix/hashes.json`, or Nix automation changes survive in the complete PR diff. The existing Kilo Docker publish target and registry remain unchanged at `packages/opencode/script/publish.ts:80` and `packages/opencode/script/publish.ts:87`.
- No release workflow, `publish-registries` script, package-manager pin, workspace list, root postinstall, source-link extraction, workflow allowlist, SDK generator, or source-link output changes survive in the complete diff.
- The GitHub workflow template emitted by the CLI remains Kilo-branded and continues to use `Kilo-Org/kilocode/github@latest`; the changed code in that command is runtime/context adaptation, not a workflow-template replacement.
- Kilo's GHCR, AUR, Homebrew, npm package naming, release archive naming, tree-sitter sidecars, and console assets remain present in the final publish/build scripts.

## Commands and Outputs

- `git rev-parse HEAD origin/main` returned head `6a1377abaa88902b741f3ffff276aa6b743f3a3c` and base `b90ab85c3b4ad5097fe11e431d0319f31f935d6e`.
- `git merge-base origin/main HEAD` returned `b90ab85c3b4ad5097fe11e431d0319f31f935d6e`.
- `git diff --stat origin/main...HEAD` reported 270 files changed, 7,733 insertions, and 3,901 deletions.
- Scoped `git diff --name-status` checks for `.github`, Docker, Nix, issue templates, source-link generation, SDK generation scripts, and protected release configuration returned no net changes.
- `git diff --check origin/main...HEAD` completed with no output.
- `bun run script/check-opencode-promise-facades.ts` passed: `6 classified runtime site(s), 52 classified test reference(s), no runtime drift found.`
- From `packages/opencode`, `bun test ./test/cli/install-artifact.test.ts` passed: 3 tests, 0 failures, 11 assertions.

## Limitations

This was a static infrastructure review plus the smallest directly relevant local checks. No release build, npm publish, Docker build/push, AUR/Homebrew update, or cross-platform installation was run because those operations are expensive, credentialed, platform-specific, or mutating. Generated SDK output was inspected but not regenerated because the task permits changing only this report. The package installation matrix and generated API intent therefore require the human verification called out above.
