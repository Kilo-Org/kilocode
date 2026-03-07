# PR #6622 Review Summary — OpenCode v1.2.16

## Overview

**370 files** across 25+ packages. **+27,872 additions / -5,669 deletions.** This is a major upstream merge from OpenCode v1.2.16 into Kilo CLI.

Key themes:

- **Unified `File` component** replaces separate `Code`/`Diff`/`DiffSSR` components (-2,066 lines, +1,354 lines)
- **Workspace system** — new control-plane subsystem, DB migrations, SDK types, server routes
- **Animation overhaul** — `motion` library integration, spring-based animations across tool status, todo dock, and composer
- **Permission broadening** — auto-accept expanded from edit-only to all permission types
- **Context overflow recovery** — auto-compaction on HTTP 413 with replay
- **i18n expansion** — Turkish locale added, 22+ new keys across all 16 locales
- **Session history windowing** — scroll-driven progressive reveal replaces idle-callback batching
- **Provider icon batch** — 22 new provider SVGs

---

## 🔴 Critical Issues (Must Fix Before Merge)

### 1. Unresolved git merge conflict in `openapi.json`

**File:** `packages/sdk/openapi.json` (lines 39-43)

Contains `<<<<<<< HEAD` / `>>>>>>> kevinvandijk/opencode-v1.2.16` markers. Must be resolved to `@kilocode/sdk` (not `@opencode-ai/sdk`). Build will fail until resolved.

**Source:** [sdk.md](sdk.md)

### 2. `Code`/`Diff` → `File` context migration breaks VS Code extension

**Files:** `packages/ui/src/context/diff.tsx` (deleted), `packages/ui/src/context/code.tsx` → `file.tsx` (renamed)

`DiffComponentProvider`/`useDiffComponent` deleted. `CodeComponentProvider`/`useCodeComponent` renamed to `FileComponentProvider`/`useFileComponent`. The VS Code extension imports these in **6+ files** (`App.tsx`, `AgentManagerApp.tsx`, `VscodeSessionTurn.tsx`, `StoryProviders.tsx`, `DiffPanel.tsx`, `FullScreenDiffView.tsx`). Without corresponding extension updates, **the extension will not compile**.

**Required action:** Update `packages/kilo-vscode/` to use `FileComponentProvider` from `@kilocode/kilo-ui/context/file`, or ensure the old contexts are preserved as re-export shims.

**Source:** [ui-components-tsx.md](ui-components-tsx.md), [ui-misc.md](ui-misc.md), [app-misc.md](app-misc.md)

### 3. `packages/ui/package.json` export map gutted — breaks kilo-ui re-exports

**File:** `packages/ui/package.json`

~70 granular component subpath exports reduced to ~14 category-level exports. Every `@kilocode/kilo-ui/*` re-export that resolves to a removed `@opencode-ai/ui/*` subpath will fail. This cascades to break the VS Code extension's entire webview build.

**Required action:** Verify that `packages/kilo-ui/package.json` and all its shim files are updated atomically, or that the removed paths are still resolvable through the remaining category exports.

**Source:** [ui-misc.md](ui-misc.md)

### 4. Root `package.json` identity overridden by upstream

**File:** `package.json`

Name changed from `@kilocode/kilo` to `opencode`, repo URL changed from `github.com/Kilo-Org/kilocode` to `github.com/anomalyco/opencode`. Must be reverted to Kilo values. Failure could break CI, `gh` CLI wrappers, SDK generation, and release scripts.

**Source:** [root-and-misc.md](root-and-misc.md)

### 5. `en.ts` type widened — kills i18n key validation across all products

**File:** `packages/ui/src/i18n/en.ts`

Export changed from inferred literal type to `Record<string, string>`. This degrades `UiI18nKey` from a union of 126 specific keys to `string`, eliminating compile-time key validation for all `t()` calls in UI, app, desktop, and VS Code extension.

**Required action:** Revert this type annotation change.

**Source:** [ui-i18n.md](ui-i18n.md)

---

