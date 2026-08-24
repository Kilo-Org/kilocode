# OPENCODE_MENTIONS Review

No findings.

## Scope and methodology

- Reviewed Kilo-Org/kilocode PR #13368 from base `6175210c0fd0092a86aa475e4d8d7616711a1464` to head `5d120f0696a83b354804e0848f1c1af4b0088a4f` against pristine upstream v1.18.18 `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`.
- Verified that the PR merge base is the supplied base, `HEAD` and the live PR head are the supplied head, the authoritative `v1.18.18` tag peels to the supplied upstream commit, and the PR is open and mergeable.
- Inspected the complete 48-file base-to-head diff (885 additions, 159 deletions), including all production sources, tests, package manifests, lockfile changes, package patch text, prompts, configuration descriptions and warnings, UI/theme changes, and the release changeset. No OpenAPI or generated SDK artifact is changed by this range.
- Searched added lines and complete changed artifacts case-insensitively for `opencode`, `open-code`, `OpenCode`, `anomalyco`, `opncd`, upstream domains, and old repository URLs. Compared each substantive hit with base and pristine upstream to separate internal compatibility identifiers and explicit upstream attribution from user-facing branding.
- Audited every newly added URL and the Kilo/OpenCode substitutions in changed prompts and strings. The changed Meta system prompt retains `You are Kilo`, the Kilo GitHub issue URL, and Kilo docs (`packages/opencode/src/session/prompt/meta.txt:1`, `packages/opencode/src/session/prompt/meta.txt:59-60`).

## Findings

None. The merge does not introduce or restore user-facing OpenCode branding or OpenCode web links in the reviewed range.

## Notable non-findings

- `.changeset/opencode-v1-18-16-to-v1-18-18.md:6` says `Adopt OpenCode v1.18.16 through v1.18.18 improvements`. This is intentional user-facing upstream provenance, not replacement product branding. It targets `@kilocode/cli` and `kilo-code`, and follows the byte-for-byte naming convention of the preceding `.changeset/opencode-v1-18-14-to-v1-18-15.md:6` release note.
- `packages/opencode/src/provider/transform.ts:622` adds `model.providerID.startsWith("opencode")`; `packages/opencode/test/provider/transform.test.ts:3550-3551` covers `opencode` and `opencode-go`. These are internal provider IDs required to apply the upstream DeepSeek V4 Flash sampling default. The implementation is identical to pristine upstream v1.18.18 and is not rendered as UI copy or a web link.
- The exact added-line branding scan also matched `packages/opencode/script/dev-local.ts` only because the repository directory is named `packages/opencode`; it is a developer script path, not output or branding.
- Existing `@opencode-ai/*` workspace package names, Effect service tags, compatibility config filenames, test fixtures, and `packages/ui/src/theme/themes/oc-2.json:2` (`https://opencode.ai/desktop-theme.json`) remain inherited internals. None was newly added or restored by the changed lines; the theme change only fixes a color value at line 28.
- The package patches add no OpenCode mention. Their added documentation links point only to Groq and xAI provider documentation.
- All newly added source URLs resolve conceptually to Kilo or third-party provider/integration surfaces: `github.com/Kilo-Org/kilocode`, `api.githubcopilot.com`, `api-gateway.merge.dev`, `console.groq.com`, and `docs.x.ai`. No added URL points to OpenCode or anomalyco.
- Configuration warning text added at `packages/opencode/src/config/config.ts:342` is product-neutral (`Configuration is invalid...`) and contains no upstream attribution.
- No generated OpenAPI descriptions, generated SDK comments/types, CLI help/epilogue text, docs pages, README copy, or package repository metadata changed to OpenCode in this PR.

## Command results

- `git merge-base 6175210c0fd0092a86aa475e4d8d7616711a1464 5d120f0696a83b354804e0848f1c1af4b0088a4f` -> `6175210c0fd0092a86aa475e4d8d7616711a1464`.
- `git diff --shortstat 6175210c0fd0092a86aa475e4d8d7616711a1464 5d120f0696a83b354804e0848f1c1af4b0088a4f` -> `48 files changed, 885 insertions(+), 159 deletions(-)`.
- `git fetch upstream tag v1.18.18 --force` followed by `git rev-parse 'refs/tags/v1.18.18^{}'` -> `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`.
- Live `gh pr view 13368 --repo Kilo-Org/kilocode` recheck -> base `6175210c0fd0092a86aa475e4d8d7616711a1464`, head `5d120f0696a83b354804e0848f1c1af4b0088a4f`, `MERGEABLE`, `OPEN`; the reported forbidden-string and source-link checks are successful.
- Exact added-line OpenCode scan produced five lines: the intentional changeset attribution, the `packages/opencode/script/dev-local.ts` path, the internal provider predicate, and the two provider-ID test cases. No other added match was found.
- Per-file occurrence count comparison across all 48 files changed only for the changeset (`0 -> 1`), provider transform (`4 -> 5`), and provider transform test (`26 -> 28`), matching the classified hits above.
- Added-line URL scan found eight URLs: one Kilo repository URL, two integration endpoints, and five provider documentation links; zero OpenCode/anomalyco URLs.
- `bun run script/check-forbidden-strings.ts` -> `check-forbidden-strings: 9591 file(s) checked, no forbidden strings found.`
- `bun run script/extract-source-links.ts --check` -> `packages/kilo-docs/source-links.md is up to date.`
- `git diff --check 6175210c0fd0092a86aa475e4d8d7616711a1464 5d120f0696a83b354804e0848f1c1af4b0088a4f` -> exit 0, no output.

## Limitations

- This OPENCODE_MENTIONS-only review used static source/diff/provenance inspection and repository guards. It did not launch the CLI, TUI, VS Code extension, or a browser to exercise rendered surfaces.
- The forbidden-string guard intentionally does not ban every `opencode.ai` form because some inherited compatibility and schema URLs remain allowlisted or documented candidates. The changed-file and added-line scans independently covered those broader forms for this PR.
- No GitHub state was mutated, and no repository file other than this report was modified.
