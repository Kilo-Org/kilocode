# Review: ui-misc (PR #6622 -- OpenCode v1.2.16)

## Files Reviewed

| File                                           | Status                    | +/-      |
| ---------------------------------------------- | ------------------------- | -------- |
| `packages/ui/package.json`                     | modified                  | +9 / -61 |
| `packages/ui/src/context/diff.tsx`             | removed                   | -10      |
| `packages/ui/src/context/file.tsx`             | renamed (from `code.tsx`) | +3 / -3  |
| `packages/ui/src/context/index.ts`             | modified                  | +1 / -1  |
| `packages/ui/src/hooks/create-auto-scroll.tsx` | modified                  | +13 / -5 |
| `packages/ui/src/storybook/fixtures.ts`        | added                     | +51      |
| `packages/ui/src/storybook/scaffold.tsx`       | added                     | +62      |
| `packages/ui/src/styles/index.css`             | modified                  | +8 / -3  |
| `packages/ui/tsconfig.json`                    | modified                  | +2 / -1  |

## Summary

This group consolidates several UI cleanup changes: a massive simplification of `packages/ui/package.json` exports (from ~70 granular component exports down to ~14 category-based exports), removal of the `diff` context and renaming of the `code` context to `file`, behavioral changes to the auto-scroll hook, new storybook infrastructure files, CSS import reshuffling (removing `code.css`, `diff.css`, `line-comment.css`; adding `file.css`, `animated-number.css`, `shell-submessage.css`, `text-reveal.css`, `tool-call.css`), and a tsconfig exclusion for storybook files.

**The most impactful changes are the package.json export removals and the context provider renames, which will break the VS Code extension at multiple call sites unless corresponding updates are made in the same PR.**

---

## Detailed Findings

### 1. `packages/ui/package.json` -- Export Map Overhaul

**What changed:** The exports map was reduced from ~70 entries to ~14. All individual component exports (`./button`, `./code`, `./diff`, `./dialog`, `./line-comment`, etc.) and all granular context sub-path exports (`./context/code`, `./context/diff`, `./context/dialog`, etc.) were removed. The new map retains only category-level entries: `./context`, `./hooks`, `./styles`, `./theme`, `./pierre`, `./i18n/*`, `./fonts/*`, `./audio/*`, plus a few icon type exports.

**Findings:**

- **BREAKING: `./context/diff` export removed.** This export is consumed by:
  - `packages/kilo-ui/src/context/diff.tsx` -- re-exports `@opencode-ai/ui/context/diff`
  - `packages/app/src/app.tsx` -- imports `DiffComponentProvider`
  - `packages/kilo-ui/src/stories/session-turn.stories.tsx`, `session-review.stories.tsx`, `message-part.stories.tsx`

  The kilo-ui re-export at `packages/kilo-ui/src/context/diff.tsx` will fail to resolve, which cascades to break the VS Code extension's `App.tsx`, `AgentManagerApp.tsx`, `VscodeSessionTurn.tsx`, `StoryProviders.tsx`, and `history.stories.tsx` (all import from `@kilocode/kilo-ui/context/diff`).

- **BREAKING: `./context/code` export removed.** Same cascade pattern -- `packages/kilo-ui/src/context/code.tsx` re-exports it, which is consumed by the VS Code extension's `App.tsx`, `AgentManagerApp.tsx`, `StoryProviders.tsx`, and `history.stories.tsx`.

- **BREAKING: `./code` export removed.** `packages/kilo-ui/src/components/code.tsx` re-exports `@opencode-ai/ui/code`. Consumed by VS Code extension via `@kilocode/kilo-ui/code` in `App.tsx`, `AgentManagerApp.tsx`, `StoryProviders.tsx`, `history.stories.tsx`.

- **BREAKING: `./diff` export removed.** `packages/kilo-ui/src/components/diff.tsx` re-exports `@opencode-ai/ui/diff`. Consumed by VS Code extension via `@kilocode/kilo-ui/diff` in `App.tsx`, `AgentManagerApp.tsx`, `DiffPanel.tsx`, `FullScreenDiffView.tsx`, `StoryProviders.tsx`, `history.stories.tsx`.

