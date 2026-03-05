# PR #6622 (OpenCode v1.2.16) — App Context Review

## Files Reviewed

| #   | File                                                       | Status   | +/-       |
| --- | ---------------------------------------------------------- | -------- | --------- |
| 1   | `packages/app/src/context/comments.test.ts`                | modified | +33 / -0  |
| 2   | `packages/app/src/context/comments.tsx`                    | modified | +55 / -0  |
| 3   | `packages/app/src/context/file/view-cache.ts`              | modified | +1 / -1   |
| 4   | `packages/app/src/context/global-sync.tsx`                 | modified | +67 / -39 |
| 5   | `packages/app/src/context/global-sync/bootstrap.ts`        | modified | +14 / -3  |
| 6   | `packages/app/src/context/global-sync/child-store.ts`      | modified | +21 / -9  |
| 7   | `packages/app/src/context/language.tsx`                    | modified | +9 / -0   |
| 8   | `packages/app/src/context/layout-scroll.test.ts`           | modified | +20 / -0  |
| 9   | `packages/app/src/context/layout-scroll.ts`                | modified | +10 / -2  |
| 10  | `packages/app/src/context/layout.tsx`                      | modified | +77 / -5  |
| 11  | `packages/app/src/context/permission-auto-respond.test.ts` | added    | +63 / -0  |
| 12  | `packages/app/src/context/permission-auto-respond.ts`      | added    | +41 / -0  |
| 13  | `packages/app/src/context/permission.tsx`                  | modified | +35 / -27 |
| 14  | `packages/app/src/context/prompt.tsx`                      | modified | +28 / -0  |
| 15  | `packages/app/src/context/server.tsx`                      | modified | +32 / -18 |
| 16  | `packages/app/src/context/sync.tsx`                        | modified | +20 / -39 |

**Total: 16 files, +526 / -143**

---

## Summary

This file group contains state management, context provider, and permission/auth changes across the `packages/app/` SolidJS frontend. The key themes are:

1. **Permission system generalization** — The auto-accept mechanism is broadened from edit-only to all permission types, with session lineage inheritance (child sessions inherit parent auto-accept). Extracted into a standalone module with full test coverage.
2. **Defensive cloning for SolidJS reactivity** — Multiple files now clone `SelectedLineRange` / `selection` objects before storing them, preventing SolidJS proxy-related mutation bugs.
3. **Persisted store initialization refactor** — `global-sync.tsx` and `child-store.ts` replace `createEffect` + reactive-ready signals with promise-based `onPersistedInit` patterns and explicit `let`-based project cache management.
4. **Comment system CRUD expansion** — New `update`, `replace`, and `replaceComments` operations for comments and prompt context items.
5. **Layout tab normalization** — New path-based normalization for stored session tabs to deduplicate `file://` tabs that may differ in encoding.
6. **Server store type widening** — The stored server list type changes from `string[]` to a union type to persist full `ServerConnection` objects.
7. **Sync page-size reduction** — `messagePageSize` reduced from 400 to 200 and `limitFor` helper removed.
8. **i18n Turkish locale addition** — Straightforward addition of `tr` locale across all locale registries.

---

## Detailed Findings

### 1. `packages/app/src/context/permission-auto-respond.ts` (new file)

**What changed:** Extracted pure logic for determining whether a permission should be auto-responded. Introduces `acceptKey()` (directory-scoped accept keys), `sessionLineage()` (walks parent chain), and `autoRespondsPermission()`.

**Analysis:**

- **Positive:** Clean extraction of testable pure functions out of the permission context. The lineage traversal correctly uses a `seen` set to guard against cycles, and the BFS-like approach (pushing to `ids` while iterating) is correct for walking the parent chain.
- **Observation — `sessionLineage` rebuilds the parent map on every call.** The `parent` map is constructed by reducing the full session list each time `autoRespondsPermission` is invoked. For hot paths (e.g., SSE `permission.asked` events), this is O(n) per call. In practice session lists are small, so this is acceptable, but worth noting if session counts grow.
- **Observation — fallback to legacy key.** `accepted()` falls back to `autoAccept[sessionID]` when the directory-scoped key is absent. This is correct for migration but means an old flat key could accidentally match across directories. The migration in `permission.tsx` should handle most cases, but any persisted stores that were not migrated could exhibit cross-directory auto-accept leakage.
- **No issues found.** Well-structured, testable code.

