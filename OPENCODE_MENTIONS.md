# OpenCode Branding Audit: v1.17.5 Merge (PR #12404)

## Scope and Methodology

Reviewed merge-added lines only: `origin/main...HEAD` on
`marius-kilocode/review-opencode-v1.17.5` (current `HEAD`:
`06d871409b`). The merge changes 194 files, with 6,121 additions and
51,674 deletions.

The audit started with the PR file list, then searched added diff lines for
`OpenCode`, OpenCode web properties (`opencode.ai`, `docs.opencode`,
`opncd.ai`, `oc.dev`), and legacy GitHub repository URLs. It specifically
reviewed the changed TUI, UI, server, OpenAPI/generated SDK, documentation,
desktop/web/app, package metadata, and CLI surfaces. Clear internal package
references (`@opencode-ai/*`), Effect service tags (`@opencode/*`), migration
temporary-path names, test assertions, and upstream attribution were excluded
from findings.

`bun script/check-forbidden-strings.ts` also passed. Its active checks are
intentionally narrow: legacy share URLs, legacy upstream GitHub URLs (with
allowlists), two upstream HTTP referer strings, and three known UI phrases.
Its `opencode.ai` auth, docs, schema, theme, and default-share-url checks are
currently disabled, so the audit did not rely on that pass alone.

## Findings

1. **User-facing branding violation**
   - File: `packages/opencode/src/plugin/snowflake-cortex.ts:161,165,173`
   - Added strings:
     - `OpenCode - Snowflake Authorization Successful`
     - `You can close this window and return to OpenCode.`
     - `OpenCode - Snowflake Authorization Failed`
   - Why: These title and body strings are rendered by the local browser
     callback page after a user completes or fails the Snowflake OAuth flow.
   - Suggested fix: Change the title and body branding to `Kilo`, for example
     `Kilo - Snowflake Authorization Successful`, `return to Kilo`, and
     `Kilo - Snowflake Authorization Failed`.

2. **User-facing branding violation**
   - File: `packages/opencode/src/plugin/snowflake-cortex.ts:500`
   - Added string: `Complete Snowflake sign-in in your browser. OpenCode will
     capture the OAuth callback and store the bearer token automatically.`
   - Why: This is returned as the OAuth authorization instruction and displayed
     to the user by the provider connection UI.
   - Suggested fix: Replace `OpenCode` with `Kilo`.

## Needs Human Verification

1. **Externally observable product identity, not local UI copy**
   - File: `packages/opencode/src/plugin/snowflake-cortex.ts:82,405`
   - Added string: `User-Agent: opencode/${InstallationVersion}`
   - Why: Both the Snowflake OAuth token request and Cortex model API request
     send this header to Snowflake. It is not displayed in Kilo, but it exposes
     the upstream product name to a third party and could affect provider
     diagnostics or policy.
   - Suggested fix if outbound attribution must be Kilo-branded: use the
     established Kilo user-agent convention (`kilo/...`, `kilocode/...`, or
     `Kilo-Code/...`) selected by the provider-integration owner. Retain only
     if Snowflake specifically requires `opencode/...`.
   - Context: Other existing provider integrations still send
     `opencode/...`, while Kilo-specific integrations use several Kilo forms;
     this merge did not establish a single project-wide convention.

## Notable Non-Findings

- No added OpenCode web-property URL or legacy `sst/opencode` /
  `anomalyco/opencode` repository link was found in merge-added lines after
  excluding explicit upstream context and package/type namespaces.
- No added match was found in the changed `packages/kilo-docs/`,
  `packages/opencode/src/cli/cmd/tui/`, `packages/opencode/src/server/`,
  `packages/sdk/openapi.json`, `packages/sdk/js/src/v2/gen/`, `packages/ui/`,
  `packages/web/`, `packages/app/`, or `packages/desktop/` surfaces.
- `packages/http-recorder/package.json` remains correctly Kilo-branded:
  repository `git+https://github.com/Kilo-Org/kilocode.git`, homepage
  `https://github.com/Kilo-Org/kilocode/tree/main/packages/http-recorder`, and
  bugs URL `https://github.com/Kilo-Org/kilocode/issues`. The merge only
  removes `private` and adds `publishConfig`; those Kilo URLs were already
  present in `origin/main`.
- Added `@opencode-ai/*` imports, `@opencode/*` Effect service tags,
  `opencode-core-migration-` temporary directories, and the Snowflake test
  assertion for the User-Agent are implementation/test details rather than
  direct end-user branding copy.

## Command Output Excerpts

```text
$ git diff --stat origin/main...HEAD
194 files changed, 6121 insertions(+), 51674 deletions(-)

$ bun script/check-forbidden-strings.ts
check-forbidden-strings: 8344 file(s) checked, no forbidden strings found.

$ git diff --unified=0 origin/main...HEAD | ... suspicious branding filter
+    "User-Agent": `opencode/${InstallationVersion}`,
+  <head><title>OpenCode - Snowflake Authorization Successful</title></head>
+      <p>You can close this window and return to OpenCode.</p>
+  <head><title>OpenCode - Snowflake Authorization Failed</title></head>
+              headers.set("User-Agent", `opencode/${InstallationVersion}`)
+                "Complete Snowflake sign-in in your browser. OpenCode will capture the OAuth callback and store the bearer token automatically.",
+    expect(captured[0].get("user-agent")).toMatch(/^opencode\\//)
```

## Limitations

- This is a static review of merge-added lines, not an end-to-end Snowflake
  OAuth exercise. The direct browser and instruction strings are unambiguous
  from their rendering/authorization paths.
- Existing OpenCode references outside the merge diff were not reported unless
  needed to classify a new line. The repository contains known pre-existing
  upstream URLs, schemas, compatibility names, package namespaces, fixtures,
  and attribution that are outside this PR-addition audit.
- No source files, commits, branches, or remote state were modified. This
  report is the only file created by the audit.
