# Infrastructure Change Review

## Scope and methodology

Reviewed PR [#10822](https://github.com/Kilo-Org/kilocode/pull/10822) at snapshot `94fc42255c35827b197d97368d75d079242e9f4d` against PR base snapshot `2f7f23deac683078a350014ec8a1a946aae46ce4`. I inspected the changed-file inventory and focused diffs for GitHub Actions, CI configuration, release/deploy scripts, Docker/build infrastructure, package manager and workspace metadata, repository automation, issue templates, changelog automation, database migration infrastructure, and generated SDK/OpenAPI artifacts. I also compared relevant changes with the pristine upstream `v1.14.46` target at `d802b0a277f4e7f113b5efd8d5446fc1db22f4a4` in the read-only upstream reference checkout.

The reviewed PR changes 181 files overall. This report intentionally lists only infrastructure-relevant findings and notable non-findings, not an exhaustive per-file checklist.

## Findings requiring human confirmation

### 1. Workspace package metadata normalization was retained for Kilo-only packages

Files:

- `packages/kilo-console/package.json`
- `packages/kilo-web-ui/package.json`

Both Kilo-only package manifests gain an explicit empty `"peerDependencies": {}` object. These edits do not appear in the pristine upstream target because those packages are not present upstream. The changes are likely harmless workspace normalization from merge/package processing, but they are not required by the reviewed upstream release and should be confirmed as intentional before merge.

### 2. Root TUI fixture/config drops an explicit empty keybind map

File:

- `.opencode/tui.json`

The checked-in config changes from:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "keybinds": {}
}
```

to:

```json
{
  "$schema": "https://opencode.ai/tui.json"
}
```

This matches the pristine upstream target. It is not CI or deploy infrastructure, but it is repository-level configuration and may affect local/manual TUI defaults or fixtures. Confirm that removing the explicit empty keybind object is desired in Kilo.

### 3. Existing workspace database migration is changed in place

Files:

- `packages/opencode/migration/20260507164347_add_workspace_time/migration.sql`
- `packages/opencode/test/storage/workspace-time-migration.test.ts`
- `packages/opencode/src/storage/storage.ts`

The migration changes from `ALTER TABLE workspace ADD time_used integer NOT NULL;` to `ALTER TABLE workspace ADD time_used integer NOT NULL DEFAULT 0;`, with a new regression test covering migration of an existing workspace row. This matches pristine upstream `v1.14.46` and is an intentional upstream fix, but it changes persisted database migration behavior and should receive explicit human confirmation because existing installations depend on migration correctness.

### 4. SDK/OpenAPI generated artifacts changed substantially and should be regeneration-verified

Generated or schema-derived files:

- `packages/sdk/openapi.json`
- `packages/sdk/js/src/gen/types.gen.ts`
- `packages/sdk/js/src/v2/gen/sdk.gen.ts`
- `packages/sdk/js/src/v2/gen/types.gen.ts`

Related hand-written SDK client files:

- `packages/sdk/js/src/client.ts`
- `packages/sdk/js/src/v2/client.ts`
- `packages/sdk/js/src/error-interceptor.ts`

The SDK artifact diff is substantial: 7 changed files, 1,383 insertions, and 1,838 deletions. Endpoint/schema work in `packages/opencode/src/server/routes/instance/httpapi/**` explains generated OpenAPI and SDK churn. The new shared `wrapClientError` interceptor is hand-written, not generated, and is wired into both client versions.

This appears to be an intentional upstream generated-SDK update plus Kilo compatibility adjustments, not infrastructure drift. Human verification should still confirm that `./script/generate.ts` reproduces the checked-in SDK/OpenAPI outputs in the resolved Kilo tree and that no expected generated SDK surfaces were omitted.

### 5. Development type dependency was added to the CLI package and lockfile

Files:

- `packages/opencode/package.json`
- `bun.lock`

`@types/node: "catalog:"` is added to `packages/opencode` development dependencies and reflected by one lockfile line. This does not appear in the pristine upstream `packages/opencode/package.json` diff from upstream `v1.14.42` to `v1.14.46`; it is likely a Kilo merge/typecheck compatibility adjustment. Confirm that this local dependency addition is intentional.

### 6. Schema utilities moved into the core package without package metadata changes

Files:

- `packages/opencode/src/util/effect-zod.ts` -> `packages/core/src/effect-zod.ts`
- `packages/opencode/src/util/schema.ts` -> `packages/core/src/schema.ts`

Git detects both moves as 100% renames. This is source architecture rather than build infrastructure, but it changes workspace package ownership and module boundaries. The Kilo `packages/core/package.json` remains unchanged and already exports `./*` from `./src/*.ts`, so no export-map update is required. Confirm that the move is intentional and that package-level typecheck/build coverage exercises the new ownership boundary.

## Intentional dependency and generated-SDK updates

- `.opencode-version` advances from `v1.14.42` to `v1.14.46`, which is the expected upstream merge bookkeeping update.
- `bun.lock` changes only by adding the CLI package's `@types/node` development dependency. No broad lockfile resolution churn is present.
- `packages/sdk/openapi.json` and the three generated SDK files listed above are expected generated artifacts for the HTTP API schema changes. They should be accepted after deterministic regeneration succeeds.
- `packages/sdk/js/src/error-interceptor.ts`, `packages/sdk/js/src/client.ts`, and `packages/sdk/js/src/v2/client.ts` are related SDK runtime changes, but they are hand-written and should be reviewed separately from generated output.

## Notable non-findings

- No GitHub Actions workflow files changed in the reviewed PR.
- No `.github/actions/**`, issue template, pull request template, CodeQL, or repository automation files changed.
- No `script/**` release, deploy, changelog, SDK generation, upstream merge, or CI guard scripts changed.
- No Docker, container, Nix, Husky, root workspace manifest, Turbo, Bun config, TypeScript root config, or changeset files changed.
- No SDK build scripts, SDK package metadata, SDK TypeScript config, or generated-client implementation files under `packages/sdk/js/src/gen/client/**` changed.
- The pristine upstream checkout contains many Kilo-incompatible infrastructure differences when directly compared with the Kilo PR base, including workflow additions/removals and script removals. Those upstream-only repository-layout differences were not imported into the reviewed PR, which is the desired result for preserving Kilo infrastructure.

## Commands and relevant outputs

```text
$ git diff --name-status 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d -- .github .changeset script Dockerfile docker-compose.yml package.json turbo.json bunfig.toml tsconfig.json packages/core/package.json packages/sdk/js/package.json packages/sdk/js/script packages/sdk/js/tsconfig.json
(no output)
```

```text
$ git diff --name-status 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d -- .opencode-version .opencode/tui.json bun.lock packages/opencode/package.json packages/kilo-console/package.json packages/kilo-web-ui/package.json packages/sdk packages/opencode/migration packages/core
M  .opencode-version
M  .opencode/tui.json
M  bun.lock
A  packages/core/src/effect-zod.ts
M  packages/core/src/flag/flag.ts
A  packages/core/src/schema.ts
M  packages/kilo-console/package.json
M  packages/kilo-web-ui/package.json
M  packages/opencode/migration/20260507164347_add_workspace_time/migration.sql
M  packages/opencode/package.json
M  packages/sdk/js/src/client.ts
A  packages/sdk/js/src/error-interceptor.ts
M  packages/sdk/js/src/gen/types.gen.ts
M  packages/sdk/js/src/v2/client.ts
M  packages/sdk/js/src/v2/gen/sdk.gen.ts
M  packages/sdk/js/src/v2/gen/types.gen.ts
M  packages/sdk/openapi.json
```

```text
$ git diff --stat 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d -- packages/sdk
7 files changed, 1383 insertions(+), 1838 deletions(-)
```

```text
$ git diff --find-renames --summary 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d -- packages/opencode/src/util/effect-zod.ts packages/opencode/src/util/schema.ts packages/core/src/effect-zod.ts packages/core/src/schema.ts
rename packages/{opencode/src/util => core/src}/effect-zod.ts (100%)
rename packages/{opencode/src/util => core/src}/schema.ts (100%)
```

```text
$ git rev-parse HEAD  # pristine upstream target reference
d802b0a277f4e7f113b5efd8d5446fc1db22f4a4
```

## Limitations

- This was a static, read-only review. I did not run SDK generation, dependency installation, builds, tests, CI guards, or migrations against a live user database.
- Aside from writing this required report file, I did not edit code or configuration, stage, commit, push, merge, rebase, stash, or otherwise mutate Git state.
- The report classifies likely generated output from paths and diffs. Deterministic reproduction still requires running the repository generation command in the writable resolver checkout.
