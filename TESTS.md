# TESTS.md — PR #10790 (OpenCode v1.14.42 upstream merge)

## Methodology

For each test file the PR touched, I ran `git diff origin/main...HEAD -- <file>` on branch `review/pr-10790-reviews` (based on `trial/kilo-opencode-v1.14.42`). I:

1. Diffed the four modified shared `packages/core/test/` files and inspected for removed `kilocode_change` markers or Kilo assertions.
2. Confirmed the six added test files (`packages/http-recorder/`, `packages/llm/`) are net-new files in net-new packages, so they cannot have removed existing Kilo tests.
3. Ran `git diff origin/main...HEAD -- packages/opencode/test/kilocode/` even though the PR description didn't call it out — the merge produced 26 changed files there, including one deletion, so it warranted scrutiny.
4. Enumerated every removed vs. added `test(`/`it(`/`describe(` declaration across the kilocode test tree and traced each removal to either a rename, a parametrization collapse, or an obsoleted assertion.
5. Verified that route coverage from the deleted bridge test is preserved by the new `httpapi-exercise` harness, and that `Server.openapiHono` / `Server.Legacy` / `KILO_EXPERIMENTAL_HTTPAPI` no longer exist in `src` (Effect HttpApi migration).

## Findings

1. **(Low severity — minor coverage gap) Removed `permission reply` 404 case in `packages/opencode/test/kilocode/permission/next.reply-http.test.ts`.**
   The test `"returns 404 for unknown replies when experimental HttpApi is enabled"` was deleted along with the `KILO_EXPERIMENTAL_HTTPAPI` flag plumbing and the `Server.Legacy()` branch. This is a direct consequence of the Effect migration removing the legacy-vs-experimental server duality (the experimental path is now the only path). The happy-path test for `POST /permission/:requestID/reply` is retained, but the specific 404-on-unknown-reply assertion is not re-added to that file or to the `httpapi-exercise` `kiloScenarios`. Recommend confirming the missing-permission 404 path is intentionally dropped or re-add a scenario for it.

2. **(No coverage loss — refactor, noted for visibility) Deleted `packages/opencode/test/kilocode/server/httpapi-bridge.test.ts` (175 lines).**
   This Kilo-specific test asserted that all Kilo overlay routes were mirrored across the **Hono** and **Effect** OpenAPI specs, plus nullable provider/indexing sentinel parity and FIM SSE schema parity between the two specs. Those assertions are now obsolete because the Hono OpenAPI generator (`Server.openapiHono`) was removed in the migration — there is only one spec left, so cross-spec parity is meaningless. Route coverage was migrated to the new `packages/opencode/test/kilocode/server/httpapi-exercise-scenarios.ts` (`kiloScenarios`, 380 lines), wired into `test/server/httpapi-exercise/index.ts` and run via the `test:httpapi` script with `--fail-on-missing`. The new harness covers every route the bridge test listed (background-process, network, suggestion, telemetry, remote, kilo gateway, session-import, etc.) and exercises them end-to-end rather than just checking spec presence — net increase in coverage. The only Kilo assertions not re-expressed are the Hono↔Effect *parity* checks, which are inapplicable post-migration.

## Non-findings (checked, no Kilo tests removed)

- `packages/core/test/global.test.ts` — preserves the `kilocode_change` assertion (`tmp` path is `kilo`, not `opencode`).
- `packages/core/test/util/effect-flock.test.ts` & `flock.test.ts` — Kilo Windows-race `kilocode_change` blocks are intact and even expanded; no test cases removed.
- `packages/core/test/effect/cross-spawn-spawner.test.ts` — only a cross-platform `realpath`/normalize hardening of an existing assertion; no Kilo logic dropped.
- `packages/http-recorder/test/record-replay.test.ts`, `packages/llm/test/*` — net-new files in net-new packages; nothing removed.
- `packages/opencode/test/kilocode/server/httpapi-public.test.ts` — net *added* Kilo assertions ("uses Kilo branding", "keeps transcription prompts in the public contract"); none removed.
- `packages/opencode/test/kilocode/server/provider-auth-lifecycle.test.ts` — net-new Kilo test.
- `packages/opencode/test/kilocode/global-config-refresh.test.ts` — the three Kilo tests are retained; only the `KILO_EXPERIMENTAL_HTTPAPI` legacy/httpapi parametrization was collapsed (legacy server path removed), so the duplicate "legacy" variants disappear but each Kilo behavior is still asserted once.
- `packages/opencode/test/kilocode/kilo-errors.test.ts` — `"still returns a string for regular 429 errors"` was renamed to `"still returns retry details for regular 429 errors"` and updated to the new `{ message }` return shape; Kilo retry behavior still asserted.
- Various server and session Kilo test files — modifications only (import/flag/signature updates from the migration); no removed `test`/`it`/`describe` declarations.

**Overall:** No Kilo-specific tests were silently lost. One deletion (the HttpApi bridge test) is a legitimate refactor into a superior end-to-end harness with the only-dropped assertions being now-impossible Hono↔Effect parity checks. The single item worth a maintainer decision is the dropped `permission reply` 404 case (Finding 1).
