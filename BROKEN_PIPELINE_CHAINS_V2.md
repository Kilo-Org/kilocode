# Broken Pipeline Chains — v2 Verification

**Verdict: v1 finding P2 is fixed and verified at the new head. No new broken chains found in the fix delta.**

## Scope and method

Reviewed PR #12901 at exact reviewed head `cbbbd7217f940b59b1b29964264536c567065327` (worktree HEAD `c5b1427314` sits on top; verified `git diff cbbbd7217f HEAD` touches only the seven v1 report `.md` files, so the source tree is identical to the reviewed head). Re-traced my v1 P2 chain (code mode advertised MCP tools that sandbox deny policy then rejected) adversarially across both gates, swept every `registry.tools`/`describeCodeMode` call site for omitted flags, ran the updated suites and guards, and scanned the remaining delta (`25f4b58d93^..cbbbd7217f`, 56 files — the supplied "49" undercounts the full two-commit range) for new pipeline risks.

## v1 finding status: FIXED (verified)

### Advertisement path — connected

- `SessionTools.resolve` computes `restricted` via `SandboxPolicy.networkRestricted(input.session.id)` at `packages/opencode/src/session/tools.ts:77`, **before** `registry.tools({...})` at `:125`, and passes `networkRestricted: restricted` at `:131`.
- `packages/opencode/src/tool/registry.ts:108` adds `networkRestricted?: boolean` to `Interface["tools"]` input; `describeCodeMode` (`:360-371`) early-returns at `:366` when set; `tools()` at `:390-393` computes the description only when `execute` is present and filters `execute` out of `visible` when the description is undefined. Restricted session ⇒ no description ⇒ no `execute` advertised. Fail-closed even if the `filtered`-vs-`kiloFiltered` set relationship shifts.
- Call-site sweep: `session/prompt.ts:175` only acquires the service (never calls `.tools(`; provides it at `:1699`), so `SessionTools.resolve` is the sole model-turn resolution path. The only flag-omitting production callers are `server/.../handlers/experimental.ts:116` (session-less tool-list introspection; no session exists to evaluate) and `cli/cmd/debug/agent.handler.ts:85` (debug command). Neither feeds model-turn tool definitions. No session-scoped caller omits the flag.

### Execution path — fail closed, predicate-consistent

- `packages/opencode/src/tool/code-mode.ts:222-223`: `restricted` ⇒ `mcpTools = {}` ⇒ empty `catalog` ⇒ `toolTree([])` ⇒ any child reference raises "Unknown tool" from the `@opencode-ai/codemode` confined runtime ⇒ `invokeChildTool` (`:136`, policy-wrapped at `:151`) is unreachable. Nothing is invoked.
- Predicate consistency: the execution gate uses `ctx.sessionID`, set at `tools.ts:80` to the same `input.session.id` used by the advertisement gate at `tools.ts:77`; both call the same `SandboxPolicy.networkRestricted` (`policy.ts:238-241`: `enabled && mode !== "allow"`) under the same `InstanceState.directory`. No session-ID mismatch within a model turn.
- Inverse regression absent: unrestricted sessions keep the full catalog and can execute — positive catalog/execution tests pass, the integration harness pins `sandbox: { enabled: false, network: "deny" }` (enabled=false ⇒ not restricted), and `test/kilocode/sandbox/network.test.ts:43` retains allow-mode `executeMcp` coverage.

### Test coverage — real assertions, wrapper coverage not weakened

- `bun test ./test/tool/registry.test.ts ./test/tool/code-mode.test.ts ./test/tool/code-mode-integration.test.ts` → **76 pass, 0 fail** (v1: 74; net +2: two added tests, one rewritten).
- Isolated runs prove execution: registry restricted test → 1 pass / 1 expect (asserts `execute` not in advertised IDs); code-mode restricted test → 1 pass / 2 expects (asserts "Unknown tool 'github.list_issues'" **and** `called` empty); rewritten remote-authority test → 1 pass / 2 expects (asserts "Unknown tool 'remote.tool'" **and** `called === false`). None skipped.
- The rewritten test still proves the sandbox boundary: `called === false` with a fresh restricted session ID demonstrates nothing was invoked. Dropping the explicit "Sandbox denied" assertion does **not** leave the policy wrapper untested — `executeMcp` keeps direct deny/allow/local coverage in `test/kilocode/sandbox/network.test.ts:20,37,43,59,74`. Residual gap: no unit test would fail if the `executeMcp` wrapper were deleted from `code-mode.ts:151` (unknown-tool tests never reach it; allow mode is transparent) — but that exact regression is pinned structurally by the guard below.

### Guard — still load-bearing

