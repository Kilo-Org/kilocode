# Infrastructure Change Review (Round 3): OpenCode v1.18.14..v1.18.15 Merge (PR #13002)

## Scope and Methodology

This review evaluates infrastructure, build, CI/CD, packaging, and repository automation changes in PR [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) (merging OpenCode `v1.18.14..v1.18.15` into Kilo).

### Audit Range
- **Base Branch:** `origin/johnnyeric/kilo-opencode-v1.18.13` (`aca225fcfd2ad5146f142a5d582f62c1dff12c35`)
- **PR Branch Head:** `origin/johnnyeric/kilo-opencode-v1.18.15` (`6d8876045d4cf06272cfb355f2b18c74cdf3e967`)
- **Main Reference:** `origin/main` (`73844ae68d5312f5a024765ca35e468be69d51b3`)

### Round 3 Review Objectives
1. **Base Reconciliation Audit:** Verify that the merge of base branch `origin/johnnyeric/kilo-opencode-v1.18.13` into PR branch head (commit `6d8876045d`) cleanly resolved all base lag regressions (slash command management endpoints `/kilocode/command/*`, generated SDK/OpenAPI schemas, terminal initial sizing `size: { rows, cols }`, JetBrains `7.0.14` release notes, and VS Code `files.watcherExclude`).
2. **Upstream Transform & CLI Web Command Verification:** Verify the restoration of `script/upstream/transforms/remove-kilo-web.ts`, its test suite, merge hooks, and the removal of `packages/opencode/src/cli/cmd/web.ts` and `WebCommand` registration.
3. **Patch Verification:** Verify that `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` is properly registered in root `package.json` and `bun.lock`, applies cleanly, and yields valid JavaScript in `node_modules`.
4. **CI Script & Guard Execution:** Execute SDK code generation (`./script/generate.ts`), CI guards (`check-workflows.ts`, `check-architecture.ts`, `check-model-tool-network.ts`, `check-opencode-annotations.ts`, `check-md-table-padding.ts`, `check-kilocode-change`), linters, typecheckers, and unit test suites across affected packages.

---

## Infrastructure-Relevant Files

| File | Area | Change Type | Round 3 Status |
|---|---|---|---|
| `package.json` (root) | Workspace Config | Modified | **OPEN REGRESSION** (`scripts.dev` overwritten by upstream default; `"check:architecture"` added) |
| `bun.lock` | Lockfile | Modified | Validated (registered `2.0.48` and `2.0.41` patches, version sync) |
| `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` | Package Patches | Added | **RESOLVED** (cleanly patches resolved version 2.0.48) |
| `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` | Package Patches | Added | Retained for transitive 2.0.41 dependencies |
| `script/upstream/transforms/remove-kilo-web.ts` | Repo Automation | Added/Restored | **RESOLVED** (transform restored and active) |
| `script/upstream/transforms/remove-kilo-web.test.ts` | Repo Automation | Added/Restored | **RESOLVED** (transform unit tests restored and passing) |
| `script/upstream/merge.ts` | Repo Automation | Modified | **RESOLVED** (`transformKiloWeb` step restored) |
| `script/upstream/utils/config.ts` | Repo Automation | Modified | **RESOLVED** (`skipFiles` entry for `web.ts` restored) |
| `script/upstream/utils/upstream.ts` | Repo Automation | Modified | **RESOLVED** (`removeKiloWeb` invocation restored) |
| `script/upstream/index.ts` | Repo Automation | Modified | **RESOLVED** (transform exports restored) |
| `script/check-architecture.ts` | CI Guards | Synced from `main` | Validated (12 ratchet sites, 0 boundary violations) |
| `script/architecture-allowlist.json` | CI Guards | Synced from `main` | Validated (domain classification allowlists present) |
| `script/check-opencode-annotations.ts` | CI Guards | Modified | Validated (expanded upstream merge commit detection) |
| `script/check-model-tool-network.ts` | CI Guards | Modified | Validated (regex updated for session-aware `executeMcp`) |
| `script/check-workflows.ts` | CI Guards | Checked | Validated (29 workflows match allowlist) |
| `.github/workflows/check-opencode-annotations.yml` | CI Workflows | Modified | Validated (synced architecture guard step from `main`) |
| `packages/opencode/script/build-node.ts` | Build Scripts | Modified | Validated (`KILO_VERSION` define added with `kilocode_change`) |
| `packages/opencode/script/generate.ts` | Code Generation | Checked | Validated (runs cleanly; generates OpenAPI schemas, TypeScript SDK, docs) |
| `packages/sdk/openapi.json` | API Schema | Checked vs Base | **RESOLVED** (in sync with base; contains `/kilocode/command/*` and PTY sizing) |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | Generated SDK | Checked vs Base | **RESOLVED** (in sync with base; contains `/kilocode/command/*` and PTY sizing) |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Generated SDK | Checked vs Base | **RESOLVED** (in sync with base; contains `/kilocode/command/*` and PTY sizing) |
| `packages/sdk-next/package.json` | Package Config | Modified | Validated (script order normalization) |
| `packages/kilo-vscode/package.json` | Package Config | Checked vs Base | **RESOLVED** (in sync with base; `files.watcherExclude` and title buttons preserved) |
| `packages/kilo-jetbrains/gradle.properties` | Plugin Config | Checked vs Base | **RESOLVED** (in sync with base; version 7.0.14) |
| `packages/kilo-jetbrains/CHANGELOG.md` | Release Notes | Checked vs Base | **RESOLVED** (in sync with base; 7.0.14 release notes preserved) |
| `nix/hashes.json` | Nix Infrastructure | Checked vs Base | Validated (updated platform `nodeModules` hashes) |
| `.opencode-version` | Version Metadata | Modified | Validated (bumped `v1.18.13` -> `v1.18.15`) |
| `.changeset/opencode-v1-18-14-to-v1-18-15.md` | Changesets | Added | Validated (patch releases for `@kilocode/cli` and `kilo-code`) |

