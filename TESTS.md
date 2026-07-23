# PR #12460 Test-Coverage Review

Reviewed `origin/main...51d8031c9997bd5478bcde715562169f732d04d4` for deleted test files, deleted test blocks, renamed tests, and changed assertions. The audit treated tests in `kilo`/`kilocode` paths and shared tests asserting Kilo behavior, branding, fixtures, or `kilocode_change` behavior as Kilo coverage. I also compared the final runtime shape with upstream `v1.17.9` and inspected the intermediate compatibility-tree repair history.

## Findings

### 1. Medium, high confidence: PTY environment regression coverage was removed without an equivalent assertion

`packages/opencode/test/pty/pty-shell.test.ts:75-102` was deleted. Its `pty environment preparation` case proved that plugin environment values were merged and that forced terminal values won, including the Kilo-specific `KILO_TERMINAL="1"` assertion.

HEAD still makes that behavior material: `packages/core/src/pty.ts:212-222` forces `TERM`, `KILO_TERMINAL`, and `KILO_PTY_ID`, and strips `KILO_SERVER_PASSWORD` and `KILO_SERVER_USERNAME`. The replacement HTTP test, `packages/opencode/test/server/httpapi-v2-pty.test.ts:178-249`, covers plugin environment merge, forced `TERM`, and hook cwd, but it does not assert `KILO_TERMINAL`, `KILO_PTY_ID`, or credential stripping. A repository-wide focused search found `KILO_TERMINAL` in tests only as the core PTY fixture input at `packages/core/test/pty/pty-session.test.ts:47`, not as spawned-process output.

Replacement coverage: partial. The test should be relocated to the canonical PTY HTTP/core path and inspect a child process environment. This is a coverage weakening rather than evidence that HEAD has removed the runtime behavior.

### 2. Medium, high confidence: Kilo stable-markdown coverage needs relocation to the renderer/worker boundary

`packages/ui/src/kilocode/markdown-stable-blocks.test.ts:14-52` was deleted with `markdown-stable-blocks.ts`. The new upstream streaming model intentionally supersedes the helper: `packages/ui/src/components/markdown-stream.ts:61-84` freezes completed top-level tokens and emits completed fences as `mode: "code"`, while `packages/ui/src/components/markdown.tsx:354-411` sends those blocks to the streaming highlighter worker.

`packages/ui/src/components/markdown-stream.test.ts:23-44` replaces the structural portions of the deleted suite: completed fences, completed prose blocks, and a live tail. It also adds delta, replacement, truncation, and fence-splitting coverage through line 193. It does not replace the deleted end-to-end assertion at `markdown-stable-blocks.test.ts:46-52` that the mixed streamed result produces the same final HTML as canonical Markdown. The missing check matters because code fences now bypass `marked.parse(block.src)` and are rendered through a distinct worker/DOM path.

An ad hoc execution of the former mixed-block case confirmed the old helper-level parity assertion cannot simply be restored: parsing the new `mode: "code"` block's raw code with `marked` yields a paragraph rather than a fenced-code element. That is expected from the new architecture, but it demonstrates that the equivalent assertion must move to a `Markdown` renderer integration test with a worker test double or an exercised worker.

Replacement coverage: partial. Relocate the canonical final-render parity assertion; do not restore the deleted helper test verbatim.

### 3. Low, medium confidence: provider-account test removal is structurally intentional, but provider-specific connection-to-request coverage is now indirect

The removed account-projection blocks in `packages/core/test/catalog.test.ts:28-56`, `packages/core/test/plugin/provider-azure.test.ts:76-104`, `packages/core/test/plugin/provider-cloudflare-workers-ai.test.ts:129-163`, and `packages/core/test/plugin/provider-gitlab.test.ts:166-236` asserted the pre-v2 behavior of projecting active credential secrets and metadata into `Catalog.provider.get()`.

That projection is obsolete in HEAD and conflicts with the upstream v1.17.9 integration model: `packages/core/src/catalog.ts:211-239` now leaves catalog records secret-free and derives availability from `Integration.connection`. Request-time credential projection moved to `packages/core/src/session/runner/model.ts:89-106,163-168`. The Kilo-specific organization mapping has direct replacement coverage at `packages/core/test/kilocode/session-runner-model.test.ts:10-55`, and generic credential precedence plus metadata projection is covered at `packages/core/test/session-runner-model.test.ts:269-296`.

The removed Azure, Cloudflare Workers AI, and GitLab assertions therefore should not be reintroduced at the catalog layer. However, no current focused test exercises their full saved connection -> request/SDK option path after the split. The retained provider tests only cover env/config values or direct plugin options. Human verification is warranted for a saved Azure key with resource metadata, saved Cloudflare key with account metadata, and GitLab PAT/OAuth token selection after this integration migration.