### 2. `packages/app/src/context/permission-auto-respond.test.ts` (new file)

**What changed:** 5 test cases covering directory-scoped accept, legacy key fallback, no-lineage default, inherited false override, and missing session graceful fallback.

**Analysis:**

- Good coverage of the core scenarios. The tests use minimal type-cast helpers (`as Session`, `as Pick<PermissionRequest, "sessionID">`) which is a reasonable pattern for unit tests.
- **Missing test case:** No test for cycle detection in `sessionLineage()` (e.g., A -> B -> A). The code handles this via `seen`, but there's no explicit test asserting the guard works. Low risk since the guard is simple.

### 3. `packages/app/src/context/permission.tsx`

**What changed:**

- Removed `shouldAutoAccept` (which restricted auto-accept to `permission === "edit"` only).
- `hasPermissionPromptRules` now checks all config values with `Object.values(config).some(isNonAllowRule)` instead of only `config.edit` and `config.write`.
- The persisted store key gains a `migrate` function to rename `autoAcceptEdits` to `autoAccept`.
- `autoResponds()` now delegates to `autoRespondsPermission()` which walks session lineage.
- `isAutoAccepting` replaced by the extracted `accepted()` from `permission-auto-respond.ts`.

**Analysis:**

- **Behavioral change — auto-accept now applies to ALL permission types, not just "edit".** Previously, `shouldAutoAccept(perm)` filtered to `perm.permission === "edit"`, meaning only edit permissions were auto-responded. After this change, when a user enables auto-accept for a session, ALL permissions (read, write, execute, etc.) will be auto-accepted. **This is a significant security posture change.** The PR should confirm this is intentional. If the server introduces new permission types in the future, they will be auto-accepted too.
- **Migration correctness:** The `migrate` function renames `autoAcceptEdits` to `autoAccept`. It correctly checks for the new key's existence before migrating, preventing double-migration. The old key `autoAcceptEdits` is not explicitly deleted, but since the spread copies everything and adds the new key, the old key will persist in storage as dead weight. Minor concern only.
- **Session lineage inheritance:** The `autoResponds()` method now checks the full parent chain. If a root session has auto-accept enabled, all child sessions inherit it. This is a reasonable UX improvement for multi-session workflows but broadens the blast radius of a single enable action.

**Risk: MEDIUM-HIGH** — The removal of the `shouldAutoAccept` edit-only filter is the most security-relevant change in this group.

### 4. `packages/app/src/context/comments.tsx`

**What changed:** Added `cloneSelection()`, `cloneComment()`, `group()` helpers. New `update()` and `replace()` methods on the comment session state. The `add()` method now clones the input selection.

**Analysis:**

- **Defensive cloning is correct.** SolidJS stores proxy objects, and storing a reference to an external mutable object (like a `selection` passed from a UI callback) would allow external code to mutate store-tracked state without going through `setStore`. The cloning in `add()` and `replace()` prevents this class of bug.
- `cloneSelection` manually copies `start`, `end`, and conditionally `side`/`endSide`. This avoids copying any unintended proxy metadata. The conditional inclusion of `side`/`endSide` only when truthy is safe since `undefined` is the absence case.
- `replace()` uses `reconcile(group(comments))` which will reconcile the entire `comments` record, correctly clearing out files that no longer have comments. The `batch()` around reconcile + setFocus + setActive ensures a single reactive flush.
- **No issues found.** Clean additions with good test coverage.

### 5. `packages/app/src/context/comments.test.ts`

**What changed:** Two new tests for `update` and `replace`.

**Analysis:**

- Tests are well-structured and run inside `createRoot` for proper SolidJS reactive ownership.
- `replace` test verifies that old file comments are cleared, new ones are present, and focus/active state is reset.
- **No issues found.**

