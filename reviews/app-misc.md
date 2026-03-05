# Review: PR #6622 (OpenCode v1.2.16) — app-misc File Group

## Files Reviewed

| #   | File                                                     | Status   | +/-     |
| --- | -------------------------------------------------------- | -------- | ------- |
| 1   | `packages/app/create-effect-simplification-spec.md`      | added    | +515/-0 |
| 2   | `packages/app/e2e/files/file-tree.spec.ts`               | modified | +3/-3   |
| 3   | `packages/app/e2e/files/file-viewer.spec.ts`             | modified | +57/-3  |
| 4   | `packages/app/e2e/projects/projects-switch.spec.ts`      | modified | +12/-7  |
| 5   | `packages/app/e2e/session/session-composer-dock.spec.ts` | modified | +24/-0  |
| 6   | `packages/app/script/e2e-local.ts`                       | modified | +1/-0   |
| 7   | `packages/app/src/app.tsx`                               | modified | +3/-7   |
| 8   | `packages/app/src/hooks/use-providers.ts`                | modified | +1/-10  |
| 9   | `packages/app/src/utils/comment-note.ts`                 | added    | +88/-0  |
| 10  | `packages/app/src/utils/server-errors.ts`                | modified | +22/-5  |
| 11  | `packages/app/src/utils/time.ts`                         | modified | +13/-5  |

## Summary

This group contains a mix of:

- **A planning spec** for future `createEffect` cleanup (doc-only, no code changes)
- **E2E test updates** adapting selectors to a `Code`/`Diff` -> `File` component refactor, adding new test coverage for `cmd+f` search and auto-accept toggle, and hardening the project-switch test
- **A build/config tweak** setting `KILO_PID` in the e2e-local script
- **A UI provider refactor** in `app.tsx` replacing separate `CodeComponentProvider`/`DiffComponentProvider` with a unified `FileComponentProvider`
- **A provider list change** removing `"opencode"` from the `popularProviders` display list
- **New utility code** (`comment-note.ts`) for structured comment metadata
- **I18n preparation** in `server-errors.ts` (label passthrough) and `time.ts` (translation function injection)

---

## Detailed Findings

### 1. `packages/app/create-effect-simplification-spec.md` (added, +515)

**What it does:** A detailed implementation spec for reducing `createEffect` misuse across `packages/app`. It is documentation only — no runtime code changes.

**Findings:**

- Well-structured spec with clear taxonomy (derive, reset, event, lifecycle, bridge), phased plan, acceptance criteria, and risks.
- References specific line numbers in the current codebase, which will become stale as soon as any file in scope is edited. This is acceptable for a time-boxed planning document but should not be treated as a living reference.
- **Concern:** This file is placed at the package root (`packages/app/create-effect-simplification-spec.md`) rather than in a `docs/` or `specs/` directory. It will ship in the npm package if one is ever built from this folder. Consider adding it to a `.npmignore` or moving it to a non-published location.

**Risk:** None. Doc-only.

---

### 2. `packages/app/e2e/files/file-tree.spec.ts` (modified, +3/-3)

**What it does:** Updates the file-tree E2E test selector from `[data-component="code"]` to `[data-component="file"][data-mode="text"]`, matching the Code-to-File component rename.

**Findings:**

- Straightforward selector migration. The new selector is more specific (adds `data-mode="text"`) which is a slight improvement in precision.
- No logic change. Test assertions remain the same.

**Risk:** None. Test-only change, correctly tracks the component rename.

---

### 3. `packages/app/e2e/files/file-viewer.spec.ts` (modified, +57/-3)

**What it does:** (a) Same selector migration as above for the existing smoke test. (b) Adds a new `cmd+f opens text viewer search while prompt is focused` test.

**Findings:**

- The new test exercises a realistic workflow: open file via slash command, select it from a dialog, then trigger `cmd+f` to open the inline find bar while the prompt input is focused. Good coverage addition.
- Uses `modKey` from utils for cross-platform key handling — correct pattern.
- The `evaluateAll` + `findIndex` poll pattern with 30s timeout is a pragmatic way to wait for a dynamically-populated list to include the target file. The regex `packages[\\/]+app[\\/]+package\.json$` handles both forward and backslash separators.
- Minor: The `let index = -1` mutated via closure in the poll is functional but slightly unidiomatic. Not worth changing.

**Risk:** None. Test-only, additive.

---

### 4. `packages/app/e2e/projects/projects-switch.spec.ts` (modified, +12/-7)

**What it does:** Hardens the project-switch E2E test: removes unused `stamp` variable, adds error checking for slug decode, reduces timeout from 30s to 15s for session ID poll, switches from `prompt.press("Enter")` to `page.keyboard.press("Enter")`, adds explicit import of `sessionPath`, and loosens the final URL assertion regex.

**Findings:**

