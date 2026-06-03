# Kilo-Specific Test Coverage Review

## Scope and methodology

Reviewed PR [#10822](https://github.com/Kilo-Org/kilocode/pull/10822), snapshot `94fc42255c35827b197d97368d75d079242e9f4d`, against base snapshot `2f7f23deac683078a350014ec8a1a946aae46ce4`. Used read-only Git diffs to inspect deleted paths, changed test and fixture paths, removed assertions, `kilocode_change` movements, paths containing `kilo` or `kilocode`, and nearby replacement tests. Also inspected the pristine upstream target checkout at `/Users/marius/Documents/git/kilocode/.worktrees/opencode-merges/v1.14.46/merge/.worktrees/opencode-merge/opencode` (`d802b0a277f4e7f113b5efd8d5446fc1db22f4a4`) as a reference.

The focused test-path diff reports 27 changed test or fixture paths: 10 added, 17 modified, and 0 deleted. The entire PR reports 0 deleted paths. The Kilo-owned CLI test subtree `packages/opencode/test/kilocode` contains 193 files at both reviewed snapshots.

## Findings

### Human verification required: structured sync validation-error coverage is disabled

- `packages/opencode/test/server/httpapi-sync.test.ts` changes `test("returns structured validation errors", ...)` to `test.todo("returns structured validation errors", ...)`.
- This weakens active coverage: the test body still asserts HTTP `400`, JSON `content-type`, `body.success === false`, and an array in `body.error` or `body.errors`, but Bun no longer executes those assertions.
- `packages/opencode/test/server/sdk-error-shape.test.ts` adds related SDK behavior coverage for a `400` response with an empty body. It verifies that the SDK throws a real `Error` with a non-empty message and `cause.status === 400`. This is not a replacement for the disabled server-side structured JSON validation-error contract.
- The existing `validates seq values` test in `packages/opencode/test/server/httpapi-sync.test.ts` still verifies that invalid history and replay sequence values return HTTP `400`, but it does not verify the structured response body.
- Human decision is required: either restore active structured-error coverage if that contract remains intentional, or confirm that the new Effect HTTP API behavior intentionally returns an empty validation-error body and remove or rewrite the obsolete `test.todo` with an explicit replacement contract.

## Notable non-findings

- No test files, fixture files, or other paths are deleted by the reviewed PR. No Kilo-owned test file disappears from `packages/opencode/test/kilocode`.
- `packages/opencode/test/cli/cmd/tui/sync.test.tsx` removes a large inline test harness, including `kilocode_change` wrappers around `ToastProvider` and the `/global/config` fixture response, but this is coverage migration rather than loss. The harness moves to `packages/opencode/test/cli/cmd/tui/sync-fixture.tsx`, preserving those Kilo additions and adding `/network` and `/background-process` fixture responses. `packages/opencode/test/cli/cmd/tui/sync-undefined-messages.test.tsx` then reuses the fixture for a new failed-message-load regression case.
- `packages/opencode/test/kilocode/background-process-tool.test.ts` only updates the `toJsonSchema` import after the utility moves to `@opencode-ai/core/effect-zod`; no assertion is removed.
- `packages/opencode/test/kilocode/server/httpapi-public.test.ts` keeps its existing Kilo branding, agent-builder slug, and nullable organization-reset assertions. It adds explicit Kilo route coverage for `directory` and `workspace` query parameters on background-process and Kilo Console routes.
- `packages/kilo-ui/src/components/session-diff.test.ts` keeps all existing assertions and adds legacy-snapshot coverage for missing file paths. `packages/kilo-jetbrains/backend/src/test/kotlin/ai/kilocode/backend/cli/SessionModelSerializationTest.kt` updates numeric expectations from integers to doubles without reducing the asserted fields.
- `packages/opencode/test/server/httpapi-sdk.test.ts` changes the `throwOnError` assertion from a raw server object to a real `Error` with message and `cause.body`; `packages/opencode/test/server/sdk-error-shape.test.ts` adds focused regression coverage for that new contract. This is a replacement and strengthening, not a loss.
- `packages/opencode/test/tool/read.test.ts` changes a read-permission expectation from an absolute path to a worktree-relative path and adds a dedicated worktree-relative regression case. The affected behavior remains covered.
- Additional tests strengthen Kilo-sensitive HTTP API behavior, including `packages/opencode/test/server/httpapi-query-schema-drift.test.ts`, `packages/opencode/test/server/httpapi-promptasync-context.test.ts`, `packages/opencode/test/server/negative-tokens-regression.test.ts`, `packages/opencode/test/server/session-diff-missing-patch.test.ts`, `packages/opencode/test/server/httpapi-session.test.ts`, `packages/opencode/test/server/session-messages.test.ts`, and `packages/opencode/test/session/schema-decoding.test.ts`.

## Command outputs

```text
$ git diff --diff-filter=D --name-status 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d
(no output)

$ git diff --name-status 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d -- <focused test and fixture globs> | wc -l
27

$ git diff --diff-filter=A --name-only 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d -- <focused test and fixture globs> | wc -l
10

$ git diff --diff-filter=M --name-only 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d -- <focused test and fixture globs> | wc -l
17

$ git diff --diff-filter=D --name-only 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d -- <focused test and fixture globs> | wc -l
0

$ git ls-tree -r --name-only 2f7f23deac683078a350014ec8a1a946aae46ce4 packages/opencode/test/kilocode | wc -l
193

$ git ls-tree -r --name-only 94fc42255c35827b197d97368d75d079242e9f4d packages/opencode/test/kilocode | wc -l
193
```

## Limitations

- This is a static, read-only coverage review. Tests were not executed.
- The report assesses whether Kilo-specific coverage was removed or weakened. It does not validate production behavior, CI health, or whether all newly added tests pass.
- The review checkout already contained unrelated untracked reports, `INFRASTRUCTURE_CHANGE.md` and `UNNECESSARY_MARKERS.md`; they were not modified.