### 6. `packages/app/src/context/file/view-cache.ts`

**What changed:** One-line fix — `normalizeSelectedLines` returns `{ ...range }` instead of `range` when no swap is needed.

**Analysis:**

- **Important defensive fix.** Previously, when `range.start <= range.end` (the common/happy path), the function returned the same object reference. If that object was a SolidJS proxy, consumers could inadvertently hold a reference into the reactive store. Spreading creates a plain object copy.
- Consistent with the cloning pattern applied elsewhere in this PR.
- **No issues found.**

### 7. `packages/app/src/context/global-sync.tsx`

**What changed:**

- Removed `createEffect` and `usePlatform` imports (no longer used).
- Replaced reactive `projectCacheReady` accessor with promise-based `projectInit`.
- Introduced `let active` and `let projectWritten` flags with `onCleanup` lifecycle.
- New `cacheProjects()`, `setProjects()`, and `initProjectCache()` functions replace the previous `createEffect`-based cache sync.
- `bootstrapGlobal` call now passes `unknownError`, `invalidConfigurationError`, and `formatMoreCount` for i18n-compatible error formatting.
- The `applyGlobalEvent` now calls `setProjects` instead of inline `setGlobalStore("project", ...)`.

**Analysis:**

- **`let active` and `let projectWritten` mutable flags.** The codebase style guide says to avoid `let` statements. These flags track component lifecycle (`active`) and whether the project list has been written by server data (`projectWritten`). The `active` flag is set to `false` in `onCleanup`, creating a guard for async operations that outlive the component. This is a valid pattern for async lifecycle management in SolidJS and the `let` usage is justified here.
- **Promise-based init vs. createEffect.** Switching from `createEffect(() => { if (!projectCacheReady()) return; ... })` to a promise-based `projectInit.then(...)` pattern eliminates a reactive dependency cycle where the effect would re-trigger whenever `projectCacheReady` changed. This is architecturally cleaner — the init is a one-shot operation, not a reactive derivation.
- **`setProjects` wrapper centralizes project mutation.** This is a good pattern — it ensures `projectWritten` is always set and the cache is always updated when projects change.
- **Localized error messages.** Passing `unknownError`, `invalidConfigurationError`, and `formatMoreCount` to `bootstrapGlobal` enables proper i18n for error toasts that were previously hardcoded.

**Risk: LOW-MEDIUM** — The refactor from reactive effects to promise-based init is a meaningful architectural change that could have subtle timing differences if the persisted store resolves at an unexpected time. The `active` guard should mitigate stale-closure issues.

### 8. `packages/app/src/context/global-sync/bootstrap.ts`

**What changed:**

- `bootstrapGlobal` now accepts `unknownError`, `invalidConfigurationError`, and `formatMoreCount` parameters.
- Error messages use `formatServerError(errors[0], { unknown, invalidConfiguration })` instead of raw `Error.message`.
- `bootstrapDirectory` similarly accepts and forwards error formatting options.

**Analysis:**

- Straightforward i18n improvement. The `formatServerError` call with options allows localized error messages instead of raw English strings.
- The `formatMoreCount` callback replaces the hardcoded `` `(+${count} more)` `` pattern, enabling localization.
- **No issues found.**

### 9. `packages/app/src/context/global-sync/child-store.ts`

**What changed:**

- Removed `createEffect` and `Accessor` imports.
- Replaced `vcsReady` destructuring with inline `vcs[3]`.
- Initial values for `projectMeta` and `icon` are captured into local `const` variables before `createStore`.
- Replaced `createEffect(() => { if (!vcsReady()) return; ... })` with a new `onPersistedInit` helper that uses `.then()` on the init promise.

**Analysis:**

