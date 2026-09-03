# Infrastructure Change Review (Round 2): OpenCode v1.18.14..v1.18.15 Merge (PR #13002)

## Scope and Methodology

This review evaluates infrastructure, build, CI/CD, packaging, and repository automation changes in PR [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) (merging OpenCode `v1.18.14..v1.18.15` into Kilo).

### Audit Range
- **Base Branch:** `origin/johnnyeric/kilo-opencode-v1.18.13` (`4bb1c2a45b977e64c1b208c3f317de58c8e1dcbb`)
- **PR Branch Head:** `origin/johnnyeric/kilo-opencode-v1.18.15` (`db7c9eb7ebe652b897c3ca5e8e76b06d25175024`)
- **Main Reference:** `origin/main` (`4f59fcb666e9d4206ca7839cc9d9c3ee99a81885`)

### Round 2 Review Objectives
1. **Critical Defect Verification:** Confirm whether Round 1 Critical Finding 1 (malformed `@ai-sdk/openai-compatible@2.0.41.patch` corrupting `node_modules` syntax on resolved `2.0.48`) is fully resolved by the introduction of `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` in commit `d2b37efbe5`.
2. **Review-Driven Commits Audit:** Review all new commits added during Round 2 review iterations:
   - `1fb16a5c1f`: `ci: sync architecture check scripts and workflow from main`
   - `d808dd5743`: `fix(ci): recognize merge branch commit in check-opencode-annotations and respect blockRetry in retryable`
   - `d2b37efbe5`: `fix(review): add patch for @ai-sdk/openai-compatible@2.0.48 and bound ACP connection wait`
   - `db7c9eb7eb`: `fix(review): bound proxy 5xx error body buffering by character budget`
3. **Infrastructure Area Scan:** Comprehensive audit of GitHub Actions workflows, CI guard scripts, package manager and patch manifests, build/dev scripts, generated SDK/OpenAPI schemas, and repository upstream merge automation.
4. **Execution & Reproducibility:** Execute SDK generation (`./script/generate.ts`), CI guards (`check-workflows.ts`, `check-architecture.ts`, `check-model-tool-network.ts`, `check-opencode-annotations.ts`, `check-md-table-padding.ts`, `check-kilocode-change`), typechecks, linters, and unit test suites.

---

## Infrastructure-Relevant Files

| File | Area | Change Type | Round 2 Status |
|---|---|---|---|
| `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` | Package Patches | Added | **RESOLVED** (cleanly patches resolved version 2.0.48) |
| `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` | Package Patches | Added | Retained for transitive 2.0.41 dependencies |
| `package.json` (root) | Workspace Config | Modified | **REGRESSION** (`scripts.dev` overwritten by upstream; `check:architecture` omitted) |
| `bun.lock` | Lockfile | Modified | Validated (registered `2.0.48` patch and updated transitive packages) |
| `.github/workflows/check-opencode-annotations.yml` | CI Workflows | Modified | Validated (synced architecture guard step from `main`) |
| `script/check-architecture.ts` | CI Guards | Added (from `main`) | Validated (12 ratchet sites, 0 boundary violations) |
| `script/architecture-allowlist.json` | CI Guards | Added (from `main`) | Validated (contains domain classification allowlists) |
| `script/check-opencode-annotations.ts` | CI Guards | Modified | Validated (expanded upstream merge commit recognition) |
| `script/check-model-tool-network.ts` | CI Guards | Modified | Validated (regex updated for session-aware `executeMcp`) |
| `script/check-workflows.ts` | CI Guards | Checked | Validated (29 workflows match allowlist) |
| `script/upstream/transforms/remove-kilo-web.ts` | Repo Automation | Deleted | **REGRESSION** (automation deleted; `kilo web` restored in CLI) |
| `script/upstream/transforms/remove-kilo-web.test.ts` | Repo Automation | Deleted | **REGRESSION** (transform tests deleted) |
| `script/upstream/merge.ts` | Repo Automation | Modified | **REGRESSION** (`transformKiloWeb` step removed) |
| `script/upstream/utils/config.ts` | Repo Automation | Modified | **REGRESSION** (`skipFiles` entry for `web.ts` removed) |
| `script/upstream/utils/upstream.ts` | Repo Automation | Modified | **REGRESSION** (`removeKiloWeb` invocation removed) |
| `script/upstream/index.ts` | Repo Automation | Modified | **REGRESSION** (transform exports removed) |
| `script/upstream/README.md` | Repo Automation | Modified | Validated (docs reflect current transforms) |
| `packages/opencode/script/build-node.ts` | Build Scripts | Modified | Validated (`KILO_VERSION` define added) |
| `packages/opencode/script/build.ts` | Build Scripts | Modified | Validated (Kilo sandbox workers bundling adapted) |
| `packages/opencode/script/generate.ts` | Code Generation | Modified | Validated (models snapshot generator operational) |
| `packages/opencode/script/kilocode/test-cli.ts` | Test Scripts | Modified | Validated (test CLI bundle generator functional) |
| `packages/opencode/script/test-runner.ts` | Test Scripts | Modified | Validated (isolated temp test directory runner) |
| `packages/sdk/openapi.json` | API Schema | Modified | **BASE LAG** (command files & PTY size endpoints lagged behind base) |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | Generated SDK | Modified | **BASE LAG** (command files & PTY size methods lagged behind base) |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Generated SDK | Modified | **BASE LAG** (command files & PTY size types lagged behind base) |
| `packages/sdk-next/package.json` | Package Config | Modified | Validated (script order normalization) |
| `packages/kilo-vscode/package.json` | Package Config | Modified | **BASE LAG** (`files.watcherExclude` & title bar buttons lagged behind base) |
| `packages/kilo-jetbrains/gradle.properties` | Plugin Config | Modified | **BASE LAG** (version 7.0.13 vs base 7.0.14) |
| `packages/kilo-jetbrains/CHANGELOG.md` | Release Notes | Modified | **BASE LAG** (7.0.14 release notes lagged behind base) |
| `nix/hashes.json` | Nix Infrastructure | Modified | Validated (updated platform `nodeModules` hashes) |
| `.opencode-version` | Version Metadata | Modified | Validated (bumped `v1.18.13` -> `v1.18.15`) |
| `.changeset/opencode-v1-18-14-to-v1-18-15.md` | Changesets | Added | Validated (patch releases for `@kilocode/cli` and `kilo-code`) |

