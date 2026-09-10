# Phased Plan - Port Kilo onto OpenCode V2

> [!IMPORTANT]
> Local working copy of
> [Kilo-Org/kilocode#13750](https://github.com/Kilo-Org/kilocode/issues/13750).
> Originally captured on 2026-09-04 from the issue version updated
> 2026-09-04T13:55:36Z; local progress and corrections updated 2026-09-05.
> Johnny will publish these changes to GitHub manually. Continue maintaining
> this file locally; local edits do not imply the GitHub issue has been updated.

> Work In Progress

The separate [scenario test plan](kilo-opencode-v2-test-plan.md) tracks detailed
CLI/TUI and runtime checks. Manual test results are recorded separately from
this implementation inventory; writing a checklist earns no completion credit.

## Active continuation target

Read-only audit references: [pre-cleanup v2 marker inventory](kilo-override-marker-inventory.md) and [v1-to-v2 marker assessment](v1-kilo-marker-port-assessment.md). All 816 marker-bearing files (6,128 occurrences) now have source-assessment dispositions: 65 already ported, 137 native equivalent, 233 partial, 163 needs port, 68 deferred, and 150 not needed. This completed read-only inventory does not add implementation or runtime acceptance credit; implementation remains paused.

### Paused checkpoint — 2026-09-08 (GitHub #13750 / local task JOH-7)

**Implementation is paused at Johnny's request after the bounded response/Stop
fix below. Do not resume implementation or restart delegates without a new
instruction.** This is the local copy of GitHub issue #13750; no GitHub update
or publication was performed.

- The default `bun run extension` entry now builds and opens the **original Kilo
  extension UI**, not the superseded white upstream-app wrapper. Original sidebar,
  editor and agent-manager webviews are built from the transplanted local sources.
  The development launcher uses an isolated short profile/extensions directory,
  removes inherited VS Code launcher variables, and focuses the Kilo sidebar.
  The empty drag-and-drop import warning was removed. No desktop automation was
  resumed for these bounded fixes.
- Original-client adapters have local coverage for sessions/prompts/history,
  permissions/questions, models/accounts, settings/collections/refresh, memory,
  stateless generation, and ticket-based terminals. These are implemented slices,
  **not full VS Code parity or complete UI acceptance**. Johnny reports that some
  workflows now work. The stale shared daemon was restarted with explicit approval;
  the previously missing settings `collectionGet` method was then verified live.
- **Response remained thinking / Stop did nothing:** the event adapter listened
  for legacy `session.status` but did not translate native
  `session.execution.started/succeeded/failed/interrupted`. It now emits the
  original UI's busy/status and turn-close messages, with completion after final
  message projection. Shutdown is not reported as a completed user turn. Successful
  Stop now acknowledges the native interrupt even when local active tracking is
  absent, allowing the provider to clear stale UI state.
- Verification: `packages/kilo-vscode/test/backend-session.test.ts` passes against
  an isolated real host with external networking denied. Its child fixture checks
  busy → completed → idle, Stop on an already-idle session with no cached activity,
  and Stop on an active permission-blocked request, including the interrupted event
  and removal from native active sessions. No live model request was sent. The
  changed lifecycle files have no typecheck diagnostics; the full extension
  typecheck still fails on incomplete port surfaces. The original extension and
  all six webviews/two workers rebuilt successfully; reload the development
  extension window to use the new bundle. Desktop verification remains unrun.
- **Remaining before full port:** missing original backend consumers (including
  sandbox controls, message deletion, agent/skill removal, notifications,
  suggestions, agent-manager/notebook control planes and provider/auth gaps),
  feature-specific services (FIM/next-edit, speech, image generation, Claw and
  remaining cloud/indexing paths), presence integration handback, and full native
  end-to-end acceptance. Existing logs still contain unrelated missing-method
  errors. Review the detailed [existing-port evidence](../kilocode/baseline/existing-vscode-port.md)
  and task-board handbacks before resuming; do not replace missing methods with
  successful no-ops.

Whole-row baseline coverage remains **31/43 (72.1%)**, not a percentage of the
VS Code port. No additional row is closed by this checkpoint. Local-only work
and the prohibition on external-host verification remain in force.

### Existing VS Code extension port — scope correction 2026-09-08

Johnny clarified that phase 5 must preserve the existing Kilo VS Code extension,
including its UI and workflows, while replacing the backend with v2. The earlier
upstream-app embedding does not satisfy that requirement. Its connection, terminal,
packaging, and native-test evidence remains useful infrastructure, not acceptance
of the existing extension port. Sidebar/editor/settings rows are reopened; current
whole-row coverage is **31/43 (72.1%)** until the real surfaces pass acceptance.
Source: local Kilo commit `d99662338e3ddbd2613ab41fc0369837a6eb4be9`.

### Earlier app-wrapper preview acceptance — superseded scope

The latest goal is to implement the VS Code extension. Sidebar chat and editor
conversation rows now pass acceptance through a locally installed VSIX in the
actual VS Code workbench. Historical preview coverage was **34/43 (79.1%)**, meeting the earlier
79% target without changing the denominator or crediting partial rows.
All staging and acceptance are local-only; external deployment remains unverified.

The native run covers sidebar streaming, editor permission approval and model
continuation, independent editor sessions, reconnect, full window reload with
restored conversations, settings persistence to the profile file, New Chat,
and Disconnect. The installed artifact is self-contained; terminal ticket
transport has separate real-host acceptance and Node runtime checks.
See [IDE evidence](../kilocode/baseline/ide-preview-integration.md).

### Earlier Goal 79% continuation — 2026-09-07

Remote heartbeats now advertise the implemented attachment capability, enabling
the consumer's attachment UI without advertising unsupported session cloning.
Remote suggestions now support accept/dismiss, reconnect replay, and one
follow-up admission, with viewer eligibility and interruption cleanup. The
focused remote suites pass (30 tests, 374 assertions). CLI and Gateway
typechecks pass; portable preview `build-r6q70z` builds and launches.

The updater now has real local directory staging and CLI check/apply/rollback.
Parent acceptance through the rebuilt bundled command copied the actual
718,102,380-byte portable artifact (67,140 entries), ran its Kilo launcher,
and rolled back while retaining both builds.
Unit coverage and independent review pass for local staging/rollback; this does
not establish other-platform packaging, archive distribution, or release gates.
See [updater evidence](../kilocode/baseline/updater-local-parity.md).
Sharing's viewer compatibility and post-share deletion/revert contracts remain
open; no external deployment has been accessed or credited.
An isolated cached-runtime attempt stopped during bundling on missing
`pg@8.20.0`; the actual sharing service has not passed a local boot check.
No missing dependency was downloaded.

The [remaining-scope audit](../kilocode/baseline/goal79-scope-boundary.md)
classifies the three cross-client rows as editor-dependent work; host-only
ports cannot close them. Even closing remote and packaging would yield 33/43.
Following the user's "Continue the goal" instruction after that scope question,
local IDE implementation is reopened. External hosts remain prohibited.

### IDE settings accepted — 2026-09-08

The VS Code settings webview row is accepted using the existing Kilo settings
RPC, with no shared App/Core/Server/Protocol changes. The extension command
opens the dedicated Kilo-owned screen; all 18 managed fields use source-backed
controls and profile/project revisions. Real browser acceptance proves
Save/reopen/Reset, project isolation, stale-edit refusal, explicit boolean
drafts, and a narrow viewport. Native extension command activation passes;
VS Code main-process shutdown requires separately reported forced cleanup.
The existing CLI settings suite passes (21 tests, 155 assertions), package
typechecks/build pass, and independent composition/UI reviews find no blockers.
See [IDE evidence](../kilocode/baseline/ide-preview-integration.md).
Sidebar and editor conversation acceptance was subsequently completed through
the installed artifact, as recorded above.

### Goal 70% accepted — 2026-09-07

Accepted coverage is **31/43 (72.1%)**, meeting the requested 70% target.
This batch closes **`kilo.jsonc` key mapping**, **Gateway catalog/BYOK/org
routing**, **Sandbox PTY/MCP/git spawn policy**, and **CLI TUI remainder**.
The denominator stays 43; partial/external-gated rows receive no new credit.

The importer now maps v1 top-level `subagent_depth` to the native v2
`experimental.subagent_depth`, preserving the pinned v1 runtime's top-level
precedence and the identical nonnegative-integer constraint. Authored policies
and other experimental leaves survive. Evidence: **49 importer tests / 216
assertions**, **34 settings/request-policy/model-picker tests**, clean package
typecheck, and parent source review of both actual depth consumers. The new
real isolated-host check reads the imported value through public `config.get`.
See [mapping evidence](../kilocode/baseline/config-mapping-v2-gap.md).

Gateway closure combines the existing native protocol/BYOK/routing and actual
personal/team scope acceptance with all eight source-adapted prompt selectors.
The final prompt checks preserve native composition and user constraints
(**2 tests / 62 assertions**); the complete Gateway package passes **72 tests /
764 assertions**. The new real TUI test shows no routed-model row for an
ordinary response, then shows the actual response-selected model after Auto
execution. Catalog choices and response metadata remain distinct. The
independent prompt review found no blockers. Compiled distribution and deployed
backend verification are separate capabilities and receive no credit here.
See [prompt parity](../kilocode/baseline/model-prompt-policy-v2-parity.md) and
[local scope acceptance](../kilocode/baseline/non-ide-closure-checkpoint.md).

Sandbox closure: the connection-scoped MCP hook confines every local spawn,
including cold add and disabled direct connect. Host decorators refuse both
ordinary and persistent terminal creation before process spawn; the latter is
the native TUI path and uses the existing typed 503 error. Other terminal
operations and daemon infrastructure remain intact. Native local evidence:
**5 PTY tests**, including stock positive controls and both sandbox refusals,
plus **20 shell/MCP regressions**, with clean CLI typecheck and independent
review. Model-requested git is confined by the shell policy; host VCS/snapshot
operations were outside the pinned v1 model-shell policy and remain trusted.
Remote MCP runs on its own host and is not claimed locally confined. No new
Core/Protocol edits were needed for either terminal decorator; the approved
shared-hook count remains eight. See
[sandbox evidence](../kilocode/baseline/sandbox-spawn-next-slice.md).

CLI/TUI closure adds persistent session-scoped memory activity, full source-backed
model details in the relocated dialog, and real-renderer evidence for funded
account rows, actual routed models, per-model usage expansion and indexing
progress/completion. Parent final usage/indexing run: **3 tests / 6 assertions**;
memory sidebar: **4 tests / 11 assertions**; delegate model detail acceptance:
**4 scenarios**, including zero/high context tiers, short viewport and metadata
failure; account/routed: **2 tests**. Existing PR/process restart and agent/Plan
acceptance is retained. The source-reviewed sync-failure toast is not claimed as
fault-injected. Manual UI-081/082/083 statuses remain NOT RUN; real-host automated
equivalents satisfy this implementation row. Native throughput is reused, the
relocated dialog is an intentional v2 layout, absent process description/ports
are not invented, and the shared native branch-watcher limitation is disclosed.
See [CLI/TUI acceptance](../kilocode/baseline/cli-tui-closure-verification.md).

Final portable build **`build-AbricZ`** includes the last tier-threshold fix.
Isolated loopback smoke passes for bundled TUI, daemon start/reuse (same PID),
and default attach/clean exit with the daemon preserved. Measured fixture times:
TUI 7,660 ms; daemon start 722 ms / reuse 205 ms; default attach 1,432 ms.
These are local smoke timings, not an apples-to-apples product benchmark.
Final CLI and Gateway package typechecks, changed-source formatting and diff
checks pass. No external deployment, production updater payload, sharing backend
or remote relay acceptance is claimed. Those rows remain open.

This closes safe import, not every refused legacy feature. Unsupported keys
remain explicit refusals; selected supported subsets require the existing
explicit opt-in. Cross-surface presentation imports and unimplemented IDE
capabilities receive no feature credit. All verification is local-only.


### Goal 62% acceptance — 2026-09-07

Accepted capability coverage is now **27/43 (62.8%)**. The newly accepted row
is **Settings scopes and remaining Kilo-only fields**. The denominator remains
43 (the obsolete Console row is excluded); earlier 26/43 checkpoints below
are historical and are not rewritten as new verification.

Closure evidence: the Profile/Project settings adapter manages 17 native
consumer-backed fields and the Kilo training-model toggle, with native
presentation and domain controls reused. The new real-TUI project scenario
edits and resets an image-width override, verifies profile fallback, and boots
a second isolated host to prove persisted project configuration loads in the
correct order. Parent validation: **2 UI scenarios passed**, **38 focused
contract tests passed / 208 assertions**, package typecheck and diff check
clean. Two delegates independently reconciled the field/scope criteria; the
review's test condition is fulfilled by the parent run. Details and field
sources: [settings parity](../kilocode/baseline/settings-v2-parity.md).

Root acceptance decisions, consistent with the recorded plan scope:

- Reuse native reasoning and shell-output presentation controls without
  claiming identical v1 semantics. Cross-surface import remains in the open
  `kilo.jsonc` mapping row; it earns no migration credit here.
- Keep IDE-only display and commit-generation settings with their separate
  phase-5 capabilities. Explicit unsupported-key reports are not counted as
  implemented features.
- Retain the scalar settings adapter and existing per-domain controls. The
  open community proposal's unified collection editor is not required by the
  recorded decision to avoid porting its entire dialog, and is not claimed
  implemented. Host plugin composition remains fixed.

The CLI/TUI remainder stays open: the parallel audit found remaining visual
coverage, durable memory-marker and model-detail differences. Sandbox PTY/git,
remote, sharing, updater/distribution and config-import rows also remain open.
No external host or deployment verification was used for this acceptance.

MCP hook continuation — 2026-09-07: after the concrete spawn-hook patch was
offered for approval, Johnny requested continuation using the shared Task board.
Proceeding with that bounded exception: one shared production file,
`packages/core/src/mcp/index.ts`, adds a host-configured, connection-scoped
spawn hook. Sandbox policy remains Kilo-owned; no PTY or protocol expansion.
Core typecheck and native MCP lifecycle regressions pass. Independent review
found no blockers; the delegate verified 13 MCP and 7 shell sandbox tests on
the native host. Parent sandboxed verification reports 7 pass / 13 skip, not
additional native acceptance. Portable build `build-udBYOF` passes isolated
loopback TUI, daemon reuse and default attach smoke checks. CLI typecheck
passes after explicit local-config narrowing in the tests. Coordination
uses the shared board inbox and acknowledgments; explicitly stopped agents
remain stopped. This does not add whole-row capability credit.

Continuation toward 34/43 — 2026-09-07: Johnny explicitly requested sustained
work to the non-IDE target and authorized up to ten concurrent delegates.
Active acceptance lanes are settings/config, Gateway prompt selectors, sharing
metadata, remote consumer contracts, native sandbox verification, a concrete
sandbox gate proposal, local updater mechanics and process-sidebar restart
coverage. Parent owns CLI/TUI completion and integration. The implementation
and verification lanes preserve existing work and use isolated fixtures;
deployment, publishing and explicitly gated shared-hook decisions are tracked
separately. Do not grant whole-row credit from a delegate's bounded result.

Local-only constraint — 2026-09-07: Johnny specified no external-host access.
Use local source and isolated loopback fixtures only. Skip deployed sharing,
remote relay, publication and other external checks; keep their acceptance gates
open rather than substituting fixture results. The staging-target question is
resolved as local only.

Local integration follow-up — 2026-09-07: parent ran the combined model-info,
settings UI, prompt-policy, remote-session and updater checks (24 pass, 0 fail),
the process-sidebar UI/unit checks including actual client/server restart
(8 pass, 0 fail), and sharing/selector/cache checks (17 pass, 0 fail). A new
Gateway regression reproduced cross-account snapshot deletion on failed refresh;
the correction retains snapshots on failed reads and scopes authoritative
deletion to the matching identity, with the 60s lifetime unchanged (36 focused
Gateway tests pass, 0 fail). CLI and Gateway typechecks passed at these checkpoints.
The follow-up portable build is `build-0nz3pB`: bundled TUI smoke, repeated
service start with the same daemon PID, real terminal attach/clean exit, and
daemon survival after client exit all passed against isolated loopback fixtures.
The corrected updater fixture suite also passed (14 tests, 0 failures).
Gateway selectors now apply six verified/adapted assets (`anthropic`, `trinity`,
`anthropic_without_todo`, `codex`, `gemini`, `ling`). Gemini/Ling use actual v2
tool parameters and respect configured permission outcomes. Final delegate
wire/unit checks passed (2 tests, 48 assertions). `gpt55` and `beast` remain
deferred, so this does not close the Gateway row.
Updater CLI exposure remains deferred: its working JSON payload is fixture-only,
and archive extraction is disabled. No whole-row acceptance credit is added.

Local-only validation correction: the first new cache-regression attempt used
`backend.url.origin` although that fixture returns a string. This may have
attempted the default Gateway with a dummy fixture key; it failed before the
snapshot assertion and was disclosed to Johnny. The corrected test uses the
explicit loopback string and reproduces the cache bug locally. Inspection also
found the portable TUI smoke's Gateway origin was implicit; it now explicitly
uses its loopback server before the bundled smoke is run.

The latest reliability checkpoint found two regressions in a 539-test run
(528 pass, 9 skip, 2 fail). Both are fixed and independently retested: signed-out
Gateway provider withdrawal, and sidebar claims registered at plugin activation
instead of inside a remountable app contribution. Final bundle/terminal smoke
passed. See `kilocode/baseline/reliability-checkpoint-2026-09-07.md`; this is not
a clean full-suite result or a new whole-row acceptance count.

Johnny clarified that Agent Manager stays with VS Code and requested the
remaining non-IDE work using delegates (2026-09-06). The current target is
**34/43 (79.1%)**, the theoretical ceiling after nine IDE-related exclusions,
not the earlier 35-row target. Eight more whole rows must be accepted beyond
the current 26. Exclusions remain excluded, not completed; the denominator
stays 43. This target is not a claim that every remaining gate can close now.

The next delegated lanes are portable packaging/updater, sharing/remote
contracts, and sandbox spawn coverage. Preserve the isolated `kilo2` preview
identity while developing packaging; publishing releases, replacing an
installed CLI, live-account writes, and new upstream patch exceptions require
their specific decisions. Implement source-backed local slices in parallel;
do not substitute fixture evidence for explicitly deployed acceptance gates.

Latest integrated verification (2026-09-06): with all batch writers frozen,
root ran `dist/interactive/bun run script/test.ts` from `packages/kilo-cli`.
The fresh-artifact wrapper passed **501 tests / 2 skipped / 0 failures /
3,130 assertions across 86 files** in 473.71 seconds. The two skips are the
deliberately gated MCP-confinement host scenarios. This includes the portable
launcher/PTY and accepted R1/R2 work, and supersedes the earlier 481-test
snapshot. It precedes the final R4 consumer-visible streaming correction:
passing integration tests do not override that review blocker. This is not
deployed verification or evidence that remaining whole capability rows are
complete. Accepted coverage stays **26/43**.

Current follow-up review gates (2026-09-06): remote permission/question
translation is accepted as a bounded slice after root independently reproduced
9 tests / 211 assertions and clean package typecheck, and final independent
review found no remaining blockers. Root-ID child replies, eight-parent-edge
ownership, and independent optional-domain live/replay behavior are covered.
Bounded R4 transcript translation is also accepted after root reproduced
11 tests / 257 assertions across the four remote suites and clean typecheck,
and the independent reviewer checked the settled formatted files. A held
model stream proves early assistant info and visible partial text before
completion; terminal reconciliation, worktree-root attribution, ownership
before translation I/O and defect recovery are covered. History lookup remains
bounded to the newest 200 messages. Deployed relay/viewer acceptance and the
remaining remote contracts are still open. The full-suite snapshot above
predates this final R4 correction; focused evidence does not replace it.
The bounded portable internal artifact is accepted after the corrected
no-install dependency copy, safe output creation, canonical link checks, and
single-Solid reactive client fix. Root's fresh combined relocation run passed
both native Auto wire tests and the mounted Kilo TUI model-picker/prompt/reply,
resize and exit checks; Luna confirmed the delta. Its default regression test
is enabled. The follow-up actual relocated `kilo2 serve` readiness/stop and
persistent-PTY websocket round-trip are also accepted: root and an independent
reviewer each reproduced 2 tests / 6 assertions and clean package typecheck.
Success and induced post-create failure both verify owned terminal/daemon
process death. The separate session-terminal PTY is now bounded-accepted too:
root and independent review each reproduced the five-child portable test
(2 tests / 6 assertions), including public websocket I/O, native `stty size`
after resize, and child exit on success and induced failure. The input-echo
marker alone is not command-output proof; the native size response supplies
that evidence. This is macOS arm64 evidence, not other-platform, updater,
release-channel or deployment acceptance. Current package-wide typecheck is
being re-established after the concurrent remote-status delta; portable files
had no diagnostics in the review run.
MCP registration was withdrawn after a
reproduced cold `mcp.add` activation bypass; Linux argv construction is fixed,
but an effective pre-spawn gate and disabled-server direct-connect coverage
are required before re-registration. A narrow Core MCP hook exception has
been requested, not approved. These are work-in-progress slices, not additions
to the accepted count or a new full-suite green claim.

## Summary

Memory save-pulse bounded acceptance (2026-09-07): user confirmed the
five-second green bullet beside `Enabled`, with no saving label or spinner.
Root independently ran 39 tests (180 assertions) across the event and CLI
memory suites; independent source review approved the producer/session/Location
attribution and lifecycle. After formatting, the affected pulse tests passed
again (5 tests / 18 assertions); package typechecks and all eight changed TS
files' formatting are clean. Durable injection markers remain pending, and
same-root/foreign-Location rejection is source-reviewed only. No whole-row
credit is added; 26/43 is unchanged.

Fresh integration checkpoint (2026-09-07): the canonical fresh-artifact
wrapper passed **518 tests / 2 gated skips / 0 failures**, 3,212 assertions
across 89 files (491.56 seconds), including the accepted Terminal Bench
sidebar and corrected indexing renderer assertion. The two skipped MCP
sandbox activation scenarios retain their existing approval gate. This
checkpoint precedes the model-info dialog and memory save-pulse work; it
does not grant either pending slice acceptance or change the 26/43 count.

Model-info bounded acceptance (2026-09-07): the Kilo-owned `/model-info`
dialog is production-wired and independently source-reviewed. The final
test tightening requires the exact inspected model in both scenarios;
root reran 2 tests / 4 wrapper assertions successfully (11.84 seconds),
with clean CLI typecheck and formatting. Public session state remains
unchanged while inspecting a different model. Native picker-attached
layout, full legacy detail parity, cold model-sync error handling and
empty-catalog feedback remain documented follow-ups. No whole-row credit.

Terminal Bench sidebar bounded acceptance (2026-09-07): root reproduced
Gateway 24 tests / 329 assertions and the real-renderer sidebar's 4 tests /
8 wrapper assertions, with clean CLI typecheck. Independent review verified
the tolerant metadata decode, pinned units, durable selected-model lookup and
muted row colors. The ineffective held-response test was removed rather than
counted as evidence; identity clearing is source-reviewed defensive behavior,
not an empirically established no-stale-intermediate guarantee. The separate
model-info-panel benchmark surface, durable memory-marker tone and remaining manual
CLI/TUI checks stay pending. No whole-row credit is added.

Post-R3 full-run result (2026-09-07): the canonical fresh-artifact wrapper
completed with **513 passed / 2 gated skips / 1 failure**, 3,203 assertions
across 88 files (496.06 seconds). `sidebar-indexing-ui.test.tsx` timed out
waiting for a renderer frame. Its immediate isolated rerun passed (1 test /
2 assertions, 3.10 seconds). A later focused run reproduced the timeout after
resize with both labels present: the right-hand scrollbar glyph between the
heading and newline defeated the whitespace-only test predicate. The fixture
now tolerates that chrome while still requiring the Disabled state on the
next non-blank line; independent review confirmed other states still fail.
The affected indexing/bench/usage/memory group passes (9 tests /
18 assertions, 20.19 seconds). This fixes the reproduced assertion failure;
the historical full-run result remains red until a fresh full run succeeds.

Remote R3 bounded acceptance (2026-09-07): root independently reviewed the
replacement queue implementation and ran all five remote suites: **23 tests /
317 assertions, zero failures**, with clean package typecheck and formatting.
Every queue snapshot reads the authoritative pending inbox; no truncated local
queue is presented as complete. Tests cover 65-item FIFO, overtaken reads,
subscription invalidation, another client's admission/cancellation and
cursor-paginated descendant ownership beyond 32 siblings. This focused result
postdates the full-suite snapshot above and does not imply a fresh full run.

### Explicitly pending for later

- Remote: deployed relay/viewer verification, history/ingest authority,
  suggestions and remaining attach/detach/exit/clone contracts, and the
  aggregate inline-attachment budget decision. The pinned consumer discards
  renamed titles; emitting that field is not delivered rename support.
- Documented remote limits: eight parent edges for descendant operations;
  transcript history searches the newest 200 messages; location validation is
  per node, not a transactional tree snapshot. Queue snapshots reflect pending
  state, so items delivered immediately may never appear as queued.
- Packaging: platforms beyond tested macOS arm64, release identity/channels,
  updater/publishing and real-account/backend acceptance.
- Other whole-row gates: six Gateway prompt selectors, remaining required
  settings/config behavior, CLI/TUI parity checks, explicit approval and
  validation of the MCP activation hook, and sharing's cloud/deployment gates.

The detailed boundaries remain in `kilocode/baseline/remote-v2-parity.md`,
`packaging-correction-plan.md` and `non-ide-closure-checkpoint.md`. Deferred
items receive no completion credit; accepted whole-row coverage remains 26/43.

Gateway scope acceptance (2026-09-07): the new real-host loopback fixture is
bounded-accepted after root's run and independent source review plus three
stable repeats (1 test / 2 wrapper assertions; detailed assertions live in the
child fixture). Two Locations exercise personal/team/personal eligibility,
metadata RPCs, organization headers, response-derived routed model identity,
stale selected-model rejection without a Gateway request, and unavailable
catalog drain/recovery. This satisfies the local "real scopes" behavior
criterion, not deployed-account verification. Six legacy prompt selectors
remain unported, so the Gateway row and 26/43 total remain unchanged.

Migrate Kilo onto the OpenCode v2 architecture as a **target-shaped port**, not
a merge of `main` into `v2`, and not a second `packages/opencode` host.

- Branch: `kilo-v2`, tracking a **pinned** `upstream/v2` SHA (record in the repo
  baseline doc). Merge forward once history is shared; perpetual rebase is not
  the standing policy.
- `main` stays the V1 product line.
- Related (different approach):
  [#12887](https://github.com/Kilo-Org/kilocode/issues/12887)

## What this is not

- Wholesale `main` merge into the v2 branch
- Keeping `packages/opencode` as a legacy host on v2 (that package is gone on
  `origin/v2`)
- Dual-running V1 and V2 against the same SQLite file or the same live
  `kilo.jsonc`
- Ambient V1→V2 migration on preview startup
- Implementing the whole product as a stack of plugins (plugins are owner 3.
  Identity, SQLite path, daemon topology, and IDE backends are host.
  Protocol/Schema/Server edits are the exception, not the default.)

## Placement

Each Kilo capability maps to **one** owner:

1. **Catalog / provider** — `catalog.transform`, or a native `packages/ai`
   provider, for model/protocol only.
2. **Host** — product binary and daemon topology. Current path is a from-scratch
   `packages/kilo-cli` (upstream `packages/cli` does not export a wrap surface
   for commands, service manager, updater, or ACP). Cost: re-own `kilo serve` /
   daemon / attach, updater, ACP. Alternative not taken: build the upstream CLI
   under Kilo identity (`OPENCODE_CLI_NAME` / channel defines) plus a narrow
   app-name hook. VS Code, JetBrains, and Agent Manager are Protocol clients of
   the local server — not OpenCode's `sdks/vscode`.
3. **Plugin** — Location-scoped `kilo-*` packages on upstream seams:
   `catalog.transform` / integration transforms, `Tool.Service` registration
   (executable tools; later transform wins on name), `session.context`
   (prompt/tool metadata only — that hook cannot invent executables),
   `tool.execute.before` / `.after`, `permission.evaluate`. Plugins do not add
   Protocol endpoints or become the host.

Clients depend on Schema and Protocol only. Core and Server stay behind HTTP.
Do not call private Core from Gateway or UI.

Prefer, in order: `kilo-*` plugin seams → host `ServerOptions` / identity →
Protocol / Schema / Server only when an upstream endpoint's shape must change →
shared-file patch (marked, counted).

## Fork boundary and upstream updates

The dependency graph is the protection; markers are leftover debt.

Prefer, in order:

1. `kilo-*` packages (`kilo-gateway`, `kilo-memory`, `kilo-indexing`,
   `kilo-sandbox`, VS Code, JetBrains). These are Kilo-owned additions, not
   upstream patches.
2. Upstream v2 seams: `catalog.transform` or native `packages/ai`;
   Location-scoped plugin hooks; `ServerOptions` on the host; Kilo-owned
   Protocol / Schema / Server modules only when the public contract needs a
   Kilo field.
3. Kilo-prefixed paths inside packages we wrap (`packages/cli`, Protocol /
   Schema / Server). Do not create a new Kilo subtree inside
   `packages/core/src/session/runner`.
4. Shared-file patches only when no seam exists. Mark each one with the existing
   Kilo marker convention and keep an exact count. The count must not grow
   without an explicit exception.

**Current approved shared-patch count on `kilo-v2`: 8** (`AGENTS.md`;
`packages/plugin/src/tui/context.ts` `home.logo` slot;
`packages/tui/src/app.tsx` pluginDirectories;
`packages/tui/src/routes/home.tsx` Slot `home.logo`;
`packages/core/src/plugin/sdk.ts` host-enforced post registration;
`packages/core/src/plugin/supervisor.ts` post-config activation;
`packages/core/src/plugin/system-prompt.ts` public exports of its existing
Anthropic/Trinity prompt strings only; `packages/core/src/mcp/index.ts`
connection-scoped host spawn hook). The MCP exception follows the concrete
patch and continuation recorded above. The prompt-export exception is the
narrow option A explicitly offered by Johnny and selected on 2026-09-05:
reuse maintained assets without private raw-file imports or copied prompts.
It does not authorize changing native prompt dispatch or other Core files.
The bounded selector handoff is implemented and independently reviewed below.
The two-file
Core exception was explicitly approved on 2026-09-04 for fail-closed Gateway
routing. Any other shared worktree diff remains outside the approved count and
must be removed or separately approved before landing.

Take `upstream/v2` in controlled steps. Do not merge `main` wholesale into
`kilo-v2`. Avoid Core forks for the migrator, runner, and private APIs; those
are the highest merge tax.

## Store and config

V1 session DB and live `kilo.jsonc` are not compatible with this port. Sharing
them corrupts data.

OpenCode v2's `V1Migration.transformSession` rewrites the SQLite file it opened
(Bun only; Node/workerd is a no-op). OpenCode maps mixed v1/v2 config in memory
and does not rewrite the file.

**Rules**

- **Preview identity is not a customer SKU.** Internally the preview uses a
  separate application identity (`kilo2`) so paths cannot collide with stable
  `kilo` or with OpenCode. Do not ship `kilo2` to customers. The product name
  stays `kilo`. When v2 becomes the default `kilo` binary, move v1 data/config
  dirs aside first, then take the `kilo` paths.
- Same project directory is Location, not the DB file. One SQLite per
  application graph.
- **Boot:** create/open only the `kilo2` file (empty if missing). No `session`
  table means the migrator does not run. If the resolved path is the live Kilo
  or OpenCode store, refuse to serve. Assert/test that upstream
  `V1Migration.layer` is a no-op on empty `kilo2` (no `session` table). The
  ambient fiber may still start; that is upstream debt to watch, not a Core
  fork.
- **Import (phase 6):** explicit and opt-in. Copy the live V1 DB, migrate the
  copy, never the original. Copy selected config keys into a new file; never
  rewrite live `kilo.jsonc`. The host (`packages/cli` / `kilo-cli`) owns
  detection, prompt, and copy-import — not a plugin. Do not ship the prompt
  until the importer exists. Precondition: a read-only schema diff of Kilo
  `main`'s store against the migrator's expected `session` / `session_message` /
  `event` tables, tested on a real Kilo `main` fixture. Note: upstream migrator
  also imports a sibling `opencode-next.db` when present. Also import
  `auth.json` → v2 credentials and map Kilo-only `kilo.jsonc` keys (upstream
  in-memory migrate only knows upstream v1 keys).
- **Rollback:** run the V1 `kilo` binary on the original files. There is no
  reverse migration. Leftover V1 tables on a migrated copy are not a way back.
- Do not fork `V1Migration` to take a destination path. Separate path is host
  identity (upstream already has `OPENCODE_DB` and channel DBs).

## Phases

Completeness is the inventory below, not extra phases. Flip Status on a row when
a slice lands.

### 0 — Isolated identity (internal preview, current)

Internal preview binary: own XDG, empty DB, branding, fail-closed. Not a
customer release.

**Done when:** stable `kilo` and the internal preview run side by side; two
stores; boot does not migrate.

### 1 — Kilo API seam

One real Kilo-owned operation end-to-end through the generated client and a
`kilo-*` plugin/host path, without importing Core. Upstream
`@opencode-ai/client` already covers generic session/prompt/events — that alone
is not this gate. Protocol / Schema / Server edits only when an upstream
endpoint's shape must change; record each exception.

**Done when:** e.g. gateway auth or org switch works through the client + plugin
path with no Core import; any Protocol change is listed.

### 2 — One native conversation

Stream, tools, permissions, interrupt, resume, restart through that contract.

**Done when:** one headless path goes prompt → idle and survives reconnect.

### 3 — Runtime + `kilo-*` packages

Memory, indexing, sandbox, telemetry, gateway policy, skills/agents. Reuse
packages; change registration.

**Done when:** those inventory rows are done or obsolete.

### 4 — CLI / TUI remainder

`/review`, privacy, themes, `kilo run --auto`, export, resume-claude/codex,
`/remote`, `kilo cloud`.

**Done when:** Phase 4 inventory rows are done or obsolete.

### 5 — Product clients

VS Code sidebar, editor tabs, Agent Manager, settings webview, JetBrains.
Capability handshake. Never mix V1 and V2 routes in one session.

**Done when:** Phase 5 inventory rows are done or obsolete.

### 6 — Import / canary / cutover

Host prompt + copy-then-migrate-the-copy. Originals untouched. Canary identity
(`kilo2` vs `kilo` + channel) is an explicit gate before shipping the importer —
not deferred silently.

**Done when:** schema-diff + fixture pass; opt-in import works including
credentials and Kilo config keys; V1 still opens the original store; canary is
isolated.

## Inventory (Kilo-Org/kilocode)

Status: `not-started` · `in-progress` · `done` · `started` · `unknown` ·
`obsolete` · `upstream-equivalent`

The local statuses below record implementation and validation progress. They
do not imply the work has been committed, merged, deployed, or released.

The completion denominator is frozen at **43 active capability rows** (44
including the obsolete Console row). Count only `done` and verified
`upstream-equivalent`; partial implementations receive no completion credit.
The previous requested target of 70% required **31 covered rows** (72.1%).
Johnny's latest direction (2026-09-05) is to maximize verified completion outside
VS Code and JetBrains, while auditing existing ports and reducing upstream
patches in parallel. Keep the 43-row denominator: exclusions are not completed
work, and partial rows do not gain credit. The earlier 60% target required 26
rows and remains historical below.

### Current execution scope

- Continue CLI/TUI, host, Gateway, runtime and explicit import work through
  existing v2 extension seams. Local IDE work is reopened by the continuation
  instruction after the Goal 79 scope audit; begin with VS Code integration.
  JetBrains work remains later in the client sequence.
  Classify the remaining cross-client Phase 5 capabilities individually before
  claiming they are excluded or covered by a CLI feature.
- Use the BB Delegates plugin for bounded implementation, parity verification
  and cleanup audits, primarily through cheaper Kilo models. Preserve exact file
  ownership and coordinate full-suite validation after writers settle.
- Recheck accepted ports against the recorded current-main source, including
  Johnny's reported memory right-sidebar display discrepancy. A completed engine
  or modal does not prove sidebar presentation parity; reopen a row if its
  acceptance scope is contradicted by verified evidence.
- Prefer reusable upstream behavior and Kilo-owned extensions. Audit the actual
  shared-file patch inventory against the approved allowance before landing;
  this direction does not approve new upstream patches or blanket refactors.
- Keep deployment, unsupported-platform and product-decision gates explicit.
  Maximum completion means verified acceptance, not bypassing those gates.

Plan save regression (2026-09-05): the native write tool authorizes
Location-relative resources, while the Kilo policy incorrectly allowed an
absolute plan path. The policy now allows `.kilo/plans/*.md` without granting
external-directory access. Its prompt restores the native save question before
writing and the separate `plan_exit` implementation choice afterward. A real
host regression begins without a plan directory and exercises question → write
→ completion; cancellation, outside-plan denial and configured denials remain
covered. Parent verification: 14 tests / 60 assertions and package typecheck
pass using bundled Bun 1.4. Save consent is model instruction, not a new
deterministic write-approval service. The broader CLI/TUI row remains open.

Follow-up validation (2026-09-05): the settings fixture now waits for native
focus, processed filter text and the selected row before Enter, rather than
matching any visible option text. The delegate recorded three consecutive
settings UI passes; parent independently ran settings UI and memory-sidebar
targets (**5 pass / 0 fail**). Remote catalog/inline-attachment tests also pass
independently (**5 tests / 60 assertions**), as do remote RPC and the updated
wrapped limitation disclosure (**2 tests / 21 assertions**). Remote deployed
transcript compatibility remains open. The former AISDK-compatible adapter
bypassed supplied HTTP middleware and carried account metadata for prompts
and titles. A Kilo-owned native compatible route now replaces that alias;
parent's focused rerun passes **9 tests / 98 assertions**, including a positive
all-wire credential regression. Opus follow-up review confirms the native
delta closes the leak without a protocol/auth/reasoning regression. The stable
snapshot passed the full CLI fresh-artifact wrapper: **443 pass / 0 fail,
2,741 assertions across 77 files** (359.21s, bundled Bun 1.4). Log:
`/Users/johnnyamancio/.bb/thread-storage/thr_qr9z7p3cqc/native-route-full-cli.log`.
Post-snapshot cleanup shares the two native routes' parser/isolation helpers
inside `packages/ai/src/kilocode/routed.ts`, preserves dialect option handling
and explicit `extraBody`, and strengthens the real server-value sentinel.
Parent independently reran **10 AI tests / 82 assertions** and **9 CLI tests /
98 assertions**, all passing, plus AI typechecks. The full 443-test result
above predates this cleanup; it is not relabeled as a post-cleanup full run.
Independent review retracted the title-specific explanation:
title generation uses normal request preparation and native-route titles are
covered. Compiled Auto package loading is a separate open gate: isolated Bun
1.4 probes confirm runtime `import.meta.resolve`/dynamic loading fails for the
new route in a compiled executable. The current compiled headless artifact
does not include that plugin, while the interactive preview is source-mode;
this is not evidence that today's source preview cannot load Auto. No compiled
Auto end-to-end flow has passed. A build-time rewrite of Core's builtins would
still be an upstream override and has not been approved.
These focused results neither close
those rows nor replace a coordinated full-suite run.

Independent remote review subsequently found an uncovered catalog-alias bug:
wire selections must use catalog `id`, not provider-route `modelID`. The
identity fix now uses `source.id` for wire identities and the configured
default. Final parent rerun: **7 remote tests / 90 assertions pass**. The
regression derives the selection from the advertised catalog, creates the
session through the relay, checks the persisted/current identity and admits
the prompt through relay `send_message`. Admission does not prove model
execution. A separate remote aggregate
attachment-budget concern remains under review; no new arbitrary payload
limits are implied by the existing Core per-file limit.

| Capability | Owner | Phase | Status |
|---|---|---|---|
| Kilo logo / branding | 4 shared patch or upstream hook | 0 | done |
| Isolated `kilo2` identity + config/data dirs | 2 host | 0 | done |
| Gateway device auth / profile | 3 plugin (`integration.transform`) | 0–1 | done |
| Organization / team (`/teams`) | 3 plugin (+ TUI); Protocol only if shape must change | 0–1 | done |
| Gateway catalog, BYOK, org routing (`kilo-gateway`) | 3 plugin (`catalog.transform`) + approved host-policy seam; local scope, response metadata and all eight prompt selectors accepted | 1, 4 | done |
| `kilo serve` / daemon / attach | 2 host | 1 | done |
| Generated JS SDK | upstream `@opencode-ai/client`; Kilo = plugin/RPC typings only if published | 1 | upstream-equivalent |
| Session share / unshare / fork-from-share | 3 plugin + Kilo backend; Protocol only if fork-from-share needs it | 1 | in-progress |
| Memory (`/memory`) | 3 + reused `kilo-memory`; current-main UI/engine gate reconciled below | 3 | done |
| Codebase indexing | 3 + `kilo-indexing` | 3 | done |
| Sandbox tool shells (macOS/Linux) | 3 + `kilo-sandbox` (`shell.hook` / tool path) | 3 | done |
| Sandbox PTY / MCP / git spawn policy | 2 host decorators + approved MCP spawn hook; model git covered by shell confinement | 3 | done |
| OpenTelemetry / telemetry | 2 or 3 | 3 | done |
| Kilo Swarm | 3 plugin + narrow host permission callback; persistent root/descendant board | 3 | done |
| Skills, custom agents, `.kilo/agents` | 3 | 3 | done |
| Project config discovery (`.kilo/`, `kilo.jsonc` vs `.opencode`) | 2 host seam or accept upstream names | 0–1 | done |
| TUI `/settings` appearance / input controls | upstream TUI; reuse existing dialog | 4 | upstream-equivalent |
| Persistent preview TUI presentation settings | 2 host through upstream config interface | 0–1, 4 | done |
| Settings scopes and remaining Kilo-only fields | 2 host + Kilo UI seams; scoped comparison and acceptance recorded above | 4 | done |
| Generic `/review` command | upstream command plugin; Kilo host reuse | 4 | upstream-equivalent |
| Kilo review scope/policy extensions | 3 command plugin delta | 4 | done |
| CLI TUI remainder (Kilo sidebar, built-in agents and custom Plan workflow) | 2 host + 3 TUI/agent/plan policy extensions; automated local equivalents and v2 layout decisions accepted | 4 | done |
| Headless text run/resume, explicit per-run `--auto` | 2 host using upstream client/execution | 2, 4 | done |
| Headless piped input / local attachments / final JSON result | 2 host using upstream prompt attachments | 4 | done |
| CLI model / visible-agent selection inventory | 2 host using upstream inventory APIs | 4 | done |
| Local v2 session listing / export / fresh-copy import | 2 host using upstream transfer/client | 4 | done |
| Resume Claude/Codex sessions | 2 host; format-specific import required | 4 | done |
| `/remote` | 2 + Gateway | 4 | started |
| `kilo cloud` CLI client | 2 + Gateway | 4 | done |
| Updater / update channel / packaging | 2 host (consequence of kilo-cli path) | 4 | in-progress |
| ACP | 2 host (upstream in `packages/cli`, not exported) | 4 | done |
| Credential import (`auth.json` → v2) | 2 host; explicit opt-in, source-proven mappings and fail-closed refusals | 6 | done |
| `kilo.jsonc` key mapping (Kilo-only keys) | 2 host; safe mappings and explicit unsupported-key refusals | 6 | done |
| V1 schema-diff + fixture import test | 2 host | 6 | done |
| VS Code sidebar chat | 2 client; preserve existing Kilo UI, migrate backend; wrapper acceptance insufficient | 5 | started |
| VS Code editor tabs | 2 client; preserve existing Kilo panels and restoration | 5 | started |
| Agent Manager | 2 client | 5 | not-started |
| VS Code settings webview | 2 client; preserve existing settings UI; reuse verified RPC authority | 5 | started |
| Inline autocomplete / FIM | 2 client; deferred editor consumer, classified in scope audit | 5 | not-started |
| Code actions, enhance prompt, git commit generation | 2 client; deferred editor/SCM consumers, classified in scope audit | 5 | not-started |
| Task timeline, diff viewer | 2 client | 5 | not-started |
| Voice / speech-to-text | 2 client + transcription provider; deferred capture surface | 5 | not-started |
| JetBrains plugin | 2 client | 5 | not-started |
| Kilo Console | — | — | obsolete |

**Overlap with upstream v2** (do not rebuild): permissions, MCP, snapshots,
compaction, session fork, ACP, plugins, subagents, `webfetch` / `websearch`,
daemon HTTP+SSE. Port Kilo policy on these, not a second engine.

This list describes reusable engines and UI primitives, not complete Kilo
product parity. In particular, upstream ACP/daemon code does not supply the
missing `kilo-cli` command/attach surface, and a TUI feature does not complete
its VS Code or JetBrains inventory row.

The [extension-led surface audit](../kilocode/baseline/extension-surface-inventory.md)
expands these coarse rows into cross-client acceptance checks. Distinguish
source-present, UI-observed, local-workflow-tested and live-contract-verified
evidence. The frozen row percentage is not a percentage of all Kilo user
workflows. New gaps in completed scope reopen its row; genuinely unassigned
scope candidates stay visible pending an explicit inventory revision.

## Check v2 overlap before porting v1 work

Before implementing any inventory item, recent v1 addition, or relevant open
community PR, compare the intended behavior with the actual v2 implementation.
Existing Kilo steering/review skills were written for v1: retain their useful
working principles, but verify architecture, paths, APIs, and validation commands
against this checkout rather than treating v1-specific instructions as v2 facts.
Record the v1 PR/commit and its state separately from the port decision. An open
proposal is a candidate to evaluate, not a shipped-v1 parity requirement.

Classify each capability as:

- **Reuse:** v2 already supplies the behavior. Use its engine, component,
  endpoint, or command; do not copy the v1 implementation.
- **Delta only:** v2 supplies the base, but Kilo still needs policy, fields,
  branding, config compatibility, persistence, or host/client wiring. Name that
  difference explicitly and implement only it.
- **Port:** a required behavior is absent. Re-implement against v2's seams.
- **Unverified / deferred:** evidence or a product decision is still missing.
  Do not infer equivalence from a matching command name or silently discard a
  v1 capability.

Check command reachability, saved versus process-local state, project/global
scope, server versus client policy, headless/IDE behavior, data coverage, and
restart behavior. A registered placeholder is not implementation; an upstream
implementation that the Kilo host disables or does not wire is not delivered
parity. Preserve regression cases that describe the required behavior even
when the v1 patch itself becomes unnecessary.

Repeat this check when v1 PRs merge and when the consumed v2 snapshot changes.

Current-HEAD upstream `/review` plumbing was verified before implementing its
Kilo delta. The first isolated host test passed 20 assertions with the generic
upstream template; that historical result did not prove Kilo policy parity.

The current Kilo-owned `src/review-policy.ts` registers through the public command
plugin seam. It adds explicit staged/unpushed/Agent Manager worktree scope rules,
base-ref validation and quoting guidance, effort selection, untrusted-data rules,
review-phase no-edit guidance, and Kilo review criteria/output. Deprecated
`local-review` aliases fail with replacement instructions before model execution.
Explicit user-configured `/review` commands still take precedence. No Core command
implementation or shared hook was changed for this extension.

`test/review.test.ts` and `test/review-policy.test.ts` now pass 4 tests / 45
assertions: public inventory, literal guidance (including `$&`), attachments,
bare/default input, queued delivery, settled model output, alias refusal, and
user override precedence. This proves policy delivery and command behavior,
not a model-quality evaluation or enforced filesystem sandbox. Git scope/no-edit
rules remain advisory model instructions, as in the v1 policy. The generic
upstream config-command string substitution still interprets `$&` specially;
the Kilo policy preserves it literally without changing upstream config code.
Keep the existing dev-fix triage lane for individual bug fixes. Neither lane
authorizes cherry-picking wholesale or increasing the shared-patch count.

### Initial overlap audit — 2026-09-05

Source inspection uses Kilo v1 `origin/main`
`1536aef0fbe96c4575d23e9de2d50ba897f6b8ac` and the actual checked-out v2 HEAD
`59b29de40966803e2c7cd734d439843fb773f6a6`. The baseline document still records
`76dbaf20adbd43fd208a00ef3cda4a51e125a234`; `/settings` was also verified at
that older pin. Do not attribute newer capabilities to that pin: for example,
the current `/stats` module is absent there. Reconcile the baseline record with
the consumed snapshot separately; this documentation audit changes no refs.
PR states below were checked through GitHub; behavior classifications are
source evidence, not fresh runtime parity tests. This is an initial audit, not
an exhaustive list of v1 additions.

| V1 capability / proposal | V1 state | V2 evidence | Port decision |
|---|---|---|---|
| In-app `/settings`, [#12502](https://github.com/Kilo-Org/kilocode/pull/12502) | Open, not merged | `packages/tui/src/app.tsx` opens `DialogConfig`; `component/dialog-config.tsx` edits theme, input, transcript, diffs, and attention settings | Reuse presentation controls; delta only for durable Kilo settings, scopes, and uncovered product fields. Do not port the entire v1 dialog. |
| Provider/model/agent/plugin controls included in #12502 | Open proposal | Existing `/connect`, `/models`, `/agents`, `/plugins`; `component/dialog-integration.tsx`, `component/dialog-model.tsx`, `component/dialog-agent.tsx`, `feature-plugins/system/plugins.tsx` | Reuse existing controls where behavior matches; compare disable/re-enable, persistence, and Kilo host plugin restrictions individually. A collection of commands is not full parity with the proposed unified settings page. |
| Saved auto-approve and its slash command, [#12444](https://github.com/Kilo-Org/kilocode/pull/12444) | Merged | `app.tsx` provides `permission.mode`; `context/permission.tsx` holds local mode, and `routes/session/index.tsx` replies to visible permission requests | Delta only. V1 saves a server-side global rule shared with IDE/headless clients; v2's TUI toggle is not equivalent. Preserve scope/policy requirements; reuse permission machinery. |
| Last-commit diff view, [#13257](https://github.com/Kilo-Org/kilocode/pull/13257) | Merged | `feature-plugins/system/diff-viewer.tsx` exists; `packages/schema/src/vcs.ts` modes are `working`, `branch`, `committed` | Reuse the viewer; retain the exact `HEAD~1` to `HEAD` behavior as a delta to verify/port. Branch-commits-only is not automatically last-commit parity. |
| Copy/export transcript versus generated summary, [#11504](https://github.com/Kilo-Org/kilocode/pull/11504) | Summary proposal open | `routes/session/index.tsx` implements `/copy` and `/export`; `packages/core/src/session/transfer.ts` exports/imports projected transcripts | Reuse transcript transfer and UI. A non-destructive model-generated summary is a separate candidate, not fulfilled by copying text or compacting a session. CLI wrappers and IDE surfaces remain separate work. |
| Themes, reasoning visibility, paste behavior, attention controls in #12502 | Open proposal; existing v1 controls also used | `component/dialog-config.tsx`, `config/index.tsx`, and `feature-plugins/system/notifications.ts` already own common presentation/notification behavior | Reuse; only Kilo defaults, identity, extra controls, persistence, and event-policy differences need work. Preview currently disables attention by default. |
| Privacy mode, [#12442](https://github.com/Kilo-Org/kilocode/pull/12442) | Merged | JSON export supports sanitization, but the inspected v2 TUI settings have no equivalent `privacy_mode` control | Keep screen-level PII privacy as an explicit CLI/TUI delta; sanitized export does not provide live-screen privacy. |
| Plugin loading and lifecycle | Present in inspected v1 source | `packages/core/src/plugin.ts`, `packages/core/src/plugin/host.ts`, and `packages/cli/src/commands/handlers/plugin/` provide lifecycle and host/CLI machinery | Reuse the v2 engine. Kilo built-ins, legacy hook compatibility, and exposure through the Kilo host remain deltas; do not transplant the v1 loader. |
| Skills discovery and model guidance | Present in inspected v1 source | `packages/core/src/skill.ts`, `packages/core/src/skill/discovery.ts`, and `packages/core/src/skill/instructions.ts` supply permission filtering, remote discovery/cache, and delta-aware guidance | Reuse discovery/instruction machinery. Compare Kilo trust provenance, `.kilocode`/`.kilo` roots, built-ins, project boundaries, and trusted `!cmd` expansion separately; do not drop those behaviors based on generic skill support. |
| MCP tools, prompts, resources, and OAuth | Present in inspected v1 source | `packages/core/src/mcp/index.ts`, `packages/core/src/config/plugin/mcp.ts`, and `packages/server/src/handlers/mcp.ts` supply location-scoped MCP operations and configuration | Reuse core MCP. Kilo MCP Apps and Kilo CLI/UI wiring remain deltas; generic MCP support does not establish Apps parity. |
| Theme engine and chooser | Present in inspected v1 source | `packages/theme/src/tui/schema.ts` and `packages/tui/src/component/dialog-theme-list.tsx` provide semantic light/dark themes and selection | Reuse the v2 schema/chooser. Translate Kilo palettes and branding, and wire persistence through the host; v1 theme JSON is not assumed drop-in compatible. |
| Usage/context statistics and poster | Present in inspected v1 source; surfaces differ | Current HEAD has `packages/core/src/session/stats.ts` and `packages/tui/src/feature-plugins/system/stats.tsx`; the recorded pin does not | Partial reuse. Aggregate session statistics and the upstream token poster do not establish parity with Kilo's compact usage display, context accounting, or shareable poster. Compare fields, aggregation windows, and host exposure before porting adapters. |

### Settings-specific acceptance

The community settings PR #12502 includes provider/model/agent/plugin controls,
project/global scope switching, immediate saves, permissions, and Kilo-specific
fields. The existing v2 `/settings` dialog covers presentation preferences;
it does not establish equivalence for every proposed field or workflow.

The initial audit found `packages/kilo-cli/src/tui.ts` supplying
`config.get/update` from an in-memory object. The host now uses
`src/tui-config.ts` through that same upstream interface to persist presentation
preferences in the isolated profile's `tui.json`. New config instances restore
saved values; atomic writes preserve the file on failure. Host-owned plugins
remain fixed, and provider/model config is not persisted through this interface.
Malformed files report an error instead of being replaced with defaults;
preflight rejects symlink/hardlink storage. These cases have focused tests.

This closes global preview presentation persistence, not the open community
PR's full scope. The subsequent scoped adapter and per-field comparison are now accepted in
the Goal 62% checkpoint above. Profile/Project edits, consumer-backed scalar
fields and existing native controls satisfy this row; full unified collection
editing and cross-surface v1 import are not claimed. No v1 config server or
second settings engine was imported.

## Current implementation and validation — 2026-09-05

### User smoke-test follow-up — model and agent parity reopened

Johnny confirmed that models appeared after selecting the Kilo team. Do not
continue treating this as an unresolved login failure. **Favorites already
exist** in the native picker; this profile has none saved. Preserve native
favorites, recents, search and selection persistence; neither seed favorites
nor silently import the v1 preference store.

The Gateway and Memory rows were reopened for the parity gaps below. That
reopening reduced coverage to **24/43 (55.8%)**. The subsequently verified
credential-import and Memory gates bring current coverage to **26/43 (60.5%)**. Earlier
checkpoints do not establish that the reopened gaps are complete. Keep the denominator
at 43. Kilo built-in agents and custom Plan behavior belong to the existing
in-progress CLI TUI remainder row. The completed custom-agent discovery and
CLI inventory-listing rows do not establish built-in Kilo mode parity.

#### Memory parity correction — 2026-09-05 user smoke test

Johnny still observes duplicate memory entries and a less polished dialog.
Remote `refs/heads/main` was checked read-only with `git ls-remote` and still
equals local `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`; this is not newly
landed UI after our reference snapshot. Current main's
`packages/opencode/src/kilocode/cli/cmd/tui/component/dialog-memory.tsx`
already has a selectable command menu, structured status/source/item panels,
auto-save activity, refresh, and scroll/page controls. At reopening, our
`tui-plugin/memory.tsx` was a simplified alert-based replacement. The current
batch now reuses the engine and supplies a native selectable menu plus
structured, refreshable Status/Show panels through existing public UI seams.

- [x] Replace plain help/status/show alerts with source-backed current-main
  interaction parity through v2 UI seams; do not fabricate unsupported fields.
- [x] Prove one actionable memory entry in both slash autocomplete and command
  palette. The real-renderer regression now counts actionable rows in both;
  `suggested: false` removes the extra Suggested entry while retaining the
  command. No stale-process assumption is used to dismiss the report.
- [x] Reconcile the full memory feature contract before restoring row credit:
  the real current-main digest/consolidation engine, durable autosave/injection
  statistics and opted-in execution grouping are now ported. The integrated
  snapshot reader passes a real canonical Git/model fixture (`+1/-0`), while
  missing bounds remain unavailable. Independent source review confirms v1
  never supplies a dedicated memory-model setting and its consolidation cost
  is hardcoded zero; absent v2 provider usage is not a lost shipped gate.
  The focused engine suite has 171 passing tests; host/diff/UI has 31. V2
  execution-drain grouping remains explicitly different from v1 per-turn
  events, with opt-in baseline, steering, interruption and cancellation proofs.

See [memory boundary and correction](../kilocode/baseline/memory-v2-parity.md).
Previously passing tests remain evidence for their bounded implementation,
not proof of latest-main product parity. The subsequent runtime/UI work is
documented in [Memory UI evidence](../kilocode/baseline/memory-ui-v2-parity.md).

Source comparison uses local v1 `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7` and the current v2 checkout based on
`59b29de40966803e2c7cd734d439843fb773f6a6`, not the older pinned snapshot.
This is source evidence, not a fresh deployed Gateway response capture.

- [x] **Gateway-first presentation:** make Kilo Gateway the primary presented
  provider in the Kilo picker/connect flow. Native
  `packages/tui/src/component/dialog-model.tsx` now accepts an optional host
  presentation policy; Kilo supplies its priority, upstream keeps `opencode`
  first. Preserve explicit user model choices and other connected providers;
  presentation priority must not silently switch a session's model.
- [x] **Recommended models:** trace Gateway recommendation metadata through
  the v2 catalog and render the Kilo recommendation ordering/group. V1
  `packages/kilo-gateway/src/api/models.ts` maps `preferredIndex` to
  `recommendedIndex`; its VS Code selector consumes this field. That is
  evidence of Kilo product behavior, not proof the old CLI had the identical
  layout. Use actual catalog metadata, not a hardcoded popular-model list.
  Audit remaining Kilo model groups/badges and record reuse versus missing
  deltas individually; a generic provider list is not full presentation parity.
  Source correction: v1 CLI uses Favorites and Recent, matching the native v2
  selection-history surface. **Most Used** is a separate VS Code count/timestamp
  feature, not a CLI acceptance gate; it remains in the product-client inventory.
  The scoped catalog now carries real recommendation order; source BYOK and
  training-disclosure flags appear in native rows, including favorites/recents.
  Missing flags are not privacy guarantees. A real team-switch fixture proves
  personal labels are cleared. This is not the full v1 model-info panel.
- [x] **Picker first-render consistency:** user confirms correct final groups
  but sees the native ungrouped list first for about a second. Current
  `DialogModel` initializes/clears groups before awaiting the Kilo metadata
  request; `createModelPicker` fetches on each dialog open with no cache.
  Avoid rendering an actionable list that changes order underneath selection.
  Prefer account-scoped metadata ready before display, with an honest loading
  state for a cold request and usable failure fallback. Test delayed responses,
  reopening, keyboard selection and invalidation on account/location changes;
  never reuse another account's recommendations. Cold loading, failure fallback,
  ready-empty search and confirmed close/reopen are now tested (two fresh RPCs,
  no cache); the real renderer additionally proves a personal-to-team switch
  replaces inventory and waits for fresh scoped metadata before selection.
- [ ] **Kilo auto models (remaining acceptance):** real `kilo-auto/*` catalog
  IDs and `autoRouting` now pass through discovery, grouping, selection and the
  source-selected native transport. OpenRouter Auto uses a Kilo-owned route that
  captures a response-selected model; explicit compatible Auto keeps the
  existing compatible extractor. This does not close the row: verify eligible
  catalogs and unavailable selections across real scopes, and show a routed
  model only when response metadata actually supplies it.
  V1's model adapter carries `autoRouting`; its constants reference
  `kilo-auto/free`, and its tests cover `kilo-auto/efficient`. These are source
  examples, not a guaranteed current availability list.
- [ ] **Kilo built-in agents:** compare v1
  `packages/opencode/src/kilocode/agent/index.ts` with native v2 agents and
  register only missing policy/prompt deltas through supported extensions.
  Cover Code (`build` compatibility), Ask, Debug, Plan and Explore behavior,
  primary versus delegated visibility, permissions, explicit agent selection
  and custom-agent precedence. V1 marks Orchestrator deprecated: record its
  compatibility decision separately rather than restoring it as an active
  default merely because it exists in the source. Do not duplicate v2's
  agent registry or subagent execution engine.
- [x] **Build → Code display rename:** Kilo's built-in coding agent is named
  **Code**, not Build. Preserve the native v2 `build` ID in sessions/API calls
  for compatibility; do not rewrite stored sessions or create a second coding
  agent merely to change its label. Picker/composer, assistant footer,
  agent-switch notices and subagent labels must use the registered display
  name rather than title-casing the ID. The post policy supplies Code; native
  UI name lookup also respects other registered/custom names and falls back
  to the ID only when no agent metadata is available. Real TUI coverage checks
  Code in picker/composer/history and switching while assistant records retain
  `agent: build`. Headless `run --agent code` now resolves native `build` only
  when no real custom `code` agent is registered; create and resume are both
  host-tested with paginated history. Native default resolution already handles
  `default_agent: code` by falling back to `build` when no real `code` agent
  exists; a local-model host test proves that resolved assistant identity,
  custom `code` precedence and explicit `ask` selection without a config
  override. Session creation alone defers agent resolution. Explicit generic
  API `agent: code` remains unsupported; clients must use advertised IDs.
- [x] **Kilo custom Plan workflow:** compare v1 `native-plan-prompt.txt`,
  `tool/plan.ts`, `plan-file.ts` and `plan-followup.ts` under
  `packages/opencode/src/kilocode/` against v2's `packages/core/src/plugin/plan.ts`.
  Port the missing context-first, one-question-at-a-time planning guidance,
  plan-file-only writes and execution permission boundaries, saved-plan
  validation, completion/handoff and explicit transition to implementation.
  A renamed native Plan agent or copied prompt alone is insufficient. Verify
  user rejection/cancellation cannot begin implementation and custom agents
  do not accidentally inherit built-in-only restrictions.
  Nine real-host tests now cover native Form approval, rejection/cancellation,
  refinement, invalid/free-form choices, saved paths, custom-agent precedence,
  configured denials, and model-preserving new-session handoff. The Kilo-owned
  post replacement reuses the bound native question executor and changes no
  shared Core path. See [Plan evidence](../kilocode/baseline/plan-v2-parity.md).

#### Right-sidebar parity — user smoke-test follow-up

The current `packages/kilo-cli/src/tui-plugin/tui.tsx` now registers additive
memory and account-credit views through native sidebar slots. The remaining
sections and broader validation below are still open. Track this work under
the existing CLI TUI remainder row; current coarse coverage, including the
completed credential and Memory gates, is **26/43 (60.5%)**.

- [ ] **Memory:** show actual project/session-scoped state, distinguishing
  loading, unavailable, disabled and enabled; trace activity indicators to real
  memory events/results. Reuse the current Memory RPC and consent model, never
  enable memory as a side effect of showing the sidebar. V1 reference:
  `kilocode/plugins/memory-status.tsx` and
  `kilocode/cli/cmd/tui/component/memory-status.tsx` under `packages/opencode/src`.
- [ ] **Account credits and Kilo Pass:** restore personal/team credit scope,
  available balance, and applicable personal Pass usage/base allotment, bonus
  and renewal information from verified response fields. V1 reference:
  `packages/opencode/src/kilocode/plugins/sidebar-footer.tsx`. Missing data is
  not zero; zero balance is valid. Keep account balance distinct from session
  cost, respect privacy masking, clear stale account data on team/account
  changes, and verify refresh/cancellation against v2 events rather than
  copying v1 event names or polling assumptions.
- [ ] **Full section audit, not just memory/balance:** compare v1's registered
  `sidebar-indexing`, `sidebar-background-processes`, `sidebar-pr` and
  `sidebar-usage` plugins with current v2 consumers. Inventory indexing state,
  background jobs, PR information, input/output/reasoning/cache token usage,
  cache rate, session/per-model cost and steps, throughput and conditional
  model benchmark metadata. Record each field's source, scope, refresh trigger,
  reuse/missing status and availability gate before implementing it. Do not
  fabricate metrics or imply all legacy sources already have v2 equivalents.
- [ ] **Reuse native sidebar sections:** v2 already provides context tokens/
  percentage and session spend, MCP status and directory/branch through
  `packages/tui/src/feature-plugins/sidebar/`. Preserve those controls and avoid
  duplicated totals. Add Kilo-owned views through the existing
  `sidebar.content` / `sidebar.footer` slots in
  `packages/tui/src/routes/session/sidebar.tsx`; no sidebar fork is needed for
  additive sections. Use semantic theme tokens and existing privacy settings.
- [ ] **Validation:** real host/TUI fixtures covering memory consent changes,
  account/team switching, zero versus unavailable balances, masked data,
  stale/out-of-order refreshes, session navigation, indexing/job updates,
  narrow/wide terminals and sidebar scrolling. Capture or verify each external
  field contract before claiming live-data parity; use local fixtures for this
  implementation batch, with no live account calls implicitly authorized.

#### Post-checkpoint request-policy slice — 2026-09-05

Checkpoint `61a8707c03` remains the saved native-Gateway/CLI stage. The subsequent
bounded `hide_prompt_training_models` request-policy slice is accepted locally:
the existing Gateway HTTP hook adds `provider.data_collection: "deny"` for the
effective explicit opt-in, using the same raw settings fold as the model picker.
No new shared upstream patch, dependency, or credential migration was needed.
The picker reads live per open; request policy is cached until host startup,
account refresh, or `config.updated`. Default file watching is off, so the UI
continues to instruct restart. This is a request to the Gateway, not evidence
of deployed provider retention behavior.

Independent review follow-up distinguishes a stored null from an absent raw
Kilo-only key, with a fixed invalid notice and the existing cross-scope fallback.
A missing file substitution can invalidate native profile configuration while
separately parsed Kilo-only values remain effective; the scope message, docs,
and tests now state that boundary explicitly. Invalid native fields alone do
not establish whole-document rejection.

Validation provenance: the delegate's canonical bundled-Bun wrapper run recorded
**447 pass / 0 fail / 2,756 assertions / 78 files** before the null-handling
follow-up. Root independently verified **14 request-policy/picker/wire tests**
and **22 Gateway plugin tests** at that snapshot, then **27 settings/policy/UI
tests / 174 assertions** plus CLI typecheck after the follow-up. The latter
focused result is not a new full-suite claim. The manual runtime plan includes
policy precedence and refresh-timing scenarios, still **NOT RUN**.

The unused CLI declaration of `@ai-sdk/openai-compatible` was also removed;
Core retains its real dependency and version patch. Neither this cleanup nor
the request-policy slice closes the compiled interactive Auto packaging gate.
Coarse accepted coverage remains **26/43 (60.5%)**; broader Settings/Gateway
acceptance stays open.

#### Authored provider-policy import — 2026-09-06

Accepted one additional config mapping: pinned v1 `experimental.policies`
maps exactly to native v2 provider-use policies. Authored policies follow
generated enabled/disabled-provider policies, preserving last-match precedence.
Strict boundary validation rejects excess or invalid fields without echoing
their contents. A real isolated host verifies the imported deny removes the
target provider while retaining an allowed provider.

Root and independent Luna review each reproduced **45 importer tests / 201
assertions**; the reviewer also ran CLI typecheck clean. No new upstream patch
or dependency. Other unsupported Kilo-only keys remain required gaps where
applicable; this single mapping does not close the config row or increase
the **26/43** count. See `kilocode/baseline/config-mapping-v2-gap.md`.

#### Bounded catalog prompt selectors — 2026-09-06

Accepted the `anthropic` and `trinity` catalog selectors through the existing
post context hook and maintained v2 prompt assets. The exact catalog tag is
decoded tolerantly, never inferred from `family` or written into settings.
Location/workspace-scoped readers access the existing Gateway cache, clear
with failed/revoked scopes, and are removed with identity-checked finalizers.
Custom agent systems win; other system parts remain intact. Unknown tags,
including inherited object-property names, select no asset.

Root reproduced **2 CLI prompt tests / 21 assertions**, full Gateway
**52 tests / 460 assertions**, and Core typecheck. Independent Luna review
also passed focused prompt/selector tests and CLI/Gateway typechecks with no
P1/P2 findings. Production launch tests use actual loopback catalog metadata,
not an injected selector map. This is source-runtime fixture evidence, not
compiled interactive packaging or deployed-model verification.

Only the separately approved two-asset exports touch shared Core. Other
legacy prompt selectors remain unresolved; the Gateway capability row and
**26/43** count stay open/unchanged. Details:
`kilocode/baseline/model-prompt-policy-v2-parity.md`.

#### Explore shell-policy slice — 2026-09-06

Accepted the pinned v1 Explore command policy through existing SDK phases:
the default-phase transform adds allowances after native AgentPlugin but
before ConfigAgentPlugin; the existing enforced post policy applies a shell
permission ceiling. Configured denies remain in their original order. The
rejected count-budget workaround and its false no-pre-seam rationale were
removed; no rule-provenance inference or new shared patch remains.

Root verified CLI typecheck and **5 production-host tests / 78 assertions**:
safe commands execute, unsafe commands are denied, user denies survive broad
allows, and attempts to disable either policy ID cannot bypass the enforced
ceiling. The redirect regression proves no output file was written. This is
the v1 command-policy port, not an OS sandbox guarantee. Ask/Debug/Code behavior
remains covered. See `kilocode/baseline/explore-policy-v2-parity.md`.

The larger CLI/TUI remainder row still has sidebar and other acceptance gaps;
coarse coverage remains **26/43**, with no full-row credit for this sub-slice.

#### PR sidebar slice — 2026-09-06

Additional bounded running-shell display accepted on 2026-09-06: root wired
`installProcessSidebar` through the existing Kilo slot and independently ran
**6 tests / 8 assertions** (typed join plus two real-renderer lifecycle/tab
scenarios). It joins viewed-session durable shell messages to running registry
entries, reconciles stale caches on revisit, and disposes subscriptions on
unmount. Missing descriptions/ports/readiness and v1 process supervision are
not fabricated or claimed. Manual case UI-083 remains NOT RUN. This later
slice is not covered by the earlier full 481 snapshot; row credit is unchanged.

Accepted the Kilo-owned PR sidebar through the existing UI slot. It uses the
viewed session's location, the v1 `gh` view/branch/SHA/fork fallback chain,
exact head matching for SHA-based candidates, validated output, and scoped
lookup cancellation. A single lookup deadline drives termination with a
bounded kill grace; the retained escalation timer is cleared on completion.
No shared UI change or dependency was added.

After review fixes, root reproduced **19 tests / 46 assertions** covering
eight real-renderer scenarios and then **12 unit tests / 34 assertions** plus
CLI typecheck after the final timer cleanup. The delegate reran the complete
PR targets after that cleanup (**20 pass**). The later coordinated full CLI
wrapper run passed **481/0**, as recorded under the active target above.
Tests use isolated fixture executables, not live GitHub accounts.

The measured same-location branch-refresh miss on this macOS host remains an
upstream VCS producer limitation, shared with the native footer. No universal
watcher fix is claimed. Manual PR scenarios `UI-081`/`UI-082` remain **NOT RUN**.
See `kilocode/baseline/sidebar-pr-v2-parity.md`; broader CLI/TUI acceptance and
the **26/43** count remain unchanged.

#### Prior integrated implementation checkpoint — 2026-09-05

Integrated validation after checkpoint `047ffd045f`: **420 CLI tests,
0 failures, 2615 assertions across 73 files** (354.22s), including the compiled
preview/ACP build and real local host/TUI fixtures. Gateway: **43 pass / 325
assertions**. Reused Memory engine: **171 pass / 648 assertions**. CLI, Gateway,
Memory, TUI and Schema package typechecks pass. These are local fixture checks,
not deployment or release validation; no live account or paid inference was
used and nothing was pushed.

#### Gateway protocol follow-up — 2026-09-05

The current Gateway batch has **47 passing direct Gateway tests / 355
assertions**, clean Gateway typecheck, clean AI typecheck, and a passing
launched-host protocol fixture. The fixture makes two requests through each
catalog-selected protocol, checks the Kilo Bearer/team headers and stateless
Responses reasoning replay, then verifies a same-ID team-to-personal protocol
change. It uses loopback only; it is not a deployed Gateway canary.

The batch does not close the Gateway inventory row or alter the frozen
**26/43 (60.5%)** count: prompt-selector policy remains open and the remaining
Auto catalog acceptance remains listed above. A first full CLI run ended
**421 pass / 1 fail** on a settings TUI frame wait; the correct-runtime isolated
settings test passed. The follow-up run recording **416 pass / 6 fail** on
compiled/packaged startup tests is **not valid full acceptance evidence**: it
bypassed `script/test.ts` (no `KILO_CLI_TEST_ARTIFACT_DIR`), so compiled-mode
tests silently fell back to a stale `dist/kilo2` built by unsupported
Bun 1.3.14 — not a same-command confirmation. The six compiled/packaged
startup failures are attributed to that stale artifact's `requireRuntime`
guard (evidence: the same binary passes `paths`/`--help` and fails
`serve`/`init` with the Bun version error), not to this Gateway batch, and the
Gateway protocol fixture and settings UI passed within the run. A coordinated
proper-wrapper confirmation rerun (`dist/interactive/bun run script/test.ts`)
is still required before any overall green claim.

The current batch also adds durable **Session family usage** through a
Kilo-owned read-only host RPC and the existing scrollable sidebar slot. It
aggregates settled assistant records across project-bounded parent descendants,
not native session/global counters, and excludes fork provenance and auxiliary
records. Tests cover nonzero costs/cache/reasoning, foreign-project exclusion,
in-flight omission, privacy, completion refresh and native narrow/wide sidebar
behavior. See [usage evidence](../kilocode/baseline/sidebar-usage-v2-parity.md).
This does not close the entire sidebar row: v1 background-process supervision,
PR metadata, throughput and model benchmarks remain separately unported or
unverified. Generic Persistent PTY is not a substitute for that process engine.

The 70% batch closes the local credential-import and reconciled Memory rows.
For credentials, API keys and metadata,
source-proven Kilo/OpenAI/Copilot/xAI OAuth mappings, and well-known origin/env
credentials all use the actual isolated host writer; unsupported mappings and
conflicts are explicitly refused. The current count is **26/43 (60.5%)**;
the 70% target is still **31/43**, not rounded-up partial credit. This is not
provider authorization or deployment verification and does not close config
mapping or the overall Phase 6 cutover gate. See
[credential evidence](../kilocode/baseline/credential-import-v2-parity.md).

Kilo `privacy_mode` now imports as the same boolean consumed by the isolated
PrivacyStore (both enabled and disabled are tested); invalid values are refused
without echoing content. Other unmapped Kilo-only configuration remains partial.
Settings gained stale-dialog path/revision checks and native v2 automatic
compaction, token-buffer and retained-token controls (zero is supported by the
native budget schema). Seventeen settings/real-TUI tests pass. No v1 context
percentage or pruning behavior is inferred from those controls; the broader
settings row is still open.

The current local batch adds [real indexing status in the sidebar](../kilocode/baseline/sidebar-indexing-v2-parity.md)
through existing slots and a read-only scoped RPC. The disabled fixture proves
that merely displaying it does not start indexing or admit model work. This
does not close the remaining sidebar sections or increase coarse-row credit.
The Memory sidebar additionally reads real persisted injection/save activity
and reconciles asynchronous saves while enabled; its isolated renderer test
proves an engine injection appears without model work and survives resizing.

`/remote` now has a bounded, explicitly confirmed control adapter through the
validated Gateway account. Normal-host tests prove default OFF, no-credential
refusal, explicit enable/disable and credential-change cleanup; real TUI tests
prove cancellation makes no relay request. Reconnect, directory listing,
command preflight and owned inbox cancellation are locally tested. Legacy
transcript forwarding and broader relay compatibility remain open, so this
does not close the Remote row. See [Remote evidence](../kilocode/baseline/remote-v2-parity.md).

[Model/agent/sidebar batch evidence](../kilocode/baseline/model-sidebar-v2-parity.md)
records the tested subset: Gateway-first presentation, actual-metadata
Recommended/Auto grouping, native favorites retained, Code/Ask/Debug policy,
memory status and privacy-aware credits/Pass panels. This does **not** close
the full Recommended/Auto acceptance items: Most Used, complete dynamic
catalog eligibility and routed-model execution metadata remain unverified.
The custom Plan file/exit/implementation handoff is explicitly not ported.
No coarse inventory row gains completion credit from these partial results.

Final local validation: bundled Bun 1.4 full CLI suite **373 pass / 0 fail**
(2,413 assertions); full Gateway **38 pass / 0 fail**; focused native TUI
model/preference/autocomplete tests **23 pass / 0 fail**. CLI, Gateway, Client,
Schema and TUI typechecks pass. The source launcher reads these changes on
restart; no distribution release, commit, push or live account probe occurred.

Implementation order: trace model metadata and the native picker seam first;
then Gateway presentation/recommendations/auto; then built-in agents and Plan.
Sidebar memory and native-data sections can proceed independently; account
credits depend on the verified Gateway data contract.
Keep policy in Kilo-owned modules and reuse native preferences and controls.
If no public picker seam suffices, document the smallest shared hook for review
instead of cloning the picker or creating another preference store. Validate
with isolated host/TUI fixtures and loopback model responses, including empty
favorites, favorite persistence, team switching and denied Plan writes. No
live account calls, paid inference, GitHub changes or product decisions are
authorized by this plan-only update.

### Historical completed local checkpoint — 26/43 (60.5%)

At this checkpoint the requested capability target was reached and validated. The fixed
denominator remains 43; no partial row was split or removed to reach it.
The supported-runtime rebuilt-package suite passes **366 tests, zero failures,
2,368 assertions across 58 files** (275.48s). Final Kilo CLI typechecking passes;
post-cleanup skill tests pass **15/15**, and project-config/settings regressions
pass **16/16**. Gateway/indexing package typechecks and CLI import-boundary
tests (**4/4**) also pass. The source TUI/ACP launcher rebuild and version smoke
check pass. No commits, pushes, live cloud/account tests or additional shared
OpenCode patches were made in this batch. This is local implementation
coverage, not release readiness. The remaining 17 active rows retain their
honest partial/unstarted/unknown statuses.

The skill/custom-agent row now combines native markdown/discovery reuse with
host-owned provenance, native shell/external-directory preflight, mandatory
human Form approval and native shell execution. **15 tests / 64 assertions**
pass independently for expansion, actual inlined output, rejection/deny,
headless auto cancellation, literal user activation, source/symlink boundaries
and bounds. The project-root filter plus settings regressions also pass
**16 tests / 118 assertions**. Untrusted sources do not execute; no ambient v1
skill stores are scanned. See the
[skill-shell ledger](../kilocode/baseline/skill-shell-parity.md).

Execution-policy validation reopened the memory and indexing rows: their tool
visibility flags hid explicit denies but did not perform the native approval
assertion at execution. Both v1 tools asked for that approval. Host-owned
native authorization now precedes memory access and semantic search; absent
host authorization fails closed. Independent bundled-runtime validation passed
**33 tests** across memory and indexing, including real model-tool ask, reject,
allow and deny paths. Both rows regain completion credit. Previously recorded
coverage was 22/43 after reopening them and completing cloud; partial fixes do
not count toward the 26/43 target.

Swarm is now covered by **7 tests / 47 assertions**, independently rerun:
real native subagent descendants, completed board output, approval/feedback,
idempotent admission, participant discovery, activity notices, cross-root and
moved-location rejection, and history after a host process restart. The
non-interactive notice guard also proves configured deny wins over saved
allow, ask does not prompt, and public permission hooks are respected. The
host test caught and fixed undefined cursor metadata on an empty board;
conversation forks are correctly treated as independent roots. See the
[Swarm ledger](../kilocode/baseline/swarm-v2-parity.md).

The Cloud Agent CLI row now passes **55 tests / 185 assertions** across seven
files, independently rerun under bundled Bun 1.4. Start/send/status/result and
start-only `--stream` use the resolved account/team. Tests cover actual CLI
JSONL, provided stream URL origin pinning, ticket fallback, non-fatal stream
failure, cancellation, and no bearer/ticket leakage in admission diagnostics.
Transport tests stay on loopback; this is the source-backed CLI port, not a
claim about deployed backend availability. See the
[cloud ledger](../kilocode/baseline/cloud-cli-v2-parity.md).

The schema-diff/fixture-validation row is now complete: an actual Kilo-main
writer at `d99662338e3ddbd2613ab41fc0369837a6eb4be9` generated the disposable
source, and the normal suite imports its recorded SQL dump without needing a
sibling checkout. The real v2 migrator runs only on a fresh copy; database/WAL
hashes prove the source unchanged. The portable test passes **30 assertions**;
the explicit live writer roundtrip passes **35 assertions**. Text, completed
tool content and compaction survive; metadata drops and finish normalization
are asserted, not hidden. This closes the test row, **not** a production store
importer or the phase-6 preservation/host-boot gates. See the exact refs,
artifact hash, transforms and historical-store limitations in the
[fixture audit](../kilocode/baseline/v1-fixture-generation.md).

The preceding 22/43 checkpoint completed these three rows:

Historical integration run while Swarm was still being implemented:
`packages/kilo-cli` supported-runtime `script/test.ts` rebuilt the artifacts
and reported **340 pass, 1 fail, 2,230 assertions across 54 files** (268.11s).
The failure was the in-progress Swarm host acceptance test, not attributed to
upstream or waived. Its replacement and fix now pass the focused suite above;
a fresh full integration run now passes as recorded above. The earlier completed checkpoint was
303 pass / zero failures. Kilo gateway/client package typechecks also pass.

Three further rows now pass their real host/CLI acceptance paths:

- Indexing reuses the actual Kilo engine, LanceDB and parser assets. An explicit
  `--indexing-config` is required; disabled/unconfigured hosts register no search
  tool and send no code. Actual model-tool tests prove location-specific search,
  ignore rules, line ranges and isolated storage. Engine: **501 pass, 9 existing
  skips**; adapter/input: **17 pass**. The engine includes 118 byte-identical v1
  source/test copies, separately recorded from new adapter code in the
  [indexing ledger](../kilocode/baseline/indexing-v2-parity.md).
- External sessions: explicit Claude/Codex source-directory discovery and fresh
  import preserve supported text, reasoning and tool records, reject unsupported
  lossy forms, and resume through the real host. CLI listing/import/export tests
  use only synthetic sources; no ambient user history is scanned or modified.
  See [external-session evidence](../kilocode/baseline/external-resume-parity.md).
- ACP: Kilo-owned build entry bundles the existing upstream ACP implementation;
  `kilo2 acp` launches the isolated host, streams JSON-RPC and exits on EOF.
  **9 tests** include the actual CLI, cancellation, host ownership, Kilo identity,
  secret-free protocol output and a bundle graph excluding Core/Server/Standalone.
  No upstream export or runtime private-package import was added.

Settings scope editing and persistent profile privacy are integrated, including
real TUI edits consumed by the host and cross-location privacy refresh. Their
shared profile-write queue prevents one editor from losing another's fields.
The fixed row still includes remaining Kilo-only fields, so it remains
`started`, with no completion credit. Remote transcript relay remains
incomplete; tested partial adapters do not close that row. Trusted skill shell
expansion is now validated as recorded above.
Cloud CLI actual launch/CLI/stream validation is now complete as recorded above.

The following four gates were completed at the preceding 19/43 checkpoint:

The fixed 60% target is still **26/43**. Four additional capability gates are
locally verified; in-progress adapters below receive no credit. This is local
implementation coverage, not release readiness or exact historical v1 parity.

- Branding: real renderer tests verify a separate quarter-tint depth layer in
  light/dark modes, original artwork, Unicode fallback and narrow/wide layouts
  (**14 tests / 243 assertions**). Existing theme tests also passed **10 / 38**
  for semantic defaults/custom fallback. This closes the missing-depth
  acceptance issue; it does not authorize additional shared patches for landing.
- Memory: explicit project operations/RPC/TUI, read-only context injection and
  persisted default-off automatic consolidation are exercised through the real
  host with a local model fixture (**19 tests**). Both memory and auto mode must
  be enabled before auxiliary generation. The v2 boundary is a successful
  coalesced execution, not v1 turn-close; it captures the latest completed pair.
  Injection statistics and personal scope are not invented. See
  [memory parity](../kilocode/baseline/memory-v2-parity.md).
- Shell sandbox: macOS **7 tests / 26 assertions** including actual model-tool
  execution; real Linux Bubblewrap probe passes workspace/outside/protected
  writes and network allow/deny controls. See
  [Linux evidence and reproduction](../kilocode/baseline/sandbox-linux-validation.md).
  PTY/MCP/independent git remain a separate open row; Linux future-name rules,
  read confinement and proxy networking are not claimed.
- Telemetry: persistent isolated consent plus eleven emitted registry/lifecycle
  names, payload-free OTLP logs, default OFF. `telemetry status|enable|disable`
  is wired; enable/disable requires the host's exclusive lease, and foreground
  plus daemon startup resolve consent while holding it. Saved decline wins over
  env opt-in. Adapter/persistence tests **31 pass**; actual CLI/foreground/daemon
  tests **2 pass / 31 assertions**. This deliberately does not restore v1's
  default-on PostHog payload pipeline or claim all 27 v1 event semantics.

Combined affected checkpoint: **86 pass / 638 assertions / 10 files** under
bundled Bun 1.4 (logo, memory, external imports/discovery, project config,
telemetry adapters/persistence, ACP bridge). Gateway **31 pass / 252 assertions**
and typecheck pass, including the new in-process validated-account extension;
the account resolver never becomes a credential-export RPC. Full-suite and
CLI typechecks will be rerun after concurrent settings/indexing/remote work
settles; transient in-progress errors are not called upstream failures.

Full Kilo CLI build/test checkpoint after these integrations: **303 pass,
0 fail, 2021 assertions across 47 files** in 229.36s, using bundled Bun 1.4.
This includes the compiled admission-only preview and the source-backed
interactive/ACP CLI; it does not turn the compiled preview into an interactive
release artifact. The later credential/privacy additions require fresh checks.

Settings remaining fields, cloud-agent CLI and remote relay remain under integration.
Cloud-agent tRPC and the `/remote` session relay are distinct services; neither
is tested against a deployment. No user histories, real cloud sessions, or
paid test inference are involved.

Provenance: this checkout remains HEAD `59b29de40966803e2c7cd734d439843fb773f6a6`.
Current local Kilo-main reference inspected by this batch is
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`; earlier audits used `1536aef0`.
These are source-comparison refs, not an upstream v2 baseline bump. Shared
patch allowance remains six; all new code in this batch is Kilo-owned.

### Previous overnight extension checkpoint (historical, 15/43)

Verified coverage is **15/43 active rows (34.9%)** after isolated identity,
review policy, managed lifecycle/attach, and project discovery closed their
bounded acceptance gates. The requested 60% target remains **26/43**, not an
estimate that includes partially implemented adapters.

- Project config: explicit `--project-config` on the foreground TUI, `serve`,
  or `run` reads Kilo JSON/JSONC within the canonical project boundary. Native
  config normalization and skills entries are reused. `.kilocode` precedes
  `.kilo` in priority; JSONC precedes JSON. Default discovery stays off and
  project executable plugin declarations/directories stay disabled. The
  isolated host has file watching disabled, so config edits require restart.
  Markdown `.kilo/agents`, v1 trust provenance, and trusted skill `!cmd` behavior
  remain gaps in the separate skills/agents row. Configuration opt-in is a
  trust decision: provider packages, MCP commands and permissions can be
  configured, so this flag is not itself a sandbox.
- Explicit v1 auth/config import: `import-v1 --auth <file> --config <file>`
  previews without opening a store; `--apply` uses public key-connection APIs
  and an atomic private config write. Reports omit secrets/config values;
  sources remain unchanged. OAuth/well-known credentials, credential metadata,
  conflicting target keys, target JSONC comments, and unmapped Kilo fields are
  refused by the CLI. Nested dropped settings are reported rather than treated
  as preserved. These two inventory rows remain partial, not full cutover.
- Telemetry: an OFF-by-default host-owned OTLP activity exporter subscribes to
  public events, emits only four allowlisted update-event names, and ignores
  event data. The global logs/traces exporter is deliberately not attached.
  Environment opt-in requires `KILO_TELEMETRY_ENABLED=1` and an endpoint.
  Local collector and real host tests pass; v1 product-event parity and durable
  consent/UI policy are not implemented, so the row remains partial.
- Sandbox: explicit `--sandbox` on foreground TUI/serve/run registers an OS
  shell hook through the existing SDK post-policy seam. macOS standalone and
  real model-shell host tests pass (7 tests / 26 assertions), including outside
  write/network denial and scoped launcher cleanup. Linux Bubblewrap remains
  source-only/unverified here; it defaults `denyNames` to an empty list and
  refuses nonempty basename restrictions rather than claiming protection for
  newly created matching paths. No PTY, MCP, filesystem-read, or independent git
  spawn protection is claimed. Managed daemon/attach reject this CLI flag.
- Memory: local project storage/commands/save/recall are implemented with
  opt-in state and isolated paths. Automatic injection, capture/consolidation,
  digests, personal memory, retention and cloud sync are not implemented. The
  direct public RPC surface returns results immediately without session inbox,
  message, or model admission; two-project isolation and restart are tested.
  Real TUI status/enable/remember/show dialogs also pass without creating a
  session. The UI imports only the pure command parser and RPC schema, not
  filesystem/plugin implementation. This row remains partial.
- External transcripts: `import-external <file> --model provider/model --agent
  name [--directory path]` imports a fresh v2 session from local Claude/Codex
  JSONL through the public client, without starting model execution. Stdout
  contains only `{sessionID}`. The supported subset preserves
  text, readable reasoning and paired tool output, records source provenance,
  and refuses unsupported structures/unpaired tools. Provider reasoning
  signatures are metadata, not replay state. The bundled-runtime host import/
  export suite passes 7 tests / 34 assertions; the real CLI also round-trips
  imported content through export. Interactive discovery/resume and
  broad real-world format compatibility remain open; this is not full parity.
- V1 session schema: the early [source audit](../kilocode/baseline/v1-session-schema-audit.md)
  incorrectly described v1 diff counts as optional. The current fixture audit
  retracts that claim for all three inspected Kilo-main refs; both writers and
  the v2 decoder require counts. At this historical checkpoint, the tested
  candidate utility only inspects and makes a private no-clobber SQLite copy;
  it is not wired into the CLI or active store. Six synthetic-fixture tests
  cover WAL contents, collisions, source DB/WAL change detection, and private
  staging/publication. Read-only SQLite may update SHM read marks. No real
  user store was opened and no migration was run.

Final combined checkpoint (packaged Bun 1.4.0, from package directories):

- `packages/kilo-cli`: `./dist/interactive/bun run script/test.ts` rebuilt the
  isolated compiled artifact and passed **180 tests / 1,355 assertions across
  29 files**, zero failures (162.57s). This includes real TUI attach and memory,
  daemon ownership/restart, macOS shell enforcement, public-client imports,
  permissions/cancellation, and source/compiled API boundaries. Fake model and
  collector endpoints were local; sharing tests do not verify deployments.
- `packages/kilo-gateway`: bundled `bun test` passed **30 tests / 232 assertions**,
  zero failures. `kilo-client` has no standalone test files; its real consumer
  paths are exercised by the CLI host/TUI/RPC tests.
- Package `bun run typecheck` passed for Kilo CLI, Gateway and Client. Selected
  changed source/test formatting and `git diff --check` pass. Root-configured
  lint on 17 integrated source files reports **10 warnings, zero errors**
  (schema/client type assertions, intentional DTO spreads, and the memory
  token estimate), not a warning-free claim.
- After a formatting-only fixture cleanup and explicit `return undefined`
  parser lint cleanup, memory/RPC/TUI plus database-copy checks passed again:
  **18 tests / 117 assertions**, zero failures.

Earlier concurrent checkpoints had a sandbox fixture timeout and a transient
in-progress memory schema failure during attach. Explicit fixture location,
permission setup and bounded cleanup fixed the former; completed memory schema
integration removed the latter. Both pass in the final combined run; neither
is being dismissed as a pristine upstream failure.

No new shared OpenCode override was added in this batch. `jsonc-parser` 3.3.1
is a direct Kilo CLI dependency, reusing the parser already used upstream
instead of maintaining another parser. Work remains local/uncommitted;
the user's existing dirty files were preserved. No user-store migration,
public transcript upload, GitHub edit, or distribution install was performed.

At this earlier checkpoint, the 60% target was not yet met. Remaining implementation work must not be confused
with decisions or external validation gates:

- Safe local continuation candidates: broaden source-fixture coverage for
  external imports, add markdown-agent discovery using supported schemas,
  and extend Kilo presentation/CLI deltas after checking native equivalents.
  These require implementation and verification, not automatic completion credit.
- Compatibility gates: v1 session transcript preservation; real Linux sandbox
  behavior; full memory/skills/telemetry parity beyond the explicit local subset.
- Authority/product gates: extra shared OpenCode seams (including an exported
  ACP entrypoint), public sharing deployment/token/viewer and team ownership
  contracts, cloud-client account operations, distribution/update policy,
  and undefined Swarm/voice/FIM scope. Do not guess these while Johnny is away.
- The IDE client rows remain substantial unimplemented work. Generic v2 TUI,
  diff, statistics or subagent engines do not complete VS Code/JetBrains rows.

### Earlier slices and evidence

Phase 0 on `kilo-v2` (internal): identity, empty store, branding (shared patch /
hook), fail-closed. Not shipped to customers.

Current-batch verification: rebuilt the isolated preview and ran
`script/coexistence.ts` with installed stable Kilo, both pointed at temporary
HOME/XDG/project paths. Two stores coexist; stable DB/WAL/SHM bytes are preserved;
preview contains no legacy table or session and shuts down cleanly. This meets
the internal identity row's Phase 0 gate, not customer migration/cutover or visual
logo acceptance. An earlier readiness failure had no diagnostic output; the
script now includes startup stderr and the rebuilt rerun passed, without claiming
a proven cause for that first failure.

Phase 1 seam gate met: gateway auth + catalog run as owner-3 plugins through the
canonical plugin RPC client path without Core imports; generated client remains
upstream-equivalent. The conversation launcher now exposes a foreground
authenticated execution `serve` command; the earlier lifecycle entrypoint's
`serve` remains admission-only. The current batch adds Kilo-owned managed
daemon/attach adapters using the public service client with an explicit isolated
registration file. Five daemon tests (73 assertions) verify authenticated
discovery, idempotence, restart persistence, contended stores, dead-owner recovery,
and refusal to signal unverified live PIDs or read foreign/symlinked metadata.
CLI start/status/stop omit credentials. A real terminal fixture attaches twice
to the same session, verifies history and new prompts, and proves that TUI exit
does not stop the daemon. One-shot headless commands still own a private execution
host; they do not automatically attach or approve another client's permissions.
Share / unshare / fork-from-share now has a Kilo-owned RPC and
client path with fresh-ID v2 imports; production backend compatibility and
post-share incremental ingest remain before that inventory row is done.

The 2026-09-05 [sharing contract audit](../kilocode/session-sharing.md) corrected
the initial fixture's flat message export to the cloud's nested envelope and
confirmed the newer `share_token` contract. The newer public viewer still
expects v1 messages; team ownership and removal-aware synchronization also
remain. Keep this row in progress until those gates and deployed compatibility
are resolved.

The Kilo TUI now wires `/share`, `/unshare`, and `/fork-from-share` through the
existing keymap seam, with explicit upload confirmation. Terminal fixtures
cover cancellation, transcript import/navigation, and revoked-link failure.
Team sharing fails before upload until ownership can be preserved. This adds
no shared upstream patch.

Local validation for the sharing step: 30 gateway tests, one interactive-host
integration test, three sharing TUI cases, and three existing account/login/
branding TUI cases pass (37 tests). Affected package typechecks, lint, and
formatting checks pass. The integration test covers a fork that continues in
another project directory. Imported forks receive fresh session/message IDs
and discard source ancestry, revert state, and unavailable snapshot references.
Disabling uploads still permits revoking an existing public link.

### Current host CLI surface

Use `packages/kilo-cli/dist/interactive/kilo2` from this development checkout
(the launcher packages Bun 1.4). These commands use the same isolated
`kilo2/interactive` profile as the TUI and acquire its exclusive store lock;
stop the other instance first. They do not attach to a running daemon.
One-shot commands do not resume unrelated suspended executions when opening
the store. TUI and foreground `serve` retain startup recovery; a shutdown →
export → normal restart test verifies that export preserves the recovery claim.

- `kilo2 serve`: authenticated foreground execution API on an ephemeral
  loopback port. Prints the URL and password-file path, never the password.
- `kilo2 sessions --directory <project>`: latest 50 top-level sessions for the
  resolved location, as JSON.
- `kilo2 models [--directory <project>]` and `kilo2 agents [--directory <project>]`:
  enabled models and visible agents, after location-scoped plugin activation.
  Selection metadata only: no provider settings/headers or agent system prompts.
  Custom agents from the isolated `kilo.jsonc` are supplied by v2, not a second
  agent registry. This does not enable `.kilo/agents` or project config discovery.
- `kilo2 export <session-id> [--sanitize]`: canonical settled v2 transcript
  JSON on stdout, raw by default. `--sanitize` applies upstream content
  redaction, **not complete path/identifier removal**: a local subprocess
  test demonstrated that `info.subpath` can retain the project path after
  `info.location.directory` is redacted. Inspect output before sharing. A
  complete sanitizer needs its own audited fix; screen privacy is separate.
- `kilo2 import <local-v2-json-file> --directory <project>`: schema-validated
  fresh transcript copy through the public import API. Regenerates session
  and message IDs; discards parent/fork/revert state and assistant snapshot
  references absent from JSON. Preserves transcript content and metadata.
  Returns the new session as JSON. Re-import creates another copy rather
  than overwriting. This is not V1 DB migration, identity-preserving backup
  restore, external-agent import, or URL/share import.
- `kilo2 run [prompt] [--session <id>] [--model <provider/model>]
  [--agent <name>] [--directory <project>] [--auto] [--file <path> ...]
  [--format text|json]`: creates or resumes a
  same-location session through the public client. Waits for Kilo plugin
  activation before selecting models, subscribes before admission, waits for
  idle, and reconciles settled response text through paginated messages after
  the admitted prompt. Final text goes to stdout and the session ID to stderr;
  host error logs also use stderr. Explicit `--auto` replies `once` to this
  session's permission requests; otherwise requested permissions are rejected.
  It does not save a global allow rule. Questions/forms are cancelled with an
  error rather than leaving an unattended run waiting. SIGINT interrupts the
  session before host shutdown and exits 130. A continued run retains prior
  conversation history but does not reprint earlier answers.
  Already-running sessions are rejected before this adapter installs its
  interruption or permission handlers. The command owns a private exclusive
  host, not a shared-server attachment: before adding attach, design and test
  concurrent admission, permission/form ownership, and response attribution.
  Non-TTY stdin is appended to positional text with a newline; stdin alone is
  accepted. Repeat `--file`/`-f` for local attachments, resolved against the
  invocation directory even when `--directory` changes session placement.
  Files must be regular and at most 10 MiB each. They are embedded in prompt
  data URLs and sent to the selected model; UTF-8 source files use `text/plain`.
  Empty input and invalid attachments fail before the host opens its store.
  `--format json` writes one completed `{sessionID,text}` object, not upstream's
  streaming JSON event format. Errors remain on stderr with nonzero exit status
  and no result object. Model support for a particular media type still applies.

The text-run slice does not yet include streamed terminal rendering/JSON event
formatting, automatic last-session selection,
remote attach, or external-agent transcript compatibility. Keep those in the
CLI remainder; the existence of this basic command does not close all v1
headless parity. The local phase-2 path now covers native model streaming,
tools, permissions, interruption, idle, reconnect/restart, and explicit CLI
resume with deterministic local model servers; this is not a live production
Gateway/deployment validation.

The transfer slice is validated against actual local HTTP hosts and the
conversation entrypoint: authentication, clean shutdown, machine-readable
listing, import/export across process restarts, repeated fresh-copy import,
partial sanitization, invalid input/missing-session failures, and continued
model execution from an imported transcript. No public Protocol/SDK generation
or additional shared upstream patch was needed.

The next local headless batch adds piped input, file attachments, final JSON
results, and model/agent listings entirely in `packages/kilo-cli`. The packaged
Bun 1.4 suite passes **97 tests / 810 assertions**, including all three `/teams`
fixtures. This successful run does not establish that the previously observed
render timeout is fixed. Subprocess tests verify model-visible piped text and
attached source bytes, v2 attachment persistence, stdin-only custom-agent runs,
inventory filtering, and rejection before store creation. Input tests cover
MIME/byte preservation, missing/directory/oversized/FIFO rejection, and cancelled
stdin. Typecheck and targeted formatting pass; targeted lint has zero errors
and only the existing transfer assertion warning in `commands.ts`.
After adding the upstream-review reuse test, the final full repeat reported
**97 pass / 1 fail (826 assertions)** across 98 tests. The failure was the
existing conversation TUI fixture timing out after 600 frame passes with the
model dialog still visible; all new batch tests and `/teams` passed. No causal
link to this batch has been established, and no speculative upstream UI change
was made. Keep this distinct from the earlier `/teams` timeout.
Three consecutive isolated reruns of `test/tui.test.tsx` then passed both cases
each time (6 passes / 39 assertions in total). They narrow the reproduction but
do not prove the full-suite timeout fixed or pre-existing relative to this batch.
User evidence from the embedded BB terminal adds a separate UI follow-up: after
idle, missing text did not return when typing but did return after a resize. That
is consistent with a redraw/render-invalidation problem, not proven data loss or
a confirmed root cause. No Kilo redraw workaround or source fix is authorized
from this observation. Keep it separate from the current compiled-startup test
failures.

Validation of this host/settings slice at
`59b29de40966803e2c7cd734d439843fb773f6a6` plus the local Kilo worktree changes:
bundled Bun 1.4 runs all 82 CLI tests successfully (753 assertions), including
source/compiled lifecycle hosts, TUI, sharing, and the new commands. All 30
gateway tests also pass. After the final active-session guard, a full repeat
reported 81 pass / 1 fail: the `/teams` standard fixture timed out waiting for a
rendered frame. All new host/settings tests passed. An immediate focused
`teams.test.tsx` rerun passed all three cases (27 assertions). Record this
intermittent failure; it has not been proven pre-existing by a control or
resolved by the successful rerun. CLI `bun typecheck`, targeted Prettier checks, and
`git diff --check` pass. Targeted lint reports zero errors and three
type-assertion warnings within the new host adapters (readonly generated JSON
typing and undefined-key cleanup); these are not a claim of a clean repository-
wide lint baseline. No generated files, cloud checkout, or GitHub issue were
changed in this slice.

Next unclosed host work: managed daemon/attach, isolated project configuration
and Kilo-only config compatibility, broader settings scopes, and remaining
headless input/output parity. Runtime inventory work (memory, indexing,
sandbox/telemetry/skills policy) remains separately open. Sharing is still
`in-progress` under the deployment/viewer/org/synchronization gates below;
none of the local host tests close those backend gates.

## Session sharing — remaining acceptance gates

Keep the sharing inventory row `in-progress` until all of these are resolved:

1. **Cloud contract and deployment.** Target the newer purpose-bound JWT
   `share_token` contract and nested `{ info, messages: [{ info, parts }] }`
   export. The audited cloud `origin/main` is
   `08c4887fa68738f19089284101084f404eb6c9b8` (2026-09-03). The older local
   checkout returns UUID `public_id` and disables public reads; it must not be
   mistaken for the current target. Neither revision proves deployed behavior.
2. **Public viewer compatibility (Kilo cloud/web).** The audited viewer reads
   v1 `message.info.role` and separate parts. V2 messages use `type` and embed
   their content, so the existing viewer drops them. Add explicit v2 support;
   acceptance by the loose ingest schema is insufficient. Legacy shares with
   separate parts remain rejected by the v2 importer until a deliberate
   conversion preserves their content.
3. **Team ownership (Kilo plugin + backend).** Bootstrap creates personal
   ownership. Model-routing headers and session metadata do not transfer team
   scope. Wire the actual selected organization UUID and platform through the
   supported `kilo_meta` contract and membership checks. Until then, reject team
   or unavailable selections before bootstrap/upload; do not silently fall back
   to personal ownership.
4. **Post-share synchronization (Kilo plugin + backend).** Ingest upserts IDs
   and retains omitted messages; it has no per-item deletion or snapshot
   replacement contract. Define how updates, reverts/removals, and revocation
   behave before adding automatic uploads. `?v=2` controls lifecycle handling,
   not transcript format or snapshot acknowledgement. Do not invent status or
   lifecycle events to make a snapshot appear complete.
5. **End-to-end acceptance.** Use an intentionally shareable fixture against
   the target deployment to verify rendering, ownership, updates, revocation,
   and fork continuation. Current tests use local servers and publish no real
   sessions. Public sharing requires explicit consent to upload the transcript,
   tool output, attachments, and local paths; the current export is not redacted.

These are completion criteria for the existing Phase 1 sharing row, not new
phases or permission to increase the approved shared-patch count.

## Plan completion follow-up — 2026-09-10

Fixed the reported missing timestamp naming instruction and invisible new-session
handoff. Built-in Plan supplies a Unix-millisecond prefix for new filenames.
Successful new-session completion carries its destination in tool metadata; the
TUI preserves the Plan tab and opens/focuses a separate Code tab. The shared plugin
tab-open implementation now promotes explicitly opened tabs instead of replacing
a preview. The old Plan session remains Plan by design.

Focused verification: 15 tests pass, including a real-host/rendered question-to-tab
handoff; CLI and TUI typechecks pass. Broader native tab coverage: 64 pass, two
shared-storage timeout failures. See
[Plan parity notes](../technical-notes/baseline/plan-v2-parity.md) for scope and
limitations. No capability percentage changed, no live session restart, no commit.
