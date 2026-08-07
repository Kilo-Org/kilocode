# Broken Pipeline Chains Review V6 — upstream v1.18.13 merge (PR head 77246a52cb)

## Scope

ROUND 6 (LIGHT) of the broken-pipeline-chains review. Round 5 (`BROKEN_PIPELINE_CHAINS_V5.md`) reviewed `4bb1c2a45b`. This round re-reviews at `77246a52cb` (PR base `4f59fcb666`, upstream tag `a105350812`); the delta is the single round-5-fix commit touching 6 files (`packages/core/src/repository-cache.ts`, `packages/kilo-vscode/src/agent-manager/GitOps.ts`, `packages/llm/script/recording-cost-report.ts`, `packages/opencode/src/kilocode/kilo-commands.tsx`, `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`, `packages/ui/vite.config.ts`; +29/−12). The top 5 commits on the branch are report-only. Work performed: verified the fix against each V5 finding with file:line evidence, ran two targeted empirical checks (one test suite, one schema-decode probe), traced the two delta files that answer sibling-report findings (repository-cache, kilo-commands), and spot-checked every carried finding at head. Broad suites intentionally skipped (see Limitations).

## Round-5 finding verification

### Finding 3 residual — `GIT_EXEC_PATH`/`PREFIX` unstripped — FIXED (closed with test evidence)

- `GitOps.ts:100-101` adds `delete env.GIT_EXEC_PATH` / `delete env.PREFIX`. Simple-git's flagged env set (`@simple-git/argv-parser@1.1.1` guard table, per V5) is now fully stripped; only `GIT_SSH_COMMAND` remains deliberately gated via `allowUnsafeSshCommand` (fail-closed, documented security choice).
- **Empirical closure proof:** `PREFIX=/tmp GIT_EXEC_PATH=$(git --exec-path) bun test tests/unit/worktree-manager.test.ts` from `packages/kilo-vscode/` → **88 pass / 0 fail** (25s). In V5 each var alone produced 87/88 with the `resolveStartPoint` stale-ref fallback (`Expected "remote" / Received "local-tracking"`). The guard no longer trips on either var.

### New finding 1 — models.dev reverts in build/dev tooling — FIXED (both instances, markers added)

- `packages/ui/vite.config.ts:50` — now `process.env.KILO_MODELS_URL || "https://models.dev" // kilocode_change`. Chain traced: `providerIconsPlugin` hooks (`configureServer`/`buildStart`, gated behind `KILO_FETCH_PROVIDER_ICONS`, `vite.config.ts:35-47`) → `fetchProviderIcons` → `fetch(${url}/api.json)` for provider keys → `fetch(${url}/logos/<provider>.svg)` → writes `src/assets/icons/provider/<provider>.svg`. The restore also brings back Kilo's `KILO_MODELS_URL` env name (upstream `a105350812:48` has `OPENCODE_MODELS_URL || "https://models.opencode.ai"`). Chain sane; models.dev serves the same `/api.json` + `/logos/` shapes.
- `packages/llm/script/recording-cost-report.ts:5` — now `https://models.dev/api.json // kilocode_change`. Chain: manual script pricing `test/fixtures/recordings` cassettes against the catalog. Sane.
- Improvement over base: PR base `4f59fcb666` had `models.dev` in both files but **without** markers; the fix adds `kilocode_change` markers to both shared upstream files, fixing the merge-hygiene half of V5's finding too. Tree sweep at head: zero `models.opencode.ai` hits in `packages/` (excluding lockfiles).

### New finding 2 — markers around upstream-identical TUI test lines — FIXED

- `diff-viewer-file-tree.test.tsx:112-113`: the `kilocode_change start/end` wrapper is removed; the two restored absence assertions remain. `git diff a105350812..77246a52cb -- <file>` is **empty** — the file is now byte-identical to upstream, fully consistent with the marker contract. Comment-only delta vs V5 head; V5's run (3 pass / 1 skip) stands.
- **Cross-report adjudication note (for KILOCODE_CHANGE_MARKERS_V6 / UNNECESSARY_MARKERS_V6):** the policy question from V5 ("markers on restored-but-upstream-identical lines") is resolved here in favor of dropping markers. This is the opposite situation from the still-open locale finding (markers stripped where lines still diverge) — the two are not in tension: mark divergence, don't mark identity.

