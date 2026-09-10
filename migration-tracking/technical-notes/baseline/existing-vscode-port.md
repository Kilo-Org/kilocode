# Existing Kilo VS Code extension port — 2026-09-08

## Scope and source

Johnny requires the existing Kilo extension UI and workflows ported onto the v2
backend. The earlier upstream-app wrapper is not an acceptable substitute.
Source is the clean local Kilo commit `d99662338e3ddbd2613ab41fc0369837a6eb4be9`
(package `kilo-code` 7.4.20). No external source fetch was performed.

Imported tracked files: existing host source/assets/audio, all six original
Solid webviews and their workers, Kilo UI components and translation package.
The original activation entry is temporarily `src/existing-extension.ts` while
its backend is adapted. The launch command has not switched to an incomplete
entry. No v1 server or SDK runtime is imported.

The former SDK view contracts are a type-only referenced closure under
`packages/kilo-client/src/ide-types.ts`; this keeps shared UI independent of the
VS Code host package. `src/backend/` implements explicit native-client adapters.
The streaming adapter reuses public `@opencode-ai/client/solid` event folding,
then projects its native state into the existing IPC message/part format.

## Current validation

`packages/kilo-vscode/test/backend-session.test.ts` passes with bundled Bun 1.4:
real isolated native host, create/prompt/history/rename/fork/list/delete,
throwOnError behavior, native streaming projected into original UI events,
shell permission approval and continuation. The entire child process runs under
loopback-only network policy. This is adapter acceptance, not complete UI parity.

Expanded acceptance also covers native question forms (single and multiple
answers, label/value translation, invalid answer counts, dismissal), whole-message
revert/clear, workspace file search/project identity, and tool-file attachment
projection. The adapter joins native coalesced session refreshes before projecting
events; this fixed an observed pending-refresh failure during host teardown.
Numeric, conditional, and external form controls and part-level revert remain open;
unsupported operations currently fail explicitly rather than changing their meaning.

All six original webviews and both workers now build from tracked source in this
checkout. Their original UI dependencies live in Kilo-owned `kilo-ide-ui`; shared
upstream `packages/ui` is unchanged. Browser pricing guards now distinguish
unavailable quotes from genuine free models. Full host integration remains in
progress; a successful bundle is not original-UI runtime acceptance.

The real-host session fixture also verifies opaque native history pagination,
MCP add/connect/disconnect/remove through a real SDK stdio server, and original
slash-command model selection, template expansion, and file attachments. MCP
pending status renders as connecting in the original settings screen. The PTY
create/update/remove/ticket adapter is composed into the facade. Original Agent
Manager terminal routing now obtains native single-use tickets through a local
relay; each panel registers its actual document origin through the existing ready
IPC message. Real-host acceptance covers terminal echo, fresh tickets, removal of
origin access, lifecycle event projection, and cleanup. The native-shaped script
terminal facade is now integrated: headless acceptance executes a real script,
observes its exit code, and removes its PTY. Native terminal rendering remains open.
Native command admission does not expose a caller-supplied message ID, so original
command retry/idempotency behavior still needs a separate disposition.

The existing Remote RPC definition moved without a contract change to
`packages/schema/src/kilocode/remote.ts`, with a CLI re-export. The extension adapter
uses that same public definition; the existing real-host/loopback relay test passes
(1 test, 19 assertions) under external-network denial. Account/auth and terminal
adapters have landed; account review follow-ups and native UI acceptance continue.
The session-usage definition likewise moved unchanged into Schema with a CLI
re-export; original model-usage reads pass against a completed native model step,
and both existing CLI session-usage tests pass.

The original session-process cleanup call now lists native shells by their
originating session metadata and removes only matching shells in the requested
location. Real-process acceptance verifies that the selected PID disappears,
another session keeps the same running PID, and cancellation reports failure
without stopping that other process (9 assertions). Native teardown is
asynchronous. The legacy parent-lifetime reassignment policy has no equivalent
native Shell field and remains part of the outstanding orchestration port.

Original per-agent model-selection messages now use `kilocode.model-state` RPC
instead of the missing v1 `path.get` and extension-side filesystem writes. The
host serializes saves across panels and retains the existing `model.json`
preference fields. Real-host acceptance covers concurrent saves, host restart,
clear/reset, unchanged native preference fields, and malformed JSON refusal
(11 assertions). Native TUI per-agent selection remains in-memory today; this
slice does not claim that its selection behavior has been ported. Native TUI
preference writes still use their existing independent process-local queue.

Memory now uses the shared `kilocode.memory` RPC, including original source-file
selection, stored-item strings, token counts, scope isolation, and explicit purge
confirmation. The composed provider facade exposes the original `provider.auth`
entry point over the native integration registry. Root headless checks pass for
memory (24 assertions) and account/auth (22 assertions). Agent mention positions
also survive native prompt admission and projected history; committed reverts
emit removal events for rows that disappear from that history.

