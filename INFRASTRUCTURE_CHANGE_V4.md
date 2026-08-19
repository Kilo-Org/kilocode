# Infrastructure Change Review (Round 4): OpenCode v1.18.14..v1.18.15 Merge (PR #13002)

## Scope and Methodology

This review evaluates infrastructure, build, CI/CD, packaging, lockfile dependencies, architecture guards, and repository automation changes in PR [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) (merging OpenCode `v1.18.14..v1.18.15` into Kilo).

### Audit Range
- **Base Branch:** `origin/johnnyeric/kilo-opencode-v1.18.13` (`47d0d6d7e8224160c50a7a8c1a264b420256e17d`) / `origin/main` (`b550030b2f523f7c4b34439bec2516d1bd280431`)
- **PR Branch Head:** `origin/johnnyeric/kilo-opencode-v1.18.15` (`860f5d9e680fb2a1b7c77913ba706419e44124b3`)

### Round 4 Review Objectives
1. **Resolution Verification of Finding 1 (`scripts.dev`):** Verify that commit `860f5d9e68` restored Kilo's `scripts.dev` in root `package.json` (`"KILO_CLIENT=cli bun run --cwd packages/opencode --conditions=node src/index.ts"`), updated `script/upstream/transforms/transform-package-json.ts` to preserve `"dev"`, and added regression coverage in `transform-package-json.test.ts`.
2. **Package Patches & Lockfile Audit:** Verify both `@ai-sdk/openai-compatible@2.0.48` and `@ai-sdk/openai-compatible@2.0.41` patches are properly registered in `package.json` `patchedDependencies` and `bun.lock`, apply cleanly, and pass test coverage (`bun test ./test/plugin/xai.test.ts`).
3. **CI Workflows & Allowlist Guards:** Verify all GitHub Actions workflows (`.github/workflows/*`), CI guards (`script/check-workflows.ts`, `script/check-architecture.ts`, `script/check-model-tool-network.ts`, `script/check-opencode-annotations.ts`, `script/check-opencode-promise-facades.ts`, `script/check-md-table-padding.ts`, `check-kilocode-change`), and regex boundaries match current branch invariants.
4. **Upstream Repo Automation:** Verify `script/upstream/transforms/remove-kilo-web.ts`, `script/upstream/transforms/transform-package-json.ts`, and `script/upstream/merge.ts` pipelines.
5. **Generated SDK / OpenAPI Artifacts:** Verify that `./script/generate.ts` runs cleanly with zero drift against `packages/sdk/openapi.json` and `packages/sdk/js/src/v2/gen/*`.
6. **Nix Hashes and Build Configurations:** Verify `nix/hashes.json`, `packages/opencode/script/build-node.ts`, and `packages/opencode/script/build.ts`.

---

## Infrastructure-Relevant Files