## 🟡 High-Priority Concerns (Should Address)

### 6. Permission auto-accept broadened from edit-only to all types

**File:** `packages/app/src/context/permission.tsx`

`shouldAutoAccept` (which restricted to `permission === "edit"`) removed. Users who enabled auto-accept for a session now auto-accept **all** permission types (read, write, execute), cascading to child sessions via lineage. This is a **significant security posture change**.

**Source:** [app-context.md](app-context.md)

### 7. `finalize-latest-json.ts` — wrong variable check

**File:** `packages/desktop/scripts/finalize-latest-json.ts` (line 23)

Checks `releaseId` instead of `version` for the `OPENCODE_VERSION` env var. Allows `undefined` version to produce malformed updater URLs (`vundefined`), corrupting the desktop auto-update manifest.

**Source:** [desktop.md](desktop.md)

### 8. Session proxy middleware returns plain-text errors

**File:** `packages/opencode/src/control-plane/session-proxy-middleware.ts`

"Workspace not found" returns a plain-text 500 response bypassing Hono's error handler. The VS Code SDK expects JSON `NamedError` format — this will cause parse failures when workspace lookup fails.

**Source:** [opencode-server.md](opencode-server.md)

### 9. Provider icon fallback removed — broken SVGs for unknown providers

**Files:** `packages/app/src/components/dialog-select-provider.tsx`, `settings-providers.tsx`

The `icon()` helper that fell back to `"synthetic"` for unknown provider IDs was deleted. Custom/unknown providers now produce broken SVG `<use>` references.

Note: `provider-icon.tsx` in the UI package adds its own fallback to `"synthetic"`, so this may be mitigated at the component level. Verify the fallback chain is complete.

**Source:** [app-components.md](app-components.md), [ui-components-tsx.md](ui-components-tsx.md)

### 10. `prependHistoryEntry` parameter order change — silent API break

**File:** `packages/app/src/components/prompt-input/history.ts`

`prependHistoryEntry(entries, prompt, max?)` changed to `(entries, prompt, comments?, max?)`. Any caller passing 3 args now silently interprets the 3rd arg as `comments` instead of `max`.

**Source:** [app-components.md](app-components.md)

### 11. Missing `kilocode_change` markers on shared files

**Files:** `server.ts`, `session.ts`, `experimental.ts`, `workspace.ts` (server routes)

Multiple modifications to shared upstream code lack required `kilocode_change` markers. Will complicate future upstream merges.

**Source:** [opencode-server.md](opencode-server.md), [opencode-cli.md](opencode-cli.md)

### 12. Hardcoded colors in provider icons — break theme support

**Files:** `302ai.svg` (`fill="rgb(...)"`) , `novita-ai.svg` (`fill="black"`)

These icons will be invisible or visually broken on dark/light themes. `stepfun.svg` is also an exact duplicate of `minimax-coding-plan.svg` (wrong icon for the provider).

**Source:** [ui-assets.md](ui-assets.md)

---

## 🟢 Medium-Priority Items (Nice to Fix)

### 13. Workspace control-plane has structural issues (inert code)

All 11 new files in `packages/opencode/src/control-plane/` are currently unreachable — no existing code imports them. Safe to merge as-is, but issues must be fixed before activation: DB insert in `setTimeout` with no error handling, no auth/CORS on `WorkspaceServer`, `WorktreeAdaptor.create` ignores branch parameter, no backoff in event loop, empty catch blocks.

**Source:** [opencode-control-plane.md](opencode-control-plane.md)

### 14. Auto-scroll timeout 6x increase (250ms → 1500ms)

**File:** `packages/ui/src/hooks/create-auto-scroll.tsx`

User scrolls after a programmatic scroll may be ignored for up to 1.5s. Click-to-stop no longer works unless user has text selected.

**Source:** [ui-misc.md](ui-misc.md)

### 15. `session-review.css` scroll refactor + z-index jump to 120

Scroll delegation, sticky positioning, z-index hierarchy, and media container styles all changed simultaneously. High surface area for visual regressions.

