# Infrastructure Change Review: OpenCode v1.17.5

## Scope and Methodology

Reviewed the PR range `origin/main...HEAD` for infrastructure that Kilo must own: CI/workflows, release and publishing automation, root/workspace dependency configuration, patches, and generated SDK automation. Compared ambiguous changes with the provided pristine OpenCode v1.17.5 worktree (`.worktrees/opencode-merge/opencode`) and Kilo base worktree (`.worktrees/opencode-merge/kilo-main`). No source files were modified as part of this review.

## Findings

### High: The merge disables CI tests for six non-CLI packages

**Files:**

- `packages/core/package.json`
- `packages/effect-drizzle-sqlite/package.json`
- `packages/http-recorder/package.json`
- `packages/llm/package.json`
- `packages/tui/package.json`
- `packages/ui/package.json`

The merge removes the Kilo-specific `test:ci` script from all six packages. The removal is upstream-sourced: every script is absent in the pristine OpenCode v1.17.5 worktree, while Kilo base defines each script with a JUnit reporter and `.artifacts/unit/junit.xml` output.

Kilo's unchanged `.github/workflows/test.yml` still runs `bun turbo test:ci --filter='!@kilocode/cli' --filter='!@kilocode/kilo-jetbrains'` and publishes `packages/*/.artifacts/unit/junit.xml`. `turbo.json` defines a generic `test:ci` task but does not supply commands, so the missing package scripts are silently scheduled as `<NONEXISTENT>` rather than failing the workflow. The verified `bun turbo test:ci --filter=@opencode-ai/core` run reported `Tasks: 0 successful, 0 total` and `WARNING No tasks were executed`.

This drops test execution and JUnit artifacts for all six packages from Kilo's non-CLI CI job. Restore the Kilo `test:ci` scripts, or intentionally redesign `.github/workflows/test.yml` and `turbo.json` to run and report the replacement test commands.

### High: Kilo's `dev:local` root entrypoint was removed

**File:** `package.json`

The merge removes:

```json
"dev:local": "bun run packages/opencode/script/dev-local.ts"
```

This is a Kilo-specific entrypoint. The target `packages/opencode/script/dev-local.ts` exists in Kilo base and final HEAD, but does not exist in the pristine OpenCode worktree. `bun run dev:local --help` now fails with `error: Script not found "dev:local"`. The script transform preserves selected Kilo root scripts, but its `PRESERVE_SCRIPTS["package.json"]` allowlist does not include `dev:local`, which explains the drop during the upstream-shaped merge.

Restore the script and add it to `script/upstream/transforms/transform-package-json.ts`'s preserved root scripts so a future merge cannot drop it again.

### Medium: The merge re-authorizes an unused native lifecycle build

**Files:** `package.json`, `bun.lock`

`tree-sitter-powershell` was added to root `trustedDependencies`, making Bun run its native `node-gyp-build` lifecycle action during install. This matches pristine upstream v1.17.5, but conflicts with Kilo's existing decision: retain this dependency for its WASM grammar while not permitting its unused native build, avoiding a root `node-gyp` requirement.

Final source uses `tree-sitter-powershell/tree-sitter-powershell.wasm` from `packages/opencode/src/tool/shell.ts`; no native module import was found. Remove `tree-sitter-powershell` from root `trustedDependencies` and regenerate `bun.lock`, unless Kilo intentionally changes the native-build policy.

### Needs Human Verification: Upstream turns `@opencode-ai/http-recorder` into a public package

**File:** `packages/http-recorder/package.json`

The merge removes `private: true` and adds `publishConfig.access: public`. This exactly matches the pristine upstream package and is therefore upstream-sourced, not an accidental Kilo conflict resolution. Kilo's root `script/publish.ts` versions every package manifest, but only explicitly publishes the CLI, SDK, plugin, and VS Code extension; the reviewed workflow does not show a dedicated `http-recorder` publication step.

No immediate automatic publish path was established from the checked release scripts, but this changes package policy and allows a future publication command to publish `@opencode-ai/http-recorder` publicly. Retain it only if Kilo intends to support that public package; otherwise restore `private: true` and remove `publishConfig`.

## Accepted / Coherent Infrastructure Changes

### Root patch map, lockfile, and MCP session-recovery patch

**Files:** `package.json`, `bun.lock`, `patches/@modelcontextprotocol%2Fsdk@1.29.0.patch`

The patch map is coherent with the final dependency graph:

- Stale upstream entries are absent: `@ff-labs/fff-bun@0.9.3`, `pacote@21.5.0`, `@ai-sdk/xai@3.0.82`, and `gcp-metadata@8.1.2`.
- Kilo's retained current replacements are present and locked: `@ff-labs/fff-bun@0.9.4`, `pacote@21.5.1`, and `@ai-sdk/xai@3.0.92`.
- `@modelcontextprotocol/sdk@1.29.0` is present in `packages/opencode/package.json`, the root patch map, and `bun.lock`.
- All 11 declared `patchedDependencies` files exist.
- The new MCP patch is byte-identical to the pristine upstream v1.17.5 patch (SHA-256 `5523454ba911504128126cca0b929f2a8f95597a3a2ac88d1d026d2892f465c7`).

This is an upstream-sourced dependency and generated-lock update, with Kilo's current-version patch replacements preserved. No action identified.

### Generated SDK artifacts

**Files:** `packages/sdk/openapi.json`, `packages/sdk/js/src/v2/gen/sdk.gen.ts`, `packages/sdk/js/src/v2/gen/types.gen.ts`

Only the OpenAPI document and generated v2 SDK outputs changed in the final PR. `script/generate.ts`, `packages/sdk/js/script/build.ts`, `packages/sdk/js/script/publish.ts`, and `packages/sdk/js/package.json` are unchanged from `origin/main...HEAD`. The final artifacts are consistent with the upstream API changes without replacing Kilo's SDK build/publish automation. No action identified.

## Notable Non-Findings

- No `.github/workflows/` or `.github/actions/` files changed. `bun run script/check-workflows.ts` passed with `check-workflows: ok (27 workflows)`, so the hardcoded workflow allowlist remains synchronized.
- No CI configuration, Docker file, `turbo.json`, `bunfig.toml`, Husky configuration, `script/check-*.ts` guard, `script/upstream/` transform, release script, publishing workflow, or `.changeset/` file changed in the PR range.
- No Kilo-specific workflow jobs or steps were dropped as a file diff. The CI coverage regression above results from package script removal against Kilo's unchanged workflow.
- `git diff --check origin/main...HEAD` reported no whitespace errors.

## Command Output Excerpts

```text
$ git diff --name-status origin/main...HEAD -- .github .changeset script Dockerfile docker-compose.yml turbo.json bunfig.toml .husky
(no output)

$ bun run script/check-workflows.ts
check-workflows: ok (27 workflows).
```

```text
$ bun turbo test:ci --filter=@opencode-ai/core
Packages in scope: @opencode-ai/core
Running test:ci in 1 packages
WARNING No tasks were executed as part of this run.
Tasks:    0 successful, 0 total
```

```text
$ bun run dev:local --help
error: Script not found "dev:local"
```

```text
$ patch-file verification
patched=11
missing=0
MCP patch byte-identical to pristine upstream: yes
```

## Limitations

- This review is static plus targeted command validation. It did not run the full CI matrix, install dependencies, build distributions, or publish packages.
- The provided upstream comparison worktree had unrelated local changes (`bun.lock` and `packages/opencode/.kilo/`); provenance comparisons were restricted to committed files and direct file content.
- Publication behavior was traced through the root publish script and `publish.yml`; external registry state and unpublished release tooling paths were not exercised.