| File | Area | Change Type | Round 4 Status |
|---|---|---|---|
| `package.json` (root) | Workspace Config | Modified | **RESOLVED** (`scripts.dev` restored to Kilo node runner; patches registered) |
| `bun.lock` | Lockfile | Modified | Validated (contains `2.0.48` & `2.0.41` patches, removes stale transitive dependencies) |
| `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` | Package Patches | Added | Validated (patches resolved `2.0.48` cleanly) |
| `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` | Package Patches | Added | Validated (retained for transitive `2.0.41` consumers) |
| `script/upstream/transforms/transform-package-json.ts` | Repo Automation | Modified in `860f5d9e68` | **RESOLVED** (`"dev"` added to `PRESERVE_SCRIPTS["package.json"]`) |
| `script/upstream/transforms/transform-package-json.test.ts` | Repo Automation | Modified in `860f5d9e68` | **RESOLVED** (unit test asserts `scripts.dev` preservation) |
| `script/upstream/transforms/remove-kilo-web.ts` | Repo Automation | Preserved | Validated (removes `kilo web` CLI command) |
| `script/upstream/transforms/remove-kilo-web.test.ts` | Repo Automation | Preserved | Validated (unit tests pass) |
| `script/upstream/merge.ts` | Repo Automation | Preserved | Validated (`transformKiloWeb` wired into transform pipeline) |
| `script/upstream/utils/config.ts` | Repo Automation | Preserved | Validated (`skipFiles` includes `web.ts`) |
| `script/upstream/README.md` | Repo Documentation | Modified in `860f5d9e68` | Validated (replaces hardcoded author usernames with `username/`) |
| `script/upstream/analyze.ts` | Repo Automation | Modified in `860f5d9e68` | Validated (replaces hardcoded author username with `username/`) |
| `script/check-architecture.ts` | CI Guards | Synced from `main` | Validated (8 classified ratchet sites, 0 boundary violations) |
| `script/architecture-allowlist.json` | CI Guards | Synced from `main` | Validated (ratchet allowances updated) |
| `script/check-model-tool-network.ts` | CI Guards | Modified in `860f5d9e68` | Validated (verifies MCP delegated authority pattern) |
| `script/check-opencode-annotations.ts` | CI Guards | Modified in `860f5d9e68` | Validated (regex catches upstream merge branch names) |
| `script/check-opencode-promise-facades.ts` | CI Guards | Preserved | Validated (6 classified runtime sites, 79 test references) |
| `script/check-workflows.ts` | CI Guards | Checked | Validated (29 workflows match allowlist) |
| `.github/workflows/*` | CI Workflows | Synced with `main` | Validated (0 workflow differences relative to `origin/main`) |
| `packages/opencode/script/build-node.ts` | Build Scripts | Modified | Validated (`KILO_VERSION` define annotated with `kilocode_change`) |
| `packages/opencode/script/generate.ts` | Code Generation | Checked | Validated (runs cleanly; zero schema/SDK drift) |
| `packages/sdk/openapi.json` | API Schema | Synced | Validated (clean generation via Hey API OpenAPI TS) |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | Generated SDK | Synced | Validated (in sync with backend schema) |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Generated SDK | Synced | Validated (in sync with backend schema) |
| `nix/hashes.json` | Nix Infrastructure | Synced | Validated (updated platform `nodeModules` hashes) |
| `.opencode-version` | Version Metadata | Modified | Validated (bumped `v1.18.13` -> `v1.18.15`) |
| `.changeset/opencode-v1-18-14-to-v1-18-15.md` | Changesets | Added | Validated (patch releases for `@kilocode/cli` and `kilo-code`) |

---

## Findings

**0 Open Blocking or High Findings.**

---

## Notable Non-Findings / Resolved Items

### Resolution of Finding 1: Root `package.json` `scripts.dev` Overwritten by Upstream Default (RESOLVED)
- **Status:** **RESOLVED** (Commit `860f5d9e68`)
- **Verification Details:**
  1. In root `package.json`, `scripts.dev` is restored to:
     ```json
     "dev": "KILO_CLIENT=cli bun run --cwd packages/opencode --conditions=node src/index.ts"
     ```
  2. In `script/upstream/transforms/transform-package-json.ts`, `"dev"` was added to `PRESERVE_SCRIPTS["package.json"]`:
     ```ts
     const PRESERVE_SCRIPTS: Record<string, string[]> = {
       "package.json": [
         "dev",
         "extension",
         "extension:isolated",
         "extension:isolated:clean",
         ...
       ]
     }
     ```
  3. `script/upstream/transforms/transform-package-json.test.ts` includes unit test assertions verifying that upstream merge transformations preserve `scripts.dev`.
  4. Executing `bun test ./script/upstream/transforms/transform-package-json.test.ts` passes 100%.

### Verification of Package Patches and Lockfile
- `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` and `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` are present in the filesystem and registered in `package.json` and `bun.lock`.
- Both patches cleanly handle stream error forwarding (`error: chunk.value.error` instead of `chunk.value.error.message`).
- `bun test ./packages/opencode/test/plugin/xai.test.ts` passes with 26/26 tests succeeding.

### CI Workflows and Guard Synchronization
- `.github/workflows/*` has zero diff against `origin/main`.
- `bun run script/check-workflows.ts` verified that all 29 workflows match the repository allowlist.
- `bun run script/check-architecture.ts` verified 8 classified Kilo ratchet sites with 0 boundary violations.
- `bun run script/check-model-tool-network.ts` verified 3 classified client sites and policy-aware MCP tool boundaries.
- `bun run script/check-opencode-promise-facades.ts` verified 6 runtime sites and 79 test references with 0 runtime drift.
- `bun run script/check-md-table-padding.ts` verified 415 markdown files with 0 padded table violations.
- `bun run --cwd packages/kilo-vscode check-kilocode-change` confirmed 0 forbidden markers in `packages/kilo-vscode` and `packages/kilo-ui`.