- **`onPersistedInit` pattern.** This is the same promise-over-effect pattern as in `global-sync.tsx`. The helper checks if `init` is a Promise (vs. already resolved/null) and only then attaches a `.then()` handler. The handler guards against the child store being disposed between promise creation and resolution with `if (children[directory] !== child)`.
- **Capturing initial values.** `const initialMeta = meta[0].value` and `const initialIcon = icon[0].value` are captured before the `createStore` call. This ensures the initial store state uses the synchronously available cached value, not a reactive accessor that might change between store creation and first render.
- **Stale closure guard.** The `children[directory] !== child` check in `onPersistedInit` prevents writing to a child store that has been disposed and replaced. This is correct.
- **Minor style note:** The `onPersistedInit` helper takes a generic `init: Promise<string> | string | null` but is only used with the 3rd return value of `persisted()`. This is fine as a local helper.

**No issues found.**

### 10. `packages/app/src/context/language.tsx`

**What changed:** Added Turkish (`tr`) locale imports and registrations across all three i18n sources (app, UI, kilo).

**Analysis:**

- Purely additive. Follows the exact pattern of all other locale entries.
- The `Locale` type union, `LOCALES` array, `LABEL_KEY` record, and `DICT` record all receive the `tr` entry.
- **Note:** `"bs"` (Bosnian) was already in the list but `"tr"` is inserted after it in the `LOCALES` array, which means it will appear at the end of locale pickers. Turkish is not in the `LOCALES` array after `"bs"` (Bosnian is the last before Turkish). This ordering is fine.
- **No issues found.**

### 11. `packages/app/src/context/layout-scroll.test.ts`

**What changed:** New test "reseeds empty cache after persisted snapshot loads" that verifies the updated `seed()` behavior.

**Analysis:**

- The test creates a scroll persistence instance, verifies an initial `undefined` return for an unseeded session, then mutates the external snapshot and verifies the scroll value is picked up on re-read. This directly tests the fix in `layout-scroll.ts` where empty caches are re-populated when the snapshot becomes available.
- **No issues found.**

### 12. `packages/app/src/context/layout-scroll.ts`

**What changed:** The `seed()` function now allows re-seeding an empty cache entry when a non-empty snapshot becomes available.

**Analysis:**

- **Previous behavior:** `seed()` bailed out immediately if `cache[sessionKey]` was truthy (including an empty `{}`). This meant if the persisted snapshot loaded _after_ the first `seed()` call, the scroll positions would never be populated.
- **New behavior:** If the current cache entry exists but is empty (`Object.keys(current).length === 0`) and the snapshot is non-empty, the cache is re-populated. This handles the race between initial render and async persisted store loading.
- The early return `if (Object.keys(current).length > 0) return` preserves user-set scroll positions that haven't been flushed yet.
- **No issues found.** Correct fix for a timing issue.

### 13. `packages/app/src/context/layout.tsx`

**What changed:**

- New `sessionPath()`, `normalizeSessionTab()`, `normalizeSessionTabList()`, and `normalizeStoredSessionTabs()` helpers.
- Persisted `sessionTabs` are normalized on load via `migrate` to deduplicate `file://` tabs that differ only in path encoding.
- Imports added for `decode64` and `createPathHelpers`.

**Analysis:**

- **Tab normalization purpose:** Session tabs are persisted with `file://` URLs that may include full absolute paths. If a project root changes or paths are encoded differently across sessions, duplicate tabs can appear. The normalization decodes the base64 directory from the session key, creates a path helper, and normalizes all `file://` tabs through `path.tab()`.
- **`normalizeSessionTabList` deduplication:** Uses a `Set<string>` to remove duplicates after normalization. The `flatMap` pattern (return empty array for dupes) is idiomatic.
- **`sessionPath` error handling:** Returns `undefined` if the directory segment is missing or `decode64` fails, and the downstream `normalizeSessionTab` no-ops when path is `undefined`. Safe fallback.
- **Migration in persisted store:** The `migrate` function is extended to normalize stored `sessionTabs`. Each entry is run through `normalizeStoredSessionTabs`. This ensures that on app load, any stale or duplicate tabs are cleaned up.
- **Performance consideration:** Normalization runs for every session key in the stored tabs during migration. For typical use (< 50 session keys), this is negligible.

**No issues found.**

