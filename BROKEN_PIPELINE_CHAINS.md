# Broken Pipeline Chain Review

**Verdict: safe after specific fixes.**

## Method and scope

Reviewed PR #12901 at exact head `c69ce6caf638617169509f09e3f5d620eb702146` against merge base `b135b4e10a9028983497bf69cded47b6ce4572ff` and pristine upstream v1.18.0 `32696c425fc0fa1ec285389346cfa1fbe22b670a`. I compared base-to-head, upstream-to-head, both merge parents, and the post-merge fix commit; searched beyond the diff for producers and final consumers; and ran focused positive and negative controls rather than treating compilation as wiring proof.

The PR changes 262 paths (93 added, 167 modified, 2 deleted). Its 159 changed `packages/**/src/**` production files include 54 files containing `kilocode_change`, with 1,251 marker occurrences and 323 paired-block ends. These are inventory counts, not 1,251 independent behaviors. I grouped retained/modified regions into semantic chains and traced config/flags, state and permissions, schemas/types, service/route/tool registration, events/messages, pass-throughs, persistence, and final CLI/TUI/VS Code consumers. The highest-risk chains received runtime controls.

## Finding

### P2: Code mode advertises MCP tools that the active sandbox policy makes unusable

**Expected chain:** `KILO_EXPERIMENTAL_CODE_MODE` enables code mode (`packages/opencode/src/effect/runtime-flags.ts:52`) -> the registry creates `execute` and appends a callable MCP catalog (`packages/opencode/src/tool/registry.ts:151-164,359-390`) -> `SessionTools.resolve` applies the session's sandbox/network state -> the model calls a catalogued child tool -> permission and `SandboxPolicy.executeMcp` authorize it -> MCP transport executes -> streamed `toolCalls` metadata persists and renders.

**Broken link:** `SessionTools.resolve` computes `restricted` at `packages/opencode/src/session/tools.ts:181`, but the registry has already built `execute` from the full permission-visible MCP catalog. Code mode then returns at `:434`, before the ordinary MCP suppression `restricted ? {} : mcp.tools()` at `:436`. The registry catalog (`packages/opencode/src/tool/registry.ts:359-390`) and execution-time catalog (`packages/opencode/src/tool/code-mode.ts:219-224`) filter permission rules but do not receive or apply `networkRestricted`. The child call is still wrapped by `SandboxPolicy.executeMcp` (`packages/opencode/src/tool/code-mode.ts:143-185`; policy entry at `packages/opencode/src/kilocode/sandbox/policy.ts:465`), so sandbox deny mode rejects it before transport invocation. The model therefore receives valid signatures for tools that cannot run and can repeatedly choose a doomed path. This is fail-closed and is not a sandbox bypass.

**Controls and provenance:** merge-base Kilo suppresses MCP resources and direct MCP tools whenever `networkRestricted` is true, but has no code mode. Pristine upstream v1.18.0 has the code-mode early return but no Kilo session-level network suppression. Head combines both without joining the predicates. The 74-test registry/code-mode run proves `execute` is advertised for a connected catalog and proves a sandboxed delegated remote MCP call is rejected with the client callback untouched. No test combines code mode with `SessionTools.resolve` under network deny. `check-model-tool-network` passes because the execution boundary is policy-wrapped; that validates containment, not catalog usability.

**Affected users:** users opting into code mode, with connected MCP tools, in a sandboxed session whose network mode is not `allow` (including the sandbox default `deny`).

**Fix direction:** apply the same session-level `networkRestricted` predicate when resolving the code-mode catalog. In a restricted session, omit `execute` or provide an empty catalog consistently to both description and execution. Add one matrix control for code mode on/off x sandbox network allow/deny that asserts advertised definitions and actual child dispatch.

## Notable verified chains

