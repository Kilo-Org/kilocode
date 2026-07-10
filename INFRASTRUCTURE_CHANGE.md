# Infrastructure Change Review: PR #12088

**Verdict: BLOCK pending infrastructure-owner review and fixes.**

This upstream merge changes Kilo-owned CI, release automation, package/workspace infrastructure, build behavior, repository guards, dependency patching, database generation, changelog automation, and generated SDK artifacts. The complete `origin/main...HEAD` diff contains 1,206 files with 115,443 insertions and 46,254 deletions. At least one release-path change is definitively broken, and the Zed automation removal is internally inconsistent.

## Findings

### P0: Root release publishing invokes a package that does not exist

- `script/publish.ts:117-118` unconditionally runs `bun ./packages/cli/script/publish.ts` after publishing the main CLI.
- Neither `HEAD` nor `origin/main` contains `packages/cli`; `git ls-tree -r --name-only HEAD packages/cli` returned no paths.
- `.github/workflows/publish.yml:469` executes `./script/publish.ts`, so the production publish job will reach this missing script and fail before SDK, plugin, and VS Code publication.
- Required action: remove or Kilo-adapt the upstream preview-CLI publish step, then have a release owner verify the entire publish sequence.

### P1: Zed release/changelog automation was only partially removed

- Deleted: `script/sync-zed.ts`, `packages/extensions/zed/LICENSE`, and `packages/extensions/zed/icons/opencode.svg`.
- Changed: `script/raw-changelog.ts` removes Zed/extension changelog classification.
- Still present and active: `packages/extensions/zed/extension.toml`, root `script/publish.ts`, `script/publish-start.ts`, `script/sync-versions.ts`, `script/upstream/transforms/preserve-versions.ts`, and `.github/workflows/test.yml` still reference the Zed extension.
- `packages/extensions/zed/extension.toml:11` still points to the now-deleted `./icons/opencode.svg`; root publishing still rewrites this manifest on every release.
- Required action: a Kilo release owner must decide whether Kilo retains Zed support. Restore Kilo's files/automation if retained, or remove all remaining release, version-sync, test-filter, and upstream-transform references if intentionally retired.

### P1: GitHub Actions behavior changed

- `.github/workflows/nix-hashes.yml` now retries the Nix `node_modules_updater` hash extraction up to three times with 10/20-second delays and revised failure output.
- This is a direct Kilo CI automation change, even though it appears intended to mitigate transient Nix failures.
- Required action: human verification that retries cannot reuse stale `BUILD_LOG` hash output, mask a persistent build failure, or cause unacceptable matrix runtime increases. Run the workflow on all configured systems before approval.

### P1: Package manager and workspace infrastructure changed materially

- `package.json` changes root scripts, moves `postinstall`'s node-pty repair from `packages/opencode` to `packages/core`, adds production SST/AWS helper scripts and dependencies, upgrades shared Effect/OpenTUI/virtua catalogs, and registers five dependency patches.
- `bunfig.toml` expands Kilo's supply-chain quarantine bypass to `@ai-sdk/amazon-bedrock` and OpenTUI musl packages. This weakens the configured minimum-release-age control for those packages and requires explicit security/infra approval.
- `bun.lock` changes by 979 additions and 136 deletions, including substantial AWS/SST/action/build dependency churn.
- New workspace packages are introduced at `packages/effect-sqlite-node` and `packages/server`; package manifests also change in `packages/core`, `packages/effect-drizzle-sqlite`, `packages/http-recorder`, `packages/opencode`, `packages/plugin`, and `packages/ui`.
- CI test scripts in several manifests drop Bun's `--dots` option; peer/export maps and runtime dependency ownership move across packages.
- Required action: run a frozen clean install, root/package typechecks, affected CI test scripts, and workspace packaging checks on supported Bun/Node/platform combinations. Security must approve the quarantine exclusion and new dependency graph.

### P1: CLI build and packaging behavior changed

- `packages/opencode/script/build.ts` and `build-node.ts` stop embedding `KILO_MIGRATIONS`; Linux builds now define `process.env.OPENTUI_LIBC`, and generated package metadata now declares `libc` when an ABI is present.
- `packages/opencode/script/fix-node-pty.ts` is moved to `packages/core/script/fix-node-pty.ts`, with root `postinstall` redirected accordingly.
- `packages/ui/script/build-oc2-v2-overrides.ts` and the `generate:v2-oc2` package script add generated theme automation.
- Required action: human verification of glibc/musl and Node/Bun artifacts, migration availability in packaged binaries, node-pty postinstall behavior, and reproducibility of the generated theme file. Run the CLI single-target build and artifact smoke tests before merge.

### P1: Database migration generation and validation were replaced