**Source:** [ui-components-css.md](ui-components-css.md)

### 16. `tabs.css` `[data-hidden]` close-button removal is global

Affects all tab variants, not just the review panel. Tab close buttons previously hidden on non-selected tabs may now always be visible.

**Source:** [ui-components-css.md](ui-components-css.md)

### 17. Six i18n keys missing from all 15 non-English locales

Server management keys (`dialog.server.add.name`, `.namePlaceholder`, `.username`, `.password`, `dialog.server.edit.title`) and `language.tr` missing from all locales. Users see English fallback in server management dialog.

**Source:** [app-i18n.md](app-i18n.md)

### 18. `OPENCODE` → `KILO` env var rename

**File:** `packages/opencode/src/index.ts`

Breaking change for any external tools/scripts checking `$OPENCODE`. No known consumers outside the monorepo.

**Source:** [opencode-misc.md](opencode-misc.md)

### 19. `KILO_EXPERIMENTAL_MARKDOWN` default flipped to enabled

All TUI users now see the experimental markdown renderer by default. Should validate stability, especially with `@opentui` 0.1.86.

**Source:** [opencode-misc.md](opencode-misc.md)

### 20. `debug-storybook.log` committed

**File:** `packages/storybook/debug-storybook.log`

307-line debug log with local filesystem paths. Should be removed and added to `.gitignore`.

**Source:** [storybook.md](storybook.md)

### 21. `motion` library added — bundle size impact

New transitive dependency via `@opencode-ai/ui`. Motion libraries can be 50-80KB gzipped. Recommend measuring impact on VS Code extension webview bundle.

**Source:** [root-and-misc.md](root-and-misc.md)

### 22. Turkish locale (`tr.ts`) missing 9 `ui.fileMedia.*` keys

Binary/media file UI will show raw key strings for Turkish users once the locale is wired up.

**Source:** [ui-i18n.md](ui-i18n.md)

### 23. Empty catch blocks in multiple files

Style guide violations in: `sse.ts`, `workspace-context.ts`, `mcp/index.ts`, `media.ts`, `selection-bridge.ts`. Errors silently swallowed.

**Source:** [opencode-control-plane.md](opencode-control-plane.md), [opencode-session-provider.md](opencode-session-provider.md), [ui-pierre.md](ui-pierre.md)

---

## VS Code Extension Impact Assessment

### Breaking changes requiring extension updates

| Change                                             | Files affected in extension                                                                            | Severity           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| `DiffComponentProvider` deleted                    | `App.tsx`, `AgentManagerApp.tsx`, `VscodeSessionTurn.tsx`, `StoryProviders.tsx`, `history.stories.tsx` | **Build-breaking** |
| `CodeComponentProvider` → `FileComponentProvider`  | `App.tsx`, `AgentManagerApp.tsx`, `StoryProviders.tsx`, `history.stories.tsx`                          | **Build-breaking** |
| `Code`/`Diff` component exports removed            | `App.tsx`, `AgentManagerApp.tsx`, `DiffPanel.tsx`, `FullScreenDiffView.tsx`                            | **Build-breaking** |
| `@opencode-ai/ui` granular subpath exports removed | All kilo-ui re-export shims                                                                            | **Build-breaking** |
| `UiI18nKey` degraded to `string`                   | `language.tsx` — silent type safety loss                                                               | **High**           |

### Behavioral changes the extension should be aware of

- **Auto-accept covers all permission types** — users who had "auto-accept edits" enabled now auto-accept everything
- **Auto-scroll click-to-stop removed** — users must select text or scroll to pause auto-scroll
- **Session list may be workspace-filtered** — if `WorkspaceContext.workspaceID` is set server-side, `session.list()` returns fewer results
- **Compaction auto-recovery** — `session.error` events may flash briefly before compaction resolves them
- **Session proxy for remote workspaces** — non-GET session requests may be transparently proxied (dev-only gated)

### New capabilities the extension can leverage

