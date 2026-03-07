# Review: ui-components-tsx (PR #6622 — OpenCode v1.2.16)

## Files Reviewed

| File                                                       | Status   | +/-       | Significance                                                             |
| ---------------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------ |
| `packages/ui/src/components/file.tsx`                      | added    | +1176     | **Critical** — replaces `code.tsx` and `diff.tsx` with unified component |
| `packages/ui/src/components/code.tsx`                      | removed  | -1097     | **Critical** — deleted, API consumers must migrate                       |
| `packages/ui/src/components/diff.tsx`                      | removed  | -652      | **Critical** — deleted, API consumers must migrate                       |
| `packages/ui/src/components/diff-ssr.tsx`                  | removed  | -317      | **Critical** — deleted, SSR diff replaced by `file-ssr.tsx`              |
| `packages/ui/src/components/file-ssr.tsx`                  | added    | +178      | High — SSR replacement for `diff-ssr.tsx`                                |
| `packages/ui/src/components/message-part.tsx`              | modified | +442/-249 | **Critical** — context import changes, new animation system              |
| `packages/ui/src/components/session-review.tsx`            | modified | +723/-554 | **Critical** — major rewrite, context migration                          |
| `packages/ui/src/components/session-turn.tsx`              | modified | +68/-19   | High — new props, context migration                                      |
| `packages/ui/src/components/line-comment-annotations.tsx`  | added    | +586      | High — new annotation system for line comments                           |
| `packages/ui/src/components/line-comment.tsx`              | modified | +160/-32  | High — new variants, inline mode                                         |
| `packages/ui/src/components/line-comment-styles.ts`        | renamed  | +111/-3   | Medium — expanded style rules                                            |
| `packages/ui/src/components/basic-tool.tsx`                | modified | +51/-4    | Medium — new `animated` prop, `motion` dependency                        |
| `packages/ui/src/components/text-shimmer.tsx`              | modified | +41/-16   | Medium — API change (removed `stepMs`/`durationMs`, added `offset`)      |
| `packages/ui/src/components/text-reveal.tsx`               | added    | +135      | Low — new animation component                                            |
| `packages/ui/src/components/text-strikethrough.tsx`        | added    | +85       | Low — new animation component                                            |
| `packages/ui/src/components/animated-number.tsx`           | added    | +100      | Low — new animation component                                            |
| `packages/ui/src/components/motion-spring.tsx`             | added    | +45       | Low — new `useSpring` primitive                                          |
| `packages/ui/src/components/tool-count-label.tsx`          | added    | +58       | Low — new animated count label                                           |
| `packages/ui/src/components/tool-count-summary.tsx`        | added    | +52       | Low — new animated count list                                            |
| `packages/ui/src/components/tool-status-title.tsx`         | added    | +133      | Low — new animated status title                                          |
| `packages/ui/src/components/file-media.tsx`                | added    | +265      | Medium — media preview for binary files                                  |
| `packages/ui/src/components/file-search.tsx`               | added    | +69       | Low — find-in-file search bar                                            |
| `packages/ui/src/components/session-review-search.ts`      | added    | +59       | Low — search hit builder                                                 |
| `packages/ui/src/components/session-review-search.test.ts` | added    | +39       | Low — tests for search                                                   |
| `packages/ui/src/components/session-retry.tsx`             | added    | +74       | Low — retry status display                                               |
| `packages/ui/src/components/provider-icon.tsx`             | modified | +5/-4     | Low — fallback to "synthetic" for unknown providers                      |
| `packages/ui/src/components/provider-icons/types.ts`       | modified | +22/0     | Low — 22 new provider icon names                                         |
| `packages/ui/src/components/provider-icons/sprite.svg`     | modified | +242/-3   | Low — new SVG sprites                                                    |
| `packages/ui/src/components/app-icon.tsx`                  | modified | +2/0      | Trivial — add Warp icon                                                  |
| `packages/ui/src/components/app-icons/types.ts`            | modified | +1/0      | Trivial — add "warp" to icon names                                       |
| `packages/ui/src/components/scroll-view.tsx`               | modified | +3/-1     | Trivial — i18n for aria-label                                            |
| `packages/ui/src/components/tabs.tsx`                      | modified | +2/0      | Trivial — `data-value` attribute on trigger                              |

