# OpenCode Naming Audit

## Scope And Methodology

Reviewed Kilo-Org/kilocode PR #12695 at exact head `054ee594915b93546d0613a45e0671edd43905ee`, branch `johnnyeric/kilo-opencode-v1.17.13`, against exact base `0b8f749ae13388cf7a38ea7fb9183acaac99eef8`. The merge base is the stated base. The local `v1.17.13` tag resolves to `10c894bdeef3618f5666fb506ef7f9491bb964d8`; merge commit `db1eae3583535d9b7a61ec8af9702e1580471056` has parents `f844790ed7e0220146d0b5d650a57fce6ecc79d5` and that upstream commit, and the reviewed head contains it.

Read root `AGENTS.md`, `REVIEW.md`, `packages/opencode/AGENTS.md`, `packages/opencode/test/AGENTS.md`, `packages/schema/AGENTS.md`, `packages/llm/AGENTS.md`, `packages/core/src/tool/AGENTS.md`, `packages/kilo-docs/AGENTS.md`, `kilo-steer`, `merge-review-johnny`, and `kilocode-merge-minimizer`.

Searched the complete base-to-head diff case-insensitively for `opencode`, `open-code`, `open code`, OpenCode web domains, and the known upstream GitHub repositories. I then inspected production strings, UI and Storybook text, docs, package metadata, CLI help snapshots, generated OpenAPI/SDK descriptions, model-facing text, and URLs in context. Candidates were compared with base, pristine local upstream `v1.17.13`, merge/adaptation commits, final-head callers, and final rendered output where possible.

## Findings

### 1. P2 Medium: Kilo OAuth callbacks render the OpenCode wordmark

**Location:** `packages/core/src/oauth/page.ts:252-270`, adapted by `packages/core/src/kilocode/oauth/page.ts:5-14`; active callers include `packages/core/src/plugin/provider/openai.ts:60-84` and `packages/opencode/src/plugin/snowflake-cortex.ts:184-212`.

**Introduced surface:** The upstream renderer introduces `const WORDMARK = \`<svg ... viewBox="0 0 234 42" ... aria-label="OpenCode" ...>\`` followed by the 19 paths of the OpenCode wordmark. The Kilo adapter only performs `page.replaceAll("OpenCode", "Kilo")`.

**Why user-facing:** ChatGPT and Snowflake sign-in success/error pages are opened in the user's browser. The replacement correctly changes text such as `OpenCode is now connected to ...`, the title, and the SVG accessibility label, but it cannot change SVG path geometry. The resulting page therefore labels an OpenCode-shaped wordmark as “Kilo” and visibly presents upstream branding during a Kilo authorization flow.

**Proof and provenance:** `packages/core/src/oauth/page.ts` is inherited from pristine upstream `v1.17.13`; the string-only Kilo wrapper was added during merge resolution (`518501a994b...`). Rendering the active wrapper produced:

```text
contains_OpenCode=false
contains_Kilo_copy=true
aria=aria-label="Kilo"
wordmark_viewbox=true
wordmark_paths=19
```

**Suggested fix:** Do not use global text replacement as the complete branding adapter. Supply the actual Kilo wordmark from a Kilo-owned renderer/parameter, or replace the full upstream `<svg>` block as well as textual branding. Human-verify the rendered ChatGPT and Snowflake success and error pages after the change.

### 2. P3 Low: Public Kilo plugin source documentation names the API and host OpenCode

**Locations:** `packages/plugin/src/v2/effect/README.md:1,5,48` and `packages/plugin/src/v2/promise/README.md:1,5`.

**Exact introduced text:** `# OpenCode V2 Effect Plugin API`, `# OpenCode V2 Promise Plugin API`, ``hook` installs behavior at an OpenCode extension point.`, and `OpenCode rebuilds the domain ...`.

**Why user-facing:** These are developer-facing guides colocated with newly exported `@kilocode/plugin/v2/effect` and `@kilocode/plugin/v2/promise` entrypoints. The adaptation changed the examples from `@opencode-ai/plugin` to `@kilocode/plugin` but retained upstream product naming in the headings and explanatory copy, so users reading Kilo's source documentation are told that the Kilo package exposes an OpenCode API/host.

**Provenance:** The wording is unchanged from pristine upstream `v1.17.13` and entered the Kilo tree through merge adaptation commit `898f0dc40b...`; it did not exist at the reviewed base.

**Suggested wording:** `# Kilo V2 Effect Plugin API`, `# Kilo V2 Promise Plugin API`, `a Kilo extension point`, and `Kilo rebuilds the domain ...`. If product intends “OpenCode V2” as a formal compatibility API name, human-verify and document that exception explicitly; current `@kilocode/plugin` imports and Kilo repository location suggest Kilo wording is intended.

## Notable Non-Findings