### Delta item — `repository-cache.ts` file-remote canonicalization — verified sound, no broken link

- **Provenance:** the `match` block is byte-identical to `712346975c` ("fix(core): canonicalize repository cache file remotes", ancestor of HEAD, Aug 6 15:38), which `e958d44860` ("stabilize Windows repository cache validation", 15:56) accidentally dropped 18 minutes later while replacing `root === worktree` with the `existsSafe(.git)` check. `77246a52cb` restores it on top of the newer `root` check (`repository-cache.ts:160-165`). An intra-branch regression, now closed.
- **Chain:** `RepositoryCache.ensure` reuse decision ← callers: `repo_clone` tool (`tool/repo_clone.ts:40` via `parseRemote` — throws `UnsupportedLocalRepositoryError` for file:), kilocode reference materialization (`kilocode/reference.ts:82` — file: marked invalid), core `Reference` finalize (`core/src/reference.ts:77` — `!Repository.isRemote → continue`). All three production entry points reject or skip file: references, so the canonicalized branch (`fs.resolve` comparison for file:↔file:) serves tests/dev/Windows scenarios; non-file behavior is unchanged (`Repository.same`). No link broken.
- **Residual note (no finding):** `fs.resolve` (`fs-util.ts:242-250`) throws on non-ENOENT `realpath` errors (ELOOP/ENOTDIR/EACCES) → would defect `ensure` where the old pure `Repository.same` could not. Unreachable in production today (file: gated above); worth remembering if a future caller admits file: remotes. The delta adds no test for the new branch — existing `repository-cache.test.ts` cases exercise only the non-file path at head.

### Delta item — `kilo-commands.tsx` `/privacy` project-unset — **NEW FINDING (see below)**

## New findings (round 6)

### 1. `/privacy` disable sends `unset` in the wrong wire shape — the project-scope call will 400, and the toggle half-applies

- **Chain:** TUI `/privacy` command (`packages/opencode/src/kilocode/kilo-commands.tsx:200-234`) → `sdk.client.config.overlayUpdate` PATCH `/config/overlay` → payload decoded against `ConfigOverlayPatch` (`packages/opencode/src/kilocode/server/httpapi/groups/config-console.ts:60-67`) → `KilocodeConfigWriter.write` (`handlers/config-console.ts:74-107`) → project/global `kilo.jsonc`.
- **Broken link:** the fix's project-unset call passes `unset: ["privacy_mode"]` (`kilo-commands.tsx:213`), but the server schema declares `unset: Schema.optional(Schema.Array(Schema.Array(Schema.String)))` — an array of path arrays — and the generated SDK type agrees (`unset?: Array<Array<string>>`, `packages/sdk/js/src/v2/gen/sdk.gen.ts:1800`). Every other caller and every server test uses the nested form (`[["permission","edit"]]`, `[["web_search"]]`, `[["model"]]` — `config-overlay.test.ts:116,134,459,571`; `kilo-console/src/client.test.ts:43,50`; `kilo-provider-indexing-refresh.test.ts:231,237`). The handler itself does `unset?.map((item) => [...item])` (`config-console.ts:80`), confirming items must be arrays.
- **Evidence (empirical, against the real schema):** decoding the exact wire body the command sends — `{scope:"project", unset:["privacy_mode"]}` — through `ConfigOverlayPatch` is **REJECTED**: `SchemaError(Expected array, got "privacy_mode" at ["unset"][0])`. The corrected body `{scope:"project", unset:[["privacy_mode"]]}` is **ACCEPTED**. At runtime the endpoint answers 400; the command's `responses.find((r) => r.error)` branch fires the "Failed to update privacy mode (400)" toast and returns early (`kilo-commands.tsx:218-222`) — but the concurrently-sent global `set` in the same `Promise.all` has already persisted `privacy_mode: false` globally. Net state: project `privacy_mode: true` still in place (effective privacy still ON), global now explicitly false, user told the operation failed. The precise scenario the fix targets — privacy enabled at project scope, disabled via `/privacy` — remains unfixed, now failing loudly with a confusing partial write instead of silently no-op'ing.
- **Why typecheck/CI can't see it:** `kilo-commands.tsx:27-28` declares `type UseSDK = any` / `type SDK = any`, so the argument shape is unchecked; no test covers the command (grep for `privacy` over `packages/opencode/test` + `packages/tui/test` finds only a models fixture).
- **Human step:** change `kilo-commands.tsx:213` to `unset: [["privacy_mode"]]`. Optionally: type the TUI SDK client (drop the `any`), or add an endpoint-level test that posts the command's exact payload. Verify in the TUI: enable privacy at project scope, run `/privacy` → expect success toast and effective off.
- **Related residual edge (pre-existing, not regressed by this fix, low):** the enable path only ever writes global. If project config explicitly has `privacy_mode: false`, toggling on sets global `true` but the project-level `false` still wins in the effective merge → "Privacy mode enabled" toast while effective stays off. Symmetric handling (unset project `false` when enabling) would close it; decide whether that state is worth supporting.

