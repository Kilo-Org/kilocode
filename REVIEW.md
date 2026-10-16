# REVIEW.md

Review policy for PRs into the Kilo v2 line (`v2` and PRs stacked on v2 PR branches). Kilo is a fork of OpenCode: Kilo code lives in Kilo-owned paths, and upstream code arrives only through sync PRs.

- Kilo-owned paths (as in `script/upstream/utils/owned.ts`): `packages/kilo-*/**`, `packages/**/src/kilocode/**`, `packages/**/test/kilocode/**`, `.kilo/**`, `migration-tracking/**`, `script/upstream/**`, `script/check-*.ts`, `script/dev-isolated.ts`, `.github/workflows/kilo-v2.yml`, `REVIEW.md`. A path that also exists in the pinned upstream release is shared, even when it matches. Every other path is shared.
- Kilo seam: a `kilocode_change` line in a shared file (listed in `script/upstream/shared-patches.json` with rung and missing seam), or Kilo-owned code that calls an upstream API.
- Kilo CI: the workflows on `v2` (`check.yml`, `kilo-v2.yml`, `test.yml`) and the scripts they call.

A PR titled `chore(upstream): sync v2.x.y (<sha>)` (branch `sync-v*`) is an upstream sync PR: follow "Upstream sync PRs" only. Every other PR: follow "Kilo PRs".

## Upstream sync PRs

A sync PR merges one upstream release commit (`NEW`, the `<sha>` in the title) into `v2`. The previous pin (`OLD`) is the SHA in parentheses of the newest sync subject on the base branch (the PR body also gives it):

```bash
git log --format=%s origin/v2 | grep -m1 '^chore(upstream): sync v'
```

Do not review upstream code for defects. Bugs, security, performance and style in lines identical to `NEW` are upstream's to fix, even when they look wrong. `gh pr diff` fails for PRs above 300 files: use local `git`, and `git diff origin/v2...HEAD -- <file>` for the PR diff of one file.

Review two things:

**A. Did the merge keep Kilo's changes?** Compare Kilo's diff before and after the sync:

```bash
git diff --name-only $OLD origin/v2      # Kilo files before
git diff --name-only $NEW HEAD           # Kilo files after
git diff $OLD origin/v2 -- <file>        # Kilo patch before
git diff $NEW HEAD -- <file>             # Kilo patch after
```

Compare only `+` and `-` lines, not context. The file lists and each Kilo patch must match, except intended changes that the PR body names (a resolved conflict, a removed skip, a new workflow in `removed`, lowered limits). For a shared file that Kilo deletes (removed workflows), only check that it stays deleted. Skip `bun.lock`. Size sub-agent use by the files whose Kilo patch differs, not by the PR diff.

1. **Lost Kilo change (CRITICAL):** a Kilo patch or `kilocode_change` line missing or altered after the merge, or a change in a Kilo-owned path that the PR body does not explain.
2. **Shared-patch budget:** limits in `shared-patches.json` may go down; a raised limit needs an entry and a reason. A new test skip needs a `kilocode_change` marker that names the upstream fix, an entry and a line in the PR body. A temporary skip whose upstream fix is now merged must be removed.
3. **Workflows:** only `check.yml`, `kilo-v2.yml` and `test.yml` may exist. A new upstream workflow must be in `removed` in `script/check-workflows.ts` and deleted.
4. **Tests:** Kilo tests removed or weakened, or upstream tests newly skipped or deleted by the resolution.

**B. Does an upstream change break Kilo?** Read `git diff $OLD $NEW -- <paths>` for the upstream code that Kilo seams and Kilo CI depend on: the plugin API (`packages/plugin/src`, `packages/core/src/plugin`), `packages/schema/src`, provider, model and variant code in `packages/core/src`, `packages/core/src/config*`, `packages/core/src/session`, `packages/cli/src`, `packages/server/src`, the TUI files that Kilo seams use (for example `packages/tui/src/ui/dialog*.tsx`), `check.yml`, `test.yml`, and the scripts they run (with their imports). Flag:

5. **Broken chain:** a renamed, moved or removed function, hook, event, config key or plugin API member that a Kilo seam uses, or a changed default or meaning (a value set but no longer read, a hook no longer triggered). Typecheck catches type breaks; flag semantic ones. A changed default that Kilo inherits without a break (for example a timeout) is a SUGGESTION.
6. **Isolation and identity:** new upstream behavior that reads config, data or credentials outside the Kilo profile, or overrides Kilo settings (for example a new managed config directory). Also changes that affect the Kilo Gateway as the only source of Kilo models, `KILO_*` variables or `.kilo` config. The finding is the location outside the profile, not the name: do not flag that upstream names and paths are still `opencode`.
7. **CI drift:** trigger changes in `check.yml` or `test.yml` that drop `v2` or the pull request trigger, or new or changed scripts that Kilo CI runs directly or through imports (for example the CLI build scripts). New upstream tests that CI picks up are not drift.