---

## Findings

### Finding 1: Malformed `@ai-sdk/openai-compatible` Patch Defect Successfully Resolved (RESOLVED - Round 1 Critical Finding)
- **Severity:** Informational / Resolved
- **Status:** **RESOLVED**
- **Verification Details:**
  - In Round 1, upstream PR #40718 added `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` to pass `chunk.value.error`. When Bun applied this patch to the resolved workspace package version `2.0.48`, fuzzy patching produced malformed JavaScript (`error: chunk.value.error.message` followed immediately by `error: chunk.value.error` without a comma or closing brace).
  - In commit `d2b37efbe5`, `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` was created and added to `patchedDependencies` in `package.json` and `bun.lock`.
  - Inspection of `node_modules/.bun/@ai-sdk+openai-compatible@2.0.48+d6123d32214422cb/.../dist/index.mjs` and `dist/index.js` confirms exact and valid syntax:
    ```javascript
    if ("error" in chunk.value) {
      finishReason = { unified: "error", raw: void 0 };
      controller.enqueue({
        type: "error",
        error: chunk.value.error
      });
      return;
    }
    ```
  - **Execution Proof:** `./script/generate.ts` and `bun test ./test/plugin/xai.test.ts` now execute and pass with 0 errors (26/26 tests passed).

### Finding 2: Root `package.json` `scripts.dev` Overwritten by Upstream Default (HIGH - Unresolved)
- **Severity:** High
- **Status:** **OPEN REGRESSION**
- **Description:** On Kilo base (`4bb1c2a45b`) and `origin/main`, the root `dev` script is:
  ```json
  "dev": "KILO_CLIENT=cli bun run --cwd packages/opencode --conditions=node src/index.ts"
  ```
  In HEAD (`package.json`), upstream OpenCode's default script is still present:
  ```json
  "dev": "bun run --cwd packages/opencode --conditions=browser src/index.ts"
  ```
- **Impact:** Omits the mandatory `KILO_CLIENT=cli` environment variable and switches execution conditions from `--conditions=node` to `--conditions=browser`, changing runtime behavior and feature flags for local CLI development.
- **Action Required:** Restore Kilo's dev command in root `package.json`.

### Finding 3: Missing `"check:architecture"` Script in Root `package.json` (MEDIUM - New Finding in Round 2)
- **Severity:** Medium
- **Status:** **OPEN**
- **Description:** Commit `1fb16a5c1f` properly synced `script/check-architecture.ts`, `script/architecture-allowlist.json`, and `.github/workflows/check-opencode-annotations.yml` from `main`. However, the corresponding convenience script `"check:architecture": "bun run script/check-architecture.ts"` was omitted from `package.json` `scripts`.
- **Impact:** Developers running `bun run check:architecture` will encounter an unrecognized script error unless running via full file path.
- **Action Required:** Add `"check:architecture": "bun run script/check-architecture.ts"` to `scripts` in root `package.json`.

