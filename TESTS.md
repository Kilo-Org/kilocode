# PR #12088 Kilo Test Preservation Review

## Scope and methodology

Reviewed `origin/main...HEAD` (`d6d90762771307b14f283caedcdbd60c66428e84...a1d8b83b59de161387b19fb8b43e4b4d16e4f869`), including the full 1,206-file diff, all 415 changed test files, 14 deleted test files, low-similarity renames, test scripts/profiles/workflows, removed Kilo-sensitive assertions, and relevant file history. I compared deleted suites with replacements in `packages/core/test`, searched current tests for the removed behaviors, and traced the suspicious removals to `2770028959` (`refactor: kilo compat for v1.16.2`) and the follow-up regression-fix commit.

## Findings

### High: the live `repo_clone` suite was deleted while the Kilo tool remains

`packages/opencode/test/tool/repo_clone.test.ts` was deleted in `2770028959` and was not restored by `a1d8b83b59`. No current test contains its seven behaviors: managed-cache clone/reuse, refresh, configured branch, malformed repository rejection, local-file URL rejection, or invalid branch rejection. This is not an obsolete-tool cleanup: `RepoCloneTool` is still instantiated at `packages/opencode/src/tool/registry.ts:158`, current registry tests still assert that `repo_clone` is exposed to the scout agent, and the Darwin test profile still names `repo_clone` at `packages/opencode/script/kilocode/test-profile.ts:27`. The brace glob continues to match its other members, so profile validation does not reveal the missing file.

Restore or port the deleted live suite. In particular, retain the `KILO_REPO_CLONE_GITHUB_BASE_URL` fixture because it exercises the real clone path without external network access.

### High: Kilo's macOS CI exception for native watcher tests was lost

The deleted `packages/opencode/test/file/watcher.test.ts` deliberately ran in CI when `KILO_TEST_PROFILE=darwin` despite skipping unreliable native bindings elsewhere. Its replacement gates the entire suite with `Watcher.hasNativeBinding() && !process.env.CI` at `packages/core/test/filesystem/watcher.test.ts:17`. The workflow still sets the Darwin profile for CLI tests at `.github/workflows/test.yml:138-144`, but the CLI profile now selects only package-local `filesystem/*.test.ts` at `packages/opencode/script/kilocode/test-profile.ts:20`; it cannot select the core watcher file. The non-CLI core job does run on macOS, but `CI` makes this replacement suite skip there too.

Consequently, create/change/delete delivery, cleanup, `.git/index` filtering, `.git/HEAD`, non-git roots, and symlinked `.git` behavior have no native CI execution. Preserve the old Darwin exception in the core test or add an equivalent core-package profile/wiring.

### Medium: the Kilo worktree-boundary regression tests were removed without an equivalent

Deleting `packages/opencode/test/file/path-traversal.test.ts` removed direct coverage of `containsPath`, including a working directory nested below the worktree, sibling/worktree-root access, `..` escape rejection, and the non-git `worktree === "/"` guard. The implementation remains at `packages/opencode/src/project/instance-context.ts:18-23` and is still used by Kilo plan files, background processes, shell permissions, config classification, and LSP filtering. No current test references `containsPath`.

The new core location-filesystem tests do cover relative and symlink escapes for the new filesystem service, but they do not exercise this Kilo-facing `directory OR worktree, except "/"` policy. Restore focused tests for this helper; the obsolete legacy `File.read`/`File.list` cases need not be restored if those endpoints were intentionally replaced.

### Medium: eager legacy Bus/SSE race coverage was substantially reduced

The deleted `packages/opencode/test/server/httpapi-event-diagnostics.test.ts` covered rapid multi-event delivery, `SyncEvent` to both callback and SSE subscribers, and both subscriber setup orders. The three deleted `packages/opencode/test/bus/*.test.ts` suites also covered immediate subscription, unsubscribe/disposal, multiple subscribers, and directory isolation. Kilo still retains the legacy Bus boundary, and the new `packages/opencode/test/kilocode/legacy-sse-event.test.ts` is valuable, but its two tests cover one routed legacy event and one versioned sync envelope only. Searches found no current equivalents for burst delivery, simultaneous callback/SSE receipt, or the acquisition-order regression.

Restore a smaller Kilo-owned race suite around the retained legacy Bus-to-SSE adapter rather than all of the old generic Bus tests.

### Medium: forced session import no longer verifies dependent message/part cleanup

The real-database rewrite of `packages/opencode/test/kilocode/session-import-service.test.ts` is stronger than the old mock for session-row recreation, but the force test at lines 91-102 now seeds only a session and checks only its new title. The base test seeded messages and parts, then asserted the forced delete removed both before recreation. `SessionImportService.session` still performs a session delete at `packages/opencode/src/kilocode/session-import/service.ts:38-42`, so cascade/dependent cleanup remains part of the behavior that can regress.

Seed actual `MessageTable` and `PartTable` rows before the forced import and assert that they are gone afterward.

### Human verification: legacy JSON-to-SQLite upgrade support

The PR deletes both `packages/opencode/src/storage/json-migration.ts` and its 832-line `packages/opencode/test/storage/json-migration.test.ts` suite. That suite covered stale IDs, messages/parts, todos, permissions, shares, orphan handling, corruption tolerance, and idempotency for persisted user data. The new core database-migration tests cover SQL schema migrations, not JSON-storage import. If the supported upgrade window intentionally no longer includes JSON-backed Kilo versions, this deletion is expected; otherwise this is a user-data compatibility regression and the implementation plus focused migration coverage must remain. Confirm the release/upgrade policy before merging.

## Notable non-findings

- No test under a `kilocode` path was deleted. The apparent removed `RecallSearch` declarations are a test-runner rewrite; all eight behaviors and assertions remain.
- Kilo provider, gateway credential, exact header casing, `HTTP-Referer`, `X-Title: Kilo Code`, and provider-isolation assertions were ported to the new catalog request shape rather than removed.
- Kilo config schema branding, `.kilo` versus `.kilocode` precedence, project-config disabling, managed config, and file-token boundary tests remain.
- PTY output isolation/session tests moved to `packages/core/test/pty`, account auth migration coverage remains in `packages/core/test/kilocode`, `repo_overview` moved into a Kilo-owned test path, and ripgrep was detected as a rename rather than a deletion.
- No Kilo test script was removed from `packages/opencode/package.json`; `test:ci` still uses the Kilo test runner. The migration-check script removal accompanies migration ownership moving to core and is not itself a lost test registration.

## Commands and limitations

Key commands included `git diff --stat/--summary/--name-status/--numstat origin/main...HEAD`, targeted `git diff -G` and `--word-diff` searches, declaration comparisons with `git grep`, `git log --follow`, low-threshold rename detection, current-tree replacement searches, workflow/profile inspection, and `git diff --check origin/main...HEAD` (passed).

I did not run the full suites. `bun test test/kilocode/test-profile.test.ts` was blocked before collection by missing preload `@opentui/solid/preload`; a standalone Bun import was then blocked by an installed Babel dependency mismatch (`TypeError: _debug is not a function`). Findings therefore come from the complete diff/history and static registration/behavior comparison. No network-backed tests or remote PR metadata were inspected.