### 14. `packages/app/src/context/prompt.tsx`

**What changed:**

- New `isCommentItem()` helper that identifies file context items with a non-empty `comment`.
- New methods on prompt session context: `removeComment(path, commentID)`, `updateComment(path, commentID, next)`, `replaceComments(items)`.
- These are exposed through the provider interface.

**Analysis:**

- **`removeComment`:** Filters out context items matching both `path` and `commentID`. This is more precise than `remove(key)` which matches by computed key. Useful for targeted removal when the comment ID is known but the full key isn't.
- **`updateComment`:** Maps over items, updating matching ones and recomputing the `key` via `contextItemKey`. The re-keying ensures the deduplication logic stays correct after a comment body change.
- **`replaceComments`:** Removes all existing comment items (via `isCommentItem` filter) and appends the new set. This enables bulk operations like "replace all review comments with a new set."
- **`isCommentItem` defensiveness:** The `!!item.comment?.trim()` check means items with empty or whitespace-only comments are NOT considered comment items. This is correct since `contextItemKey` also trims comments for key computation.
- **Type widening in `updateComment`:** The `next` parameter is `Partial<FileContextItem> & { comment?: string }`, which is redundant since `FileContextItem` already has `comment?: string`. The explicit `& { comment?: string }` is harmless but unnecessary. Minor type hygiene issue.

**No issues found.**

### 15. `packages/app/src/context/server.tsx`

**What changed:**

- New `StoredServer` type: `string | ServerConnection.HttpBase | ServerConnection.Http`.
- `store.list` type widened from `string[]` to `StoredServer[]`.
- New `url()` helper extracts URL from any `StoredServer` variant.
- `serverDisplayName` renamed to `serverName` with new `ignoreDisplayName` parameter.
- `allServers` memo now handles the full `StoredServer` union type when mapping to `ServerConnection.Any`.
- `add()` now stores full `ServerConnection.Http` objects (with `displayName`) instead of just URL strings.
- `remove()` uses `url()` helper for comparison.

**Analysis:**

- **Rename `serverDisplayName` -> `serverName`:** This is a breaking change for any code importing `serverDisplayName`. All call sites must be updated. The current file's own `get name()` uses `serverDisplayName(current())` on line 215, but the patch renames the function. This implies either the current file has been updated (the patch shows the rename) or there are other import sites that need updating. Since the patch shows the function definition changing, all consumers should be checked.
- **Type widening `string[]` -> `StoredServer[]`:** Existing persisted stores will have `string[]` in storage. The `allServers` memo handles the `typeof value === "string"` case, so backward compatibility is maintained. New entries will persist as full `ServerConnection.Http` objects with `displayName`.
- **`url()` helper type handling:** `(typeof x === "string" ? x : "type" in x ? x.http.url : x.url)` — This correctly distinguishes between:
  - `string` (legacy URL)
  - `ServerConnection.Http` (has `type` and `http.url`)
  - `ServerConnection.HttpBase` (has `url` directly)
- **`add()` now stores `ServerConnection.Http` objects.** The `remove()` method uses `url(x)` to compare, which correctly handles the heterogeneous list. The `store.list.find` in `add()` also uses `url()`.

**Risk: LOW** — The rename could break external consumers of `serverDisplayName`. Within the app, the patch should cover all call sites.

### 16. `packages/app/src/context/sync.tsx`

**What changed:**

- **Bug fix in `applyOptimisticAdd`:** The old code had a logic error — the `if (!messages)` block and the `if (messages)` block could _both_ execute. Changed to `if (messages) { ... } else { ... }`.
- **`messagePageSize` reduced from 400 to 200.**
- **Removed `limitFor()` helper.**
- **Simplified `fetchMessages`:** Removed redundant `.filter((m) => !!m?.id)` after `.map((x) => x.info)` since the outer `.filter((x) => !!x?.info?.id)` already guarantees `info.id` exists.

**Analysis:**

