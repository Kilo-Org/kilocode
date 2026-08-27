# Infrastructure change review — PR #13513

## Summary, scope, and methodology

**Infrastructure verdict: safe after specific fixes.** One P2 SDK-generation compatibility regression is present relative to the actual PR base, although it also exists on comparison main. Release-note coverage needs a P3 follow-up. The remaining infrastructure changes require explicit human verification rather than being classified as defects.

Reviewer 2 audited the actual PR delta for workflows/actions, CI scheduling, release/deployment, containers/builds, manifests/workspaces/toolchain pins, lockfiles, repository automation, issue templates, changesets/changelogs, and SDK generation. Comparisons covered actual base → HEAD, pristine upstream v1.18.18 → v1.18.20, pristine upstream → HEAD, both merge parents → result, and comparison main → HEAD. Static caller tracing was supplemented with read-only guards, SDK tests/typecheck/lint, two disposable generator runs, and real loopback HTTP probes against complete base/HEAD/main SDK snapshots.

All shell commands ran from `/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports`. No caller checkout access, source edits, dependency installation, branch switching, Git configuration changes, commits, pushes, or GitHub mutations were performed. Disposable output and control snapshots were outside the checkout and removed by the probes.

- Actual base / merge base: `bf1cf502a3c511e9daf6a43244568ae4e83473a8` (`johnnyeric/kilo-opencode-v1.18.18`).
- Reviewed HEAD: `6a7d6bc002319ac2987bcde3d6c63efcafc07021`; 59 changed files, 3 added / 56 modified, 95 reachable commits, two first-parent merges.
- Comparison main: `62998965e9fb0d9ed89011c62498b39801dbbb4f`.
- Local authoritative upstream refs resolve to `.18 = 31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`, `.19 = 2b72179c663cadcb54f54d9f19221b3fb3d11fb6`, `.20 = 7248bc1964b13fa67e601733f89ee9dc6dfa0563`.
- `91ca95bad927436131ea4783a470885a381ce6ad` has actual base and pristine `.20` as parents and is tree-identical to the base. HEAD has `91ca95bad9` and transformed `9563af96a012effc25df5a11eaa1f7633161a742` as parents. Thus the effective tree changes occur at the final merge, not the ancestry-recording merge.

## Findings

### F1 — P2: generator upgrade loses error wrapping for client-level `throwOnError`

**Location:** `packages/sdk/js/src/v2/gen/client/client.gen.ts:201`; activating dependency change at `packages/sdk/js/package.json:26`. Kilo consumer: `packages/sdk/js/src/error-interceptor.ts:19`, registered by `packages/sdk/js/src/v2/client.ts:100`.

**Invariant:** `createKiloClient({ throwOnError: true })` should preserve the same structured `Error` behavior as setting `{ throwOnError: true }` on an individual operation. Kilo's interceptor deliberately gives thrown server errors a usable `.message` and `.cause.status`.

The new generated client computes the effective throw policy from `options.throwOnError ?? _config.throwOnError` at line 74, but passes the **unresolved operation options** into error interceptors at line 201. The previous generated client passed resolved `opts`, including client defaults. Consequently `wrapClientError` sees no `throwOnError`, returns the decoded error object unchanged, and the client throws that object instead of an `Error`. A consumer reading `err.message`, `err.cause.status`, or formatting `String(err)` loses the useful message/status and can display `[object Object]`.

**Proof / controls:** a real local HTTP server returned status 400 and `{ name: "BadRequestError", data: { message: "review proof: denied" } }`. Calling `client.global.health()` with client-level `throwOnError: true` rejected with an `Error` on actual base, but a plain object on HEAD. Explicit per-call `throwOnError: true` still produced an `Error` on both. The nonthrowing result tuple remained unchanged. Complete SDK source snapshots, not a rewritten error algorithm, were used for the controls; exact output is below.

**Provenance:** introduced into this PR's actual-base delta by the Kilo-side `@hey-api/openapi-ts` upgrade to `0.97.3`, not by pristine upstream `.18 → .20` (which retains `0.90.10` and unchanged generated transport). The same generator and transport already exist on comparison main, and main reproduces the failure. This is **not a newly discovered main-only regression caused by this upstream release**; it is a demonstrated compatibility loss when adopting that generator into this stack.

**Fix direction:** preserve effective client defaults at the Kilo-owned error-interceptor registration boundary, or make generation preserve resolved options when invoking interceptors. Add a regression covering client default, per-call override, and nonthrowing tuple behavior. Do not hand-edit generated output without a reproducible generation fix.

