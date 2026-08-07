# Infrastructure Change Review: OpenCode v1.18.14..v1.18.15 Merge (PR #13002)

## Scope and Methodology

This review evaluates infrastructure, build, CI/CD, packaging, and repository automation changes introduced in PR [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) (merging OpenCode `v1.18.14..v1.18.15` into Kilo).

### Review Invariants
- **Preserve Kilo Infrastructure:** Merging upstream code must not overwrite Kilo-specific workflows, build scripts, development scripts, repository transforms, or package configurations.
- **Maintain Clean Automation:** CI guard scripts (`check-workflows.ts`, `check-opencode-annotations.ts`, `check-kilocode-change`) and SDK generator scripts (`generate.ts`, `build-node.ts`) must remain valid and operational.

### Methodology
1. **Provenance & Range Audit:** Compared base commit `b6505b164bee1acf20d5c33dbc052e8a60c464c0` (`origin/johnnyeric/kilo-opencode-v1.18.13`), HEAD commit `94fd41e3a2892ad667c890c2d995813aa706bdd0` (`origin/johnnyeric/kilo-opencode-v1.18.15`), merge base `0a96c10cb651ecdf9338342b52d93afb1c1b0022`, and `origin/main`.
2. **Infrastructure Area Scan:** Examined diffs across 9 infrastructure areas:
   - GitHub Actions workflows (`.github/workflows/*`)
   - CI configuration and checks (`script/check-*`, etc.)
   - Release and deployment automation (`script/publish*`, JetBrains release scripts, changelog generation)
   - Docker and build infrastructure (`nix/hashes.json`, `packages/opencode/script/build-node.ts`)
   - Package manager and workspace configs (root `package.json`, `bun.lock`, `patches/*`, package `package.json` files)
   - Repository automation (`script/upstream/*`, `script/setup-git.ts`)
   - Issue and PR templates (`.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`)
   - Changeset and version tracking (`.changeset/*`, `.opencode-version`)
   - Generated SDK and API Schema automation (`packages/sdk/`, `packages/sdk-next/`, `packages/opencode/src/kilocode/command-files.ts`)
3. **Execution Verification:** Ran CI guards, typechecks, linters, SDK generators, and test suites to verify reproducibility and discover hidden regressions.

---

## Infrastructure-Relevant Files

| File | Area | Change Type | Status |
|---|---|---|---|
| `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` | Package Patches | Added | **CRITICAL DEFECT** (corrupts `node_modules` syntax) |
| `package.json` (root) | Workspace Config | Modified | **REGRESSION** (`scripts.dev` overwritten by upstream) |
| `bun.lock` | Lockfile | Modified | Modified (patch added, `@vscode/codicons` removed) |
| `script/upstream/transforms/remove-kilo-web.ts` | Repo Automation | Deleted | **REGRESSION** (automation deleted; `kilo web` restored) |
| `script/upstream/transforms/remove-kilo-web.test.ts` | Repo Automation | Deleted | **REGRESSION** (tests deleted) |
| `script/upstream/merge.ts` | Repo Automation | Modified | **REGRESSION** (`transformKiloWeb` step removed) |
| `script/upstream/utils/config.ts` | Repo Automation | Modified | **REGRESSION** (`skipFiles` entry for `web.ts` removed) |
| `script/upstream/utils/upstream.ts` | Repo Automation | Modified | **REGRESSION** (`removeKiloWeb` transform removed) |
| `script/upstream/index.ts` | Repo Automation | Modified | **REGRESSION** (exports removed) |
| `script/upstream/README.md` | Repo Automation | Modified | Documentation updated |
| `packages/opencode/script/build-node.ts` | Build Scripts | Modified | Validated (`KILO_VERSION` define added) |
| `packages/sdk/openapi.json` | API Schema | Modified | **REGRESSION** (command-file endpoints removed via base lag) |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | Generated SDK | Modified | **REGRESSION** (command-file SDK methods removed via base lag) |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Generated SDK | Modified | **REGRESSION** (command-file types removed via base lag) |
| `packages/sdk-next/package.json` | Package Config | Modified | Non-functional (script ordering swap) |
| `packages/kilo-vscode/package.json` | Package Config | Modified | **REGRESSION** (`files.watcherExclude` dropped; old title buttons restored) |
| `packages/kilo-vscode/eslint.config.mjs` | Lint Config | Modified | Line cap comments adjusted |
| `packages/kilo-jetbrains/gradle.properties` | Plugin Config | Modified | **REGRESSION** (version reverted `7.0.14` -> `7.0.13`) |
| `packages/kilo-jetbrains/CHANGELOG.md` | Release Changelog | Modified | **REGRESSION** (7.0.14 notes dropped) |
| `nix/hashes.json` | Nix Infrastructure | Modified | Validated (updated platform `nodeModules` hashes) |
| `.opencode-version` | Version Metadata | Modified | Validated (bumped `v1.18.13` -> `v1.18.15`) |
| `.changeset/opencode-v1-18-14-to-v1-18-15.md` | Changesets | Added | Validated (declares patch bumps for `@kilocode/cli` and `kilo-code`) |
| `.opencode/skills/rtl-aware-development/SKILL.md` | Skills | Added | Validated (upstream skill imported) |
| `.kilo/plans/*.md` | Plans | Added | Multi-project handoff and gap plans |

