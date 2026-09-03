# INFRASTRUCTURE_CHANGE Review

## Scope and methodology

Infrastructure-only review of Kilo-Org/kilocode PR #13368 at base `6175210c0fd0092a86aa475e4d8d7616711a1464` and head `5d120f0696a83b354804e0848f1c1af4b0088a4f`. I inspected the complete 48-file PR diff and 53-commit range, reconstructed pristine upstream `v1.18.15` to `v1.18.18`, Kilo base to head, pristine `v1.18.18` to transformed/final Kilo, and both merge parents. Review covered workflows/CI, release and repository automation, package/workspace scripts, manifests, versions, patches, lockfile and Nix/build consequences, changesets, and generated SDK/build automation.

Provenance verified: authoritative `upstream` tag `v1.18.18` resolves to `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`; merge `6b9a826e03cd8a5716e73d25596fa6199cf25d59` has parents `6175210c0fd0092a86aa475e4d8d7616711a1464` and `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`; merge base is the stated base. GitHub still reports the exact base/head, draft, `MERGEABLE`, and 32 successful, one neutral, one skipped check; `mergeStateStatus: BLOCKED` is consistent with draft/protection state rather than a merge conflict.

## Findings

### P2 - Regenerate and commit Nix node_modules hashes before release

Classification: introduced by the upstream range; Kilo release-infrastructure reconciliation requires human verification.

The PR adds `@ai-sdk/groq@3.0.31` to `package.json#patchedDependencies` and `bun.lock#patchedDependencies`, adds `patches/@ai-sdk%2Fgroq@3.0.31.patch`, and changes the installed Mistral and xAI patch contents (`package.json:162-181`, `bun.lock:1008-1024`). These inputs are included in the fixed-output Nix source (`nix/node_modules.nix:25-34`), but `nix/hashes.json` is byte-identical to base. The existing workflow explicitly watches `bun.lock`, root/package manifests, and `patches/**` and recomputes all four hashes (`.github/workflows/nix-hashes.yml:7-18,24-90`). It only runs on pushes to `main`, not PRs (`:7-10`), so current green PR checks do not validate these hashes.

Consequence: fixed-output Nix builds at this head are expected to reject the stale hash until `nix/hashes.json` is refreshed. This is release hygiene rather than evidence of a bad provider patch, but merging without confirming the planned post-merge hash update leaves the Nix package temporarily broken and relies on an automatic direct-to-main follow-up commit.

Minimal direction: run the four-platform `nix-hashes` computation for this exact head and include the resulting `nix/hashes.json` update before release, or explicitly confirm that the post-merge `nix-hashes.yml` direct commit is the accepted process and block release until it succeeds. Local proof was unavailable because this host has no `nix` executable (`zsh:1: command not found: nix`).

### P3 - Confirm five empty `peerDependencies` additions are intentional reconciliation output

Classification: introduced by merge reconciliation/adaptation.

`artifacts/glm52-rise-video/package.json:24-25`, `packages/httpapi-codegen/package.json:23-24`, `packages/protocol/package.json:22-23`, `packages/schema/package.json:22-23`, and `packages/sdk-next/package.json:26-27` gain `"peerDependencies": {}`. Neither the Kilo base nor pristine/transformed upstream has those empty objects; semantic key comparison confirms this is the only change in four manifests, while `packages/sdk-next/package.json` also preserves Kilo's required `test:ci` script. The artifacts are harmless to Bun and the packages are private, but they are unexplained fork drift created during package reconciliation rather than upstream code Kilo needs.

Minimal direction: confirm the merge tool intentionally normalizes absent dependency sections to empty objects; otherwise remove these five empty keys and adjust the reconciler so future upstream merges do not repeat this noise. This does not block installation or tests.

## Infrastructure-relevant notable non-findings