### F2 — P3: the newly adopted release range has no changeset

**Location:** `.opencode-version:1` advances to `v1.18.20`; release-note consumption is in `script/publish.ts:18-29`.

The actual PR adds or updates no `.changeset` file and changes no changelog. The existing `.changeset/opencode-v1-18-16-to-v1-18-18.md:6` explicitly ends at v1.18.18; there is no `.19`/`.20` coverage in current changeset text. The PR contains user-facing provider/session fixes, so consuming the existing changesets will not describe this newly adopted range. This violates the documented release-note requirement, not the runtime or publishing chain.

**Provenance / control:** omission in this actual merge delta, not the older changeset deletions or package version differences visible only against main. Prior range changesets demonstrate the intended mechanism. Do not recreate already-consumed main security changesets merely because this stack is behind main.

**Fix direction:** add one concise user-facing patch changeset for the newly adopted range, covering the CLI/extension fixed release group, or explicitly document where equivalent release-note coverage is supplied before publication.

## Infrastructure changes requiring explicit human verification

These are **policy/product approval items, not additional severity-graded defects**. They account for all infrastructure-related changes in the actual PR delta, grouped by purpose rather than by every file.

### HV1 — Kilo SDK generator upgrade and compatibility policy

- `packages/sdk/js/package.json:26`: `@hey-api/openapi-ts` changes `0.90.10 → 0.97.3`; corresponding toolchain dependency graph changes are in `bun.lock:1578` onward. This is **Kilo adaptation matching comparison main**, not adoption of an upstream `.19/.20` generator upgrade.
- `packages/sdk/js/script/build.ts:97-109` now accepts an already-correct SSE return signature, instead of requiring the old buggy signature to be replaced. This is necessary for `0.97.3`; the checked output still requires `ServerSentEventsResult<TData>`.
- `packages/sdk/js/script/build.ts:111-122` adds a Kilo-specific patch restoring required `request: Request` / `response: Response` fields in the nonthrowing result type. That preserves the base's declared contract, but deliberately declines the generator's more accurate optional fields. Network errors already lacked a response on base; the broader new catch also allows pre-request failures to return with no request. This is a conscious compatibility tradeoff requiring approval, not proof that those fields always exist at runtime.
- Ten generated V2 files change as a consequence. This is not purely formatting: the fetch catch now covers construction/validation/interception/parsing, interceptor error transformations compose, `buildUrl` includes client config, parameter maps use null prototypes, required flattened request fields become required, SSE callback typing changes, and colliding generated class identifiers gain suffixes. F1 is the verified integration failure among these changes. The underlying committed OpenAPI document is unchanged by this PR.
- The caller chain remains `.github/workflows/generate.yml:36 → script/generate.ts:5 → SDK build`, and `.github/workflows/publish.yml:476 → script/publish.ts:71 → SDK build → script/publish.ts:120 → SDK publish`. `packages/sdk/js/script/publish.ts:23-25` still maps source exports to built `dist` JavaScript/declarations. The newly changed generator therefore affects both generated source and shipped SDK artifacts; it is not dormant developer tooling.

**Human verification:** explicitly approve the generator/security-pin reconciliation, generated API/transport changes, and result-type compatibility policy. Two disposable runs of the actual generation/postprocessing section matched all 15 tracked V2 files exactly after filename-aware formatting. The pre-existing history numeric-query and duplicate-schema guards still pass.

### HV2 — upstream runtime provider pins and regenerated dependency graph

- `packages/core/package.json:95,108` and `packages/opencode/package.json:82,130`: `@ai-sdk/google-vertex 4.0.128 → 4.0.181` and `ai-gateway-provider 3.1.2 → 3.2.0`.
- These two pin changes **are present in pristine upstream `.18 → .20`**. Comparison main still has the older provider pins. They are legitimate upstream code/dependency adoption, but still require Kilo infrastructure approval.
- `bun.lock:1154,2830` and nested package records change the resolved Vertex and gateway provider trees. The lock now carries newer nested Anthropic/Google/OpenAI-compatible/provider-utils versions and additional optional gateway-provider SDK copies, including their `undici` dependencies. This changes the shipped dependency graph even though root AI SDK pins remain fixed.

**Human verification:** approve the runtime dependency/bundle changes together with the upstream provider behavior. No independent provider API or cross-platform CLI build certification is claimed by this infrastructure lens.

### HV3 — Kilo minimatch pin reconciliation and lockfile hygiene

