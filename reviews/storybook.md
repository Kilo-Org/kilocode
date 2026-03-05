# Storybook File Group Review -- PR #6622 (OpenCode v1.2.16)

## Files Reviewed

| #   | File                                                                                | Status | +/-  |
| --- | ----------------------------------------------------------------------------------- | ------ | ---- |
| 1   | `packages/storybook/.gitignore`                                                     | added  | +3   |
| 2   | `packages/storybook/.storybook/main.ts`                                             | added  | +66  |
| 3   | `packages/storybook/.storybook/manager.ts`                                          | added  | +11  |
| 4   | `packages/storybook/.storybook/mocks/app/components/dialog-select-model-unpaid.tsx` | added  | +3   |
| 5   | `packages/storybook/.storybook/mocks/app/components/dialog-select-model.tsx`        | added  | +7   |
| 6   | `packages/storybook/.storybook/mocks/app/context/command.ts`                        | added  | +22  |
| 7   | `packages/storybook/.storybook/mocks/app/context/comments.ts`                       | added  | +34  |
| 8   | `packages/storybook/.storybook/mocks/app/context/file.ts`                           | added  | +47  |
| 9   | `packages/storybook/.storybook/mocks/app/context/global-sync.ts`                    | added  | +42  |
| 10  | `packages/storybook/.storybook/mocks/app/context/language.ts`                       | added  | +74  |
| 11  | `packages/storybook/.storybook/mocks/app/context/layout.ts`                         | added  | +41  |
| 12  | `packages/storybook/.storybook/mocks/app/context/local.ts`                          | added  | +41  |
| 13  | `packages/storybook/.storybook/mocks/app/context/permission.ts`                     | added  | +24  |
| 14  | `packages/storybook/.storybook/mocks/app/context/platform.ts`                       | added  | +16  |
| 15  | `packages/storybook/.storybook/mocks/app/context/prompt.ts`                         | added  | +117 |
| 16  | `packages/storybook/.storybook/mocks/app/context/sdk.ts`                            | added  | +25  |
| 17  | `packages/storybook/.storybook/mocks/app/context/sync.ts`                           | added  | +32  |
| 18  | `packages/storybook/.storybook/mocks/app/hooks/use-providers.ts`                    | added  | +23  |
| 19  | `packages/storybook/.storybook/mocks/solid-router.tsx`                              | added  | +20  |
| 20  | `packages/storybook/.storybook/preview.tsx`                                         | added  | +98  |
| 21  | `packages/storybook/.storybook/theme-tool.ts`                                       | added  | +21  |
| 22  | `packages/storybook/debug-storybook.log`                                            | added  | +307 |
| 23  | `packages/storybook/package.json`                                                   | added  | +30  |
| 24  | `packages/storybook/sst-env.d.ts`                                                   | added  | +10  |
| 25  | `packages/storybook/tsconfig.json`                                                  | added  | +16  |

## Summary

This file group introduces a new `packages/storybook/` package that sets up Storybook v10 for the `packages/ui/` component library using `storybook-solidjs-vite`. The setup includes:

- Vite config with Tailwind CSS, SolidJS dedupe, and extensive path aliases to mock out all app-level context providers
- A theme toggle toolbar addon (React-based, as required by Storybook manager API)
- A decorator-based preview that wraps stories in the real `ThemeProvider`, `DialogProvider`, `MarkedProvider`, and `Font` from `@opencode-ai/ui`
- 14 mock files that replace the real app contexts (`useCommand`, `useSDK`, `useSync`, etc.) so UI components can render in isolation
- Standard package scaffolding (`package.json`, `tsconfig.json`, `.gitignore`)

The approach is sound: alias-based module replacement at the Vite level avoids any changes to source code and keeps the mocking layer entirely within the storybook package.

## Detailed Findings

### 1. `debug-storybook.log` -- Committed debug log (Low)

**File:** `packages/storybook/debug-storybook.log` (+307 lines)

A 307-line debug log containing local filesystem paths (`/Users/davidhill/Documents/Local/opencode/...`) is committed. This is clearly a development artifact. The log also shows every `*.stories.tsx` file failing with `CSF: default export must be an object`, which indicates the story files in `packages/ui/` are using a non-standard CSF format that Storybook v10 cannot index -- this is a functional concern documented in the log itself but not addressed.

**Recommendation:** Remove `debug-storybook.log` from the commit and add it to `.gitignore`. The indexing errors logged here should be tracked separately.

---