- `bun run script/check-model-tool-network.ts` → exit 0, "4 classified client site(s), policy-aware tool and MCP boundaries verified".
- Its delta updated the wrapper regex from `executeMcp(ctx.sessionID, item,` to `executeMcp(ctx.sessionID, entry,`, matching `session/tools.ts:456-458` (native MCP entry's authority marker preserved before AI-SDK adaptation). The regex matches real code and the script exits 1 on mismatch (`:151`). The guard pins the wrapper layer only; the new catalog gates rely on the unit tests — the two layers together cover both regression modes.

## New findings

None at P-level. Two observations, neither introduced by this delta:

1. `experimental.ts:116` (tool-list HTTP handler) and the debug agent handler can describe `execute` with an MCP catalog regardless of sandbox state. Both are session-less; model turns never consume them. If a future client renders per-session tool availability from that endpoint, it would over-advertise in restricted sessions.
2. Sandbox state is keyed per session ID, so task-spawned subagent sessions resolve their own snapshot (config default / directory preference) rather than inheriting a parent's interactive toggle. Advertisement and enforcement stay mutually consistent per session (both gates use the same predicate on the same ID), matching pre-existing direct-MCP behavior.

## Notable verified chains (rest of the delta)

- **`test:ci` restoration:** six package.json files gained `test:ci` scripts; `turbo.json` defines the `test:ci` task; new guard `script/check-test-ci.ts` passes locally ("ok (25 test-bearing package(s))") and runs in `test.yml` on the linux packages leg before `turbo test:ci` — closes the silent-skip hole for test-bearing packages.
- **`translate-app` deletion:** root script removed; upstream `transform-package-json.ts:323` strips upstream's `translate:app` (tested); skip-list retains the deletions (`script/upstream/utils/config.ts:141-143`, tested). No dangling consumer.
- **`transform-i18n.ts` marker appending:** new unit test pins the behavior (markers only on replaced lines; legacy `.opencode/opencode.json` names preserved); the 20 re-marked `packages/ui/src/i18n/*.ts` files remain valid modules (`en.ts` imports cleanly). Markers in shared `packages/ui` are appropriate (not the Kilo-owned `kilo-ui`).
- **Kimi adaptive effort:** `anthropicEffort` Kimi branch (`transform.ts:1300-1302`) is placed inside the right function, before the upstream `anthropicAdaptiveEfforts` allowlist; reachable in the request path via `:1236` for `@ai-sdk/anthropic` and vertex-anthropic; `isKimiFamily` matches providerID/api.id ("kimi"|"moonshot") or api.url hosts, and `url` is non-optional `Schema.String` (no undefined crash). New `kimi-adaptive-effort.test.ts` passes, including the URL-host fallback.
- **`meta.txt` rebrand:** guarded by new `meta-prompt.test.ts`; `extract-source-links.ts` re-ran with zero drift (CI source-links check safe).
- **TUI `useLocation` removal:** complete, no remaining references in `prompt/index.tsx`.
- **`models.test.ts` cache isolation** (per-process `Global.Path.cache` override) and **`config.ts` ensureGitignore** PermissionDenied/NotFound tolerance: test-only / same-as-v1 handling; annotation guard `--worktree` clean; all new shared-file lines carry `kilocode_change` markers.

## Commands and results

- Provenance: `git rev-parse HEAD` → `c5b1427314`; `git diff cbbbd7217f HEAD --name-only` → only the 7 v1 report `.md` files; `git diff --name-status 25f4b58d93^ cbbbd7217f` → 56 files.
- Code mode: `bun test ./test/tool/registry.test.ts ./test/tool/code-mode.test.ts ./test/tool/code-mode-integration.test.ts` (from `packages/opencode/`) → 76 pass, 0 fail. Isolated `-t` runs of the three new/rewritten restricted tests → each 1 pass, 0 fail, with 1/2/2 expect() calls respectively.
- Guard: `bun run script/check-model-tool-network.ts` → exit 0; `bun run script/check-test-ci.ts` → "ok (25 test-bearing package(s))"; `bun run script/check-opencode-annotations.ts --worktree` → clean; `bun run script/extract-source-links.ts` → no `source-links.md` drift.
- Transform tests: `bun test transform-i18n/skip-files/transform-package-json.test.ts` (from neutral cwd; root `bun test` is repo-blocked by design) → 30 pass, 0 fail.
- New suites: `bun test ./test/kilocode/provider/kimi-adaptive-effort.test.ts ./test/kilocode/session/meta-prompt.test.ts` → 3 pass, 0 fail; `bun test test/models.test.ts` (from `packages/core/`) → 9 pass, 0 fail; `bun test ./test/kilocode/issue-8656-stall.test.ts` → 2 pass, 0 fail.
- Locale validity: `bun -e 'await import("./packages/ui/src/i18n/en.ts")'` → import ok.

## Limitations

- CI `unit (macos)` failed at 1m53s on this head. Subsequent log analysis (authoritative in `TESTS_V2.md`) attributes it to the `sdk-next` embedded-test 10s timeout on macos-15, with zero CLI-shard lines in the job log, while `unit (linux, 1/2)` and `unit (windows, 1/4)` fail three `transform.test.ts` reasoningVariants cases on the delta's new `isKimiFamily` (tracked as F1 in `KILOCODE_CHANGE_MARKERS_V2.md` and P1 in `TESTS_V2.md`). The delta's `models.test.ts` isolation fix passes locally on macOS.
- No live model turn with code mode plus sandbox deny was run; verification is structural plus unit-test controls — now including the combined advertisement/dispatch regression tests v1 required.
- `packages/core` and TUI changes were verified by targeted runs, not full package suites.
- Only `BROKEN_PIPELINE_CHAINS_V2.md` was authored; no source, v1 reports, or other agents' V2 files were modified.