---

## Findings

### Finding 1: Root `package.json` `scripts.dev` Overwritten by Upstream Default (HIGH - Open Regression)
- **Severity:** High
- **Status:** **OPEN REGRESSION**
- **Description:** In Kilo base (`aca225fcfd`) and `origin/main`, the root `dev` script is:
  ```json
  "dev": "KILO_CLIENT=cli bun run --cwd packages/opencode --conditions=node src/index.ts"
  ```
  In HEAD (`6d8876045d`), upstream OpenCode's default script is still present:
  ```json
  "dev": "bun run --cwd packages/opencode --conditions=browser src/index.ts"
  ```
- **Impact:** Omits the mandatory `KILO_CLIENT=cli` environment variable and switches execution conditions from `--conditions=node` to `--conditions=browser`, changing runtime behavior and feature flags for local CLI development.
- **Action Required:** Restore Kilo's dev command in root `package.json`.

### Finding 2: Base Branch Lag Reconciled via Merge Commit `6d8876045d` (RESOLVED - Round 2 High Finding)
- **Severity:** Informational / Resolved
- **Status:** **RESOLVED**
- **Verification Details:**
  - Commit `6d8876045d` merged `origin/johnnyeric/kilo-opencode-v1.18.13` (`aca225fcfd`) into the PR branch.
  - Diff comparison against base branch confirms exact reconciliation across all previously lagged areas:
    - Slash command management endpoints (`/kilocode/command/files`, `/kilocode/command/remove`) and OpenAPI types in `packages/sdk/openapi.json` and `packages/sdk/js/src/v2/gen/*`.
    - Terminal initial sizing (`size: { rows, cols }` in `packages/schema/src/pty.ts`, `packages/client/`, `packages/sdk/`).
    - JetBrains plugin version `7.0.14` in `gradle.properties` and release notes in `CHANGELOG.md`.
    - VS Code `files.watcherExclude` for worktrees in `packages/kilo-vscode/package.json`.
    - VS Code title bar and secondary sidebar button configuration.