## Summary

This is a **major architectural refactor** of the file/diff rendering subsystem in `packages/ui/`. The three most impactful changes:

1. **Unified `File` component replaces separate `Code` and `Diff` components.** The old `code.tsx` (1097 lines), `diff.tsx` (652 lines), and `diff-ssr.tsx` (317 lines) are deleted. A new `file.tsx` (1176 lines) consolidates both code viewing and diff viewing into a single `<File>` component with a `mode` prop. A companion `file-ssr.tsx` (178 lines) replaces the SSR diff path.

2. **Context provider migration: `useDiffComponent` + `useCodeComponent` → `useFileComponent`.** The patch changes imports in `message-part.tsx`, `session-turn.tsx`, and `session-review.tsx` from the two separate context hooks to a single `useFileComponent`. However, the new `file` context (`packages/ui/src/context/file.tsx`) **does not exist in the current codebase** — it must be created elsewhere in this PR (likely in a different file group). The old `diff.tsx` and `code.tsx` contexts remain in the codebase and are still referenced by the VS Code extension.

3. **New animation system using `motion` library.** Multiple new components (`AnimatedNumber`, `TextReveal`, `TextStrikethrough`, `ToolStatusTitle`, `AnimatedCountList`, `useSpring`) introduce the `motion` library as a dependency for spring-based animations. `BasicTool` gains an `animated` prop for smooth expand/collapse height transitions.

Additionally, the line comment system is substantially expanded with `line-comment-annotations.tsx` (586 lines) providing a full controller pattern for inline comment annotations on diffs, and `line-comment.tsx` adds an `"add"` variant and `inline` mode.

## Detailed Findings

### 1. `code.tsx`, `diff.tsx`, `diff-ssr.tsx` → `file.tsx`, `file-ssr.tsx` (BREAKING)

**What changed:** Three files deleted (2066 lines total), replaced by two new files (1354 lines). The old `CodeProps` and `DiffProps` types are gone. The new `file.tsx` exports:

- `File` — a wrapper component that accepts a `mode` prop and delegates to internal `CodeViewer` or `DiffViewer`
- `FileProps` / `DiffFileProps` — new prop types
- `FileSearchHandle` — handle for programmatic find-in-file

**Breaking surface:** Any consumer that imported `Code` from `./code`, `Diff` from `./diff`, or `SSRDiff` from `./diff-ssr` will break. The prop shapes have changed (e.g. `mode` is new, `media` option is new, `FileMediaOptions` replaces direct binary handling).

**Risk:** High. The new `File` component is a well-structured consolidation, but the old exports are completely removed with no re-export shims or deprecation layer.

### 2. Context Migration: `useDiffComponent` / `useCodeComponent` → `useFileComponent` (BREAKING)

**What changed:** In `message-part.tsx`, the patch replaces:

```ts
import { useDiffComponent } from "../context/diff"
import { useCodeComponent } from "../context/code"
```

with:

```ts
import { useFileComponent } from "../context/file"
```

Similar changes occur in `session-turn.tsx` and `session-review.tsx`.

**Issue:** The file `packages/ui/src/context/file.tsx` does not exist in the current codebase. It is presumably created in another file group of this PR. The old contexts (`diff.tsx`, `code.tsx`) still exist and are imported by `packages/kilo-vscode/webview-ui/src/components/chat/VscodeSessionTurn.tsx` (line 22) and `packages/app/src/pages/session/file-tabs.tsx` (line 5). If the old contexts are not also updated or re-exported, these downstream consumers will break at runtime when they try to provide/consume the old context while shared components expect the new one.