- `packages/core/package.json:80`: `minimatch 10.2.5 → 10.2.6`.
- `packages/opencode/package.json:183`: `minimatch 10.0.3 → 10.2.6`.
- Both match comparison main, while pristine `.20` retains the older differing pins. This is **Kilo-side reconciliation**, not an upstream release requirement.
- `bun.lock:3954` changes the root resolution to `minimatch@10.2.6`, drops the separate old core resolution and unneeded `@isaacs` matcher dependencies, and uses the `brace-expansion` dependency selected by the newer matcher.
- Across all SDK/provider/minimatch changes, the lock has **40 added, 15 changed, and 11 removed package records**. Exactly three workspace records change, with seven direct pin updates matching their manifests. Lockfile/config versions, workspace membership, catalog, overrides, trusted dependencies, and patch metadata are preserved.

**Human verification:** approve this dependency reconciliation and the complete lockfile delta; do not misclassify the root Bun/version differences against main as new changes in this PR.

### HV4 — upstream automation baseline advances

`.opencode-version:1` changes `v1.18.18 → v1.18.20`. This influences future upstream-marker/reset tooling through the documented baseline selection; it is not a Kilo package version bump. The final merge records pristine `.20` ancestry, and the resolved local `.20` ref matches the supplied authoritative SHA.

**Human verification:** approve `.20` as the next automation baseline together with the range release notes. Upstream `.19` is a release-commit sibling rather than an ancestor of `.20`; their common ancestor is `.19`'s parent `f4a89683da2fb5fd1b37995402100ca7a24a8484`. This is consistent with release-only tag commits and is not a wrong-target finding.

## Notable non-findings and inherited limitations

- **No workflow/action, CI configuration, release/deploy script, Docker/container definition, Nix file, root package/workspace configuration, issue/PR template, changelog, or changeset content changes occur in the actual PR delta.** The only changed handwritten build script is the SDK generator discussed above. The broader differences against main (including Bun `1.3.14 → 1.4.0`, package versions `7.5.5` versus `7.5.0`, older changelog/changeset state, Nix/container adjustments, and upstream automation edits) belong to the existing stack, not this PR's effective change set.
- Pristine upstream deletes `.github/workflows/beta.yml` and removes preview-CLI publishing from `script/publish.ts`. Kilo retains its own beta workflow and its existing publishing script unchanged. Kilo already did not publish the preview CLI. No upstream-hosted application, deployment, or desktop publishing infrastructure is reintroduced.
- CLI/core `test:ci` commands and all scripts in the three changed manifests are preserved. The workflow allowlist and package scheduling guard pass. No new no-op release/test chain was introduced.
- **Pre-existing CI coverage gap:** `@kilocode/sdk` has no `test:ci` on base, HEAD, or comparison main. Turbo's dry run reports `@kilocode/sdk#test:ci` as `<NONEXISTENT>`. `script/check-test-ci.ts:19,34` collapses the nested test path to `packages/sdk`, which has no package manifest, and skips it. Thus the passing guard does not establish SDK test scheduling. This is unchanged Kilo infrastructure, not a new PR finding; the seven existing SDK tests were run manually here.
- **Pre-existing generation coverage limitation:** `generate.yml:3-6` runs on pushes to `dev`, not as a PR SDK-regeneration gate. `check-kilo-generated-artifacts.yml:6-11` does not cover SDK source generation. Neither is treated as proof that F1 or generator behavior was tested by PR CI.
- No generated SDK drift remains in the disposable fixture check. An initial one-character generic trailing-comma difference came from the review harness omitting Prettier's `filepath`; rerunning with the actual `.ts` filename produced an exact match. It was a harness artifact, not a repository finding.

## Exact command outputs and evidence

All commands below used the separate review checkout as their working directory. Long diff and lint outputs are represented by explicitly labeled decisive excerpts.

### Read-only guards and existing SDK checks

```text
$ bun --version
1.3.14

$ bun run script/check-workflows.ts
check-workflows: ok (29 workflows).

$ bun run script/check-test-ci.ts
check-test-ci: ok (25 test-bearing package(s), 11 root script test file(s))

$ git diff --check bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD
[no output; exit 0]

$ bun test ./packages/sdk/js/test/session-history.test.ts ./packages/sdk/js/test/server.test.ts
bun test v1.3.14 (0d9b296a)

 7 pass
 0 fail
 11 expect() calls
Ran 7 tests across 2 files. [37.00ms]

$ bun run --cwd packages/sdk/js typecheck --incremental false --composite false
$ tsgo --noEmit --incremental false --composite false
[exit 0]

$ bun run lint packages/sdk/js/script/build.ts packages/sdk/js/src/v2/gen
[summary excerpt; exit 0]
Found 320 warnings and 0 errors.
Finished in 1.3s on 15 files with 130 rules using 18 threads.
```