- `workspaceID` field on `Session` and `GlobalSession` — can replace client-side worktree-session tracking
- `EventWorkspaceReady` / `EventWorkspaceFailed` events — workspace lifecycle notifications
- `client.experimental.workspace.*` methods — CRUD for workspace management
- Universal `workspace` query parameter on all SDK methods — workspace-scoped API calls
- New `File` component with unified code/diff viewing and media support
- `createLineCommentController` — structured line comment annotations
- Spring-based animation primitives (`useSpring`, `AnimatedNumber`, `TextReveal`)

---

## Risk Matrix by Area

| Area                                   | Risk          | Key Concern                                                    |
| -------------------------------------- | ------------- | -------------------------------------------------------------- |
| **UI component refactor** (`file.tsx`) | 🔴 Critical   | Deletes `Code`/`Diff` exports, breaks all downstream consumers |
| **UI export map** (`package.json`)     | 🔴 Critical   | ~70 subpath exports removed, cascading build failures          |
| **UI i18n type safety** (`en.ts`)      | 🔴 Critical   | Silent loss of compile-time key validation                     |
| **Root `package.json` identity**       | 🔴 Critical   | Wrong repo name/URL breaks CI pipelines                        |
| **SDK `openapi.json` conflict**        | 🔴 Critical   | Unresolved merge conflict, build blocker                       |
| **Permission system**                  | 🟡 High       | Auto-accept broadened to all permission types                  |
| **Session/provider core**              | 🟡 Medium     | Overflow compaction complex but well-guarded                   |
| **App pages/layout**                   | 🟡 Medium     | Large refactor (~2,800 lines), async `navigateToProject`       |
| **Server routes**                      | 🟡 Medium     | Workspace proxy, missing error handling                        |
| **Desktop app**                        | 🟡 Medium     | Wrong variable check in release script                         |
| **CSS animation system**               | 🟢 Low-Medium | Additive; `code.css`/`diff.css` rename needs coordination      |
| **Database migrations**                | 🟢 Low        | Purely additive (new table + nullable column)                  |
| **Control plane**                      | 🟢 Low (now)  | All inert/unreachable code; issues matter at activation        |
| **CLI commands**                       | 🟢 Low        | Workspace sync gated behind `Installation.isLocal()`           |
| **i18n (app/desktop)**                 | 🟢 Low        | Missing keys cause English fallback, not crashes               |
| **Provider icons**                     | 🟢 Low        | Visual issues only (hardcoded colors, wrong icon)              |
| **Storybook**                          | 🟢 Low        | Dev-only package, no production impact                         |
| **Tests**                              | 🟢 Low        | Good coverage; PTY behavior change needs verification          |

---

## Detailed Review Files