### SDK and OpenAPI Schema Generation
- Running `./script/generate.ts` from repo root completed cleanly.
- `git status` after generation confirms working tree is clean with zero uncommitted changes or schema drift in `packages/sdk/openapi.json` and `packages/sdk/js/src/v2/gen/*`.

### Build Configurations & Nix Hashes
- `packages/opencode/script/build-node.ts` defines `KILO_VERSION: '${Script.version}'` marked with `kilocode_change`.
- `nix/hashes.json` contains valid SHA256 hashes for all 4 supported architectures (`x86_64-linux`, `aarch64-linux`, `aarch64-darwin`, `x86_64-darwin`).

---

## Command Outputs

| Command | Working Directory | Result / Output |
|---|---|---|
| `./script/generate.ts` | Root | **PASSED** (OpenAPI schema generated, TypeScript SDK generated in `packages/sdk/js/src/v2/gen/`, docs updated) |
| `bun test ./script` | Root | **PASSED** (62 pass, 0 fail, 150 expect calls across 11 files in 2.03s) |
| `bun test ./script/upstream/transforms/transform-package-json.test.ts` | Root | **PASSED** (all test cases pass in 53ms) |
| `bun test ./packages/opencode/test/plugin/xai.test.ts` | Root | **PASSED** (26 pass, 0 fail, 105 expect calls in 1.08s) |
| `bun test ./packages/opencode/test/session/retry.test.ts ./packages/opencode/test/acp/usage.test.ts ./packages/opencode/test/kilocode/command-files.test.ts` | Root | **PASSED** (66 pass, 0 fail, 91 expect calls in 11.05s) |
| `bun run script/check-workflows.ts` | Root | `check-workflows: ok (29 workflows).` |
| `bun run script/check-architecture.ts` | Root | `check-architecture: ok (8 classified Kilo ratchet sites, 0 boundary violations).` |
| `bun run script/check-model-tool-network.ts` | Root | `check-model-tool-network: 3 classified client site(s), policy-aware tool and MCP boundaries verified.` |
| `bun run script/check-opencode-annotations.ts` | Root | `Skipping shared upstream annotation check — upstream merge detected.` |
| `bun run script/check-opencode-annotations.ts --worktree` | Root | `No shared upstream source files changed — nothing to check.` |
| `bun run script/check-opencode-promise-facades.ts` | Root | `check-opencode-promise-facades: 6 classified runtime site(s), 79 classified test reference(s), no runtime drift found.` |
| `bun run script/check-md-table-padding.ts` | Root | `check-md-table-padding: 415 file(s) checked, no padded tables found.` |
| `bun run --cwd packages/kilo-vscode check-kilocode-change` | Root | `0 violations` |
| `bun run --cwd packages/opencode typecheck` | `packages/opencode` | `$ tsgo --noEmit` (Passed, exit code 0) |
| `bun run --cwd packages/kilo-vscode typecheck` | `packages/kilo-vscode` | `check-types: Done in 887ms`, `check-types:webview: Done in 1.56s` (Passed, exit code 0) |
| `bun run --cwd packages/kilo-vscode lint` | `packages/kilo-vscode` | `$ eslint ...` (Passed, exit code 0) |
| `git diff origin/main 860f5d9e68 -- .github/` | Root | Empty (0 differences against main) |

---

## Limitations

1. **Targeted Subprocess Test Execution:** Due to concurrency constraints on macOS temporary files during full-suite runs, tests covering specific infrastructure boundaries (`xai.test.ts`, `retry.test.ts`, `command-files.test.ts`, `usage.test.ts`, `transform-package-json.test.ts`, `remove-kilo-web.test.ts`) were executed in targeted runs.
2. **Annotation Guard Upstream Bypass:** `script/check-opencode-annotations.ts` automatically skips checking when an upstream merge commit is detected in history; individual shared files were inspected directly.
