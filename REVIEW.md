# REVIEW.md

Guidance for the automated reviewer (kilo-code-bot) on PRs in this repo.

The goal of the review is to catch things CI **cannot** catch: bugs, design issues, and judgment calls about style and fork hygiene. Be helpful, not pedantic — frame everything as a suggestion the human can accept or reject.

## Don't duplicate CI

CI already runs and will report failures directly. Do **not** comment on:

- Lint, formatting, or typecheck errors (root `lint`, `turbo typecheck`)
- Test failures (CLI tests, vscode tests)
- `knip` unused exports
- `kilocode_change` marker rules — both directions:
  - Missing markers on shared opencode files (`script/check-opencode-annotations.ts`)
  - Markers present in kilo-only paths like `packages/kilo-vscode/`, `packages/kilo-ui/`, `packages/opencode/src/kilocode/` (`bun run check-kilocode-change`)
- Workflow allowlist drift (`script/check-workflows.ts`)
- Stale `packages/kilo-docs/source-links.md` (`script/extract-source-links.ts`)
- Markdown table padding (`script/check-md-table-padding.ts`)
- Visual regression snapshots (CI generates baselines on Linux)
- SDK regeneration drift (`generate.yml`)
- Generated artifact freshness (`check-kilo-generated-artifacts.yml`)
- Docs link checks, nix evals, container builds

If the only issue you'd raise is one of the above, just say `lgtm`.

## What to focus on

### 1. Bugs and correctness

Read enough of the surrounding file to actually understand the change — diffs alone hide context. Look for:

- Logic errors, off-by-one, wrong conditions, swapped arguments
- Unhandled error paths, swallowed promises, missing `await`
- Race conditions, especially around session/process lifecycle in the CLI and Agent Manager
- Resource leaks (unclosed file handles, child processes, subscriptions)
- Inputs that aren't validated where they cross trust boundaries (server routes, IPC, config loading)
- In `.github/workflows/**` and release/test-infra changes, flag only issues tied to this repo's actual behavior (for example, mismatched `if:` guards on restore/save cache steps or a non-essential reporting job included in a required aggregate gate); don't raise speculative path/default warnings when the workflow or observed runs already verify the behavior.

### 2. Style guide judgment calls

The full guide is in `AGENTS.md`. Don't be a zealot — only flag actual violations, and recognize when the existing code already complies through a different mechanism.

- **No `let`**: prefer `const` with ternary or IIFE (`packages/opencode/src/util/iife.ts`). But `let` is fine when it's genuinely the simplest option; don't demand IIFE rewrites for trivial cases.
- **No `else`**: prefer early returns. Don't complain about `else` if the code already uses early returns elsewhere. You **may** flag excessive nesting regardless.
- **No empty `catch`**: always flag — empty catches hide bugs.
- **Avoid `try`/`catch` where possible**: if a try/catch is added, consider whether it's needed at all.
- **Avoid `any`**: flag new `any` usage unless there's a clear reason.
- **Single-word names**: prefer `cfg`, `pid`, `dir`, `opts`, `err` over `inputPID`, `connectTimeout`. Only flag newly introduced multi-word names where a clear single-word alternative exists.
- **Avoid unnecessary destructuring**: prefer `obj.a` over `const { a } = obj` to preserve context.
- **Bun APIs**: prefer `Bun.file()` etc. over node equivalents in CLI code.
- **Type inference**: avoid explicit annotations unless needed for exports/clarity.

When suggesting fixes, ensure the suggestion is valid TypeScript (matched braces, correct syntax). Prefer prose comments over `suggestion` blocks unless the fix is trivially mechanical.

### 3. Fork merge hygiene

Kilo CLI is a fork of opencode. Minimizing diff against upstream is a top priority.

- If a change modifies a shared opencode file (anything under `packages/opencode/` not in a path containing `kilocode`), ask whether the logic could live in a Kilo-only directory instead (`packages/opencode/src/kilocode/`, `packages/kilo-gateway/`, etc.) or be reduced to a smaller hook.
- Refactors or reorganizations of upstream code are a red flag — flag them unless clearly justified.
- See `.kilo/skills/kilocode-merge-minimizer/SKILL.md` for the decision rules.

### 4. Cloud config schema mirror

When `Config.Info` in `packages/opencode/src/config/config.ts` gains a new `kilocode_change` field, the matching JSON Schema entry must also be added in the cloud repo (`apps/web/src/app/config.json/extras.ts`). CI does **not** check this — flag it as a reminder if you see a new config field added.

### 5. Test quality

- Tests should exercise real implementation, not duplicate logic into the test.
- Mocks should be avoided where reasonable; flag mock-heavy tests that look like they're testing the mock rather than the code.
- New behavior in `packages/opencode/` should generally come with a test under `packages/opencode/test/`.

### 6. User-facing changes

- Features, bug fixes, and breaking changes should include a changeset (`.changeset/*.md`). If a PR clearly changes user-visible behavior and has no changeset, mention it.
- Changeset descriptions are read by end users — if one is present but written as implementation notes ("Add a new export handler that serializes…"), suggest a user-facing rewrite ("Support exporting conversations as markdown").
- PR descriptions should explain **why**, not enumerate files. Skip file-by-file inventories.

### 7. UI changes

For changes under `packages/kilo-vscode/webview-ui/`:

- Significant visual or layout changes should have a Storybook story added under `webview-ui/src/stories/`.
- Don't ask for locally generated baseline PNGs — those must come from Linux CI.

## How to comment

- Leave comments on the exact line via `gh api .../pulls/{n}/comments`.
- Make it clear suggestions are suggestions; the human decides.
- If the PR is clean against the above, comment `lgtm` and nothing else.