---

## Findings

### Finding 1: Malformed `@ai-sdk/openai-compatible@2.0.41.patch` Corrupts Node Modules and Breaks Runtime, Tests, and SDK Generation (CRITICAL)
- **Severity:** Critical / Blocker
- **Description:** Upstream PR #40718 added `@ai-sdk/openai-compatible@2.0.41.patch` to pass `chunk.value.error` instead of `chunk.value.error.message`. However, the workspace dependency resolution in `bun.lock` resolves `@ai-sdk/openai-compatible` to version `2.0.48`.
- When Bun executes `bun install` or applies patched dependencies, fuzzy patch matching injects duplicate properties and drops a closing brace in `node_modules/@ai-sdk/openai-compatible/dist/index.mjs` around line 692:
  ```javascript
  if ("error" in chunk.value) {
    finishReason = { unified: "error", raw: void 0 };
    controller.enqueue({
      type: "error",
      error: chunk.value.error.message
      error: chunk.value.error
    return;
  }
  ```
- **Observed Failure:**
  - `./script/generate.ts` fails with:
    `error: Expected "}" but found "error" at node_modules/@ai-sdk/openai-compatible/dist/index.mjs:692:17`
  - `bun run dev` fails on startup.
  - `bun test` across CLI and VS Code unit test suites encounters unhandled errors and segfaults.
- **Action Required:** Regenerate the patch against the exact installed version (`2.0.48`), ensure valid JavaScript syntax in both `.js` and `.mjs` distribution files, and update the patch entry in root `package.json` and `bun.lock`.

### Finding 2: Root `package.json` `scripts.dev` Overwritten by Upstream Default (HIGH)
- **Severity:** High
- **Description:** In Kilo (`origin/main` and base `b6505b164b`), the root `dev` script is:
  ```json
  "dev": "KILO_CLIENT=cli bun run --cwd packages/opencode --conditions=node src/index.ts"
  ```
  In HEAD (`package.json`), upstream OpenCode's default script was taken:
  ```json
  "dev": "bun run --cwd packages/opencode --conditions=browser src/index.ts"
  ```
- **Impact:** Drops the `KILO_CLIENT=cli` environment variable and switches execution conditions from `--conditions=node` to `--conditions=browser`, altering runtime behavior and feature flags for local CLI development.
- **Action Required:** Restore Kilo's dev command: `"dev": "KILO_CLIENT=cli bun run --cwd packages/opencode --conditions=node src/index.ts"`.

### Finding 3: Deletion of Upstream Transform `remove-kilo-web.ts` and Silent Restoration of Unsupported `kilo web` Command (HIGH)
- **Severity:** High
- **Description:** Kilo explicitly removed upstream's unsupported `kilo web` CLI command (PR #12978 / commit `1406d719e3`) and created the repo transform `script/upstream/transforms/remove-kilo-web.ts` (commit `7f1b402587`) to guarantee future merges would omit `WebCommand`.
- In this PR, because the merge branch diverged before those commits reached the merge branch, the merge commit (`71bc00dd24`):
  1. Deleted `script/upstream/transforms/remove-kilo-web.ts` and `remove-kilo-web.test.ts`.
  2. Removed `transformKiloWeb` from `script/upstream/merge.ts`, `utils/config.ts`, `utils/upstream.ts`, and `index.ts`.
  3. Re-introduced `packages/opencode/src/cli/cmd/web.ts` and registered `WebCommand` in `packages/opencode/src/index.ts`.
- **Impact:** Re-introduces the unsupported `kilo web` command into the CLI binary and removes the repo automation protecting future merges.
- **Action Required:** Restore `script/upstream/transforms/remove-kilo-web.ts`, restore `script/upstream/merge.ts` hooks, delete `packages/opencode/src/cli/cmd/web.ts`, and reinstate the `kilocode_change` omission comments in `packages/opencode/src/index.ts`.

