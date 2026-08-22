# OpenCode Branding Audit

## Scope And Method

Reviewed the exact two-tree diff `70eeaff3837e29529e26c7c090767df0a3768249..518501a994bcd660e8c6d061b450c32412104004` (1,502 changed files; 118,630 insertions and 72,565 deletions). Searched added/restored content case-insensitively for `opencode`, `OpenCode`, `open code`, `anomalyco`, and related upstream URLs, then inspected surrounding hunks and base content. Candidates were traced to their rendered/output surfaces; imports, package namespaces, protocol/type names, provider IDs, compatibility filenames, test fixtures, and implementation-only selectors/theme keys were excluded unless they could reach users.

The requested base is not the Git merge-base of the two commits: `git merge-base` returned `f844790ed7e0220146d0b5d650a57fce6ecc79d5`. This audit therefore uses the requested explicit base-to-head snapshot comparison, not a three-dot PR diff.

## Findings

1. **ACP returns an OpenCode-branded fallback error.** `packages/opencode/src/acp/service.ts:871` adds `OpenCode prompt failed` as the safe message when an assistant error has no usable message. `packages/opencode/src/acp/error.ts` passes that value to ACP's JSON-RPC `internalError`, so ACP clients can display it. Change the fallback to Kilo branding.

2. **Public OpenAPI grouping regressed from Kilo to OpenCode.** `packages/protocol/src/api.ts:58` defines the title as `opencode HttpApi`; the generated `packages/sdk/openapi.json` and `packages/sdk/js/openapi.json` consequently replace the base's `Kilo HttpApi` tags with `opencode HttpApi`. Rename the source annotation and regenerate both specs.

3. **Generated API descriptions call the running product OpenCode.** `packages/protocol/src/groups/session.ts:163` and `:365` describe active/interrupt operations as owned by "this OpenCode process". These descriptions are emitted into the public OpenAPI/SDK documentation. Replace with Kilo (or neutral wording) and regenerate artifacts.

4. **Human verification: a Storybook developer UI asks for an `opencode export`.** The newly added `packages/session-ui/src/components/timeline-playground.stories.tsx:463` error and `:1631` helper text display `opencode export`. Confirm whether this playground is intentionally upstream-branded or visible to Kilo contributors/users; if not, use `kilo export`. The same wording already exists in the older `packages/ui` playground, so ownership may be intentionally upstream-derived.

## Notable Non-Findings

- The new shared OAuth page is OpenCode-branded internally, but Kilo's ChatGPT flow uses `KiloOauthCallbackPage`, which replaces the visible brand. Snowflake continues to show OpenCode branding, but its base implementation was already OpenCode-branded, so this merge did not restore or introduce that branding. DigitalOcean, Codex, xAI, and MCP retain Kilo-facing pages.
- New private workspace names such as `@opencode-ai/client`, `@opencode-ai/protocol`, `@opencode-ai/schema`, `@opencode-ai/sdk-next`, and `@opencode-ai/session-ui`, plus `OpenCode` client/event type names, are internal/upstream identifiers rather than end-user product text. Their package manifests are marked private where newly introduced.
- `opencode` provider IDs, `OPENCODE_API_KEY`, legacy `opencode.json` compatibility, `.opencode-version`, server-auth usernames, Effect service keys, CSS selectors, Shiki theme names, tests/fixtures, and Zed binary artifact filenames are functional compatibility or implementation identifiers.
- `runMini()` sets synthetic yargs `$0` to `opencode`, but no changed help snapshot or output exposes it; CLI help remains Kilo-branded. The upstream links found in changed production content were comments, synthetic examples/tests, or Kilo-Org release artifact URLs rather than navigable Kilo UI/help links.
- Repository design notes (`CONTEXT.md`, `specs/v2/config.md`, and private package design READMEs) use upstream architecture terminology. They do not replace current Kilo end-user configuration documentation. The two `@kilocode/plugin` V2 READMEs do say "OpenCode", but they live under `src/`, are not included by that package's `files: ["dist"]`, and are not currently shipped documentation.

## Commands And Limitations

- Used `git status --short`, `git rev-parse`, `git merge-base`, `git diff --stat`, `git diff --name-status`, `git diff --unified=0/1/2/20`, `git show <base>:<path>`, and case-insensitive `grep` filters over the exact diff.
- Cross-checked current sources with repository content search and inspected generated OpenAPI occurrences separately because `packages/sdk/js/openapi.json` is minified onto one line.
- `rg` is unavailable in this container, so equivalent Git pathspec and `grep -E -i` searches were used. No application, Storybook, generated-code command, or test suite was run; conclusions are static. The Storybook exposure/branding intent in finding 4 therefore requires human verification.