| #   | File                                                         | Focus Area                                                       | Risk                          |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------- |
| 1   | [app-components.md](app-components.md)                       | App component refactors, ProviderIcon type changes               | Medium-High                   |
| 2   | [app-context.md](app-context.md)                             | Permission broadening, state management refactors                | Medium                        |
| 3   | [app-i18n.md](app-i18n.md)                                   | App i18n: Turkish locale, 22 new keys, missing translations      | Low-Medium                    |
| 4   | [app-misc.md](app-misc.md)                                   | E2E tests, `File` provider refactor, `comment-note` utility      | Low-Medium                    |
| 5   | [app-pages.md](app-pages.md)                                 | Session history windowing, project navigation, animations        | Medium-High                   |
| 6   | [desktop.md](desktop.md)                                     | Shell env probing, `open_path`, i18n, release script bug         | Medium-Low                    |
| 7   | [opencode-cli.md](opencode-cli.md)                           | Serve command, workspace-serve refactor, TUI navigation          | Low                           |
| 8   | [opencode-control-plane.md](opencode-control-plane.md)       | New workspace system (all inert code)                            | Low (now) / High (activation) |
| 9   | [opencode-migrations.md](opencode-migrations.md)             | `workspace` table, `session.workspace_id` column                 | Low                           |
| 10  | [opencode-misc.md](opencode-misc.md)                         | Auth normalization, markdown flag flip, PTY refactor             | Low-Medium                    |
| 11  | [opencode-server.md](opencode-server.md)                     | Workspace context, session proxy, workspace CRUD routes          | Medium                        |
| 12  | [opencode-session-provider.md](opencode-session-provider.md) | Context overflow recovery, MCP cleanup, workspace sessions       | Medium                        |
| 13  | [opencode-tests.md](opencode-tests.md)                       | 738 lines of new tests, PTY behavior change                      | Medium                        |
| 14  | [root-and-misc.md](root-and-misc.md)                         | Dependencies, kilo-ui re-exports, publish script                 | Low                           |
| 15  | [sdk.md](sdk.md)                                             | Workspace SDK types, universal `workspace` param, merge conflict | Low (except conflict)         |
| 16  | [storybook.md](storybook.md)                                 | New Storybook package with mocks (dev-only)                      | Low                           |
| 17  | [ui-assets.md](ui-assets.md)                                 | 22 new provider icons, theme/quality issues                      | Low-Medium                    |
| 18  | [ui-components-css.md](ui-components-css.md)                 | Animation CSS, `code.css` removal, `diff.css` rename             | Medium                        |
| 19  | [ui-components-tsx.md](ui-components-tsx.md)                 | `File` component, context migration, `motion` dependency         | **High**                      |
| 20  | [ui-i18n.md](ui-i18n.md)                                     | UI i18n type safety regression, Turkish locale gaps              | **High**                      |
| 21  | [ui-misc.md](ui-misc.md)                                     | Export map overhaul, context rename, auto-scroll changes         | **High**                      |
| 22  | [ui-pierre.md](ui-pierre.md)                                 | Find-in-file, comment hover, selection bridge (all additive)     | Low-Medium                    |
| 23  | [ui-stories-components.md](ui-stories-components.md)         | 53 new Storybook stories (dev-only)                              | Low                           |

---

## Recommendations

### Must do before merge

1. **Resolve the `openapi.json` merge conflict** — use `@kilocode/sdk`
2. **Revert root `package.json`** name and repo URL to Kilo values
3. **Revert `en.ts` type annotation** from `Record<string, string>` back to inferred literal type
4. **Verify VS Code extension compiles** — the `Code`/`Diff` → `File` migration and export map changes are the single biggest risk. Confirm that either:
   - (a) `packages/kilo-vscode/` is updated in this PR to use `FileComponentProvider`, or
   - (b) backward-compatible re-exports are preserved in `kilo-ui`
5. **Fix `finalize-latest-json.ts`** — change `if (!releaseId)` to `if (!version)` on line 23
6. **Remove `debug-storybook.log`** from the commit

### Should do before merge

7. **Confirm `.github/TEAM_MEMBERS`** file is included — Nix build depends on it
8. **Confirm `packages/desktop/scripts/finalize-latest-json.ts`** is included — `publish.ts` imports it
9. **Update `x-codeSamples`** in workspace endpoints from `@opencode-ai/sdk` to `@kilocode/sdk`
10. **Add `kilocode_change` markers** to modified shared server files
11. **Validate the permission broadening is intentional** — document in release notes if so

### Should do after merge

12. **Add missing i18n keys** to all 16 non-English locales (5 server management + `language.tr`)
13. **Fix provider icon quality issues** — `302ai.svg`, `novita-ai.svg` (hardcoded colors), `stepfun.svg` (wrong icon)
14. **Measure VS Code extension bundle size** impact from `motion` dependency
15. **Add empty catch block logging** across control-plane, MCP, pierre files
16. **Smoke test TUI** with experimental markdown renderer now enabled by default

### Merge verdict

**Conditional merge.** The 5 critical items (merge conflict, root `package.json`, `en.ts` type, VS Code extension compilation, release script bug) must be resolved. Once those are addressed and the extension build is verified, this PR is safe to merge — the vast majority of changes are well-structured improvements with good test coverage. The workspace control-plane is entirely inert and carries zero runtime risk. The permission broadening and auto-scroll behavior changes should be documented in release notes.