- **BREAKING: `./line-comment` export removed.** `packages/kilo-ui/src/components/line-comment.tsx` re-exports `@opencode-ai/ui/line-comment`. Used by `packages/kilo-ui/src/stories/line-comment.stories.tsx` and `packages/app/src/pages/session/file-tabs.tsx`.

- **Also removed:** `./diff-ssr`, `./diff-changes`, `./button`, `./dialog`, `./icon`, `./icon-button`, `./list`, `./spinner`, `./text-field`, `./toast`, `./tooltip`, `./select`, `./checkbox`, `./switch`, `./radio-group`, `./tabs`, `./card`, `./avatar`, `./logo`, `./favicon`, `./file-icon`, `./app-icon`, `./markdown`, `./keybind`, `./popover`, `./hover-card`, `./dropdown-menu`, `./context-menu`, `./collapsible`, `./accordion`, `./sticky-accordion-header`, `./resize-handle`, `./progress`, `./progress-circle`, `./tag`, `./typewriter`, `./image-preview`, `./inline-input`, `./message-nav`, `./message-part`, `./session-review`, `./session-turn`, `./basic-tool`, `./dock-prompt`, `./dock-surface`, `./scroll-view`, `./font`, `./provider-icon`. These are all consumed extensively by `packages/kilo-ui` re-exports and `packages/app` direct imports. The entire `packages/kilo-ui/package.json` mirrors these exports and will need a corresponding rewrite.

- **Risk:** This is the highest-risk change in the group. The upstream OpenCode project is consolidating its public API surface, but the kilo-ui re-export layer and the VS Code extension both depend on the granular paths. Without synchronized updates to `packages/kilo-ui/package.json` and all its re-export files, plus all consumer imports, this will cause build failures across the monorepo.

### 2. `packages/ui/src/context/diff.tsx` -- Removed

**What changed:** The `DiffComponentProvider` and `useDiffComponent` context pair was deleted entirely.

**Findings:**

- `useDiffComponent` is called in `packages/ui/src/components/session-review.tsx:181`, `session-turn.tsx:155`, and `message-part.tsx:1500,1693`. These are internal to `packages/ui` and presumably updated in other patch groups within this PR.
- `DiffComponentProvider` is used by external consumers (app, kilo-ui stories, VS Code extension) to inject the concrete diff component. If the provider/consumer pattern is being replaced with direct imports, all wrapping sites need updates.
- The kilo-ui re-export at `packages/kilo-ui/src/context/diff.tsx` (`export * from "@opencode-ai/ui/context/diff"`) will break.

### 3. `packages/ui/src/context/file.tsx` -- Renamed from `code.tsx`

**What changed:** `code.tsx` was renamed to `file.tsx`. The context name changed from `"CodeComponent"` to `"FileComponent"`, and exports changed from `CodeComponentProvider`/`useCodeComponent` to `FileComponentProvider`/`useFileComponent`.

**Findings:**

- This is a semantic rename reflecting a broader scope (files, not just code blocks).
- All existing consumers of `CodeComponentProvider` and `useCodeComponent` must be updated: `packages/ui/src/components/message-part.tsx:31,1596`, `packages/app/src/app.tsx:4`, `packages/app/src/pages/session/file-tabs.tsx:5`, `packages/kilo-ui/src/context/code.tsx`, VS Code extension's `App.tsx:5`, `AgentManagerApp.tsx:47`, `StoryProviders.tsx:20`, `history.stories.tsx:11`.
- The barrel export at `context/index.ts` is updated (see below), but the subpath `./context/code` in `package.json` is removed (covered above).

### 4. `packages/ui/src/context/index.ts` -- Barrel Re-export Updated

**What changed:** `export * from "./diff"` replaced with `export * from "./file"`.

**Findings:**