- The `sessionPath` import is added but does not appear to be used in the visible diff. This is an **unused import** unless it is consumed in a section of the file not shown in the patch. Should be verified — unused imports will fail lint in many configurations.
- Lowering timeout from 30s to 15s for the session-ID poll is acceptable — the test already has a 60s overall timeout, and 15s is generous for URL routing.
- The switch from `prompt.press("Enter")` to `page.keyboard.press("Enter")` is intentional — it ensures the keypress goes to the currently focused element rather than being scoped to the prompt locator, which may matter if focus has shifted.
- The loosened final URL regex (dropping the workspace slug prefix check) reduces fragility but also reduces specificity of the assertion.
- Adding `if (!workspaceDir) throw new Error(...)` is good — converts a silent `undefined` into a clear failure.

**Risk:** Low. Test-only. The unused `sessionPath` import should be confirmed.

---

### 5. `packages/app/e2e/session/session-composer-dock.spec.ts` (modified, +24/-0)

**What it does:** Adds a `setAutoAccept` helper and a new `auto-accept toggle works before first submit` test. Inserts `setAutoAccept(page, false)` calls at the beginning of permission-related tests.

**Findings:**

- The `setAutoAccept(page, false)` calls at the start of permission tests are defensive — they ensure the auto-accept toggle is off before testing manual permission flows, preventing flaky failures if the toggle default ever changes.
- The new test (`auto-accept toggle works before first submit`) validates the toggle UI works even before any prompt is submitted. Clean, minimal test.
- The `setAutoAccept` helper checks `aria-pressed` state before clicking, making it idempotent. Good pattern.
- One concern: `page: any` type on the helper. This is pre-existing in the file (other helpers do the same), so it's consistent, but the `any` type hides potential issues.

**Risk:** None. Test-only, additive, improves reliability of existing tests.

---

### 6. `packages/app/script/e2e-local.ts` (modified, +1/-0)

**What it does:** Sets `process.env.KILO_PID = String(process.pid)` during local E2E runs.

**Findings:**

- This exposes the current process PID as `KILO_PID`, likely consumed by the CLI server to associate the server process with its parent. The env var name follows the existing pattern (`AGENT`, `OPENCODE`).
- No other files in the repo currently reference `KILO_PID` on main, indicating this is being introduced alongside (or ahead of) corresponding server-side consumption code that likely lives in another file group of this PR or a future PR.
- No risk of breaking anything — it's purely additive to the environment.

**Risk:** None. Build/config only.

---

### 7. `packages/app/src/app.tsx` (modified, +3/-7)

**What it does:** Replaces the `DiffComponentProvider` + `CodeComponentProvider` nesting with a single `FileComponentProvider`. The `Diff` and `Code` component imports are replaced by a single `File` import from `@opencode-ai/ui/file`.

**Findings:**

- This is part of a larger refactor merging the separate Code and Diff viewer components into a unified File component. The change reduces provider nesting depth.
- **Critical dependency:** The new imports (`@opencode-ai/ui/file` and `@opencode-ai/ui/context/file`) do not exist in the `packages/ui` source tree on main. They must be introduced by other file groups in this same PR. If those groups are not merged atomically with this change, `app.tsx` will fail to compile.
- **VS Code extension divergence:** The VS Code extension (`packages/kilo-vscode/`) still uses `CodeComponentProvider` and `DiffComponentProvider` from `@kilocode/kilo-ui` in 4 separate files (`App.tsx`, `AgentManagerApp.tsx`, `StoryProviders.tsx`, `history.stories.tsx`). The `kilo-ui` package re-exports from `@opencode-ai/ui`. If the upstream `ui` package removes the old `code.tsx`/`diff.tsx` context files as part of this PR, the VS Code extension will break. If they're kept as deprecated re-exports, no immediate breakage occurs but the extension will be on divergent patterns.

**Risk:** **Medium-High.** The change itself is clean, but it creates a dependency on UI package changes that must land together, and it introduces divergence with the VS Code extension's provider setup.

---

### 8. `packages/app/src/hooks/use-providers.ts` (modified, +1/-10)

**What it does:** Removes `"opencode"` from the `popularProviders` array and collapses the array to a single-line format.

**Findings:**

- The `"opencode"` provider remains referenced in the `paid` memo filter on line 34 (`p.id !== "opencode"`), so removing it from `popularProviders` does not break that logic — the `paid` filter still excludes free opencode models correctly.
- The `popularProviders` list controls UI display priority on the providers/onboarding screen. Removing `"opencode"` means it will no longer appear in the "popular" section, but will still be available in the full provider list.
- This is a Kilo-specific change (within `kilocode_change` markers), consistent with de-emphasizing the upstream `opencode` provider in the Kilo product.
- The array collapse to one line is cosmetic. Functionally identical.

**Risk:** Low. Intentional product decision. No breakage.

---

### 9. `packages/app/src/utils/comment-note.ts` (added, +88)

**What it does:** New utility module for structured comment metadata — creating, reading, formatting, and parsing "prompt comments" that associate user comments with file paths and optional line selections.

**Findings:**