- Generated public artifacts are clean at final head: `packages/sdk/openapi.json`, `packages/sdk/js/src/v2/gen/types.gen.ts`, `packages/sdk/js/src/v2/gen/sdk.gen.ts`, and the CLI help snapshot contain no case-insensitive `OpenCode`, `opencode.ai`, or `open-code` match. Commit `61b2f1d0cb...` explicitly changed generated OpenAPI tags/names from `opencode HttpApi` to `Kilo HttpApi`.
- No added OpenCode match was found in the reviewed diff under Kilo-owned product surfaces `packages/kilo-docs`, `packages/kilo-vscode`, `packages/kilo-ui`, or `packages/kilo-console`. The changed CLI reference also uses Kilo branding.
- The OAuth wrapper successfully removes literal OpenCode text and accessibility naming for current ChatGPT and Snowflake callers. The remaining issue is the unchanged visual path geometry. The upstream `bootstrap()` renderer has no production caller at final head, so its literal OpenCode output is not reported separately.
- `@opencode-ai/*` imports/package names, `OpenCode` SDK namespace/type names, `@opencode/*` Effect service identifiers, `opencode.json`/`.opencode` compatibility paths, `OPENCODE_*` compatibility environment variables, server username `opencode`, and provider ID/name `opencode` were excluded as internal/source/compatibility identifiers rather than user-facing branding regressions.
- Newly added `@opencode-ai/client`, `@opencode-ai/sdk-next`, `@opencode-ai/schema`, `@opencode-ai/protocol`, and `@opencode-ai/session-ui` metadata/READMEs retain upstream naming, but all corresponding package manifests are `private: true`. Their current names and `OpenCode` API symbols are upstream architecture/source identities, not shipped Kilo package metadata; no finding was raised.
- `packages/session-ui/src/components/timeline-playground.stories.tsx` says ``opencode export` JSON file`, and Storybook autodocs mention the OpenCode design system. These are upstream test/development fixtures in a private package, not shipped runtime UI, and were excluded under the requested fixture exception.
- OpenCode domains in provider fixtures, recorded cassettes, URL-classification tests, config compatibility tests, upstream provider catalog data, and comments explaining why Kilo disables OpenCode Console integration were excluded as fixtures, provider identities, compatibility coverage, or internal rationale.
- `.changeset/opencode-v1-17-9-to-v1-17-13.md:6` says `Changes from opencode v1.17.9 to v1.17.13 upstream:`. This is intentional release-note attribution generated by the established upstream changeset workflow, consistent with earlier Kilo releases, and not accidental product renaming.
- OpenCode links already present in Kilo documentation for explicit fork attribution, upstream behavior references, or the Kilo Cloud schema-overlay architecture were not introduced by this PR and are legitimate attribution/reference links.

## Exact Command Results

```text
$ git rev-parse HEAD
054ee594915b93546d0613a45e0671edd43905ee

$ git merge-base 0b8f749ae13388cf7a38ea7fb9183acaac99eef8 054ee594915b93546d0613a45e0671edd43905ee
0b8f749ae13388cf7a38ea7fb9183acaac99eef8

$ git show -s --format='%H%n%P%n%s' 10c894bdeef3618f5666fb506ef7f9491bb964d8
10c894bdeef3618f5666fb506ef7f9491bb964d8
6697cf3fd81d44fc8c3f72d32edb0e2549d24003
release: v1.17.13

$ git merge-base --is-ancestor 10c894bdeef3618f5666fb506ef7f9491bb964d8 054ee594915b93546d0613a45e0671edd43905ee
upstream_ancestor_exit=0

$ git diff --shortstat 0b8f749ae13388cf7a38ea7fb9183acaac99eef8 054ee594915b93546d0613a45e0671edd43905ee
1237 files changed, 101898 insertions(+), 41085 deletions(-)

$ git diff --unified=0 BASE HEAD | rg -i '^\+[^+].*(opencode|open[- ]code)' | wc -l
1583

$ git diff --unified=0 BASE HEAD | rg -i '^-[^-].*(opencode|open[- ]code)' | wc -l
382

$ git grep -n -i -E 'OpenCode|opencode\.ai|open-code' HEAD -- packages/sdk/openapi.json packages/sdk/js/src/v2/gen/types.gen.ts packages/opencode/test/cli/help/__snapshots__/help-snapshots.test.ts.snap
head_scan_exit=1

$ git diff --unified=0 BASE HEAD -- packages/kilo-docs packages/kilo-vscode packages/kilo-ui packages/kilo-console | rg -n -i -C 2 '^\+[^+].*(OpenCode|opencode\.ai|console\.opencode|open-code)'
(no output)

$ git status --short
?? vscode-self-test.config.json
```

The unrelated untracked `vscode-self-test.config.json` existed before this audit and was not modified. Other parallel reviewer reports may appear concurrently and were not modified.

## Limitations

- This was a focused naming/link audit, not a complete behavioral or visual review of the 1,237-file merge.
- The repository only has the Kilo `origin` remote configured in this worktree. Upstream provenance was verified against the local signed-by-history tag/commit graph and pristine `v1.17.13` commit already merged into the reviewed head; no authoritative upstream remote fetch was performed.
- OAuth HTML was rendered and inspected structurally, but no browser screenshot comparison was run. The SVG source comment, unchanged 19-path geometry, and upstream comparison establish that it remains the OpenCode wordmark; final visual acceptance should still be human-verified.
- Source-document visibility can differ between GitHub, package build, and npm publication. The plugin README finding is scoped to Kilo's developer-facing source documentation; the manifest's `files: ["dist"]` may prevent those nested README files from appearing in the packed npm artifact.
- No files other than this report were edited; no commit, push, or GitHub mutation was performed.
