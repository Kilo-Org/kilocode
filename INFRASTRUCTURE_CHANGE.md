# Infrastructure Change Review

## Scope And Methodology

Infrastructure verdict: **not safe to merge until the release publisher and CI test coverage findings are fixed; the Effect override also needs an explicit compatibility decision.**

This review is limited to infrastructure changes in PR #12695 at head `054ee594915b93546d0613a45e0671edd43905ee`, against base and merge base `0b8f749ae13388cf7a38ea7fb9183acaac99eef8`. I compared `base..head`, partitioned the imported upstream range from Kilo adaptations using pristine upstream `10c894bdeef3618f5666fb506ef7f9491bb964d8` (`v1.17.13`), inspected the active and disabled GitHub Actions changes, release/build scripts, workspace manifests, Turbo configuration, dependency patches, lockfile resolution, changeset input, and generated SDK/OpenAPI machinery. I then exercised the resolved Turbo task graph and targeted package checks without publishing, committing, pushing, or changing GitHub.

The reviewed PR is large (`1237 files changed, 101898 insertions(+), 41085 deletions(-)`), but the infrastructure-relevant flattened delta is concentrated in `.github`, root workspace/lock/Turbo files, package manifests and scripts, three dependency patches, release automation, generated clients, and `packages/sdk/openapi.json`. Product source under the newly imported Schema, Protocol, Core, Client, SDK Next, and Session UI packages was considered only where it activates CI, generation, packaging, or release behavior.

## Findings

### P1/high: Kilo CI silently skips newly imported package tests, including one that currently fails

- **Paths:** `.github/workflows/test.yml:144-160`, `packages/client/package.json:11-15`, `packages/client/test/contract-identity.test.ts:40-44`, `turbo.json`
- **Provenance:** Introduced by the merge adaptation. Upstream `v1.17.13` runs `GITHUB_ACTIONS=false bun turbo test`, while Kilo preserves its `bun turbo test:ci` orchestration. The imported packages define `test`, not `test:ci`.
- **Exact evidence:** The active Kilo unit workflow invokes only `bun turbo test:ci` for non-CLI packages. `bun turbo run test:ci --dry=json` reports all of the following as `<NONEXISTENT>`: `@opencode-ai/client#test:ci`, `@opencode-ai/httpapi-codegen#test:ci`, `@opencode-ai/sdk-next#test:ci`, and `@opencode-ai/session-ui#test:ci`. Their manifests expose `test` scripts instead. The generated-client freshness command added at `.github/workflows/test.yml:224-227` runs generation plus `git diff`; it does not run the package's contract tests.
- **Concrete failure:** Running `bun test` in `packages/client` produced:

  ```text
  (fail) client and Server contracts generate identically

   15 pass
   1 fail
   75 expect() calls
  Ran 16 tests across 4 files. [1020.00ms]
  ```

  The assertion at `packages/client/test/contract-identity.test.ts:44` found different generated contracts because middleware errors are emitted in different orders, for example `[401, 400]` versus `[400, 401]`. Even if error ordering is ultimately judged semantically irrelevant, the imported upstream invariant explicitly requires client and server generation to be identical, and the current Kilo CI never executes it.
- **Risk to Kilo infrastructure:** Required checks can pass while generator, protocol/client identity, embedded SDK, and extracted Session UI tests are not scheduled. This already conceals a red test at the reviewed head and creates a durable blind spot for future upstream imports.
- **Human action:** Add `test:ci` scripts for every imported package that has tests, or add an explicit CI step that runs their existing `test` scripts. Confirm `bun turbo test:ci` schedules non-zero commands, fix or deliberately revise the client/server identity invariant, and make the required job depend on the resulting checks.

### P1/high: Kilo's release job now attempts to publish the upstream-owned `@opencode-ai/ui` npm package

