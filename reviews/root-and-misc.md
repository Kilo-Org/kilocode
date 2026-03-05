# PR #6622 (OpenCode v1.2.16) — Root & Misc Review

## Files Reviewed

### Group: root

| File                                      | Status   | +/-        |
| ----------------------------------------- | -------- | ---------- |
| `.opencode/glossary/tr.md`                | added    | +38        |
| `README.gr.md`                            | added    | +140       |
| `bun.lock`                                | modified | +146 / -12 |
| `flake.lock`                              | modified | +3 / -3    |
| `nix/node_modules.nix`                    | modified | +1         |
| `package.json`                            | modified | +4 / -3    |
| `script/publish.ts`                       | modified | +3 / -1    |
| `specs/session-composer-refactor-plan.md` | removed  | -240       |

### Group: kilo-ui

| File                                                           | Status   | +/- |
| -------------------------------------------------------------- | -------- | --- |
| `packages/kilo-ui/package.json`                                | modified | +7  |
| `packages/kilo-ui/src/components/animated-number.tsx`          | added    | +2  |
| `packages/kilo-ui/src/components/file.tsx`                     | added    | +2  |
| `packages/kilo-ui/src/components/line-comment-annotations.tsx` | added    | +2  |
| `packages/kilo-ui/src/components/motion-spring.tsx`            | added    | +2  |
| `packages/kilo-ui/src/components/text-reveal.tsx`              | added    | +2  |
| `packages/kilo-ui/src/components/text-strikethrough.tsx`       | added    | +2  |
| `packages/kilo-ui/src/context/file.tsx`                        | added    | +2  |

### Group: other-packages

| File                           | Status | +/- |
| ------------------------------ | ------ | --- |
| `packages/kilo-i18n/src/tr.ts` | added  | +21 |

---

## Summary

This PR is an upstream merge from OpenCode v1.2.16. It brings in:

1. **Dependency bumps** — `@opentui/core` and `@opentui/solid` 0.1.81 -> 0.1.86, `@pierre/diffs` beta.17 -> beta.18, nixpkgs pin update, and new `motion` / `motion-dom` / `motion-utils` packages pulled in by `packages/ui`.
2. **New upstream packages/storybook workspace** added to `bun.lock` (not a Kilo package — comes from upstream `packages/storybook`).
3. **kilo-ui re-exports** — 6 new component shims and 1 new context shim to keep `@kilocode/kilo-ui` in sync with new upstream `@opencode-ai/ui` exports.
4. **Publish script change** — adds `finalize-latest-json.ts` step for desktop releases.
5. **Nix build fix** — adds `.github/TEAM_MEMBERS` to the Nix fileset.
6. **i18n** — Turkish glossary, Greek README, Turkish kilo-i18n translations.
7. **Housekeeping** — removes stale `specs/session-composer-refactor-plan.md`.
8. **Upstream identity changes in `package.json`** — name reverted to `opencode`, repo URL changed to `anomalyco/opencode`. These must be reverted during our merge.

---

## Detailed Findings

### `package.json`

**ISSUE (Must Fix): Upstream identity override.**
The PR changes the root `package.json` name from `@kilocode/kilo` to `opencode` and the repository URL from `github.com/Kilo-Org/kilocode` to `github.com/anomalyco/opencode`. These are upstream-native values that must be reverted to Kilo's values during the merge. If these slip through, tooling that reads the repo URL (e.g. `gh` CLI wrappers, SDK generation, release scripts referencing `process.env.GH_REPO`) could break or publish to the wrong target.

**OK: `@pierre/diffs` bump beta.17 -> beta.18.**
Catalog-level bump, propagates to all consumers. Low risk — it's a patch within a beta series.

**OK: `dev:storybook` script addition.**
Adds convenience script forwarding to `packages/storybook`. No impact on build or production.

### `bun.lock`

**INFO: `@opentui/core` and `@opentui/solid` 0.1.81 -> 0.1.86.**
These are the terminal UI libraries used by `packages/opencode` (the TUI). A 5-patch jump in a 0.x library can contain breaking changes. The VS Code extension does not use the TUI directly, so risk is isolated to CLI TUI rendering. Worth a quick smoke test of the TUI after merge.

**INFO: New `motion`, `motion-dom`, `motion-utils` dependencies in `packages/ui`.**
These are animation libraries (Framer Motion successor). They are dependencies of the upstream `@opencode-ai/ui` package — used by the new components like `animated-number`, `motion-spring`, `text-reveal`, `text-strikethrough`. The VS Code extension depends on `@opencode-ai/ui` transitively through `@kilocode/kilo-ui`, so these will be pulled into the extension's webview bundle. Motion libraries can be heavy (50-80KB gzipped for the full `motion` package). **Recommend checking bundle size impact on the VS Code extension webview.**

**INFO: New `packages/storybook` workspace.**
Upstream added a Storybook workspace with React + SolidJS + Vite dependencies. This is a dev-only workspace, not consumed by any production package. No production risk, but it adds to `bun install` time.

### `flake.lock`

**OK.** Routine nixpkgs pin update. No functional impact — just refreshes the Nix channel snapshot.

### `nix/node_modules.nix`