Lint warnings are not promoted to review findings; they include generated-code type/style warnings. The complete lint output is retained at `/Users/johnnyamancio/.local/share/kilo/tool-output/tool_0439358b20015p0VrBqf4hgcU2`.

### Disposable generation

```text
$ bun /var/folders/pd/_rh0zzyx19ncnzldhjlt3mtc0000gp/T/kilo/pr13513-infra-r2-generate.ts
[decisive stdout; exit 0]
{"round":1,"generatedFiles":15,"drift":[]}
{"round":2,"generatedFiles":15,"drift":[]}
SDK fixture generation: two identical rounds; numeric history, duplicate-schema, SSE and result-contract patches passed
```

The harness executes the actual `build.ts` section from `const document` through the new result-contract patch, redirecting only file I/O and generator output to a disposable directory. It supplies the committed OpenAPI document, uses the installed `@hey-api/openapi-ts@0.97.3`, and formats with the repository's settings and actual filenames. Both generations were byte-identical to each other and to tracked V2 output. The generator also emitted its nonfatal `instance` deprecation notice; changing that option is not required to establish this PR's correctness.

### Real HTTP error-regression proof

```text
$ bun /var/folders/pd/_rh0zzyx19ncnzldhjlt3mtc0000gp/T/kilo/pr13513-infra-r2-error.ts
{"ref":"base","mode":"config","rejected":true,"isError":true,"message":"review proof: denied"}
{"ref":"base","mode":"call","rejected":true,"isError":true,"message":"review proof: denied"}
{"ref":"base","mode":"tuple","rejected":false,"isError":false,"error":{"name":"BadRequestError","data":{"message":"review proof: denied"}}}
{"ref":"HEAD","mode":"config","rejected":true,"isError":false,"error":{"name":"BadRequestError","data":{"message":"review proof: denied"}}}
{"ref":"HEAD","mode":"call","rejected":true,"isError":true,"message":"review proof: denied"}
{"ref":"HEAD","mode":"tuple","rejected":false,"isError":false,"error":{"name":"BadRequestError","data":{"message":"review proof: denied"}}}
{"ref":"main","mode":"config","rejected":true,"isError":false,"error":{"name":"BadRequestError","data":{"message":"review proof: denied"}}}
{"ref":"main","mode":"call","rejected":true,"isError":true,"message":"review proof: denied"}
{"ref":"main","mode":"tuple","rejected":false,"isError":false,"error":{"name":"BadRequestError","data":{"message":"review proof: denied"}}}
```

The local server is stopped and snapshot copies are removed in `finally`. The probe uses `createKiloClient` and actual generated clients, not duplicated transport/error logic.

### Lockfile and CI-task verification

```text
$ bun /var/folders/pd/_rh0zzyx19ncnzldhjlt3mtc0000gp/T/kilo/pr13513-infra-r2-lock.ts
[final summary excerpt; all seven manifest/lock pin assertions passed; exit 0]
{"added":40,"changed":15,"removed":11}
```

The asserted preserved metadata keys were `lockfileVersion`, `configVersion`, `trustedDependencies`, `patchedDependencies`, `overrides`, and `catalog`. Changed workspaces were exactly `packages/core`, `packages/opencode`, and `packages/sdk/js`.

Turbo command executed by the read-only JSON-summary wrapper:

```text
bun turbo run test:ci --filter=@kilocode/sdk --dry=json
```

Exact wrapper output:

```text
exit=0
{
  "packages": [
    "@kilocode/sdk"
  ],
  "tasks": [
    {
      "taskId": "@kilocode/sdk#test:ci",
      "command": "<NONEXISTENT>"
    }
  ]
}
```

### Control and integrity checks

These commands all exited 0 with no output:

```sh
git diff --quiet bf1cf502a3c511e9daf6a43244568ae4e83473a8 91ca95bad927436131ea4783a470885a381ce6ad
git diff --quiet bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD -- .github script infra nix package.json bunfig.toml turbo.json .changeset '**/CHANGELOG*' '**/Dockerfile*'
git diff --quiet refs/review/pr-13513/upstream-v1.18.18 refs/review/pr-13513/upstream-v1.18.20 -- packages/sdk/js/src/v2/gen/client/client.gen.ts
git diff --quiet bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD -- packages/sdk/js/src/error-interceptor.ts
git diff --quiet 62998965e9fb0d9ed89011c62498b39801dbbb4f HEAD -- packages/sdk/js/src/v2/gen/client/client.gen.ts
git diff --exit-code
git diff --cached --exit-code
```