- Consumers importing from `@opencode-ai/ui/context` will get `FileComponentProvider`/`useFileComponent` instead of `DiffComponentProvider`/`useDiffComponent`.
- The `code.tsx` context (now `file.tsx`) was never exported from the barrel -- only via the `./context/code` subpath. After rename, it's now exported from the barrel as `./file`. This is a subtle API change: previously `import { useCodeComponent } from "@opencode-ai/ui/context"` would fail (it wasn't in the barrel); now `import { useFileComponent } from "@opencode-ai/ui/context"` will succeed.
- The removal of the diff context from the barrel is a breaking change for any consumer that was doing `import { useDiffComponent } from "@opencode-ai/ui/context"`.

### 5. `packages/ui/src/hooks/create-auto-scroll.tsx` -- Behavioral Changes

**What changed:** Four distinct behavioral modifications:

1. **Auto-scroll timeout increased from 250ms to 1500ms** (lines 51 and 58 in pre-patch): The `markAuto` timer and `isAuto` staleness check both changed from 250ms to 1500ms. This means programmatic scrolls are now "trusted" for 6x longer before being treated as potentially user-initiated.

2. **`scrollToBottom` reordered and calls `markAuto` on short-circuit** (lines 79-93): The `force && store.userScrolled` reset was moved above the `const el = scroll` guard (actually above the `if (!force && store.userScrolled) return`). More importantly, when `distance < 2`, instead of silently returning, it now calls `markAuto(el)` before returning. This prevents subsequent scroll events from misinterpreting the near-bottom position as a user scroll.

3. **`handleInteraction` now only stops on text selection** (lines 143-146): Previously, any click interaction during active mode would call `stop()` and set `userScrolled = true`. Now it checks `window.getSelection()` and only stops if there's an actual text selection. This prevents clicks (e.g., on buttons, links, or empty space) from inadvertently disabling auto-scroll.

**Findings:**

- The 250ms-to-1500ms timeout change is significant. On slower connections or with large streaming responses, 250ms could have been too short and caused false "user scrolled" detections. 1500ms is more forgiving but could also mean that if a user scrolls up immediately after a programmatic scroll, their input is ignored for up to 1.5 seconds. This is a UX tradeoff.
- The `handleInteraction` change is a behavioral improvement. Currently, clicking anywhere in the chat area stops auto-scroll, which is annoying when users click to copy text or interact with tool output. The new behavior only stops on actual text selection. However, `handleInteraction` is wired to `onClick` in `session-turn.tsx:354` and `MessageList.tsx:80` (VS Code extension). A user who clicks to "pause" scrolling without selecting text will no longer be able to do so via click alone -- they must scroll up or select text.
- The `markAuto` call in the `distance < 2` short-circuit is a correctness fix: without it, a scroll event arriving when already near-bottom could be misclassified.
- The reorder of `setStore("userScrolled", false)` before `const el = scroll` means the `userScrolled` flag is cleared even if the scroll element doesn't exist. This is a minor edge case but could cause state inconsistency if `scroll` is temporarily undefined.

### 6. `packages/ui/src/storybook/fixtures.ts` -- New File

**What changed:** Added storybook test fixtures (diff before/after, code sample, markdown sample, change stats).

**Findings:**

- Pure additive, no risk. Provides reusable test data for storybook stories.
- The `packages/ui/tsconfig.json` change excludes `*.stories.*` and `*.mdx` from type-checking, but this file is `.ts` so it will still be type-checked. This is correct since fixtures are plain data.

### 7. `packages/ui/src/storybook/scaffold.tsx` -- New File

**What changed:** Added a storybook scaffold utility that auto-picks components from module exports and wraps them in an `ErrorBoundary` for rendering.

**Findings:**

- Pure additive, no risk. The `pick` function prioritizes named exports starting with uppercase, then falls back to `default`, then any function. Reasonable heuristic for SolidJS components.
- Uses `Dynamic` from `solid-js/web` for dynamic component rendering, which is the standard approach.

### 8. `packages/ui/src/styles/index.css` -- CSS Import Changes

**What changed:**

- Added: `animated-number.css`, `shell-submessage.css`, `text-reveal.css`, `tool-call.css`
- Removed: `code.css`, `diff.css`, `line-comment.css`
- Renamed reference: `code.css` -> `file.css`

**Findings:**