**OK with caveat.** Adds `../.github/TEAM_MEMBERS` to the Nix fileset because `@opencode-ai/script` now reads it at build time. The file does not exist in our current tree (it comes from upstream). **Must confirm `.github/TEAM_MEMBERS` is included in the upstream merge** — if it is missing, the Nix build will fail with a missing-file error.

### `script/publish.ts`

**ISSUE (Low): Import reorder and new publish step.**

- The import reorder (`$ from "bun"` moved below `Script`) is cosmetic.
- The new `await import("../packages/desktop/scripts/finalize-latest-json.ts")` line runs after the release tag is pushed but before the draft is un-drafted. The script `finalize-latest-json.ts` does not exist in our current tree — it is coming from upstream. **Must confirm this file is included in the merge.** If missing, `publish.ts` will throw an unhandled dynamic import error during release, which would halt the release pipeline after the git tag is already pushed (leaving the release in a draft state).
- This step runs unconditionally during release (not gated on `!Script.preview`), so it will execute for preview releases too. Verify that's intended.

### `.opencode/glossary/tr.md`

**OK.** Turkish translation glossary. Content-only, no code impact.

### `README.gr.md`

**OK.** Greek README translation. Content-only, no code impact.

### `specs/session-composer-refactor-plan.md` (removed)

**OK.** Stale planning doc removal. No code impact.

### `packages/kilo-ui/package.json`

**OK.** Adds 7 new export entries to keep `@kilocode/kilo-ui` in sync with the upstream `@opencode-ai/ui` components:

- `./file`, `./animated-number`, `./line-comment-annotations`, `./motion-spring`, `./text-reveal`, `./text-strikethrough` (components)
- `./context/file` (context)

These follow the established pattern — each new component is a 2-line re-export file. The exports will resolve only if the upstream `@opencode-ai/ui` package actually provides the corresponding modules. **Must confirm the upstream merge includes the source files in `packages/ui/src/components/` and `packages/ui/src/context/` for all 7 entries.** Currently none of these exist in the working tree, which is expected for a pre-merge review.

### `packages/kilo-ui/src/components/*.tsx` (6 new files)

**OK.** All follow the identical pattern:

```tsx
// kilocode_change - new file
export * from "@opencode-ai/ui/<name>"
```

Properly marked with `kilocode_change` comment. Minimal merge-conflict surface. No logic — pure re-exports.

### `packages/kilo-ui/src/context/file.tsx`

**OK.** Same pattern as above for context re-export. No issues.

### `packages/kilo-i18n/src/tr.ts`

**OK.** Turkish translations for Kilo-specific strings. Follows the exact same structure as the existing `en.ts` — same key set, same comment structure. Properly marked with `kilocode_change - new file`. Keys match the English source (`en.ts`), with two additions that `en.ts` doesn't have:

- `desktop.menu.reloadWebview`
- `desktop.updater.installFailed.message`
- `desktop.cli.installed.message`

These 3 extra keys exist in `tr.ts` but not in `en.ts`. This is either intentional (English falls back to upstream for these) or a minor inconsistency. Low risk — unused keys are harmless.

---

## Risk to VS Code Extension

| Area                                            | Impact                                                                                                                                                                  | Risk                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `@kilocode/kilo-ui` new exports                 | Extension depends on `@kilocode/kilo-ui`. New re-exports are additive — no existing exports changed. Will only break if upstream `@opencode-ai/ui` modules are missing. | **Low** (assuming complete merge)                                               |
| `motion` / `motion-dom` / `motion-utils`        | Transitive new deps pulled into the webview bundle via `@opencode-ai/ui`. Could increase extension bundle size.                                                         | **Low-Medium** (functional risk low; bundle size increase warrants measurement) |
| `@pierre/diffs` beta.17 -> beta.18              | Used in diff rendering. Extension uses diffs in code review UI.                                                                                                         | **Low** (patch bump within beta series)                                         |
| `@opentui/core` / `@opentui/solid` bump         | TUI-only; extension does not use TUI rendering.                                                                                                                         | **None**                                                                        |
| Root `package.json` name/URL changes            | If not reverted, could affect SDK generation or `gh` CLI operations in CI. Does not affect extension runtime.                                                           | **Medium** (CI/release pipeline risk if not reverted)                           |
| `publish.ts` new `finalize-latest-json.ts` step | Only affects desktop release pipeline, not VS Code extension release.                                                                                                   | **None**                                                                        |
| `kilo-i18n` Turkish translations                | Additive. Extension consumes translations at runtime. New keys with no behavior change.                                                                                 | **None**                                                                        |

---

## Overall Risk

**Low**, with two items requiring attention during merge:

1. **Must revert** the root `package.json` name and repository URL to Kilo's values (`@kilocode/kilo` and `github.com/Kilo-Org/kilocode`). Failure to do so is a CI/release pipeline risk.
2. **Must verify** that the upstream merge includes `.github/TEAM_MEMBERS` and `packages/desktop/scripts/finalize-latest-json.ts`. Both are referenced by modified files but do not exist in the current tree. Missing either will cause Nix build failures or release pipeline errors respectively.

Secondary recommendation: measure the bundle size impact of the new `motion` dependency on the VS Code extension webview after merging.