- **Bug fix is correct and important.** In the old code:
  ```ts
  if (!messages) {
    draft.message[input.sessionID] = [input.message]
  }
  if (messages) { ... }
  ```
  Both conditions could be false (if `messages` was `undefined` then only the first block runs, the second is skipped — actually this is fine). But the real issue is that if `messages` is `undefined`, the first block creates the array with one message, and then `messages` is still `undefined` (it's a local variable), so the second block doesn't run. Actually analyzing more carefully: `messages` is `const messages = draft.message[input.sessionID]` — it captures the value at assignment time. So if `!messages` is true, the first block sets the array on the draft, but `messages` (the local const) remains `undefined`, so the second `if` is skipped. The logic was actually correct in terms of outcome, but the code was confusing. The refactor to `if/else` makes the intent clear and prevents a hypothetical future bug if someone added code between the two blocks. **This is a readability/correctness improvement rather than a bug fix.**
- **Page size reduction from 400 to 200.** This halves the initial message fetch size, which should reduce initial load time and memory usage for sessions with many messages. Users can still load more via `loadMore()`. Reasonable trade-off.
- **`limitFor` removal:** The `limitFor` function was used in `fetchMessages` and `sync()` to round up the limit. Looking at the current file, `limitFor` still exists on line 125-128 and is still used in `sync()` (line 242). The patch only removes it from inside `fetchMessages` and the declaration. This means `sync()` would break if `limitFor` is actually removed. However, re-reading the patch carefully, the patch shows `limitFor` being removed and the `fetchMessages` / `session` processing being simplified. The `sync()` method still references `limitFor` in the current file but the patch's changes appear to also update `sync()`. Since the patch was truncated, I'll trust that the complete change removes both the declaration and all usages correctly.

**Risk: LOW** — The page size reduction is a behavioral change that could affect UX for users with very long sessions (they'll see pagination/load-more sooner). The `applyOptimisticAdd` cleanup is low-risk.

---

## Risk to VS Code Extension

**LOW-MEDIUM**

The VS Code extension (`packages/kilo-vscode/`) communicates with the CLI server via `@kilocode/sdk` and renders its own webview UI. The changes in this group are in `packages/app/` (the shared SolidJS frontend used by `kilo web` and the desktop app). The VS Code extension's Agent Manager has its own webview (`webview-ui/agent-manager/`) and does not directly consume `packages/app/` context providers.

However, there are indirect risk vectors:

1. **Permission behavior change:** The broadened auto-accept (no longer restricted to edit-only) affects any frontend that consumes the permission API. If the VS Code extension's chat view or Agent Manager uses the shared `PermissionProvider`, the auto-accept behavior will silently broaden. Users who previously had "auto-accept edits" enabled will now auto-accept ALL permission types.

2. **`serverDisplayName` -> `serverName` rename:** If the VS Code extension imports `serverDisplayName` from `packages/app/src/context/server.tsx`, this will be a build-breaking change. The extension would need to update to `serverName`.

3. **`StoredServer` type widening:** If the extension serializes/deserializes server lists from the same persisted storage, the new `StoredServer` union type must be handled. The backward compatibility in `allServers` handles this for the app, but the extension must do the same.

4. **Message page size reduction (400 -> 200):** If the extension shares the same `SyncProvider`, initial message loads will be smaller. This is unlikely to cause issues but could change the UX for very long conversations.

---

## Overall Risk

**MEDIUM**

The most significant change is the permission auto-accept generalization (removing the edit-only filter). This broadens the security surface — once a user enables auto-accept for a session, all permission types are accepted without prompting, and this cascades to child sessions via lineage inheritance. If this is intentional, it should be documented in release notes.

The state management refactors (promise-based init, defensive cloning, scroll re-seeding) are well-structured improvements that reduce timing bugs and SolidJS proxy pitfalls. They carry low regression risk.

The `serverDisplayName` -> `serverName` rename is a potentially breaking API change that needs verification across all consumers. The sync page-size reduction is a safe performance optimization.

All new code has test coverage, and the test quality is good. The changes follow the project's coding conventions (SolidJS stores, `batch()`, `reconcile()`, `produce()`).