**Risk:** **Critical for VS Code extension.** `VscodeSessionTurn.tsx` imports `useDiffComponent` from `@kilocode/kilo-ui/context/diff`. After this PR merges, the shared `SessionTurn` and `message-part` components it depends on will call `useFileComponent` instead, which won't be provided unless `VscodeSessionTurn` is also updated to use `FileComponentProvider`.

### 3. `BasicTool` — New `animated` Prop

**What changed:** `BasicTool` gains an optional `animated?: boolean` prop. When true, expand/collapse uses `motion`'s `animate()` for spring-based height transitions instead of the Collapsible's default CSS approach. A `SPRING` config is defined at module scope.

**Assessment:** Additive, non-breaking. The `animated` prop defaults to `undefined`/`false`, so existing consumers are unaffected. The implementation properly cleans up animation controls in `onCleanup`. The `motion` library is now a required dependency of `@opencode-ai/ui`.

### 4. `TextShimmer` — Breaking Prop Changes

**What changed:**

- Removed: `stepMs`, `durationMs` props
- Added: `offset` prop
- The internal rendering changed from `<For>` over individual character `<span>`s to a single child with CSS-driven shimmer. The `data-active` attribute value changed from bare boolean to `"true"/"false"` string.

**Risk:** Medium. Any consumer passing `stepMs` or `durationMs` will get TypeScript errors. The `data-active` value change from `true` to `"true"` could break CSS selectors using `[data-active=true]` vs `[data-active="true"]` (though in practice attribute selectors match both). More importantly, custom CSS targeting `[data-slot="text-shimmer-char"]` will no longer work since individual character spans are removed.

### 5. `session-review.tsx` — Major Rewrite (+723/-554)

**What changed:** Nearly the entire component is rewritten. Key changes:

- Migrated from `useDiffComponent` to `useFileComponent`
- Integrated `createLineCommentController` from the new `line-comment-annotations.tsx` for structured line comment management
- Added `FileSearchBar` integration for cross-file search within the review
- Added `DropdownMenu` for additional actions
- New `mediaKindFromPath` integration for binary/media file preview
- Added `cloneSelectedLineRange` and `previewSelectedLines` from selection bridge utilities
- Prop type `SessionReviewProps` likely expanded (new imports suggest new capabilities)

**Risk:** High. This is a near-total rewrite of a complex interactive component. The line comment system is significantly more capable but the controller pattern (`createLineCommentController`) introduces new state management abstractions that must be correctly wired up by all consumers.

### 6. `session-turn.tsx` — Prop Changes

**What changed:**

- Removed: `lastUserMessageID` prop
- Added: `active`, `queued`, `status` (type `SessionStatus`) props
- Added `SessionRetry` and `TextReveal` component integration
- Context migration from `useDiffComponent` to `useFileComponent`

**Risk:** Medium-High. Removing `lastUserMessageID` is breaking for any consumer passing it. The VS Code extension's `VscodeSessionTurn` is a custom replacement that doesn't directly use `SessionTurn`, but it does use shared sub-components from `message-part.tsx` that will expect the new context.

### 7. `message-part.tsx` — Significant Changes (+442/-249)

**What changed:**

- Context migration to `useFileComponent`
- New `ShellSubmessage` component with `motion` animations
- Integration of `AnimatedCountList` and `ToolStatusTitle` for richer tool status display
- New `Part` export (in addition to existing `AssistantParts`, `Message`)
- Added `Index` import from solid-js (used alongside `For`)

**Risk:** High. This is the central rendering component for all message parts. The context change means any provider hierarchy that supplied `DiffComponentProvider` and `CodeComponentProvider` separately must now supply `FileComponentProvider` instead.

### 8. `line-comment-annotations.tsx` — New System (586 lines)

**What changed:** An entirely new annotation system for line comments in diffs. Exports:

- `LineCommentAnnotation<T>`, `LineCommentAnnotationMeta<T>` — generic types
- `createLineCommentController` — a controller factory that manages comment state, selection, draft creation, and hover interactions
- Internal helper components for rendering annotations in shadow DOM

**Assessment:** Well-structured generic system. The controller pattern using generics (`<T extends LineCommentShape>`) allows reuse across different comment data shapes. The shadow DOM rendering approach (using `renderSolid` into pierre diffs' annotation slots) is consistent with the existing architecture. No breaking changes — this is purely additive.

### 9. `provider-icon.tsx` — Graceful Fallback

**What changed:** The `id` prop type widened from `IconName` (strict union) to `string`. A runtime check falls back to `"synthetic"` icon for unknown provider IDs.

**Assessment:** Non-breaking improvement. Prevents runtime errors when new providers are added before their icons exist.

### 10. New Animation Components

`animated-number.tsx`, `motion-spring.tsx`, `text-reveal.tsx`, `text-strikethrough.tsx`, `tool-count-label.tsx`, `tool-count-summary.tsx`, `tool-status-title.tsx` — all additive. They use the `motion` library for spring physics. `useSpring` in `motion-spring.tsx` is a clean SolidJS reactive wrapper around `motion`'s `attachSpring` + `motionValue`.

No breaking changes from these additions.

## Risk to VS Code Extension

**HIGH**

The VS Code extension (`packages/kilo-vscode/`) has direct exposure to two breaking changes:

1. **Context provider mismatch.** `VscodeSessionTurn.tsx` (line 22) imports `useDiffComponent` from `@kilocode/kilo-ui/context/diff`. After this PR, the shared components it renders (via `message-part.tsx` tool renderers) will call `useFileComponent()` instead of `useDiffComponent()`. If `VscodeSessionTurn.tsx` still wraps content in `DiffComponentProvider`, the shared components will throw a missing context error at runtime.

   **Required action:** `VscodeSessionTurn.tsx` must be updated to import and use `FileComponentProvider` (from `@kilocode/kilo-ui/context/file`, which this PR presumably creates) instead of `DiffComponentProvider`. The component it provides must satisfy the new unified `File` API rather than the old separate `Diff` component API.

2. **`SessionTurn` prop changes.** The removal of `lastUserMessageID` and addition of `active`/`queued`/`status` props won't directly break `VscodeSessionTurn` (which is a custom replacement), but any code path in the extension that renders the upstream `SessionTurn` directly would need updating.

3. **`TextShimmer` prop removal.** If the extension or its webview passes `stepMs` or `durationMs` to `TextShimmer`, those will become TypeScript errors. This is likely low risk since the extension mostly uses kilo-ui components via their defaults.

4. **CSS targeting `data-slot="text-shimmer-char"`** in `chat.css` or extension styles will silently break (elements no longer exist).

The `packages/app/` (desktop/web) has similar exposure via `useCodeComponent` in `file-tabs.tsx:5`.

## Overall Risk

**HIGH**

This is a structurally significant refactor that:

- Deletes 2066 lines across 3 core rendering components (`code.tsx`, `diff.tsx`, `diff-ssr.tsx`)
- Replaces them with a unified 1354-line system (`file.tsx`, `file-ssr.tsx`)
- Changes the context provider contract from two providers to one (`useFileComponent`)
- Introduces `motion` as a new runtime dependency
- Rewrites `session-review.tsx` almost entirely (~90% changed)
- Modifies `message-part.tsx` substantially (~35% changed)
- Breaks at least 2 known downstream consumers (`VscodeSessionTurn.tsx`, `file-tabs.tsx`)

The consolidation itself is architecturally sound — having a single `File` component with a `mode` prop is cleaner than separate `Code`/`Diff`/`SSRDiff` components. However, the migration requires coordinated updates across all client packages. The absence of the new `context/file.tsx` in this file group suggests it exists in another group of the same PR, but the downstream consumer updates in `kilo-vscode` and `app` must be verified.