### Finding 4: Deletion of Upstream Transform `remove-kilo-web.ts` and Silent Restoration of Unsupported `kilo web` Command (HIGH - Unresolved)
- **Severity:** High
- **Status:** **OPEN REGRESSION**
- **Description:** Kilo explicitly removed upstream's unsupported `kilo web` CLI command (PR #12978 / commit `1406d719e3`) and created the repo transform `script/upstream/transforms/remove-kilo-web.ts` (commit `7f1b402587`) to guarantee future merges would omit `WebCommand`.
- In this PR, because the merge branch diverged before those commits reached the merge branch, the merge commit:
  1. Deleted `script/upstream/transforms/remove-kilo-web.ts` and `remove-kilo-web.test.ts`.
  2. Removed `transformKiloWeb` from `script/upstream/merge.ts`, `utils/config.ts`, `utils/upstream.ts`, and `index.ts`.
  3. Re-introduced `packages/opencode/src/cli/cmd/web.ts` and registered `WebCommand` in `packages/opencode/src/index.ts`.
- **Impact:** Re-introduces the unsupported `kilo web` command into the CLI binary and removes the repo automation protecting future merges.
- **Action Required:** Restore `script/upstream/transforms/remove-kilo-web.ts`, restore `script/upstream/merge.ts` hooks, delete `packages/opencode/src/cli/cmd/web.ts`, and reinstate the `kilocode_change` omission comments in `packages/opencode/src/index.ts`.

### Finding 5: Base Branch Lag Reverts Slash Command Endpoint Infrastructure, Initial PTY Sizing, and JetBrains 7.0.14 Release (HIGH - Base Reconciliation Pending)
- **Severity:** High
- **Status:** **PENDING MERGE BASE RECONCILIATION**
- **Description:** The merge branch diverged from base before several PRs merged into `origin/johnnyeric/kilo-opencode-v1.18.13` and `origin/main`:
  - Slash command management endpoints (`/kilocode/command/files`, `/kilocode/command/remove`, and OpenAPI types in `packages/sdk/openapi.json` and `packages/sdk/js/src/v2/gen/*`).
  - Terminal initial dimensions support (`size: { rows, cols }` in `packages/schema/src/pty.ts`, `packages/client/`, `packages/sdk/`).
  - JetBrains plugin version bump to `7.0.14` and CHANGELOG entry.
  - VS Code `files.watcherExclude` for worktrees in `packages/kilo-vscode/package.json`.
  - VS Code title bar / secondary sidebar button cleanup.
- **Action Required:** Merge or rebase the latest base branch (`origin/johnnyeric/kilo-opencode-v1.18.13`) into the PR branch prior to final merge.

### Finding 6: CI Workflow & Architecture Guard Synchronization from `main` (VALIDATED - Added in Round 2)
- **Severity:** Informational / Validated
- **Description:** Commit `1fb16a5c1f` synchronized the architecture check step in `.github/workflows/check-opencode-annotations.yml` as well as `script/check-architecture.ts` and `script/architecture-allowlist.json`.
- **Verification:** `bun run script/check-architecture.ts` passed with `ok (12 classified Kilo ratchet sites, 0 boundary violations)`.

### Finding 7: CI Annotations Guard Upstream Merge Detection Enhanced (VALIDATED - Added in Round 2)
- **Severity:** Informational / Validated
- **Description:** Commit `d808dd5743` updated `isUpstreamMerge()` in `script/check-opencode-annotations.ts` to recognize additional merge commit message patterns including `merge: record upstream`, `merge branch 'johnnyeric/opencode`, and any subject containing both `merge` and `opencode`.
- **Verification:** `bun run script/check-opencode-annotations.ts` correctly detects upstream merge context and safely executes.

### Finding 8: Model Tool Network MCP Boundary Guard Pattern Modernized (VALIDATED)
- **Severity:** Informational / Validated
- **Description:** `script/check-model-tool-network.ts` regex was adjusted to `SandboxPolicy\.executeMcp\(\s*ctx\.sessionID,\s*(?:item|entry),/` to match both variable naming conventions.
- **Verification:** `bun run script/check-model-tool-network.ts` passed with 4 classified client sites verified.

### Finding 9: Nix Platform Hashes Updated in `nix/hashes.json` (VALIDATED)
- **Severity:** Informational / Validated
- **Description:** Upstream commit `b1f8cc04af` updated platform `nodeModules` SHA-256 hashes in `nix/hashes.json` across all supported Linux and macOS architectures (`x86_64-linux`, `aarch64-linux`, `aarch64-darwin`, `x86_64-darwin`).