- **Paths:** `script/publish.ts:125-126`, `packages/ui/package.json:2-12`, `packages/ui/script/publish.ts:11-23`, `.github/workflows/publish.yml:469-478`
- **Provenance:** The UI package publisher is introduced by upstream `v1.17.10-v1.17.13`; the Kilo merge retained the upstream package name and publisher, changed its repository metadata/version to Kilo, and wired it into Kilo's existing release driver.
- **Exact evidence:** `script/publish.ts` now unconditionally runs `bun ./packages/ui/script/publish.ts`. That script reads `name: "@opencode-ai/ui"`, checks `npm view`, and then executes `npm publish ... --access public --tag ${Script.channel}`. The Kilo release workflow invokes the driver with npm provenance enabled. The live read-only registry query returned:

  ```json
  {
    "version": "1.18.13",
    "dist-tags": {
      "tui-v2": "0.0.0-tui-v2-202606261840",
      "next": "0.0.0-next-16741",
      "latest": "1.18.13",
      "beta": "0.0.0-beta-202608041253",
      "dev": "0.0.0-dev-202608041225"
    },
    "repository": {
      "url": "git+https://github.com/anomalyco/opencode.git",
      "type": "git",
      "directory": "packages/ui"
    }
  }
  ```

  The reviewed package instead has version `7.4.20` and repository `Kilo-Org/kilocode`. The PR changeset versions only `@kilocode/cli` and `kilo-code`; it does not establish ownership or release intent for `@opencode-ai/ui`.
- **Risk to Kilo infrastructure:** A Kilo release can fail at npm authorization/provenance before the VS Code publish step, or, if credentials unexpectedly have access, publish Kilo-modified artifacts into OpenCode's namespace with Kilo's unrelated `7.x` version line. Either outcome violates the requirement that repository/release machinery remain Kilo-owned.
- **Human action:** Remove the UI publish call from Kilo's release driver unless Kilo has an explicit package ownership agreement. If Kilo intends to distribute this UI independently, rename it to a Kilo-owned npm scope, define versioning/changeset policy, and validate trusted-publisher provenance from `Kilo-Org/kilocode` in a dry-run release.

### P2/medium, human verification: the Effect beta.83 upgrade retains a beta.74 platform override

- **Paths:** `package.json:58`, `package.json:87`, `package.json:138-142`, `bun.lock:1425-1429`, `patches/effect@4.0.0-beta.83.patch`
- **Provenance:** Merge-resolution/adaptation issue. Base consistently used Effect beta.74 and the beta.74 override. Pristine upstream `v1.17.13` upgrades Effect and `@effect/platform-node` to beta.83 and has no `@effect/platform-node-shared` override. Head imports the beta.83 catalog and patch but retains Kilo's old beta.74 override.
- **Exact evidence:** The reviewed root catalog contains `effect: 4.0.0-beta.83`, `@effect/platform-node: 4.0.0-beta.83`, and `@effect/sql-sqlite-bun: 4.0.0-beta.83`, while `overrides` forces `@effect/platform-node-shared: 4.0.0-beta.74`. The lockfile records `@effect/platform-node@4.0.0-beta.83` requesting `@effect/platform-node-shared: ^4.0.0-beta.83`, but resolves the shared package to beta.74 with peer dependency `effect: ^4.0.0-beta.74`. `bun pm ls --all` confirms:

  ```text
  ├── @effect/platform-node@4.0.0-beta.83
  ├── @effect/platform-node-shared@4.0.0-beta.74
  ├── effect@4.0.0-beta.83
  ```

- **Risk to Kilo infrastructure:** Bun is forced outside `@effect/platform-node`'s declared dependency range and across an Effect beta API boundary. Typecheck and selected layer tests passed, but platform-specific file, socket, worker, or runtime behavior can fail outside those tests; subsequent lockfile regeneration will preserve the unsupported split.
- **Human action:** Establish why the beta.74 override still exists. Prefer removing it or updating it to beta.83, regenerate `bun.lock`, and rerun cross-platform Core/CLI tests. If it must remain, document the compatibility rationale and add a guard that proves the mixed versions are intentional.

## Notable Non-Findings

