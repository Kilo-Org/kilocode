# PR #6622 (OpenCode v1.2.16) - App Components Review

## Files Reviewed

| #   | File                                                                   | +/-       | Status   |
| --- | ---------------------------------------------------------------------- | --------- | -------- |
| 1   | `packages/app/src/components/dialog-connect-provider.tsx`              | +1/-2     | modified |
| 2   | `packages/app/src/components/dialog-release-notes.tsx`                 | +6/-4     | modified |
| 3   | `packages/app/src/components/dialog-select-directory.tsx`              | +56/-3    | modified |
| 4   | `packages/app/src/components/dialog-select-file.tsx`                   | +1/-1     | modified |
| 5   | `packages/app/src/components/dialog-select-model-unpaid.tsx`           | +12/-2    | modified |
| 6   | `packages/app/src/components/dialog-select-provider.tsx`               | +5/-7     | modified |
| 7   | `packages/app/src/components/dialog-select-server.tsx`                 | +340/-238 | modified |
| 8   | `packages/app/src/components/file-tree.tsx`                            | +0/-6     | modified |
| 9   | `packages/app/src/components/prompt-input.tsx`                         | +206/-75  | modified |
| 10  | `packages/app/src/components/prompt-input/build-request-parts.test.ts` | +9/-0     | modified |
| 11  | `packages/app/src/components/prompt-input/build-request-parts.ts`      | +9/-13    | modified |
| 12  | `packages/app/src/components/prompt-input/history.test.ts`             | +51/-1    | modified |
| 13  | `packages/app/src/components/prompt-input/history.ts`                  | +106/-19  | modified |
| 14  | `packages/app/src/components/prompt-input/submit.test.ts`              | +38/-0    | modified |
| 15  | `packages/app/src/components/prompt-input/submit.ts`                   | +5/-0     | modified |
| 16  | `packages/app/src/components/server/server-row.tsx`                    | +60/-22   | modified |
| 17  | `packages/app/src/components/session/session-context-tab.tsx`          | +3/-2     | modified |
| 18  | `packages/app/src/components/session/session-header.tsx`               | +18/-16   | modified |
| 19  | `packages/app/src/components/session/session-sortable-tab.tsx`         | +12/-9    | modified |
| 20  | `packages/app/src/components/settings-models.tsx`                      | +1/-2     | modified |
| 21  | `packages/app/src/components/settings-providers.tsx`                   | +21/-12   | modified |
| 22  | `packages/app/src/components/status-popover.tsx`                       | +15/-17   | modified |
| 23  | `packages/app/src/components/terminal.tsx`                             | +3/-4     | modified |

---

## Summary

This patch group introduces several categories of changes across `packages/app/` components:

1. **`ProviderIcon` type relaxation**: The `id` prop across 5+ components no longer requires `as IconName` casting. The underlying `ProviderIcon` component still types `id` as `IconName`, so this change relies on an upstream `@opencode-ai/ui` type widening (likely `IconName` now accepts `string`, or ProviderIcon's prop type was relaxed). If the UI package was not also updated, these become type errors.

2. **`IconName` import removal**: The `iconNames` array and `icon()` helper functions that fell back to `"synthetic"` for unknown providers are removed in `dialog-select-provider.tsx` and `settings-providers.tsx`. Provider IDs are now passed directly — unknown providers will render a broken SVG `<use>` reference instead of a fallback icon.

3. **Server management dialog rewrite** (`dialog-select-server.tsx`): Major refactor of +340/-238 lines. `AddRowProps` and `EditRowProps` interfaces are replaced by a unified `ServerFormProps` with added `name`, `username`, `password` fields and `onSubmit`/`onBack` callbacks. The `ServerRow` component is updated with a new `showCredentials` prop and a renamed helper (`serverDisplayName` -> `serverName`). A new `ServerHealthIndicator` component is now exported.

4. **Prompt history now includes comments**: `PromptHistoryEntry` is now a tagged union (`Prompt | PromptHistoryEntry`) that can carry `PromptHistoryComment[]` alongside prompt parts. The `navigatePromptHistory` function signature adds `currentComments` and `savedComments` fields. The `prependHistoryEntry` function gains an optional third `comments` parameter.

5. **Auto-accept on new sessions**: `createPromptSubmit` input type gains `autoAccept: Accessor<boolean>`. When enabled on a new session, `permission.enableAutoAccept()` is called after session creation.

6. **i18n expansion**: `dialog-release-notes.tsx`, `settings-providers.tsx`, and `dialog-select-file.tsx` replace hardcoded English strings with `language.t()` calls. `getRelativeTime()` gains a `t` parameter for i18n.

7. **Component renames**: `Code` -> `File` (with added `mode="text"` prop) in `session-context-tab.tsx`.

8. **Minor UI/UX tweaks**: Warp terminal added to "Open In" list, `StatusPopover` trigger simplified to a minimal icon button, `FileVisual` tab icons refactored for active/inactive states with CSS-based mono overlays, `terminal.tsx` replaces signal with `createMemo`.

---

## Detailed Findings

### 1. `dialog-connect-provider.tsx`

**Change**: Remove `IconName` import, pass `props.provider` directly to `ProviderIcon` without cast.
**Risk**: Low. If `ProviderIcon`'s `id` prop type was widened to `string` in the UI package (part of a parallel UI PR), this is safe. If not, this is a **compile-time type error**.
**Action needed**: Verify the UI package's `ProviderIconProps.id` type was widened. Currently it's `IconName` at `packages/ui/src/components/provider-icon.tsx:7`.

### 2. `dialog-release-notes.tsx`

**Change**: Adds `useLanguage()` context, replaces 4 hardcoded strings with `language.t()` keys.
**Risk**: Low. Pure i18n. No API/prop changes. New translation keys: `dialog.releaseNotes.action.getStarted`, `dialog.releaseNotes.action.next`, `dialog.releaseNotes.action.hideFuture`, `dialog.releaseNotes.media.alt`.
**Breaking**: None.

### 3. `dialog-select-directory.tsx`

**Changes**:

- `Row` type gains `group: "recent" | "folders"` field.
- `toRow()` signature changes from `(absolute, home)` to `(absolute, home, group)` — **breaking internal API** change.
- New `uniqueRows()` deduplication helper.
- `useLayout()` context added, `recentProjects` memo introduced.
- List now likely renders grouped items (recent vs folders).

**Risk**: Medium. The `toRow()` signature change is internal but any callers outside this file would break. The `Row` type gained a required field — all downstream list renderers consuming `Row` must handle `group`.
**Breaking**: Internal-only. The component's public props (`DialogSelectDirectoryProps`) are unchanged.

### 4. `dialog-select-file.tsx`

**Change**: `getRelativeTime()` call gains second argument `language.t`.
**Risk**: Low. Requires `getRelativeTime` in `@/utils/time.ts` to accept the translation function. This is a **function signature change** in the utility — any other callers of `getRelativeTime` must also be updated.
**Breaking**: `getRelativeTime` API changed (new required parameter).

### 5. `dialog-select-model-unpaid.tsx`

**Changes**:

- Remove `IconName` import, pass `i.id` directly to `ProviderIcon`.
- Add tagline/tag for `"opencode"` and `"opencode-go"` providers.
- New translation keys: `dialog.provider.opencode.tagline`, `dialog.provider.opencodeGo.tagline`.

**Risk**: Low. Same `IconName` type concern as #1. New provider entries are additive.

### 6. `dialog-select-provider.tsx`

**Changes**:

- Remove `iconNames` import and `icon()` fallback helper. Previously unknown providers fell back to `"synthetic"` icon; now they pass raw ID.
- Add `"opencode-go"` tagline note.

**Risk**: Medium. **Removing the `icon()` fallback means unknown/custom provider IDs will produce a broken SVG sprite reference** instead of showing a `"synthetic"` fallback. This is a functional regression for users with custom provider configurations.

### 7. `dialog-select-server.tsx` (Major Refactor)

**Changes**:

- `AddRowProps` and `EditRowProps` replaced by unified `ServerFormProps`.
- `ServerFormProps` adds: `name`, `username`, `password` fields with corresponding change handlers, plus `onSubmit`/`onBack` callbacks. Removes `onKeyDown`/`onBlur`.
- `ServerRow` now uses `ServerHealthIndicator` (newly exported from `server-row.tsx`).
- `Icon` imported (new dependency for this file).
- Net +340/-238 lines — essentially a rewrite of the server management UI.

**Risk**: High. This is the largest change in the group. The entire server dialog interaction model changed (unified form with credentials support, back navigation). Any tests or integration points relying on the old `AddRow`/`EditRow` structure are invalidated. The `ServerConnection` type may need to accommodate `name`/`username`/`password` fields.
**Breaking**: Internal component APIs changed. Public dialog invocation (`<DialogSelectServer />`) props appear unchanged, but behavior differs substantially.

### 8. `file-tree.tsx`

**Change**: Removes a `createEffect` that called `file.tree.list(props.path)` for expanded directories.
**Risk**: Medium. This removes an eager data-fetching side effect. If the tree data is now fetched elsewhere (lazy or on-demand), this is fine. If not, **expanded directories may no longer load their children automatically**.
**Action needed**: Verify that the tree listing logic was moved elsewhere (likely into the `file.tree` context or the `List` component itself).

### 9. `prompt-input.tsx` (Major Change)

**Changes**:

- New imports: `useSpring` from `@opencode-ai/ui/motion-spring`, `selectionFromLines` and `SelectedLineRange` from file context, new history types.
- Remove `IconName` import.
- New `queueCommentFocus` helper with retry logic (up to 6 attempts via `requestAnimationFrame`).
- Prompt history persistence format changes: stored entries are now `PromptHistoryStoredEntry` (union of `Prompt | PromptHistoryEntry`), with `normalizePromptHistoryEntry` for migration.
- `navigatePromptHistory` calls now include `currentComments`/`savedComments` parameters.
- `createPromptSubmit` call gains `autoAccept` accessor.
- Spring animation likely added for some UI transition.

**Risk**: High. The history format migration (`PromptHistoryStoredEntry`) affects persisted local storage data. The `normalizePromptHistoryEntry` function handles backward compatibility (arrays → entry objects). If the normalization has bugs, users' prompt history breaks on upgrade. The `autoAccept` integration changes the session creation flow.
**Breaking**: Persisted history format changed. Migration handled via `normalizePromptHistoryEntry`. The `PromptInput` public props are unchanged.

### 10. `build-request-parts.test.ts`

**Change**: Adds assertion that comment metadata is included in synthetic text parts.
**Risk**: None. Test-only. Validates the new `createCommentMetadata` utility.

### 11. `build-request-parts.ts`

**Changes**:

- Removes inline `commentNote()` helper, replaces with imported `formatCommentNote` and `createCommentMetadata` from `@/utils/comment-note`.
- Synthetic text parts now include `metadata.opencodeComment` with structured data (path, selection, comment, preview).

**Risk**: Low-Medium. The comment text format produced by `formatCommentNote` must match the old `commentNote` output for backward compatibility with existing LLM prompts. Adding `metadata` to parts is additive but changes the wire format sent to the server.
**Breaking**: Wire format change — parts now carry `metadata.opencodeComment`. Server must tolerate this.

### 12. `history.test.ts`

**Change**: Comprehensive test coverage for comments in prompt history, including `normalizePromptHistoryEntry`, comment-only entries, and deduplication.
**Risk**: None. Test-only. Good coverage of the new history types.

### 13. `history.ts` (Significant API Change)

**Changes**:

- New types: `PromptHistoryComment`, `PromptHistoryEntry`, `PromptHistoryStoredEntry`.
- New functions: `clonePromptHistoryComments`, `normalizePromptHistoryEntry`, `cloneSelection`.
- `prependHistoryEntry` signature: `(entries, prompt, max?)` -> `(entries, prompt, comments?, max?)`.
- `navigatePromptHistory` input/output types expanded with `currentComments`, `savedComments`, and `comments` fields.

**Risk**: Medium. **All callers of `prependHistoryEntry` and `navigatePromptHistory` must be updated.** The `max` parameter position shifted in `prependHistoryEntry` (from 3rd to 4th arg). Since `comments` is optional and `max` defaults to `MAX_HISTORY`, existing callers passing `(entries, prompt)` are safe, but any passing `(entries, prompt, max)` will now interpret `max` as `comments`.
**Breaking**: `prependHistoryEntry` parameter order change is a subtle API break for callers passing 3 args.

### 14. `submit.test.ts`

**Change**: Adds `usePermission` mock, `autoAccept` accessor in test inputs, and a new test for auto-accept on new sessions.
**Risk**: None. Test-only. Validates the auto-accept feature integration.

### 15. `submit.ts`

**Changes**:

- `PromptSubmitInput` gains `autoAccept: Accessor<boolean>`.
- `usePermission()` context consumed.
- After session creation, calls `permission.enableAutoAccept(session.id, sessionDirectory)` if `shouldAutoAccept` is true.

**Risk**: Low. Additive feature. The `usePermission` context is already used elsewhere in the app. The `enableAutoAccept` method exists in the permission context.
**Breaking**: `PromptSubmitInput.autoAccept` is a new required field — all callers of `createPromptSubmit` must provide it.

### 16. `server/server-row.tsx` (Significant API Change)

**Changes**:

- Import `children` from solid-js, `serverName` replaces `serverDisplayName`.
- New prop: `showCredentials?: boolean`.
- `ServerHealthIndicator` component exported (new export).
- Tooltip placement changed from `"top"` to `"top-start"`, tooltip now always active when `props.conn.displayName` is set.
- Version display now prefixed with `"v"`, style changed to `text-text-invert-weak`.
- The tooltip displays full name via `serverName(props.conn, true)` (new second parameter).
- Badge rendered via `children()` helper.

**Risk**: Medium. `serverDisplayName` renamed to `serverName` — **all importers of `serverDisplayName` from `@/context/server` will break** unless the context module was also updated. The new `showCredentials` prop is optional, so existing usage is safe. `ServerHealthIndicator` is a new export — no breakage.
**Breaking**: `serverDisplayName` -> `serverName` rename in context module. `ServerRow` tooltip behavior change (now always active with `displayName`).

### 17. `session/session-context-tab.tsx`

**Change**: `Code` component replaced by `File` component (from `@opencode-ai/ui/file`), with added `mode="text"` prop.
**Risk**: Medium. This assumes `@opencode-ai/ui/file` exports a `File` component with a compatible API to the old `Code` component (accepting `file`, `overflow`, `class` props). If the `File` component API differs, this breaks rendering of the raw message content view.
**Breaking**: Component rename. Must verify `File` component exists and has compatible props.

### 18. `session/session-header.tsx`

**Changes**:

- Warp terminal added to `OPEN_APPS` list and `MAC_APPS`.
- `useSessionShare` args: `currentSession` type no longer requires `id` field, gains new `sessionID: () => string | undefined` accessor.
- Internal calls switched from `args.currentSession().id` to `args.sessionID()`.

**Risk**: Low. The `useSessionShare` API change is internal. Adding Warp is purely additive. The session share logic is slightly decoupled — `sessionID` can now come from a different source than the full session object.
**Breaking**: `useSessionShare` args interface changed (internal-only).

### 19. `session/session-sortable-tab.tsx`

**Changes**:

- `FileVisual` now uses `Show` with fallback instead of `classList` for active/inactive states.
- Active tabs render a single `FileIcon`; inactive tabs render two overlapping `FileIcon` instances (one with mono prop) using CSS-based transition.
- Tab wrapper layout adjusted: added `flex items-center` class, removed nested `h-full` div.
- `TooltipKeybind` gains `gutter={10}` prop.

**Risk**: Low. Visual-only changes. The dual-icon overlay technique for inactive tabs may have rendering issues if `FileIcon`'s `mono` prop isn't supported yet in the UI package.
**Breaking**: None. Props to `SortableTab` are unchanged.

### 20. `settings-models.tsx`

**Change**: Remove `IconName` import, pass `group.category` directly to `ProviderIcon`. Same pattern as #1.
**Risk**: Low. Same type concern.

### 21. `settings-providers.tsx`

**Changes**:

- Remove `iconNames` import and `icon()` fallback helper (same as #6).
- Replace hardcoded "Connected from your environment variables" with `language.t()`.
- New translation keys for disconnect confirmation dialog.

**Risk**: Medium. Same fallback icon concern as #6 — unknown providers lose their `"synthetic"` fallback.

### 22. `status-popover.tsx`

**Changes**:

- Import `ServerHealthIndicator` from `server-row.tsx` (new import).
- Trigger button significantly simplified: removed text label, changed from bordered pill to minimal `titlebar-icon` button (24x24, no text).
- Added `aria-label` to trigger.

**Risk**: Medium. **The status popover trigger is now just a dot indicator without the "Status" text label.** This is a visible UI regression for discoverability — users may not realize the dot is clickable. However, if this aligns with upstream design intent, it's intentional.
**Breaking**: Visual change to the titlebar. The `ServerHealthIndicator` is used in the popover content for individual server entries.

### 23. `terminal.tsx`

**Change**: Replace `createSignal`/`setTerminalColors` with `createMemo(getTerminalColors)`. The `createEffect` that called `getTerminalColors()` and `setTerminalColors()` is simplified to just read `terminalColors()`.
**Risk**: Low. This is a correct simplification — `createMemo` automatically tracks reactive dependencies and caches the result. Behavior is equivalent but more idiomatic SolidJS.
**Breaking**: None.

---

## Risk to VS Code Extension

| Area                                  | Risk            | Details                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server management**                 | **Medium-High** | The `dialog-select-server.tsx` rewrite changes the server connection form to include `name`, `username`, `password` fields. If the VS Code extension uses the SDK to connect to servers, the `ServerConnection` type may now carry more fields. The extension's `kilo serve` spawning is unaffected, but any remote server configuration UI could be impacted. |
| **Prompt submit API**                 | **Low**         | New `autoAccept` accessor is required on `createPromptSubmit`. The VS Code extension uses its own chat panel — it does not consume `createPromptSubmit` directly.                                                                                                                                                                                              |
| **ProviderIcon type relaxation**      | **Low**         | The VS Code extension's `kilo-ui` webview components may use `ProviderIcon`. If the UI package type wasn't widened, this causes compile errors in shared code paths.                                                                                                                                                                                           |
| **History format migration**          | **Low**         | Prompt history is persisted in the web app's local storage. The VS Code extension has its own session management and doesn't share this storage.                                                                                                                                                                                                               |
| **StatusPopover visual change**       | **Low**         | Only affects the web UI titlebar. The VS Code extension has its own status bar integration.                                                                                                                                                                                                                                                                    |
| **`Code` -> `File` component rename** | **Low**         | If the VS Code extension's webview uses `@opencode-ai/ui/code`, it needs to update imports. The Agent Manager webview may be affected if it renders raw message content.                                                                                                                                                                                       |

---

## Overall Risk

**Medium-High**

The most significant risks in this patch group are:

1. **`ProviderIcon` type mismatch** (5+ files): All `IconName` casts were removed but the UI package still types `id` as `IconName`. This depends on a coordinated UI package change. If the UI change isn't included in this PR, **these files will fail typecheck**.

2. **Provider icon fallback removal** (`dialog-select-provider.tsx`, `settings-providers.tsx`): The `icon()` helper that fell back to `"synthetic"` for unknown providers was deleted. Custom/unknown provider IDs will now render as broken SVG references.

3. **Server dialog rewrite** (`dialog-select-server.tsx`): 340+ lines changed with new credential fields and form flow. High surface area for regressions.

4. **Prompt history format change** (`history.ts`): Persisted data format migration. If `normalizePromptHistoryEntry` doesn't handle all edge cases, user history is lost.

5. **`prependHistoryEntry` parameter order** (`history.ts`): The `max` parameter moved from position 3 to position 4. Any callers passing 3 args now silently interpret the third arg as `comments` instead of `max`.

6. **`getRelativeTime` signature change**: New required `t` parameter. All callers must be updated.

The changes are internally consistent within this patch group, but depend on coordinated changes in the UI package (`ProviderIcon` type widening, `File` component export, `useSpring` export) and the app's context layer (`serverName` rename, `comment-note` utility). Missing any of these dependencies will cause build failures.