### Finding 4: Base Branch Lag Reverts Slash Command Endpoint Infrastructure and JetBrains 7.0.14 Release (HIGH)
- **Severity:** High
- **Description:** The merge branch `origin/johnnyeric/kilo-opencode-v1.18.15` diverged from base at commit `0a96c10cb6`. In the interim, base (`b6505b164bee1acf20d5c33dbc052e8a60c464c0`) merged several PRs from `origin/main`:
  - Slash command management endpoints (`/kilocode/command/files`, `/kilocode/command/remove`, and OpenAPI types in `packages/sdk/openapi.json` and `packages/sdk/js/src/v2/gen/*`).
  - JetBrains plugin version bump to `7.0.14` and CHANGELOG entry.
  - VS Code `files.watcherExclude` for worktrees in `packages/kilo-vscode/package.json`.
  - VS Code title bar / secondary sidebar button cleanup.
- In the diff between base and HEAD, these changes appear as deletions / regressions.
- **Action Required:** Rebase or merge the latest base branch (`origin/johnnyeric/kilo-opencode-v1.18.13` / `origin/main`) into the PR branch before merging to retain recent Kilo infrastructure changes.

### Finding 5: Node Build Define Added in `packages/opencode/script/build-node.ts` (VALIDATED)
- **Severity:** Low / Informational
- **Description:** Upstream commit `24470e52a5` added `OPENCODE_VERSION` to `build-node.ts`. Kilo properly adapted this in `packages/opencode/script/build-node.ts`:
  ```typescript
  KILO_VERSION: `'${Script.version}'`, // kilocode_change
  ```
- **Impact:** Injects `KILO_VERSION` into the bundle define map according to Kilo conventions.

### Finding 6: Nix Platform Hashes Updated in `nix/hashes.json` (VALIDATED)
- **Severity:** Low / Informational
- **Description:** Upstream commit `b1f8cc04af` updated nodeModules sha256 hashes across `x86_64-linux`, `aarch64-linux`, `aarch64-darwin`, and `x86_64-darwin`.
- **Impact:** Keeps Nix build hashes aligned with lockfile changes.

### Finding 7: Changeset Reconciled for OpenCode v1.18.14..v1.18.15 (VALIDATED)
- **Severity:** Low / Informational
- **Description:** Added `.changeset/opencode-v1-18-14-to-v1-18-15.md` declaring patch releases for `@kilocode/cli` and `kilo-code`. Older changesets from base branch were removed/consumed.

---

## Notable Non-Findings

- **GitHub Actions Workflows (`.github/workflows/*`):** No workflows were added, removed, or modified. `bun run script/check-workflows.ts` confirmed all 29 workflows match the allowlist.
- **Docker / Containers:** No Dockerfiles or container configuration files were added or modified.
- **Issue & PR Templates:** `.github/ISSUE_TEMPLATE/*` and `.github/PULL_REQUEST_TEMPLATE.md` remain unchanged.
- **Workflow Security / Secrets:** No changes to token usage, permissions blocks, or release credential piping.
- **Forbidden Markers:** `bun run --cwd packages/kilo-vscode check-kilocode-change` passed with 0 violations.

---

## Command Outputs

| Command | Working Directory | Result / Output |
|---|---|---|
| `git diff b6505b164bee1acf20d5c33dbc052e8a60c464c0..HEAD -- .github/` | Root | Empty (no workflow changes) |
| `bun run script/check-workflows.ts` | Root | `check-workflows: ok (29 workflows).` |
| `bun run script/check-opencode-annotations.ts` | Root | `Skipping shared upstream annotation check — upstream merge detected.` |
| `bun run --cwd packages/kilo-vscode check-kilocode-change` | Root | `0 violations` |
| `bun run --cwd packages/opencode typecheck` | `packages/opencode` | `$ tsgo --noEmit` (Passed, exit 0) |
| `bun run --cwd packages/kilo-vscode typecheck` | `packages/kilo-vscode` | `check-types: Done in 1.14s`, `check-types:webview: Done in 1.93s` (Passed, exit 0) |
| `bun run --cwd packages/kilo-vscode lint` | `packages/kilo-vscode` | `$ eslint ...` (Passed, exit 0) |
| `bun run lint` | Root | Oxlint passed (0 errors, 8982 warnings across 5271 files) |
| `./script/generate.ts` | Root | **FAILED**: `Expected "}" but found "error"` at `@ai-sdk/openai-compatible/dist/index.mjs:692:17` |
| `bun test ./test/plugin/xai.test.ts` | `packages/opencode` | **FAILED**: Unhandled error due to `@ai-sdk/openai-compatible` syntax corruption |

---

## Limitations

1. **SDK Regeneration Blocked:** End-to-end execution of `./script/generate.ts` could not verify OpenAPI and TypeScript SDK consistency because the syntax error in `@ai-sdk/openai-compatible` prevents the CLI binary from running `kilo generate`.
2. **Annotation Guard Inactive During Upstream Merge:** `script/check-opencode-annotations.ts` intentionally bypasses verification when an upstream merge is detected, so marker coverage on modified shared files requires manual audit.