- Kilo workflows and automation are retained. The flattened PR changes no `.github/workflows`, `.github/actions`, issue-template, `script`, `infra`, Docker, Nix, generated SDK, or OpenAPI path. Upstream's `deploy.yml` Pulumi `GITHUB_TOKEN`, `.github/TEAM_MEMBERS` addition, hosted stats infrastructure, and `script/beta.ts` v2 automation are intentionally absent because Kilo does not ship those upstream surfaces and the merge configuration keeps Kilo workflows/manual infrastructure.
- Root package reconciliation is coherent: Bun remains `bun@1.3.14`; Kilo workspaces remain `packages/*` plus `packages/sdk/js`; Kilo extension/dev/postinstall/test scripts remain present; upstream-only desktop/web/console scripts and native trusted dependency are not reintroduced. `test:script:ci` moved only in JSON ordering.
- Patch reconciliation is internally consistent. The new Groq patch is registered in `package.json` and `bun.lock`; Mistral combines the pre-existing Kilo `promptCacheKey` patch with upstream arbitrary reasoning effort; xAI combines pre-existing Kilo file/response options with upstream arbitrary reasoning effort. `bun install --frozen-lockfile --ignore-scripts` applied all patches and produced no changes.
- Kilo's package versions remain `7.4.23`; upstream's `1.18.18` package-version synchronization is intentionally not adopted. `.opencode-version` correctly advances from `v1.18.15` to `v1.18.18` and the release changeset correctly targets `@kilocode/cli` and `kilo-code` with user-facing v1.18.16-v1.18.18 notes.
- CI scheduling remains live: `packages/sdk-next/package.json` retains `test:ci`, root tooling retains `test:script:ci`, and `script/check-test-ci.ts` reports 25 test-bearing packages and 11 root script test files. No package test script was silently dropped or reduced to zero tests.
- No generated SDK/build automation change is required by this PR: there is no server endpoint/schema change and no generated SDK/OpenAPI diff. Current CI reports source-link freshness, typechecks, unit tests, annotations, and other checks successful.

## Exact commands and results

- `git diff --shortstat 6175210... 5d120f0...` -> `48 files changed, 885 insertions(+), 159 deletions(-)`; `git rev-list --count 6175210...5d120f0...` -> `53`.
- `git fetch upstream tag v1.18.18 --force`; `git ls-remote --tags upstream refs/tags/v1.18.18` -> `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`.
- `git show -s --format='%H %P' 6b9a826...` -> merge plus parents `6175210... 31406cc...`; `git merge-base 6175210... 5d120f0...` -> `6175210...`.
- `bun install --frozen-lockfile --ignore-scripts` -> Bun 1.3.14, `Checked 2011 installs across 2247 packages (no changes)`.
- `bun run script/check-workflows.ts` -> `check-workflows: ok (29 workflows).`
- `bun run script/check-test-ci.ts` -> `check-test-ci: ok (25 test-bearing package(s), 11 root script test file(s))`.
- `bun test transforms/transform-package-json.test.ts transforms/preserve-versions.test.ts` from `script/upstream` -> `23 pass`, `0 fail`, `74 expect() calls`.
- `bun run script/check-md-table-padding.ts` -> `400 file(s) checked, no padded tables found.`
- `bunx changeset status` -> CLI and `kilo-code` remain covered by pending minor release aggregation; no changeset parse error.
- `git diff --check 6175210... 5d120f0...` -> no output, exit 0.
- `nix build .#packages.aarch64-darwin.node_modules --no-link` -> not run: `zsh:1: command not found: nix`.
- Final `gh pr view` -> unchanged exact head `5d120f0...`, base `6175210...`, draft, `MERGEABLE`, checks `{SUCCESS: 32, NEUTRAL: 1, SKIPPED: 1}`.

## Limitations

- Review was intentionally limited to `INFRASTRUCTURE_CHANGE`; application behavior is covered only where it determines patch/manifest/build reconciliation.
- Nix hashes could not be computed locally because Nix is not installed; the stale-hash finding is based on the fixed-output source closure and workflow trigger definition and needs the native four-platform job for exact replacements.
- No Docker/container or full release/publish dry run was run because those files are unchanged and such runs may publish or require credentials. No GitHub state was mutated.
- Concurrent untracked reviewer reports (`CONFIG_REGRESSION.md` and `OPENCODE_MENTIONS.md`) were not modified. This report is the only file written by this review.