Replacement coverage: superseded for catalog projection; partial for provider-specific end-to-end request execution.

## Notable Non-Findings

- The deleted `packages/core/test/pty/input.test.ts` is superseded by `packages/core/test/pty/protocol.test.ts:4-26`, which preserves invalid binary-frame rejection and adds `ArrayBuffer`, control-frame, and replay-chunk coverage.
- The deleted PTY output-isolation suite is superseded by `packages/core/test/pty/pty-session.test.ts:155-203`, which covers detach behavior, cross-session output isolation, replay, exit notification, and attachment rejection after exit. Socket-object reuse is obsolete because the new attach API owns subscriptions with fresh internal tokens.
- The shell move is covered rather than lost: `packages/core/test/shell.test.ts:30-107` covers shell selection/login metadata and Windows Git Bash behavior; `packages/core/test/pty/pty-session.test.ts:225-238` covers configured PTY defaults; `packages/opencode/test/kilocode/shell/shell.test.ts:7-47` retains Kilo PowerShell UTF-8 and prologue behavior. The Darwin test profile explicitly replaces the deleted shell suite with `server/httpapi-v2-pty.test.ts`, and `packages/opencode/test/kilocode/test-profile.test.ts:9-50` validates that selection.
- Kilo branding assertions remain present and were strengthened where behavior changed: `packages/core/test/plugin/provider-kilo.test.ts:20-98` checks the Kilo referer/title headers and provider-id isolation; lines 102-188 verify Kilo Gateway routing, authenticated-token precedence, and anonymous availability. `packages/core/test/plugin/provider-llmgateway.test.ts:38-52` retains the Kilo-branded LLM Gateway headers.
- The compatibility-tree bug did not ship a mass deletion at the reviewed head. Intermediate compatibility commit `a776bd4d29` removed broad Kilo test trees, but the final `origin/main...HEAD` deleted-test-file list contains only four files: `core/test/pty/input.test.ts`, `core/test/pty/pty-output-isolation.test.ts`, `opencode/test/pty/pty-shell.test.ts`, and `ui/src/kilocode/markdown-stable-blocks.test.ts`. `f1e22ebf21` adds the overlay-preservation logic and its regression test in `script/upstream/utils/git.test.ts`.

## Relevant Commands

| Command | Result |
|---|---|
| `git diff --name-status --find-renames origin/main...HEAD` | Final range changes 208 files; four test files are deleted and the shared shell test is renamed to `packages/core/test/shell.test.ts`. |
| `git diff --find-renames --diff-filter=D --name-only origin/main...HEAD` | Deleted tests are limited to the four files identified above. |
| `git diff --find-renames -U... origin/main...HEAD` on provider, PTY, shell, profile, and markdown paths | Confirmed the replacement locations and the catalog-to-runtime integration migration. |
| `bun test test/pty/protocol.test.ts test/pty/pty-session.test.ts test/plugin/provider-kilo.test.ts test/kilocode/session-runner-model.test.ts` in `packages/core` | Passed: 18 tests, 0 failures. |
| `bun test test/plugin/provider-azure.test.ts test/plugin/provider-cloudflare-workers-ai.test.ts test/plugin/provider-gitlab.test.ts test/plugin/provider-opencode.test.ts test/catalog.test.ts test/session-runner-model.test.ts` in `packages/core` | Passed: 61 tests, 0 failures. |
| `bun test src/components/markdown-stream.test.ts src/kilocode/markdown-bidi.test.ts` in `packages/ui` | Passed: 23 tests, 0 failures. |
| `bun test test/server/httpapi-v2-pty.test.ts test/kilocode/test-profile.test.ts test/kilocode/pty-self-command.test.ts test/kilocode/shell/shell.test.ts` in `packages/opencode` | Passed: 13 tests, 0 failures. The suite logged an interrupted indexing bootstrap during cleanup but completed successfully. |

## Limitations

- The review was static plus targeted automated tests. No real external Azure, Cloudflare, or GitLab account was available for the provider-connection manual scenarios in Finding 3.
- Windows-specific PTY spawning and Git Bash behavior were inspected through platform-guarded tests but could not be executed on this Darwin host.
- The existing worktree contained unrelated untracked reports, `CONFIG_REGRESSION.md` and `INFRASTRUCTURE_CHANGE.md`; they were not inspected or modified.

Summary: two Kilo-relevant regression suites were weakened and should be relocated to the new PTY and markdown rendering boundaries. Provider account catalog projections are intentionally obsolete, with Kilo routing covered at request resolution, but provider-specific connection execution needs human verification. Report: `TESTS.md`.