- **Code mode outside this interaction:** flag -> lazy registry initialization under active `InstanceRef` -> permission-filtered catalog -> plugin hooks -> MCP native authority marker -> sandbox boundary -> attachment/result projection -> running/completed/error metadata -> `SessionProcessor` persistence (`packages/opencode/src/session/processor.ts:229-257,296-305`) -> dedicated TUI renderer (`packages/tui/src/routes/session/index.tsx:1988-1989,2681-2732`) is connected. Success, failure, cancellation, permission, media, plugin-hook, transport, and metadata controls pass.
- **MCP OAuth browser fallback:** `McpBrowser.open` failure -> `mcp.browser.open.failed` publication (`packages/opencode/src/mcp/index.ts:976-979`) -> event inventory/OpenAPI/generated SDK -> VS Code handler (`packages/kilo-vscode/src/KiloProvider.ts:4327-4329`) -> deduped external-browser fallback is connected. MCP lifecycle/OAuth controls pass 34/34.
- **Provider/model data:** models.dev and cache -> Kilo model/provider schema extensions -> catalog/config/custom-loader merge -> reasoning variants/options and endpoint selection -> public serialization/failed-provider list -> HTTP/SDK consumers remains connected. Provider, transform, Codex, and Copilot controls pass 509/509; Core model/session controls pass 95/95.
- **HTTP and session routing:** Kilo handler groups, worktree diff routes, `session.viewed`, viewer service, listener/app layers, session-directory normalization, and SDK shapes remain registered. The persisted-directory prompt control passes alone and confirms the stored session directory wins over the request query directory.
- **Config and filesystem setup:** config source discovery -> optional config-directory creation -> `.gitignore` write -> background dependency install -> `waitForDependencies` consumers is connected. The current head's `ensureDir` handling ignores only `PermissionDenied`/`NotFound`, then the existing safe existence/write and logged background-install paths continue; config controls pass 107/107.
- **Schema/client/message pass-throughs:** MCP browser event, provider `failed`, session `worktreeName`, tool metadata, attachments, routed-model metadata, and step metrics have source schemas/types, generated SDK representation where applicable, forwarding/persistence, and identified consumers. No additional set-never-read, populated-never-passed, emit-without-handler, or schema/client break was established.

## Commands and results

- Provenance: `git rev-parse HEAD` -> `c69ce6caf638617169509f09e3f5d620eb702146`; `git merge-base b135... c69c...` -> `b135b4e10a9028983497bf69cded47b6ce4572ff`; `git rev-parse 'v1.18.0^{}'` -> `32696c425fc0fa1ec285389346cfa1fbe22b670a`. Merge `2847475275` has parents `b135...` and `32696...`. Range: 297 commits, 3 first-parent commits.
- Inventory: `git diff --name-status b135...c69c` -> 262 paths, 93 A / 167 M / 2 D. Production marker inventory -> 159 changed `packages/**/src/**` files, 54 marker-bearing files, 1,251 occurrences, 323 paired-block ends. `git diff --check ... -- packages/opencode/src` -> pass.
- Code mode: `bun test ./test/tool/registry.test.ts ./test/tool/code-mode.test.ts ./test/tool/code-mode-integration.test.ts` -> 74 pass, 0 fail. `bun run ../../script/check-model-tool-network.ts` -> 4 classified client sites, policy-aware boundaries verified.
- MCP: `bun test ./test/mcp/lifecycle.test.ts ./test/mcp/oauth-auto-connect.test.ts ./test/mcp/oauth-browser.test.ts` -> 34 pass, 0 fail.
- Provider/model: four focused provider/plugin suites -> 509 pass, 0 fail. Core model/compaction/runner suites -> 95 pass, 0 fail.
- Config: `bun test ./test/config/config.test.ts` -> 107 pass, 0 fail.
- UI parsing/scroll controls: corrected command `bun test ./src/context/marked-code-span.test.ts ./src/components/scroll-view.test.ts` -> 8 pass, 0 fail. The first command used nonexistent `./test/...` paths and scheduled no tests; it was corrected, not counted as validation.
- Session HTTP: full `bun test ./test/server/httpapi-session.test.ts` -> 22 pass, 1 five-second timeout; immediate isolated rerun with `-t "uses the persisted session directory for prompt requests"` -> 1 pass, 22 filtered, 0 fail. Classified load-sensitive/environmental, not a semantic failure.
- GitHub final recheck: PR head remains exact; `MERGEABLE`, merge state `BLOCKED`; 29 checks successful, 1 neutral, 1 skipped, none pending or failed. GitHub reports target-base head `b1d014c980...`; the review comparison baseline remains the supplied/verified merge base `b135b4e10a...`.

## Limitations

- Runtime controls ran on macOS. All Windows CI shards completed successfully, but I did not manually exercise Windows UI/process behavior.
- I did not run a live model turn with code mode plus sandbox deny. The finding is supported by the contradictory production branches, the positive catalog control, and the negative real sandbox child-dispatch control; the missing combined regression test remains required.
- Marker counts are reliable textual inventory counts, not claims that every marker is semantically distinct. Localization and presentation-only regions were traced to their consumers and grouped rather than enumerated.
- Other untracked root reports appeared during this review and are owned by other reviewers. I did not read for conclusions, edit, delete, or stage them. No source, GitHub state, credentials, or real user state was modified; only `BROKEN_PIPELINE_CHAINS.md` was authored.