- Clean, focused utility. Four public functions: `createCommentMetadata`, `readCommentMetadata`, `formatCommentNote`, `parseCommentNote`.
- The `readCommentMetadata` function is defensive with runtime type checks — good, since the input is `unknown` (likely from serialized/stored data).
- `formatCommentNote` and `parseCommentNote` are inverse operations. The format is `"The user made the following comment regarding {range} of {path}: {comment}"`. The regex in `parseCommentNote` correctly handles all three range variants (this file, line N, lines N through M).
- **Naming concern:** The local `selection` function shadows the imported `FileSelection` type name pattern and the parameter name in `PromptComment`. The function name `selection` is a parser/validator — a name like `parseSelection` would be clearer, per the style guide's preference for clarity.
- The `satisfies PromptComment` assertions are used correctly for type narrowing without casting.
- Uses `Number.isFinite` for validation, which correctly rejects `NaN`, `Infinity`, and non-numeric inputs after `Number()` coercion.

**Risk:** Low. New code, no existing consumers on main. The module will be consumed by other parts of the PR (likely the comments context and prompt components).

---

### 10. `packages/app/src/utils/server-errors.ts` (modified, +22/-5)

**What it does:** Adds an optional `labels` parameter to `formatServerError` and `parseReabaleConfigInvalidError` to allow callers to provide localized/custom label text for "Unknown error" and "Invalid configuration" strings.

**Findings:**

- The `Label` type and `resolveLabel` function are clean and minimal. Fallback values preserve backward compatibility — existing callers passing no `labels` argument get identical behavior.
- The `Partial<Label>` parameter type allows partial overrides, which is flexible.
- **Typo preserved:** The existing function name `parseReabaleConfigInvalidError` (should be "Readable") is untouched. This is correct — renaming it would be out of scope and would break callers.
- This is i18n preparation: callers can now pass translated strings without modifying this utility.

**Risk:** None. Backward-compatible API extension.

---

### 11. `packages/app/src/utils/time.ts` (modified, +13/-5)

**What it does:** Changes `getRelativeTime` to accept a `Translate` function parameter instead of returning hardcoded English strings. The function now calls `t("common.time.justNow")`, `t("common.time.minutesAgo.short", { count })`, etc.

**Findings:**

- **Breaking change to existing callers.** Every call site of `getRelativeTime(dateString)` must now pass a `t` function as the second argument. If any caller is missed, it will be a TypeScript compile error (not a silent runtime bug), so the failure mode is safe.
- The `TimeKey` union type is a nice pattern — it documents exactly which translation keys this function requires, enabling type-safe translation dictionaries.
- The `Translate` type signature `(key: TimeKey, params?: Record<string, string | number>) => string` is clean and minimal.
- This is pure i18n plumbing — no behavioral change when the identity translator is used.

**Risk:** Low. Breaking API change but TypeScript will catch any missed call sites at compile time. All callers must be updated in the same PR.

---

## Risk to VS Code Extension

| Area                           | Risk Level      | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.tsx` provider refactor    | **Medium-High** | The VS Code extension (`packages/kilo-vscode/`) uses `CodeComponentProvider` and `DiffComponentProvider` from `@kilocode/kilo-ui` in `App.tsx`, `AgentManagerApp.tsx`, `StoryProviders.tsx`, and `history.stories.tsx`. If the upstream `@opencode-ai/ui` package removes `context/code.tsx` and `context/diff.tsx` as part of this PR, the `kilo-ui` re-exports will break, and the extension will fail to compile. The extension must either be updated to use `FileComponentProvider` or the old providers must be kept as deprecated re-exports. |
| `use-providers.ts`             | **None**        | The extension does not import from `packages/app`. The `popularProviders` list is app-specific.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `comment-note.ts`              | **None**        | New utility in `packages/app`. No extension dependency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `server-errors.ts` / `time.ts` | **None**        | These are `packages/app` utilities. The extension does not consume them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| E2E tests                      | **None**        | Tests are app-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `KILO_PID` env var             | **None**        | Only set in the e2e-local script. The extension spawns `kilo serve` with its own env handling.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Key action item:** Verify that `@opencode-ai/ui` retains backward-compatible exports for `context/code` and `context/diff`, OR that a corresponding update to `packages/kilo-vscode/` is included in PR #6622 or a companion PR. Without this, the VS Code extension will break on the next build.

---

## Overall Risk

**Low-Medium.**

The majority of changes are test updates, i18n plumbing, and a new utility — all low risk and well-structured. The single elevated-risk item is the `app.tsx` provider consolidation (`Code`/`Diff` -> `File`), which:

1. Depends on new `@opencode-ai/ui` exports that must land atomically
2. Creates divergence with the VS Code extension's provider setup that must be resolved

If the broader PR handles both of these (the UI package changes exist in another file group, and the old exports are preserved or the extension is updated), the overall risk drops to **Low**. The i18n changes in `time.ts` and `server-errors.ts` are clean breaking API changes that TypeScript will enforce at compile time.