### 2. `main.ts` -- Vite alias configuration (Low)

**File:** `packages/storybook/.storybook/main.ts` (+66)

The alias list is comprehensive and correctly maps each `@/context/*` and `@/hooks/*` import to its mock. The regex patterns (e.g., `/^@\/context\/local$/`) are appropriately anchored to prevent partial matches. `fs.allow` is correctly broadened to include `../../ui` and `../../app/src` to let Vite serve files from sibling packages.

One minor observation: the alias for `@/context/global-sync` points to `mocks/app/context/global-sync.ts`, but there is no alias for `@/context/global-sdk` -- the real `sdk.tsx` uses `useGlobalSDK` from `./global-sdk`. Since the SDK mock replaces `@/context/sdk` entirely this is fine for direct consumers, but if any UI component in `packages/ui/` ever imports `useGlobalSDK` directly, it will fail at build time. This appears to be currently safe but is fragile.

**No action required** unless `packages/ui/` gains a direct `useGlobalSDK` import.

---

### 3. Mock: `command.ts` -- Missing `options`, `register`, `catalog`, keybinds methods (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/command.ts` (+22)

The real `useCommand()` returns `{ register, trigger, keybind, show, keybinds, suspended, catalog, options }`. The mock only provides `{ options, register, trigger, keybind }`. Missing: `show`, `keybinds` (suspend/resume), `suspended`, `catalog`.

The `keybind()` method in the mock returns raw config strings like `"mod+u"` whereas the real implementation returns formatted display strings via `formatKeybind()` (e.g., `"Ctrl+U"` or the Mac equivalent). This will cause UI components that display keybind hints to show raw config syntax in stories.

**Recommendation:** Add a simple `formatKeybind` approximation or return pre-formatted strings from the mock `keybind()` method for visual accuracy.

---

### 4. Mock: `comments.ts` -- Shape differences from real context (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/comments.ts` (+34)

The mock's `Comment` type uses `selection: { start: number; end: number }` while the real `LineComment` type uses `selection: SelectedLineRange` (same shape). The mock provides `replace()` and a flat `all` signal, whereas the real context provides `list(file)`, `all()`, `add()`, `ready()`, `clearFocus()`, `clearActive()`. The mock's `all` is a signal accessor (not a function returning aggregated results).

For component rendering purposes the shape is likely sufficient, but any story exercising file-scoped comment listing will not match real behavior.

---

### 5. Mock: `file.ts` -- Minimal surface (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/file.ts` (+47)

Exports `selectionFromLines`, `FileSelection`, `SelectedLineRange` types and a minimal `useFile()`. The real context has a much richer API (`tree`, `get`, `load`, `normalize`, `tab`, `pathFromTab`, `scrollTop`, `setScrollTop`, `selectedLines`, `searchFiles`, `searchFilesAndDirectories`, etc.). The mock correctly provides `tab`, `pathFromTab`, `load`, and `searchFilesAndDirectories`.

The `searchFilesAndDirectories` mock uses a hardcoded pool of 5 paths with simple `includes` matching, which is adequate for stories.

---

### 6. Mock: `global-sync.ts` -- Partial data shape (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/global-sync.ts` (+42)

Returns `{ data, child, todo }`. The real `useGlobalSync` has `{ data, set, ready, error, child, bootstrap, updateConfig, project, todo }`. The `child()` mock returns `[store, setStore]` which matches the real signature. However, `data.provider` is inlined as a plain object instead of being reactive via `createStore` -- this means Storybook components that depend on reactive provider updates won't track properly. For static story rendering this is fine.

The model ID `"claude-3-7-sonnet"` appears in at least 4 different mock files (`global-sync.ts`, `local.ts`, `use-providers.ts`, `sdk.ts` by implication). This duplication is a maintenance concern.

---

### 7. Mock: `language.ts` -- Hardcoded i18n dictionary (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/language.ts` (+74)

Provides a flat `Record<string, string>` dictionary and a `useLanguage()` with `t()` doing simple key lookup with template variable support. This avoids pulling in the real i18n infrastructure and all locale dictionaries. The approach is pragmatic.

The `t()` implementation uses regex replacement for `{{var}}` templates which matches the `resolveTemplate` pattern from `@solid-primitives/i18n`. The dictionary coverage appears to include the keys actually used by UI components (prompt placeholders, command labels, etc.).

---

### 8. Mock: `layout.ts` -- Simplified tabs & view (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/layout.ts` (+41)