### Finding 10: Changeset Reconciled for OpenCode v1.18.14..v1.18.15 (VALIDATED)
- **Severity:** Informational / Validated
- **Description:** Added `.changeset/opencode-v1-18-14-to-v1-18-15.md` declaring patch release bumps for `@kilocode/cli` and `kilo-code`. Older changesets from base branch were removed/consumed.

---

## Notable Non-Findings

- **GitHub Actions Workflows (`.github/workflows/*`):** Zero workflow regressions or unexpected file changes relative to base. `bun run script/check-workflows.ts` confirmed all 29 workflows match the repository allowlist.
- **Forbidden Markers:** `bun run --cwd packages/kilo-vscode check-kilocode-change` passed with 0 violations across `packages/kilo-vscode` and `packages/kilo-ui`.
- **Markdown Table Padding:** `bun run script/check-md-table-padding.ts` verified 399 markdown files with 0 padded table violations.
- **Docker / Containers / Issue & PR Templates:** No Dockerfiles or issue/PR templates were added, removed, or altered.
- **Workflow Security / Permissions:** No changes to token scoping, permissions blocks, or release credential piping.
- **Typechecks & Linters:**
  - `packages/opencode`: `tsgo --noEmit` passed with exit code 0.
  - `packages/kilo-vscode`: `check-types` and `check-types:webview` passed with exit code 0.
  - `packages/kilo-vscode`: ESLint passed with exit code 0.
  - Root: `oxlint` passed with 0 errors across 5,271 files.

---

## Command Outputs

| Command | Working Directory | Result / Output |
|---|---|---|
| `./script/generate.ts` | Root | **PASSED** (Exit 0; OpenAPI schema generated, TypeScript SDK types generated in `packages/sdk/js/src/v2/gen/`, docs generated) |
| `bun test ./test/plugin/xai.test.ts` | `packages/opencode` | **PASSED** (26 pass, 0 fail, 105 expect calls across 1 file) |
| `bun test ./test/session/retry.test.ts ./test/acp/usage.test.ts` | `packages/opencode` | **PASSED** (61 pass, 0 fail, 77 expect calls across 2 files) |
| `bun test ./script` | Root | **PASSED** (58 pass, 0 fail, 145 expect calls across 10 files) |
| `bun run script/check-workflows.ts` | Root | `check-workflows: ok (29 workflows).` |
| `bun run script/check-architecture.ts` | Root | `check-architecture: ok (12 classified Kilo ratchet sites, 0 boundary violations).` |
| `bun run script/check-model-tool-network.ts` | Root | `check-model-tool-network: 4 classified client site(s), policy-aware tool and MCP boundaries verified.` |
| `bun run script/check-opencode-annotations.ts` | Root | `Skipping shared upstream annotation check — upstream merge detected.` |
| `bun run script/check-md-table-padding.ts` | Root | `check-md-table-padding: 399 file(s) checked, no padded tables found.` |
| `bun run --cwd packages/kilo-vscode check-kilocode-change` | Root | `0 violations` |
| `bun run --cwd packages/opencode typecheck` | `packages/opencode` | `$ tsgo --noEmit` (Passed, exit 0) |
| `bun run --cwd packages/kilo-vscode typecheck` | `packages/kilo-vscode` | `check-types: Done in 1.79s`, `check-types:webview: Done in 2.76s` (Passed, exit 0) |
| `bun run --cwd packages/kilo-vscode lint` | `packages/kilo-vscode` | `$ eslint ...` (Passed, exit 0) |
| `git diff 4bb1c2a45b977e64c1b208c3f317de58c8e1dcbb db7c9eb7ebe652b897c3ca5e8e76b06d25175024 -- .github/` | Root | Empty (0 workflow differences vs base) |

---

## Limitations

1. **Monorepo Test Concurrency:** Full bulk execution of the complete `packages/opencode` test suite without concurrency isolation encounters git snapshot locking timeouts on macOS temp files; targeted test runs (`retry.test.ts`, `usage.test.ts`, `tool-define.test.ts`, `xai.test.ts`, `test-runner-cleanup.test.ts`) were executed to verify core infrastructure paths.
2. **Annotation Guard Upstream Bypass:** `script/check-opencode-annotations.ts` intentionally bypasses verification when an upstream merge commit is detected, requiring manual audit of `kilocode_change` annotations in modified shared files.
3. **Base Branch Synchronization:** Differences arising from base branch lag (slash command management endpoints, initial PTY sizing, JetBrains 7.0.14 version/notes) will resolve upon rebasing/merging the latest `origin/johnnyeric/kilo-opencode-v1.18.13` base branch into the PR branch.
