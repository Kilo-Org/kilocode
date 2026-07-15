# PR #12204 Kilo Test-Coverage Audit: Second Pass

Reviewed PR HEAD `2d92d8dae2cb2d9efc4961b020dabb11ff5564aa` against merge base `19bd048e21464f69b45e0d7a27c98a77037ebb08`.

## Finding

### High: CI executes none of the extracted TUI package tests

The fallback at `.github/workflows/test.yml:139` is intended to run packages with `test` but no `test:ci`, including `@opencode-ai/tui`. Turbo logs show that the command selects seven packages but executes zero tasks and exits successfully:

```text
WARNING  No tasks were executed as part of this run.
Tasks: 0 successful, 0 total
```

The JUnit artifacts contain no TUI or LLM report. No other workflow runs `@opencode-ai/tui`.

This leaves the restored hydration-race suite and all other extracted TUI tests unenforced despite green required checks. Add a generic Turbo `test` task, separate package invocations, or `test:ci` scripts, and fail CI when zero intended tests run.

## Resolved Since First Pass

- The macOS profile selects the replacement HTTP reference test and validates independently before the profiled suite. Current macOS tests pass.
- Six restored hydration tests cover live events during snapshot fetch, duplicate replay, partial snapshots, stale cache replacement, and order/metadata preservation. Source coverage is restored, but CI enforcement remains blocked by the finding above.
- Both direct-mode skill-picker tests are active and pass.
- Repeated logger initialization and timestamped-log cleanup have focused passing Kilo tests.
- Reference materialization and refresh use a real local Git remote and pass in Core CI.
- JUnit production, publication, and upload are restored for packages with `test:ci`; all seven platform unit jobs upload reports.

## Skip Audit And Additional Coverage

No new Kilo-owned skip was introduced by the remediation. Existing OpenTUI/keymap and platform-gated skips are unchanged. New Kilo-owned Core suites cover event-storage compatibility, grep behavior, image sizing, filesystem reads, search targets, and spawn validation, and these execute through Core `test:ci`.

## CI And Limitations

All required checks at the audited SHA pass, including Linux, macOS, Windows, HttpApi, JetBrains, VS Code, typechecks, and visual regression. The green result does not invalidate the finding because Turbo explicitly reports zero fallback-package tasks.

This was a read-only source, CI-log, and JUnit-artifact audit. No local tests were run against the target tree because the shared worktree contains unrelated staged changes.