- The only active workflow changed in `base..head` is `.github/workflows/test.yml`. The PR does not change `.github/workflows/publish.yml`, `.github/workflows/beta.yml`, `.github/workflows/containers.yml`, `.github/workflows/generate.yml`, reusable actions, Dockerfiles, Compose files, Nix files, or container build scripts.
- Changes to `.github/workflows/disabled/compliance-close.yml.disabled`, `duplicate-issues.yml.disabled`, `storybook.yml.disabled`, and `triage.yml.disabled` remain inert because their filenames still end in `.disabled`. They import upstream team-author exemptions and Session UI path coverage without activating upstream automation in Kilo.
- `script/github/close-issues.ts` still targets `anomalyco/opencode`, but its only workflow caller found in this repository is `.github/workflows/disabled/close-issues.yml.disabled`; the PR does not activate it. Human review is still advisable before ever re-enabling that workflow.
- `.github/ISSUE_TEMPLATE/config.yml` only changes the Discord contact description. It does not enable blank issues or redirect the link away from `https://kilo.ai/discord`.
- The imported `packages/client` generation machinery is explicitly gated by `bun run check:generated` in the active HTTP API job. Generated-output scope is substantial but expected: `packages/client/src/generated*` is new, `packages/sdk/js/src/v2/gen` changes, and `packages/sdk/openapi.json` changes by `27550` additions and `14963` deletions. Targeted OpenAPI/SDK tests passed; the separate skipped client contract test is the finding above.
- The dependency patch changes are infrastructure-relevant but did not expose a separate verified defect: the MCP SDK patch expands OAuth/session-retry behavior, the TanStack patch adds virtual-range clamping, and the new Effect patch gives SSE wrapper schemas distinct OpenAPI identifiers. The version-resolution concern is limited to the stale Effect platform override described above.
- `script/check-opencode-annotations.ts` expands coverage to newly upstream-owned packages (`core`, `llm`, `schema`, `protocol`, `server`, and `tui`), and `script/check-model-tool-network.ts` adapts its network-layer check to the new LayerNode graph. No weakening of their intended checks was identified in this infrastructure pass.

## Commands And Results

- Revision verification:

  ```text
  $ git rev-parse HEAD
  054ee594915b93546d0613a45e0671edd43905ee
  $ git merge-base 0b8f749ae13388cf7a38ea7fb9183acaac99eef8 054ee594915b93546d0613a45e0671edd43905ee
  0b8f749ae13388cf7a38ea7fb9183acaac99eef8
  $ git diff --shortstat 0b8f749ae13388cf7a38ea7fb9183acaac99eef8..054ee594915b93546d0613a45e0671edd43905ee
   1237 files changed, 101898 insertions(+), 41085 deletions(-)
  ```

- Infrastructure guards:

  ```text
  $ bun run script/check-workflows.ts
  check-workflows: ok (29 workflows).
  $ bun run script/check-md-table-padding.ts
  check-md-table-padding: 385 file(s) checked, no padded tables found.
  $ git diff --check BASE..HEAD -- <infrastructure paths>
  [no output; exit 0]
  ```

- Turbo coverage proof: `bun turbo run test:ci --dry=json` exited `0`, but reported `<NONEXISTENT>` commands for the four imported packages named in finding 1. Direct package results were:

  ```text
  packages/client:          15 pass, 1 fail, 16 tests across 4 files
  packages/httpapi-codegen: 66 pass, 0 fail, 66 tests across 2 files
  packages/sdk-next:         5 pass, 0 fail, 5 tests across 2 files
  packages/session-ui:      57 pass, 0 fail, 57 tests across 11 files
  ```

- Generated API integration: `bun test ./test/server/httpapi-public-openapi.test.ts ./test/server/httpapi-sdk.test.ts` from `packages/opencode` passed `39` tests across `2` files with `0` failures.
- Effect integration: `bun run --cwd packages/core typecheck` exited `0`; `bun test ./test/effect/layer-node/layer-node.test.ts ./test/effect/layer-node/node-build.test.ts` from `packages/core` passed `17` tests across `2` files with `0` failures.
- Client typecheck: `bun run typecheck` from `packages/client` exited `0`. Its direct test failure is therefore behavioral/contract-level rather than a TypeScript compile failure.
- Worktree integrity before writing this report: `git status --short` showed only the pre-existing untracked `vscode-self-test.config.json`; diagnostics left no tracked changes. GitHub was not queried or mutated through `gh`, and no commit, push, tag, release, package publish, or other external mutation was performed.

## Limitations

- I did not execute `script/publish.ts`, `npm publish`, changeset versioning, release tagging, or any GitHub Actions workflow because those paths mutate package registries, Git history, releases, marketplaces, or GitHub state. The npm package check was read-only.
- I did not run the full monorepo suite or all cross-platform jobs. Targeted checks covered the changed CI graph, imported package tests, Core Effect layers, and generated OpenAPI/SDK integration; Windows/Linux-only runtime behavior for the mixed Effect versions remains a human-verification item.
- I did not regenerate tracked SDK/OpenAPI artifacts in-place because the assignment permits writing only this report. Freshness was assessed from the committed generation gate, diffs, targeted tests, and the clean tracked worktree after diagnostics.
- Disabled workflows were reviewed as dormant repository machinery, not executed. Their behavior could differ if renamed back to `.yml` in a later change.