Latest exact-head check before report creation:

```text
$ git rev-parse HEAD
6a7d6bc002319ac2987bcde3d6c63efcafc07021
```

The initial checkout was clean. Later untracked reports/temporary review files belonged to other parallel reviewers; they were neither edited nor removed. This review adds only `INFRASTRUCTURE_CHANGE.md` in the checkout. Diagnostic harnesses are retained under the approved temporary directory for reproducibility; generated output and snapshot trees have been cleaned up.

## Limitations

- Local Bun is `1.3.14`; the unchanged stack pin is `bun@1.4.0`. Parent-owned frozen installation with lifecycle scripts disabled was not rerun by this reviewer. Lockfile assertions and installed generator execution are not a substitute for a fresh install on every supported platform.
- Disposable generation validates the committed OpenAPI fixture → V2 SDK path, not live server → OpenAPI freshness. No tracked regeneration, complete publish build, `tsc` declaration emission, npm packaging, Docker/Nix build, release execution, or deployment was attempted. Existing history/type tests and source typecheck do not certify every downstream consumer.
- No broad provider/model, CLI, VS Code, or JetBrains tests were run by this lens; those belong to the other reviewers/parent. F1 proves the supported public SDK configuration path, not a claim that all current product calls use client-level defaults.
- GitHub CI/mergeability and remote head freshness were not independently queried by this worker; exact supplied local refs were used and local HEAD was rechecked. The parent should reconcile the final PR-wide verdict and any main/base movement.
- This infrastructure lens accessed no real user credentials, configuration, databases, or model endpoints. Its only network test was a temporary loopback HTTP server. This statement does not cover other reviewers: `CONFIG_REGRESSION.md` discloses an initial fixture run that attempted primary-checkout config reads, discarded results, corrected isolation, and unaudited possible incidental setup effects.

## Coordinator validation and cross-report reconciliation

All seven assigned reports were completed by their respective reviewers; the marker-chain reviewer completed a follow-up static trace covering all 737 marker-bearing lines in 29 changed files. Overall reviewed-head verdict: **safe after specific fixes**, based on the two distinct merge-relative P2 findings in `BROKEN_PIPELINE_CHAINS.md`. This report's SDK finding is the same SDK finding, not a third defect. Existing main/base problems and human policy checks are explicitly separated from new regressions.

Coordinator checks, performed after the report reviews:

```text
$ bun run script/check-md-table-padding.ts KILOCODE_CHANGE_MARKERS.md INFRASTRUCTURE_CHANGE.md OPENCODE_MENTIONS.md UNNECESSARY_MARKERS.md BROKEN_PIPELINE_CHAINS.md CONFIG_REGRESSION.md TESTS.md
check-md-table-padding: 7 file(s) checked, no padded tables found.

$ bun run lint
Found 9489 warnings and 0 errors.
Finished in 18.0s on 5461 files with 130 rules using 18 threads.

$ bun run typecheck --incremental false --composite false
$ tsgo --noEmit --incremental false --composite false
[run separately from packages/core and packages/tui; both exit 0]
```

The CLI and SDK typechecks passed in the pipeline lens; this is not a claim that the coordinator ran the full root Turbo/JetBrains typecheck. The coordinator independently reran the real HTTP SDK harness recorded above and reproduced all nine base/HEAD/main outcomes. All local runtime checks still used Bun 1.3.14, not pinned 1.4.0.

Read-only `gh pr view 13513` recheck returned the same head/base pins, `MERGEABLE` / `CLEAN`, and all 29 non-skipped checks successful; `[code]smith` was skipped. Independent tag verification corrected an initial marker-report summary: both release-only `.18` and `.19` tag commits are siblings, not ancestors, of `.20`; their common ancestors with `.20` are their respective parents. The exact `.20` tag is an ancestor of the reviewed head, so the target remains valid.

Before staging, the isolated checkout contained only the seven untracked report files and no tracked-source diff. The original user checkout remained clean on `johnnyeric/kilo-opencode-v1.18.20` at `ff7f6654fd2692013ed80f78516de4bd6c21267e`; no report branch was checked out there. Publication is limited to these reports in the separate branch, with the reviewed PR branch as the draft PR base. No source fixes or edits to the reviewed PR are part of this work.