- Existing migration inputs move from `packages/opencode/migration` to `packages/core/migration`; 12 new migration directories and generated TypeScript wrappers are added.
- New `packages/core/script/migration.ts`, `packages/core/src/database/migration.gen.ts`, and package scripts replace the deleted `packages/opencode/script/check-migrations.ts` and build-time migration embedding.
- No GitHub workflow reference to the old or new migration check was found. Whether another CI command transitively checks `bun run migration --check` was not established by static inspection.
- Required action: database/infra owners must verify migration ordering, upgrade compatibility for existing Kilo databases, generated wrapper fidelity, and that CI explicitly detects schema/migration/registry drift.

### P1: Generated SDK/API artifacts changed at very large scale

- `packages/sdk/openapi.json`, `packages/sdk/js/src/v2/gen/sdk.gen.ts`, and `packages/sdk/js/src/v2/gen/types.gen.ts` change by 27,731 additions and 20,918 deletions.
- `packages/sdk/js/src/v2/client.ts` also changes hand-written request rewriting and exported type aliases; this is not merely generated churn.
- The new `packages/server` package and extensive route movement are likely inputs to generation, but provenance/reproducibility cannot be proven from the diff alone.
- Required action: regenerate with Kilo's canonical `./script/generate.ts`, require a clean resulting diff, review public API compatibility, and run SDK generation/build/tests before approval.

### P2: Repository guards and test-selection automation changed

- `script/check-opencode-annotations.ts` broadens upstream-merge detection to subjects beginning `merge: opencode `.
- `script/check-opencode-promise-facades.ts` changes allowlisted test files/counts, including adding `kilocode/cli-shutdown.test.ts`.
- `packages/opencode/script/kilocode/test-profile.ts` replaces an explicit filesystem test list with `filesystem/*.test.ts`.
- These changes can alter what CI rejects or executes and therefore need Kilo maintainer verification, especially because this PR is itself an upstream merge.

### P2: New dependency patches affect install/runtime behavior

- Added `patches/@ai-sdk%2Fgoogle@3.0.73.patch`: suppresses empty Gemini model entries.
- Added `patches/pacote@21.5.0.patch`: changes git dependency fallback behavior for HTTP/tar failures.
- Added `patches/virtua@0.49.1.patch`: adds measurement APIs and range bounds to the Solid virtualizer.
- Root `package.json` also begins registering these plus existing-version patches for `@ai-sdk/xai` and `gcp-metadata`.
- Required action: dependency owners must verify patch provenance, exact-version lock alignment, platform behavior, and whether fixes should remain Kilo-owned or be replaced by released upstream versions.

## Notable Non-Findings

- No Dockerfiles, Compose files, `.dockerignore`, Nix source files, or flake files changed. The Nix-related change is limited to `.github/workflows/nix-hashes.yml`.
- No issue templates, pull-request templates, CODEOWNERS, Dependabot/Renovate configuration, GitHub composite actions, or changeset files changed.
- No other GitHub workflow file changed besides `.github/workflows/nix-hashes.yml`.
- `script/publish-start.ts`, `script/sync-versions.ts`, `.github/workflows/publish.yml`, and `.github/workflows/test.yml` were not changed, but their unchanged references are relevant to the inconsistent Zed removal and broken publish path described above.

## Commands Used

```text
git status --short --branch
git diff --name-status --find-renames origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --summary origin/main...HEAD
git diff --shortstat origin/main...HEAD
git log --oneline --decorate origin/main..HEAD
git diff [--stat|--numstat] origin/main...HEAD -- <infrastructure pathspecs>
git diff origin/main...HEAD -- <workflow, manifest, build, release, guard, SDK, and config files>
git ls-tree -r --name-only HEAD packages/cli
git ls-tree -r --name-only origin/main packages/cli
git ls-tree -r --name-only {origin/main,HEAD} packages/extensions/zed
git show origin/main:packages/opencode/drizzle.config.ts
git diff --check origin/main...HEAD
```

Dedicated path/content searches were also used to locate migration-check, publish, preview-CLI, and Zed references and to confirm the notable non-findings.

## Limitations

- This was a static infrastructure review of the complete diff. No publishing, deployment, release, SDK regeneration, database migration, Docker/Nix build, clean install, package build, or GitHub Actions workflow was executed because those operations may be destructive, credentialed, network-dependent, or exceed the review environment's two-minute command limit.
- The generated SDK/OpenAPI and migration snapshots are too large for meaningful line-by-line semantic validation here; reproducible regeneration and human API/database review are mandatory.
- The PR contains 1,206 changed files. All paths were inventoried and infrastructure-relevant/ambiguous areas were inspected, but non-infrastructure application logic was outside this report's scope.
- `rg` was unavailable in the container; equivalent Git pathspec searches and dedicated file/content search tools were used instead.