`script/build-existing-extension.ts` builds the original host, six webviews, and
two workers. The native activation runner invokes this build before staging, so
activation cannot silently use an older bundle. The current-source run verified
the original sidebar, editor-tab, and Agent Manager identities with exit code 0;
it did not prove streaming chat or complete workflow parity.

The original UI packages now have local dependency directories with workspace
links resolving inside this checkout. Their utility imports use native
`@opencode-ai/util` path, encoding, and binary helpers, replacing the build's
copied utility shims. The indexing detector uses the existing source-backed
plugin-spec helper. The web build inspects esbuild input metadata and refuses
filesystem sources outside this checkout, except cached third-party dependencies
under `node_modules`. Native helper tests pass (19 tests, 37 assertions).

Johnny reported disruption from repeated VS Code launches. All desktop acceptance
is paused until explicit authorization to resume. Continue headless local checks;
do not treat this pause or the earlier wrapper's tests as original-UI acceptance.
Project-scoped stateless generation now uses a Kilo-owned RPC. Headless acceptance
verifies successful enhancement, branch-name generation with session context,
and commit generation with the caller's diff, while preserving session count and
the full message history. No-change commit generation refuses explicitly.

Explicit configuration refresh is being integrated through the existing settings
RPC. The host reuses the native serialized loader and rereads Kilo project files;
the original Reload command and marketplace refresh no longer request instance
disposal. Core's configuration regression suite passes (39 tests, 142 assertions)
and its package typecheck is clean. RPC and preserved-session/terminal acceptance
remain pending; this is not yet a completed refresh-flow claim.

Package-wide compilation remains in progress while imported dependencies and
roughly 97 SDK methods plus raw routes are mapped. No package-wide pass, final
VSIX, or completed capability row is claimed for this port yet.

## Remaining work

- Integrate and exercise the original webview builds in the extension host.
- Complete native client facade, account/auth, model metadata and settings.
- Finish permission/forms and event projection, including non-chat messages.
- Preserve Agent Manager, terminals, timeline/diff, SCM and editor actions.
- Port missing feature-specific server seams through Kilo-owned RPCs where
  possible; do not silently return successful empty responses for absent work.
- Wire the original activation/manifest and automatic server lifecycle.
- Validate original UI and actual VSIX in isolated VS Code; skip only genuinely
  external checks under the user's local-only constraint and record them.

The canonical plan reopens the three former wrapper rows: current coverage is
31/43, not a completed existing-extension port.

### Autocomplete parser and packaged assets — 2026-09-08

The original autocomplete implementation now consumes the locally available
web-tree-sitter 0.25.10 named types and Query constructor. Its prior 0.24.7
dependency disagreed with its Parser/Language runtime calls. The original host
build copies the runtime WASM, every cached grammar (all declared languages are
present), and the original query files into dist. Parsing and an original
TypeScript context query are verified both from source and in a separate Node
process with only the bundled module and assets in a temporary directory.

The host bundle uses the cached esbuild Node/CommonJS build with the package's
CommonJS Tree-sitter entry. This preserves runtime __dirname asset discovery;
the prior Bun bundle embedded development source paths, which the isolated
packaged test reproduced. All six original webviews and two workers still build
from this checkout. This verifies parser/context infrastructure, not the still
unported FIM/next-edit backend or desktop autocomplete behavior. Desktop tests
remain paused at the user's request; no external hosts or downloads were used.

### Original past-chat and first-use session listing — 2026-09-08

The original `experimental.session.list` callers now use native v2 session
pages. Worktree-family queries resolve the native project and its worktree
registry, while directory queries stay directory-scoped and the original
no-directory first-use check stays global. Root filtering is applied before
pagination; archived sessions are omitted unless requested, following pinned
v1 `KiloSession.listGlobal`. The adapter continues across native pages when
client-side archived filtering removes rows. Labels come from actual native
worktree roots rather than guessed branch names.

A real temporary Git repository and linked worktree validate the unchanged
`handleSessionSearch` consumer, exclusion of unrelated projects/current chat,
worktree labels, title filtering, and the first-use one-session query (9
assertions). No native public archive mutation exists yet, so archive creation
and archived-row pagination remain unverified via real-host acceptance. This
does not claim the separate archive workflow is ported. All work is headless
and local-only.

### Default original UI and wrapper removal — 2026-09-08

At the user's explicit request, the upstream-app wrapper was deleted rather
than retained as another extension mode. `src/extension.ts` is now the original
Kilo activation entry, `script/build.ts` builds that entry plus all original
webviews, and the package manifest contributes the original Kilo sidebar and
commands. `bun run extension` uses this manifest in a dedicated development profile and
extension directory, preventing the installed stable extension from contributing
duplicate toolbar entries. A disable-extension flag alone was insufficient in
the user-observed development window.

The preview package identity is unchanged, so its VSIX replaces the old wrapper.
Wrapper-only browser assets, Vite config, activation code, and acceptance tests
were removed. Connection/daemon and terminal transport code remains because the
original host consumes it. Packaging now requires original webview assets and
rejects the old `dist/web/` payload. No desktop was launched for this change;
remaining backend gaps still apply to the original UI.