Put B findings in the summary under "Upstream impact" with file, line and upstream commit. Use inline comments only for A findings on lines in the PR diff.

8. **PR body (SUGGESTION, summary only):** release and SHA, all included releases, lag, each conflict with its resolution and plugin-first rung, shared files touched, the test comparison against `v2`, self-test results, and the merge-commit note.

Skip in sync PRs: style, OpenCode branding in upstream code (a rename script handles it later), generated files (`bun.lock`, `packages/client/src/**/generated`, OpenAPI output), upstream packages that Kilo does not ship (`packages/console`, `packages/web`, `packages/enterprise`, `packages/desktop`, `packages/app`), PR size, and requests to split, squash or rebase (sync PRs merge with a merge commit). Use the standard summary format; with no findings, post the no-issues summary.

## Kilo PRs

### Do not duplicate CI

Do not comment on what CI reports: workflow allowlist, `kilocode_change` markers and shared-patch counts (`kilo-v2.yml`), lint and typecheck (`check.yml`), unit and e2e tests and generated SDK freshness (`test.yml`). If a CI job did not run, or passed with all steps skipped, say so in the summary.

### Flag (high confidence only)

- **Bugs:** security issues (injection, auth bypass, secrets in logs or errors, untrusted input at server routes, IPC or config loading), runtime errors (null access, missing `await`, unhandled Effect failures), logic errors, races in session and process lifecycle, resource leaks, breaking changes to public contracts (Protocol, HttpApi, Kilo plugin RPCs that VS Code or JetBrains call, exports of `packages/kilo-*` that a consumer still uses).
- **Plugin first (only when the PR changes a shared upstream file):** ask whether a Kilo plugin (`@opencode/plugin`) or the Kilo host could do it. The change must be a small, generic seam, marked, listed in `shared-patches.json`, and the PR must name the rung and the missing seam. Flag refactors of upstream code, upstream merges inside a feature PR, hand-edited branding in upstream files, and new user-facing OpenCode names or opencode.ai links in Kilo code.
- **Kilo boundaries:** Kilo logic packages (for example `packages/kilo-gateway-core`) import nothing from `@opencode/*`; only thin adapters do. A small copy of an upstream type or helper that this rule needs is expected, not a finding. The chat model list of the `kilo` provider comes only from the Kilo Gateway (no models.dev or snapshot fallback; defaults derived from Gateway data are fine). Requests to Kilo services (Gateway, `api.kilo.ai`) send the Kilo token, and the team header when a team is active, as v1 (`origin/main`) does. Flag a change to the Gateway model list, variant IDs or request headers that differs from v1 and that the PR body does not explain (WARNING).
- **Repository rules:** no `.changeset` files on `v2`; no hand edits of generated client files (Protocol or HttpApi changes need `bun run generate` in `packages/client`); Client code never imports Core or Server.
- **Style (AGENTS.md), clear violations in new code only:** `any`, empty `catch`, unneeded `try`/`catch`, `let` where `const` with a ternary or early return is simple, `else` after `return`, aliased or star imports, type-position `import("...")`, nested service yields in Effect, revalidating values a schema or type already guarantees, single-use helpers that do not name a real concept.
- **Tests:** new behavior has tests in its package; prefer real integration (the Kilo Gateway, or a local HTTP fixture server) over mocks; flag tests that copy the logic under test. New logic with no test is a WARNING. An untested branch next to a tested main path, TUI rendering, or ported v1 code that nothing calls yet is a SUGGESTION. Every skipped or deleted test needs a reason in the PR.
- **Ports from v1:** compare with the v1 code on `origin/main`. A faithful port is not a style finding; flag behavior that differs from v1 without a reason in the PR body.
- **PR body (SUGGESTION, summary only):** commands, file names or evidence in the body that do not match the code.

### Skip

Other style preferences, TODO comments, generated and lock files, style patterns already used in the same package (a copied pattern can still be a bug), existing OpenCode strings, and lines the PR does not change.

## Severity

- CRITICAL: a lost Kilo change, a security issue, data loss, broken Kilo Gateway login or model listing.
- WARNING: a bug, a broken chain, an isolation leak, an unjustified shared-file change, new logic without a test, workflow or trigger drift.
- SUGGESTION: plugin-first or hygiene improvements, test gaps next to tested paths, PR body gaps.

Write comments as suggestions; the human decides. Prefer prose over `suggestion` blocks.