### Finding 3: Upstream Transform `remove-kilo-web.ts` and `kilo web` CLI Omission Restored (RESOLVED - Round 2 High Finding)
- **Severity:** Informational / Resolved
- **Status:** **RESOLVED**
- **Verification Details:**
  - `script/upstream/transforms/remove-kilo-web.ts` and `script/upstream/transforms/remove-kilo-web.test.ts` have been restored.
  - `script/upstream/merge.ts` includes `transformKiloWeb` in the transform pipeline.
  - `packages/opencode/src/cli/cmd/web.ts` was deleted in commit `6d8876045d`.
  - `packages/opencode/src/index.ts` retains `kilocode_change` omission comments (lines 25, 109) and does not register `WebCommand`.
  - `bun test ./script` executes all 62 script unit tests across 11 files with 0 failures (including `remove-kilo-web.test.ts`).

### Finding 4: Missing `"check:architecture"` Script in Root `package.json` Added (RESOLVED - Round 2 Medium Finding)
- **Severity:** Informational / Resolved
- **Status:** **RESOLVED**
- **Verification Details:**
  - Commit `c24adedfa1` added `"check:architecture": "bun run script/check-architecture.ts"` to `scripts` in root `package.json`.
  - `bun run check:architecture` and `bun run script/check-architecture.ts` execute cleanly and output:
    `check-architecture: ok (12 classified Kilo ratchet sites, 0 boundary violations).`

### Finding 5: Malformed `@ai-sdk/openai-compatible` Patch Defect Successfully Resolved (RESOLVED - Round 1 Critical Finding)
- **Severity:** Informational / Resolved
- **Status:** **RESOLVED**
- **Verification Details:**
  - `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` is registered in `package.json` and `bun.lock`.
  - The patch applies cleanly to resolved workspace version `2.0.48` in `node_modules` with valid syntax in `dist/index.mjs`, `dist/index.js`, and TypeScript sources.
  - `bun test ./test/plugin/xai.test.ts` passes with 26/26 tests succeeding.
  - `./script/generate.ts` runs to completion with 0 errors.

### Finding 6: CI Workflow & Architecture Guard Synchronization from `main` (VALIDATED)
- **Severity:** Informational / Validated
- **Status:** **VALIDATED**
- **Description:** `.github/workflows/check-opencode-annotations.yml`, `script/check-architecture.ts`, and `script/architecture-allowlist.json` match `origin/main`.
- **Verification:** `bun run script/check-architecture.ts` reports 12 classified ratchet sites and 0 boundary violations.

### Finding 7: CI Annotations Guard Upstream Merge Detection Enhanced (VALIDATED)
- **Severity:** Informational / Validated
- **Status:** **VALIDATED**
- **Description:** `script/check-opencode-annotations.ts` detects upstream merge commit subjects (including `merge: record upstream`, `merge branch 'johnnyeric/opencode'`, and compound merge subjects).
- **Verification:** `bun run script/check-opencode-annotations.ts` correctly detects upstream merge context and exits cleanly without false positive failures.

### Finding 8: Model Tool Network MCP Boundary Guard Pattern Modernized (VALIDATED)
- **Severity:** Informational / Validated
- **Status:** **VALIDATED**
- **Description:** `script/check-model-tool-network.ts` regex was adjusted to `SandboxPolicy\.executeMcp\(\s*ctx\.sessionID,\s*(?:item|entry),/`.
- **Verification:** `bun run script/check-model-tool-network.ts` verified 4 classified client sites.

### Finding 9: Node Build Define Added in `packages/opencode/script/build-node.ts` (VALIDATED)
- **Severity:** Informational / Validated
- **Status:** **VALIDATED**
- **Description:** `KILO_VERSION: `'${Script.version}'`, // kilocode_change` is present in `packages/opencode/script/build-node.ts` to define the version for the node bundle.

### Finding 10: Nix Platform Hashes and Changeset Reconciled (VALIDATED)
- **Severity:** Informational / Validated
- **Status:** **VALIDATED**
- **Description:** `nix/hashes.json` has updated `nodeModules` hashes for Linux and macOS architectures. `.changeset/opencode-v1-18-14-to-v1-18-15.md` declares patch bumps for `@kilocode/cli` and `kilo-code`.

---

## Notable Non-Findings