## Carried findings — status at `77246a52cb`

The delta's 6 files do not intersect any carried-finding file; contents spot-checked at head:

- **(d) `Schema.is(Model)` silent-drop in `toPublicInfo`** — STILL OPEN: `provider/provider.ts:1128` identical. Human verification unchanged (diff `/provider` output pre/post merge for custom/gateway/copilot models).
- **(e) session-list `?directory=` reroute** — STILL OPEN: `handlers/session.ts:73-75` identical; runtime confirmation on symlinked/nested worktrees still outstanding.
- **(f) `promptCacheKey` narrowing (`@ai-sdk/openai-compatible`)** — STILL OPEN: `provider/transform.ts:1570` (and twin at 1625) intact. Awaiting intent confirmation.
- **(g) modal failure fallback round-trip** — STILL OPEN (low): untouched; only materializes with (d).
- **(h) `ensureDir` lost exists-as-file recheck** — STILL OPEN: `packages/kilo-sandbox/src/filesystem.ts:15-22` still catches only `AlreadyExists`; call site `core/src/fs-util.ts:117-119` untouched.
- **(2) orchestration `stats()`/`prs()` drop the request directory** — STILL OPEN: `packages/kilo-vscode/src/agent-manager/orchestration-setup.ts:42-43` still `stats: () => deps.getStats()` / `prs: () => deps.getPrs()`. The delta's `GitOps.ts` change is in the same directory but unrelated.
- **(1) locale markers stripped in 8 locales** — STILL OPEN: no `packages/ui/src/i18n/` file in the delta; the 12-marked/8-unmarked inconsistency (az/fi/hi/id/pa/sv/ur/vi) stands per V4/V5. See the adjudication note above — the diff-viewer resolution does not bear on the locale case.

## Test outputs (this head)

| Check | Result |
|---|---|
| `packages/kilo-vscode`: `PREFIX=/tmp GIT_EXEC_PATH=$(git --exec-path) bun test tests/unit/worktree-manager.test.ts` | 88 pass / 0 fail — finding-3 residual closure proof (V5: 87/88 per var) |
| Schema probe: `ConfigOverlayPatch` decode of `{scope:"project", unset:["privacy_mode"]}` | REJECTED — `SchemaError(Expected array, got "privacy_mode" at ["unset"][0])` — new-finding evidence |
| Schema probe: same with `unset:[["privacy_mode"]]` | ACCEPTED — `{"scope":"project","unset":[["privacy_mode"]]}` |
| `git diff a105350812..77246a52cb -- packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` | empty — file byte-identical to upstream |
| `rg "models.opencode.ai" packages/` (excl. lockfiles) | zero hits |

## Limitations

- LIGHT round: broad suites skipped by design — no full `test:unit`, no typechecks, no `bun test` over opencode/core/tui. The diff-viewer change is comment-only and verified by byte-diff to upstream; the repository-cache restore is verified by provenance + static chain trace, not by re-running `repository-cache.test.ts` (no test covers the new file: branch at head).
- The 400 conclusion for the `/privacy` unset call is proven at the payload-schema layer (the exact rejection the endpoint's decoder produces), not by an end-to-end HTTP round trip through a running server.
- The pre-existing enable-with-explicit-project-`false` edge assumes project-over-global precedence in the effective merge (standard overlay order); not re-verified live this round.
- Runtime verifications outstanding from earlier rounds are unchanged: (d)'s `/provider` before/after diff, (e)'s worktree scoping, grok request bodies, gateway `m4a` acceptance — all need a live environment (no outbound network here).
- kilo-jetbrains not re-checked; the delta touched no JetBrains files.