- The new CSS files (`animated-number.css`, `file.css`, `shell-submessage.css`, `text-reveal.css`, `tool-call.css`) do not currently exist in the working tree. They must be introduced by other patch groups in this PR (likely `ui-components-css.json`). If those patches are not applied, the CSS build will fail.
- The removed CSS files (`code.css`, `diff.css`, `line-comment.css`) currently exist. They presumably are deleted or renamed in other patch groups.
- The component CSS previously split across `code.css` and `diff.css` appears to be consolidated into `file.css`, consistent with the `code` -> `file` context rename.

### 9. `packages/ui/tsconfig.json` -- Storybook Exclusion

**What changed:** Added `"exclude": ["**/*.stories.*", "**/*.mdx"]`.

**Findings:**

- This prevents storybook story files and MDX docs from being type-checked by `tsgo`. This is a reasonable change since storybook files may use storybook-specific types not available to the base tsconfig.
- Low risk. No impact on production code.

---

## Risk to VS Code Extension

**HIGH.** The VS Code extension (`packages/kilo-vscode/`) is critically affected by this patch group:

1. **Export map breakage (package.json):** The kilo-ui package re-exports from `@opencode-ai/ui` using the granular subpaths that are being removed. Every `@kilocode/kilo-ui/*` import in the VS Code extension that ultimately resolves to a removed `@opencode-ai/ui/*` subpath will fail. This affects:
   - `webview-ui/src/App.tsx` -- imports `Code`, `Diff`, `CodeComponentProvider`, `DiffComponentProvider`
   - `webview-ui/agent-manager/AgentManagerApp.tsx` -- same imports
   - `webview-ui/src/components/chat/VscodeSessionTurn.tsx` -- imports `useDiffComponent`
   - `webview-ui/agent-manager/DiffPanel.tsx` -- imports `Diff`
   - `webview-ui/agent-manager/FullScreenDiffView.tsx` -- imports `Diff`
   - `webview-ui/src/stories/StoryProviders.tsx`, `history.stories.tsx` -- multiple imports

2. **Context provider removal/rename:** `DiffComponentProvider` is deleted and `CodeComponentProvider` is renamed to `FileComponentProvider`. The VS Code extension uses both providers in its component tree roots (`App.tsx`, `AgentManagerApp.tsx`). Without corresponding updates, these components will fail to resolve.

3. **Auto-scroll behavior change:** The `handleInteraction` change means clicking in the chat message area (wired in `MessageList.tsx:80`) no longer pauses auto-scroll unless the user has selected text. This is a UX behavior change that users will notice -- clicking to "stop" streaming scroll will no longer work. This may be intentional but needs validation against VS Code extension UX expectations.

**Mitigation required:** The kilo-ui package.json, all kilo-ui re-export shim files, and all VS Code extension import paths must be updated in the same merge. If these changes come from other patch groups in the PR, they need to be landed atomically. If they are NOT part of this PR, the VS Code extension build will break.

---

## Overall Risk

**HIGH.**

This patch group contains upstream API surface changes that are breaking by nature. The export map reduction is a major architectural change that removes the granular import paths that the entire kilo ecosystem (kilo-ui re-export layer, VS Code extension, desktop app) depends on. The context provider deletion and rename compound the breakage.

The individual changes are well-reasoned (consolidating exports, fixing auto-scroll edge cases, renaming for clarity), but they are only safe if all downstream consumers are updated atomically. The key question for reviewing this PR as a whole is: **do the other patch groups (e.g., `kilo-ui.json`, `ui-components-tsx.json`, `app-*.json`) contain the corresponding import path updates?** If not, this will break the build.

| Area                   | Risk Level   | Notes                                                   |
| ---------------------- | ------------ | ------------------------------------------------------- |
| Export map changes     | **Critical** | Breaks all downstream consumers unless coordinated      |
| Context removal/rename | **High**     | Breaks provider tree in app, kilo-ui, VS Code extension |
| Auto-scroll behavior   | **Medium**   | UX change to click-to-stop behavior; 6x longer timeout  |
| CSS import changes     | **Medium**   | Depends on new CSS files from other patches existing    |
| Storybook additions    | **Low**      | Additive, no risk                                       |
| tsconfig exclusion     | **Low**      | No production impact                                    |