- **GitHub Actions Workflows (`.github/workflows/*`):** Zero workflow differences relative to base branch `aca225fcfd`. `bun run script/check-workflows.ts` confirmed all 29 workflows match the repository allowlist.
- **Forbidden Markers:** `bun run --cwd packages/kilo-vscode check-kilocode-change` passed with 0 violations across `packages/kilo-vscode` and `packages/kilo-ui`.
- **Markdown Table Padding:** `bun run script/check-md-table-padding.ts` verified 405 markdown files with 0 padded table violations.
- **Docker / Issue & PR Templates:** No Dockerfiles or issue/PR templates were added, removed, or altered.
- **Workflow Security / Secrets:** No changes to token usage, permissions blocks, or release credential piping.
- **Typechecks & Linters:**
  - `packages/opencode`: `tsgo --noEmit` passed with exit code 0.
  - `packages/kilo-vscode`: `check-types` and `check-types:webview` passed with exit code 0.
  - `packages/kilo-vscode`: ESLint passed with exit code 0.
  - Root: `oxlint` passed with 0 errors across 5,299 files.

---

## Command Outputs

| Command | Working Directory | Result / Output |
|---|---|---|
| `./script/generate.ts` | Root | **PASSED** (OpenAPI schema generated, TypeScript SDK generated in `packages/sdk/js/src/v2/gen/`, docs generated) |
| `bun test ./test/plugin/xai.test.ts` | `packages/opencode` | **PASSED** (26 pass, 0 fail, 105 expect calls across 1 file in 3.03s) |
| `bun test ./test/session/retry.test.ts ./test/acp/usage.test.ts ./test/kilocode/command-files.test.ts` | `packages/opencode` | **PASSED** (66 pass, 0 fail, 91 expect calls across 3 files in 10.51s) |
| `bun test ./script` | Root | **PASSED** (62 pass, 0 fail, 149 expect calls across 11 files in 3.89s) |
| `bun run script/check-workflows.ts` | Root | `check-workflows: ok (29 workflows).` |
| `bun run script/check-architecture.ts` | Root | `check-architecture: ok (12 classified Kilo ratchet sites, 0 boundary violations).` |
| `bun run script/check-model-tool-network.ts` | Root | `check-model-tool-network: 4 classified client site(s), policy-aware tool and MCP boundaries verified.` |
| `bun run script/check-opencode-annotations.ts` | Root | `Skipping shared upstream annotation check — upstream merge detected.` |
| `bun run script/check-md-table-padding.ts` | Root | `check-md-table-padding: 405 file(s) checked, no padded tables found.` |
| `bun run --cwd packages/kilo-vscode check-kilocode-change` | Root | `0 violations` |
| `bun run --cwd packages/opencode typecheck` | `packages/opencode` | `$ tsgo --noEmit` (Passed, exit 0) |
| `bun run --cwd packages/kilo-vscode typecheck` | `packages/kilo-vscode` | `check-types: Done in 1.48s`, `check-types:webview: Done in 2.21s` (Passed, exit 0) |
| `bun run --cwd packages/kilo-vscode lint` | `packages/kilo-vscode` | `$ eslint ...` (Passed, exit 0) |
| `bun run lint` | Root | Oxlint passed (0 errors, 9038 warnings across 5299 files in 47.8s) |
| `git diff aca225fcfd2ad5146f142a5d582f62c1dff12c35 6d8876045d4cf06272cfb355f2b18c74cdf3e967 -- .github/` | Root | Empty (0 workflow differences vs base) |

---

## Limitations

1. **Monorepo Test Concurrency:** Full bulk execution of the complete `packages/opencode` test suite without concurrency isolation encounters git snapshot locking timeouts on macOS temp files; targeted test suites (`retry.test.ts`, `usage.test.ts`, `command-files.test.ts`, `xai.test.ts`, `test-runner-cleanup.test.ts`, `./script/*`) were executed to verify core infrastructure paths.
2. **Annotation Guard Upstream Bypass:** `script/check-opencode-annotations.ts` intentionally bypasses verification when an upstream merge commit is detected, requiring manual audit of `kilocode_change` annotations in modified shared files.