The real `useLayout()` returns a deeply nested object with `tabs()`, `view()`, `sidebar`, `terminal`, `review`, `fileTree`, `session`, `mobileSidebar`, `projects`, `pendingMessage`, `handoff`, and `ready`. The mock provides only `tabs`, `view` (partial), `fileTree` (stub), and `handoff` (stub).

The mock returns `tabs: () => tabs` and `view: () => view` which means consumers call `useLayout().tabs()` and `useLayout().view()` -- but the real API has `layout.tabs(sessionKey)` (takes a session key argument) and `layout.view(sessionKey)`. The mock's `tabs()` ignores the session key parameter. This is acceptable for single-session story rendering.

---

### 9. Mock: `local.ts` -- Model variant mock differs (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/local.ts` (+41)

The real `useLocal().model` has `current()`, `recent()`, `list()`, `cycle()`, `set()`, `visible()`, `setVisibility()`, `ready()`, and `variant` with `configured()`, `selected()`, `current()`, `list()`, `set()`, `cycle()`. The mock only provides `model.current()`, `model.variant.list()`, `model.variant.current()`, `model.variant.set()`.

The mock's `model.current()` returns a plain object `{ id, name, provider: { id }, variants }` while the real one returns the result of `models.find(key)` which includes the full provider object. Stories showing model details may render slightly different shapes.

---

### 10. Mock: `permission.ts` -- Missing `permissionsEnabled`, `ready`, `respond` (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/permission.ts` (+24)

The real context exports `{ ready, respond, autoResponds, isAutoAccepting, toggleAutoAccept, enableAutoAccept, disableAutoAccept, permissionsEnabled }`. The mock provides only `{ autoResponds, isAutoAccepting, toggleAutoAccept }`. Missing `permissionsEnabled`, `enableAutoAccept`, `disableAutoAccept`, and `respond`. If a UI component checks `permissionsEnabled()` it will crash.

---

### 11. Mock: `platform.ts` -- Type import uses relative path (Info)

**File:** `packages/storybook/.storybook/mocks/app/context/platform.ts` (+16)

Uses `import type { Platform } from "../../../../../app/src/context/platform"` -- a 5-level relative path. This is the only mock that imports the real type directly. It works but is fragile if directory structure changes. The mock correctly implements all required `Platform` fields.

---

### 12. Mock: `prompt.ts` -- Duplicated type definitions (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/prompt.ts` (+117)

This is the largest mock file. It re-declares all the prompt part interfaces (`TextPart`, `FileAttachmentPart`, `AgentPart`, `ImageAttachmentPart`, `ContentPart`, `Prompt`) and utility functions (`clonePart`, `clonePrompt`, `isPromptEqual`, `DEFAULT_PROMPT`) that exist in the real `packages/app/src/context/prompt.tsx`. The mock's `FileAttachmentPart` is missing the `selection?: FileSelection` property that the real one has -- this is a divergence.

The mock's `isPromptEqual` uses `JSON.stringify` comparison whereas the real one uses structural field comparison via `isPartEqual`. Functionally similar but not identical (key ordering sensitivity, etc.).

The `usePrompt()` mock uses module-level `createSignal` calls which means state is shared across all stories in the same test run. This could cause state leakage between stories.

---

### 13. Mock: `sdk.ts` -- Minimal client surface (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/sdk.ts` (+25)

Mocks `session.create`, `session.prompt`, `session.shell`, `session.command`, `session.abort`, and `worktree.create`. The real SDK client has many more methods (`file.read`, `file.list`, `find.files`, `permission.respond`, `permission.list`, `lsp.status`, `session.messages`, `session.diff`, `session.todo`, `session.update`, `session.list`, `session.get`, `global.config.update`, `project.update`). Missing methods will throw at runtime if any story triggers them.

The mock returns `directory` as a plain property whereas the real `useSDK()` uses a getter (`get directory()`). This difference is semantically invisible to consumers.

---

### 14. Mock: `sync.ts` -- Missing `data.config`, `status`, `ready`, `directory`, `absolute` (Low)

**File:** `packages/storybook/.storybook/mocks/app/context/sync.ts` (+32)

The mock's `data` store includes `session`, `permission`, `question`, `session_diff`, `message`, `session_status`, `agent`, `command` -- but is missing `config` (used by `useLocal` to resolve configured model), `path` (used for `directory`/`absolute`), `todo`, `part`, `limit`, `lsp`, `project`, `projectMeta`, `provider`, `icon`, `status`, `sessionTotal`. The real `useSync()` also exposes `status`, `ready`, `project`, `directory`, `absolute`, and the full `session` API with `sync()`, `diff()`, `todo()`, `history`, `fetch()`, `more`, `archive()`.

