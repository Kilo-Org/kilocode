# Kilo v2 scenario test plan

Separate from the [implementation plan](kilo-opencode-v2-issue-13750.md).
This is a test checklist, not a claim that scenarios have passed.

## Scenario lists

| List | Scope | Manual execution status |
|---|---|---|
| [CLI/TUI scenarios](kilo-opencode-v2-test-plan-ui.md) | Dialogs, model selection, agents, Plan, settings, memory and sidebar, terminal behavior | NOT RUN |
| [Runtime and data-safety scenarios](kilo-opencode-v2-test-plan-runtime.md) | Permissions, persistence, imports, Gateway, cloud/remote/share, isolation, sandbox, telemetry and ACP | NOT RUN |

The initial inventory contains **161 scenarios**: `UI-001`–`UI-080` and
`RT-001`–`RT-081`. Setup instructions and source references are reviewed
separately from executing the scenarios; an authored case is not validation.

Use the stable `UI-…` and `RT-…` identifiers when reporting failures. Automated
test references identify related coverage; they do not certify a manual test or
a deployed service. VS Code and JetBrains implementation/testing is deferred.

## Start safely

- Record the checkout commit, whether it has local changes, launch command,
  runtime version, terminal application and dimensions. A source preview and an
  older compiled binary can behave differently even from the same checkout.
- The source launcher from the repository root is
  `./packages/kilo-cli/dist/interactive/kilo2`. It uses the bundled runtime and
  current source. Restart the preview host to load changed host policy; do not
  assume opening a new client refreshes an already-running daemon.
- Use a disposable project and isolated preview profile for mutation, import,
  sandbox and failure-injection cases. Never point these cases at production
  Kilo/OpenCode stores, real credentials or valuable files.
- Treat any account connection, upload, remote enablement, public sharing,
  telemetry collector, paid model request or real embedding request as a
  separate explicit opt-in. Offline fixture coverage does not authorize those
  actions or establish their deployed contracts.
- Prefer cancelling or closing a dialog over changing an existing account or
  project setting just to inspect the UI. Record and restore intentional test
  settings; do not delete an entire profile as cleanup.

## Suggested order

1. Run the UI list's quick-smoke subset first: launch, slash-command uniqueness,
   first-open model loading, Code/Plan selection, plan save and cancellation,
   settings navigation, compact memory status, resize and restart.
2. Exercise the recently changed features with disposable data: permissions,
   same-project versus other-project state, account/location refresh and JSONC
   precedence. A displayed path or success message is not evidence of a saved
   file: check persisted content and reopen it.
3. Run lifecycle and failure cases: interrupted streams, reconnect, failed
   requests, cancelled forms, stale dialog revisions and process restart.
4. Run fixture-only data-safety cases before considering any opted-in live
   account test. Unsupported or unverified behavior must remain explicitly
   blocked, not silently replaced by a different workflow.

## Automated validation

Run from `packages/kilo-cli`, never the repository root:

```sh
./dist/interactive/bun run typecheck
./dist/interactive/bun run script/test.ts
```

For a focused compiled/host test batch, pass test paths to `script/test.ts`.
This builds a fresh artifact and sets `KILO_CLI_TEST_ARTIFACT_DIR`; bare
`bun test` must not silently use an old `dist/kilo2`. Do not build with the
ambient Bun 1.3.14 runtime. Coordinate the full suite after writers settle;
changing shared files underneath a run invalidates its acceptance evidence.

Never reset, check out, stash or temporarily replace shared working files to
compare a baseline. Use an isolated source snapshot or disposable worktree.

## Record each execution

Copy this record into a separate results note; leave the checklist reusable.
Redact tokens, balances, private transcript content and sensitive filesystem
paths from screenshots or request captures before sharing them.

| Field | Value |
|---|---|
| Case ID / date / tester | |
| Commit / dirty state / runtime / launch command | |
| OS / terminal / dimensions / profile and project scope | |
| Preconditions and intentional deviations | |
| Actual result | |
| Verdict | NOT RUN / PASS / FAIL / BLOCKED / NOT APPLICABLE |
| Evidence | Screenshot, sanitized output, fixture assertion or error |
| Cleanup / settings restored | |
| Follow-up issue / reproducibility | |

A known gap is **BLOCKED**, not PASS. Use NOT APPLICABLE only with a concrete
scope or platform reason. An automated fixture result must be labeled as such,
not substituted for a live/manual result.

## Current cautions

- Plan save consent is prompt-directed. The native permission boundary and
  completion choice are exercised separately; do not treat a scripted fixture
  as proof that every model will follow the save-question instruction.
- Memory's compact status row is implemented, but the historical per-session
  activity indicator and five-second saved pulse remain a parity gap. A neutral
  Enabled bullet is not evidence that memory failed or that it was injected.
- BB terminal elements disappearing after idle is still unresolved. Record
  whether typing changes it and whether resizing restores it; do not confuse
  that with terminal teardown on exit or session-data loss.
- Gateway security/config changes, remote compatibility and the settings UI
  selection investigation require their own final integration evidence.
- Gateway credential-body hygiene must include prompts and automatic titles
  on every transport. Independent review corrected the earlier explanation:
  titles use normal request preparation. The old AISDK-compatible adapter
  ignored supplied HTTP middleware; the new native route removes that path.
  Focused all-wire tests and independent correctness review pass. The stable
  pre-cleanup snapshot passed the full CLI wrapper (443 tests, 0 failures);
  subsequent cleanup requires fresh focused checks. Compiled Auto packaging
  remains unverified end to end.
- Local share/relay/cloud fixtures do not establish which contract is deployed.
- The checklist does not increase the implementation completion percentage.
