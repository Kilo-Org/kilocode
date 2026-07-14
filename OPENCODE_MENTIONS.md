# OpenCode Mention Audit: PR #12204

## Scope And Method

- Reviewed current branch `review/upstream-12204-latest` at `472247daa9063cf7dfea423bec64c46cea44ba36` against requested base `c49560af0f94459015d3fa4e1efa23ad9b291955`; `git merge-base` equals the requested base.
- Audited the complete three-dot diff: 972 changed files, 40,251 insertions, and 26,427 deletions.
- Searched added lines case-insensitively for `OpenCode`, `open code`, `opencode`, `opencode.ai`, `opncd.ai`, `anomalyco/opencode`, and `sst/opencode` across UI/TUI strings, URLs, docs, CLI/help, package metadata, config material, generated SDK/OpenAPI output, errors, and runtime strings.
- Compared suspicious hits with the base commit and rename metadata to distinguish newly introduced/restored user-facing branding from inherited upstream identifiers, compatibility names, internal package imports, tests, and attribution.
- Inspected the latest `Check forbidden strings` workflow run for this exact HEAD (run `29360349407`, job `87178529284`) and reproduced the check locally.
- Preserved the four unrelated untracked reports present before this review and wrote only this file.

## Findings

### Medium: Public beta publication exposes the upstream package identity

The PR changes `packages/http-recorder/package.json` from private to publicly publishable (`publishConfig.access: "public"` at lines 26-27), and `packages/http-recorder/README.md:7-13` newly presents a public beta and tells external users to install `@opencode-ai/http-recorder@beta`. The package name and README heading existed at the base while the package was private, but this PR makes that OpenCode-branded identity user-facing.

This is ownership-dependent rather than an unconditional branding defect. The namespace, archive/build names, imports, and `packages/http-recorder/LICENSE:3` attribution are internally consistent with an upstream-owned package. However, current metadata now points to Kilo (`packages/http-recorder/package.json:10-14`), which implies Kilo ownership while the public npm identity remains OpenCode.

Action: explicitly decide and document who owns/publishes this package before merge.

- If Kilo owns the public release, use a Kilo package namespace/name and update the README, package/build verification scripts, archive naming, lockfile/workspace consumers, and copyright only as legally appropriate.
- If this intentionally preserves an upstream-owned `@opencode-ai/http-recorder` publication, keep the package name and attribution, confirm Kilo should be the repository/homepage/issue destination, and document that exception in the PR.

No other actionable user-facing OpenCode branding leak was found in the current diff.

## Resolved Since Prior Head

The previous HEAD added three public npm metadata links to `github.com/anomalyco/opencode`. Current commit `472247daa9` fixes all three:

- `packages/http-recorder/package.json:10` now uses `git+https://github.com/Kilo-Org/kilocode.git`.
- `packages/http-recorder/package.json:13` now uses the Kilo package tree URL.
- `packages/http-recorder/package.json:14` now uses the Kilo issue tracker.

The latest CI log checks exact HEAD `472247daa9063cf7dfea423bec64c46cea44ba36` and reports:

```text
check-forbidden-strings: 8352 file(s) checked, no forbidden strings found.
```

The same command passes locally. The earlier high-severity repository-link finding is therefore resolved.

## Notable Non-Findings

- A focused added-line scan found no OpenCode branding in `packages/sdk/openapi.json`, generated `packages/sdk/js/src/v2/gen/`, CLI help snapshots, or Kilo docs pages (`MATCHES=0`).
- No OpenCode additions appeared in the changed CLI help snapshot or generated CLI reference output.
- The existing SDK error `Request is not supported by this version of OpenCode Server` at `packages/sdk/js/src/v2/client.ts:96` is user-facing but unchanged from base line 100, so this PR neither introduces nor restores it.
- The `opencode` fallback user agents in `packages/core/src/tool/webfetch.ts:159` and `packages/core/src/tool/websearch.ts:232` are unchanged from the base and should not be attributed to this PR.
- The observability values `serviceName: "opencode"`, `opencode.client`, and `opencode.run` at `packages/core/src/observability/otlp.ts:38-44` preserve values from the deleted base implementation in `packages/core/src/effect/observability.ts`; this is relocation/refactoring.
- The 36 bundled TUI theme links to `https://opencode.ai/theme.json` are 100% renames from the old TUI theme directory, not newly introduced URLs.
- Upstream-branded tips visible in `packages/tui/src/feature-plugins/home/tips-view.tsx:271-282` remain inside the intentionally disabled block ending at line 292 and are not rendered; active tips come from the Kilo list.
- `specs/tui-package.md` uses OpenCode terminology for upstream architecture, package names, migration boundaries, and paths. It is an internal migration specification, not product documentation or UI.
- `@opencode-ai/*` private workspace packages/imports, Effect service tags, `opencode` provider IDs, compatibility config names, test fixtures, and paths under `packages/opencode/` are legitimate internal/upstream compatibility references.
- `packages/http-recorder/LICENSE:3` is upstream copyright attribution and should not be mechanically rebranded.
- New regression tests guard direct-mode and OAuth Kilo branding at `packages/opencode/test/kilocode/cli/direct-mode-branding.test.ts:11-14` and `packages/opencode/test/kilocode/oauth-branding.test.ts:20-24`. The extracted TUI fatal-error URL correctly targets Kilo at `packages/tui/src/component/error-component.tsx:39`.

## Command Output

```text
$ git rev-parse --abbrev-ref HEAD
review/upstream-12204-latest

$ git rev-parse HEAD
472247daa9063cf7dfea423bec64c46cea44ba36

$ git merge-base c49560af0f94459015d3fa4e1efa23ad9b291955 HEAD
c49560af0f94459015d3fa4e1efa23ad9b291955

$ git diff --shortstat c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD
972 files changed, 40251 insertions(+), 26427 deletions(-)

$ gh run view 29360349407 --repo Kilo-Org/kilocode --job 87178529284 --log
check-forbidden-strings: 8352 file(s) checked, no forbidden strings found.

$ bun run script/check-forbidden-strings.ts
check-forbidden-strings: 8352 file(s) checked, no forbidden strings found.

$ <added-line scan over SDK/OpenAPI, generated SDK, CLI help snapshots, and Kilo docs pages>
MATCHES=0

$ git diff --check c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD
patches/@ff-labs%2Ffff-bun@0.9.3.patch:7: trailing whitespace.
<blank line containing trailing whitespace>
patches/@ff-labs%2Ffff-bun@0.9.3.patch:29: trailing whitespace.
<blank line containing trailing whitespace>
```

The whitespace output is unrelated to this branding audit but is included because it appeared during validation.

## Limitations

- This was a static diff and CI-log audit. I did not launch the interactive TUI, publish/inspect an npm tarball, or regenerate SDK/OpenAPI output because the task permits only this report file to be written.
- `rg` is unavailable in this container, so equivalent `git diff`/Perl filters plus repository file and content search tools were used.
- The audit is scoped to changes relative to the requested base. Existing user-facing references are discussed only when needed to prove that a suspicious current string was inherited rather than introduced/restored by this PR.