For basic story rendering this is adequate, but components that access `sync.data.config` or `sync.ready` will get `undefined` / crash.

---

### 15. `preview.tsx` -- Well-structured decorator chain (Info)

**File:** `packages/storybook/.storybook/preview.tsx` (+98)

The decorator wraps every story in `MetaProvider > Font > ThemeProvider > Scheme > DialogProvider > MarkedProvider > Story`. This correctly mirrors the provider nesting in the real app. The `Scheme` component syncs the Storybook globals toolbar with the SolidJS theme context, and also manages `document.documentElement.classList` for light/dark mode CSS. The `GLOBALS_UPDATED` event listener is properly cleaned up with `onCleanup`.

The `initialGlobals: { theme: "dark" }` default is a reasonable choice for development.

---

### 16. `theme-tool.ts` -- React component in SolidJS project (Info)

**File:** `packages/storybook/.storybook/theme-tool.ts` (+21)

Uses `createElement` from React because the Storybook manager UI runs in React (even with a SolidJS framework adapter). The `mode` variable is computed outside the render cycle, so toggling won't re-derive `mode` correctly if React re-renders are batched. In practice this works because `useGlobals` triggers a full re-render on update and the component is simple.

---

### 17. `package.json` -- Dependency versions (Info)

**File:** `packages/storybook/package.json` (+30)

- `react: 18.2.0` and `@types/react: 18.0.25` are pinned for Storybook manager compatibility. React 18.2 is correct for Storybook v10.
- All `@storybook/*` addons are pinned to `^10.2.13`.
- `storybook-solidjs-vite: ^10.0.9` provides the SolidJS framework integration.
- The package `version: "7.0.37"` appears arbitrary -- this is a private package so it doesn't matter, but it's an odd starting version.

---

### 18. `tsconfig.json` -- Configuration (Info)

**File:** `packages/storybook/tsconfig.json` (+16)

Extends `@tsconfig/node22`, sets `jsx: "preserve"` with `jsxImportSource: "solid-js"`, targets ESNext with bundler module resolution. The `include` covers `.storybook/**/*.ts` and `.storybook/**/*.tsx` which matches the project's file layout. `noEmit: true` is correct since Vite handles compilation.

---

### 19. `.gitignore` -- Standard (Info)

**File:** `packages/storybook/.gitignore` (+3)

Ignores `node_modules/`, `storybook-static/`, `.storybook-cache/`. Standard and correct. Should also include `debug-storybook.log` (see finding #1).

---

### 20. `sst-env.d.ts` -- Auto-generated SST types (Info)

**File:** `packages/storybook/sst-env.d.ts` (+10)

Auto-generated by SST. References `../../sst-env.d.ts`. Standard boilerplate, no issues. Missing trailing newline.

---

### 21. `solid-router.tsx` -- Router mock (Info)

**File:** `packages/storybook/.storybook/mocks/solid-router.tsx` (+20)

Provides `useParams` (returns hardcoded `{ dir: "c3Rvcnk=", id: "story-session" }`), `useNavigate` (no-op), `MemoryRouter`, and `Route` (both pass-through). The `dir` value is the base64 encoding of `"story"` which matches the `useLocal` mock's `slug()` return. Consistent.

---

### 22. Component mocks (Info)

**Files:** `dialog-select-model-unpaid.tsx` (+3), `dialog-select-model.tsx` (+7)

Minimal stub components. `DialogSelectModelUnpaid` renders a div placeholder. `ModelSelectorPopover` renders the trigger element with forwarded props. These are adequate for stories that import these components but don't need their real behavior.

## Risk to VS Code Extension

**None.** This entire file group is a new `packages/storybook/` package that is `private: true` and has no runtime dependency relationship with the VS Code extension (`packages/kilo-vscode/`). The Storybook package only consumes `packages/ui/` components and mocks out `packages/app/` contexts. No changes are made to any existing package.

## Overall Risk

**Low.** This is a net-new dev tooling package with no production impact. The only actionable item is removing the committed `debug-storybook.log` file, which contains local filesystem paths. The mocks are reasonable approximations of the real contexts -- they cover the critical surface area needed for story rendering while leaving gaps in less commonly used APIs. The mock accuracy concerns noted above are inherent to this aliasing approach and will naturally surface as stories are added for more complex components.
