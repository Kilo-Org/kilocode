# UI Implementation Plan: kilo-vscode adopting @kilocode/kilo-ui

## 1. Executive Summary

### What we are doing

Replace the hand-built UI components in the kilo-vscode webview with components from `@kilocode/kilo-ui`, the shared Solid.js component library already used by the desktop app. This brings the VS Code extension's webview UI to visual and functional parity with the desktop app while eliminating duplicated UI code.

### Why

- **Consistency**: Users get the same look-and-feel whether they use the desktop app or the VS Code extension.
- **Reduced maintenance**: One component library to maintain instead of two divergent implementations.
- **Feature uplift**: Gain markdown rendering, syntax-highlighted code blocks, diff display, accessible dialogs, toast notifications, and i18n — all currently missing from the webview.
- **Design tokens**: The `kilo-vscode` theme in kilo-ui already maps VS Code CSS variables to the design token system via [`vscode-bridge.css`](../../../kilo-ui/src/styles/vscode-bridge.css), so components automatically adapt to the user's VS Code theme.

### High-level approach

1. Wire up the build system to bundle `@kilocode/kilo-ui` into the webview.
2. Wrap the webview entry point with kilo-ui's provider hierarchy.
3. Incrementally replace hand-built components with kilo-ui equivalents, starting with simple primitives and progressing to complex chat components.

---

## 2. Current State

### Webview architecture

The webview is a Solid.js SPA bundled by esbuild into a single IIFE file ([`dist/webview.js`](../esbuild.js:54)) plus a CSS sidecar ([`dist/webview.css`](../esbuild.js:54)). The HTML shell is generated at runtime by [`KiloProvider._getHtmlForWebview()`](../src/KiloProvider.ts:688).

**Provider hierarchy** (in [`App.tsx`](../webview-ui/src/App.tsx:110)):

```
VSCodeProvider → ServerProvider → SessionProvider → AppContent
```

**View routing**: Signal-based (`createSignal<ViewType>`) in [`AppContent`](../webview-ui/src/App.tsx:32), driven by `action` messages from the extension host. Views: `newTask`, `marketplace`, `history`, `profile`, `settings`.

### What is hand-built vs what could use kilo-ui

| Area                                  | Current                                               | kilo-ui available?                                |
| ------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Buttons (send, abort, login, etc.)    | Raw `<button>` + inline styles                        | Yes — `Button`, `IconButton`                      |
| Cards (profile, balance, device auth) | Raw `<div>` + inline styles                           | Yes — `Card`                                      |
| Permission dialog                     | Custom overlay div + CSS                              | Yes — `Dialog`                                    |
| Settings tabs                         | Custom signal-based tab nav (~80 lines inline styles) | Yes — `Tabs`                                      |
| Session list                          | Custom `<div>` items + CSS                            | Yes — `List`                                      |
| Tool call expand/collapse             | Custom toggle buttons                                 | Yes — `Collapsible`, `Accordion`                  |
| Loading indicators                    | Emoji (`⏳`, `⚙️`)                                    | Yes — `Spinner`                                   |
| Code blocks                           | Raw `<pre>` tags                                      | Yes — `Code` (with shiki)                         |
| Markdown rendering                    | **Not implemented** (plain text)                      | Yes — `Markdown`                                  |
| Diff display                          | **Not implemented**                                   | Yes — `Diff`, `DiffChanges`                       |
| Tooltips                              | **Not implemented**                                   | Yes — `Tooltip`                                   |
| Toast notifications                   | **Not implemented**                                   | Yes — `Toast`                                     |
| Icons                                 | `lucide-solid` in Settings; emoji elsewhere           | Yes — `Icon`                                      |
| Theming                               | Raw `--vscode-*` CSS vars                             | Yes — `ThemeProvider` + `kilo-vscode` theme       |
| Settings form controls                | **Not implemented** (14 stub tabs)                    | Yes — `Select`, `Switch`, `Checkbox`, `TextField` |

---

## 3. Target Architecture

### Provider hierarchy after adoption

The existing app-local providers are preserved. kilo-ui providers wrap them at the outer level:

```
ThemeProvider (defaultTheme="kilo-vscode")
└── I18nProvider (locale + translate fn)
    └── DialogProvider
        └── MarkedProvider (optional — Phase 3)
            └── DiffComponentProvider (optional — Phase 3)
                └── CodeComponentProvider (optional — Phase 3)
                    └── VSCodeProvider (existing)
                        └── ServerProvider (existing)
                            └── SessionProvider (existing)
                                └── AppContent
```

The `MarkedProvider`, `DiffComponentProvider`, and `CodeComponentProvider` are only needed once markdown/code/diff rendering components are adopted (Phase 3). The minimal stack for Phase 0–2 is:

```
ThemeProvider → I18nProvider → DialogProvider → [existing providers] → AppContent
```

### HTML template changes

The `<html>` element needs `data-theme="kilo-vscode"` to activate the VS Code bridge CSS:

```html
<html lang="en" data-theme="kilo-vscode"></html>
```

---

## 4. Build System Changes

### 4.1 Dependencies to add to package.json

Add to [`package.json`](../package.json) `dependencies`:

```json
{
  "@kilocode/kilo-ui": "workspace:*",
  "@opencode-ai/ui": "workspace:*",
  "@kobalte/core": "catalog:",
  "@kilocode/sdk": "workspace:*",
  "@opencode-ai/util": "workspace:*"
}
```

`solid-js` is already present. `lucide-solid` can be removed once all 15 icons in [`Settings.tsx`](../webview-ui/src/components/Settings.tsx) are migrated to kilo-ui's `Icon` component (Phase 1, §1.5). This requires adding 6 missing icons to kilo-ui first — see the [Icon Migration](#15-replace-icons-with-icon) section for details.

### 4.2 esbuild.js changes

The webview build context in [`esbuild.js`](../esbuild.js:46) needs two additions:

**a) CSS `@import` resolution for package subpath exports**

kilo-ui's CSS entry point uses `@import "@opencode-ai/ui/styles"` which references a package.json exports subpath. esbuild's CSS bundler may not resolve this automatically. Add a plugin:

```js
const cssPackageResolvePlugin = {
  name: "css-package-resolve",
  setup(build) {
    // Resolve @import in CSS that reference package subpath exports
    build.onResolve({ filter: /^@/, namespace: "file" }, (args) => {
      if (args.kind === "import-rule") {
        // Let esbuild try normal resolution first via the main resolver
        return build.resolve(args.path, {
          kind: "import-statement",
          resolveDir: args.resolveDir,
        })
      }
    })
  },
}
```

**b) Add the plugin to the webview context** (line 56):

```js
plugins: [cssPackageResolvePlugin, solidPlugin(), esbuildProblemMatcherPlugin],
```

> **Note**: If the CSS `@import` resolution proves problematic, a fallback approach is to create a local CSS entry file that imports the resolved paths directly. See [Risks and Mitigations](#7-risks-and-mitigations).

### 4.3 CSP changes in KiloProvider.ts

In [`_getHtmlForWebview()`](../src/KiloProvider.ts:700), add `font-src` to the CSP array:

```ts
const csp = [
  "default-src 'none'",
  `style-src 'unsafe-inline' ${webview.cspSource}`,
  `script-src 'nonce-${nonce}'`,
  `font-src ${webview.cspSource}`, // ← NEW: allow loading bundled fonts
  "connect-src http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
  `img-src ${webview.cspSource} data: https:`,
].join("; ")
```

Also update the HTML template (line 709) to include the theme data attribute:

```html
<html lang="en" data-theme="kilo-vscode"></html>
```

### 4.4 TypeScript config changes

The webview [`tsconfig.json`](../webview-ui/tsconfig.json) already has `moduleResolution: "bundler"` which supports package.json `exports` maps. **No changes needed.**

---

## 5. Implementation Phases

### Phase 0: Foundation — build system + providers

**Goal**: kilo-ui is installed, styles load, providers are wired up, and the webview renders exactly as before (no visual changes yet).

#### Steps

1. **Add dependencies** to [`package.json`](../package.json):
   - `@kilocode/kilo-ui`, `@opencode-ai/ui`, `@kobalte/core`, `@kilocode/sdk`, `@opencode-ai/util`
   - Run `bun install` from the monorepo root

2. **Update [`esbuild.js`](../esbuild.js)** — add the CSS package resolve plugin to the webview build context (see [4.2](#42-esbuildjs-changes))

3. **Update CSP** in [`KiloProvider.ts`](../src/KiloProvider.ts:700) — add `font-src` directive (see [4.3](#43-csp-changes-in-kiloProviderts))

4. **Add `data-theme="kilo-vscode"`** to the `<html>` tag in the HTML template ([`KiloProvider.ts`](../src/KiloProvider.ts:709))

5. **Import kilo-ui styles** in [`index.tsx`](../webview-ui/src/index.tsx):

   ```tsx
   import "@kilocode/kilo-ui/styles"
   ```

   This imports the non-Tailwind variant which includes:
   - Upstream `@opencode-ai/ui` base styles
   - kilo-ui global overrides (font sizes, border radii)
   - 26 component CSS overrides
   - [`vscode-bridge.css`](../../../kilo-ui/src/styles/vscode-bridge.css) (maps `--vscode-*` → design tokens)

6. **Set up provider hierarchy** in [`App.tsx`](../webview-ui/src/App.tsx:110):

   ```tsx
   import { ThemeProvider } from "@kilocode/kilo-ui/theme"
   import { I18nProvider } from "@kilocode/kilo-ui/context"
   import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"

   const App: Component = () => {
     return (
       <ThemeProvider defaultTheme="kilo-vscode">
         <I18nProvider value={{ locale: "en", t: (key) => key }}>
           <DialogProvider>
             <VSCodeProvider>
               <ServerProvider>
                 <SessionProvider>
                   <AppContent />
                 </SessionProvider>
               </ServerProvider>
             </VSCodeProvider>
           </DialogProvider>
         </I18nProvider>
       </ThemeProvider>
     )
   }
   ```

7. **Verify**: Build compiles (`bun run compile`), webview loads in VS Code, existing UI renders unchanged. The kilo-ui styles should coexist with the existing [`chat.css`](../webview-ui/src/styles/chat.css) without conflicts.

#### Acceptance criteria

- `dist/webview.js` and `dist/webview.css` build without errors
- Webview loads and all existing views (chat, history, profile, settings) render correctly
- No CSP violations in the webview developer console
- kilo-ui CSS custom properties are present in the DOM (inspect `<style id="oc-theme">`)

---

### Phase 1: Low-hanging fruit — simple component replacements

**Goal**: Replace the simplest hand-built elements with kilo-ui components. Each replacement is isolated and low-risk.

#### 1.1 Replace buttons with `Button` / `IconButton`

**Files to modify**:

- [`PromptInput.tsx`](../webview-ui/src/components/chat/PromptInput.tsx) — send and abort buttons
- [`PermissionDialog.tsx`](../webview-ui/src/components/chat/PermissionDialog.tsx) — reject, once, always buttons
- [`ProfileView.tsx`](../webview-ui/src/components/ProfileView.tsx) — login, logout, refresh buttons
- [`DeviceAuthCard.tsx`](../webview-ui/src/components/DeviceAuthCard.tsx) — cancel, copy code buttons
- [`Settings.tsx`](../webview-ui/src/components/Settings.tsx) — back button

**Import pattern**:

```tsx
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
```

**Usage example** (replacing a raw button in PermissionDialog):

```tsx
// Before
<button class="permission-btn permission-btn-once" onClick={...}>Allow Once</button>

// After
<Button variant="primary" size="small" onClick={...}>Allow Once</Button>
```

#### 1.2 Replace loading indicators with `Spinner`

**Files to modify**:

- [`Message.tsx`](../webview-ui/src/components/chat/Message.tsx:38) — tool status emoji (`⏳`, `⚙️`)
- [`ChatView.tsx`](../webview-ui/src/components/chat/ChatView.tsx) — any loading states

**Import**:

```tsx
import { Spinner } from "@kilocode/kilo-ui/spinner"
```

#### 1.3 Replace permission overlay with `Dialog`

**File**: [`PermissionDialog.tsx`](../webview-ui/src/components/chat/PermissionDialog.tsx)

The current implementation is a custom overlay `<div>` with CSS. Replace with:

```tsx
import { Dialog } from "@kilocode/kilo-ui/dialog"

<Dialog open={showPermission()} onOpenChange={...}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Permission Required</Dialog.Title>
    </Dialog.Header>
    {/* permission details + buttons */}
  </Dialog.Content>
</Dialog>
```

#### 1.4 Replace cards with `Card`

**Files to modify**:

- [`ProfileView.tsx`](../webview-ui/src/components/ProfileView.tsx) — profile card, balance card
- [`DeviceAuthCard.tsx`](../webview-ui/src/components/DeviceAuthCard.tsx) — auth flow card

**Import**:

```tsx
import { Card } from "@kilocode/kilo-ui/card"
```

#### 1.5 Replace icons with `Icon`

**File**: [`Settings.tsx`](../webview-ui/src/components/Settings.tsx) — all 15 `lucide-solid` icons are used in this single file (settings tab icons). The kilo-ui [`Icon`](../../../kilo-ui/src/components/icon.tsx) component uses a string `name` prop with inline SVG paths.

```tsx
// Before
import { Settings as SettingsIcon } from "lucide-solid"

// After
import { Icon } from "@kilocode/kilo-ui/icon"
;<Icon name="sliders" />
```

##### Prerequisite: Add 6 missing icons to kilo-ui

Before migrating, the following icons must be added to the `icons` map in [`ui/src/components/icon.tsx`](../../../ui/src/components/icon.tsx) (SVG paths can be sourced from Lucide's MIT-licensed icon set, converted to 20×20 viewBox):

- `monitor` — for Display tab
- `bot` — for Autocomplete tab
- `bell` — for Notifications tab
- `users` — for Agent Behaviour tab
- `flask` — for Experimental tab
- `globe` — for Language tab

##### Migration mapping

| Settings Tab    | lucide-solid         | kilo-ui `name`  | Notes                         |
| --------------- | -------------------- | --------------- | ----------------------------- |
| Back button     | `ArrowLeft`          | `arrow-left`    | Exact match                   |
| Providers       | `Plug`               | `providers`     | Semantic match                |
| Terminal        | `SquareTerminal`     | `console`       | Good match                    |
| Prompts         | `MessageSquare`      | `speech-bubble` | Good match                    |
| Checkpoints     | `GitBranch`          | `branch`        | Good match                    |
| Browser         | `SquareMousePointer` | `window-cursor` | Approximate — review visually |
| About           | `Info`               | `help`          | Approximate — `?` vs `i` icon |
| Context         | `Database`           | `server`        | Approximate — review visually |
| Auto-Approve    | `CheckCheck`         | `checklist`     | Approximate — review visually |
| Display         | `Monitor`            | `monitor`       | **New icon needed**           |
| Autocomplete    | `Bot`                | `bot`           | **New icon needed**           |
| Notifications   | `Bell`               | `bell`          | **New icon needed**           |
| Agent Behaviour | `Users2`             | `users`         | **New icon needed**           |
| Experimental    | `FlaskConical`       | `flask`         | **New icon needed**           |
| Language        | `Globe`              | `globe`         | **New icon needed**           |

Once all lucide icons are replaced and the 6 new icons are added to kilo-ui, remove `lucide-solid` from `package.json` dependencies.

#### Acceptance criteria

- 6 missing icons (`monitor`, `bot`, `bell`, `users`, `flask`, `globe`) added to [`ui/src/components/icon.tsx`](../../../ui/src/components/icon.tsx)
- All 15 lucide-solid icons in `Settings.tsx` replaced with kilo-ui `Icon` component
- All buttons use `Button` or `IconButton` with appropriate variants
- Spinners replace emoji loading indicators
- Permission dialog uses `Dialog` component
- Profile/auth cards use `Card` component
- `lucide-solid` dependency removed from `package.json`
- No visual regressions in existing functionality

---

### Phase 2: Settings shell migration

**Goal**: Replace the hand-built settings tab navigation with kilo-ui `Tabs`. The actual settings tab _content_ (form controls, backend wiring) is **out of scope** for this plan — that work belongs to the settings implementation effort, not the kilo-ui integration.

#### 2.1 Replace settings tabs with `Tabs`

**File**: [`Settings.tsx`](../webview-ui/src/components/Settings.tsx)

Replace the custom signal-based tab navigation (~80 lines of inline styles) with:

```tsx
import { Tabs } from "@kilocode/kilo-ui/tabs"
;<Tabs orientation="vertical" variant="settings" defaultValue="providers">
  <Tabs.List>
    <Tabs.SectionTitle>Configuration</Tabs.SectionTitle>
    <Tabs.Trigger value="providers">
      <Icon name="providers" />
      Providers
    </Tabs.Trigger>
    {/* ... more triggers ... */}
  </Tabs.List>
  <Tabs.Content value="providers">
    <ProvidersTab />
  </Tabs.Content>
  {/* ... more content ... */}
</Tabs>
```

#### Note on form components

When settings tabs are eventually implemented, they should use kilo-ui form components (`Select`, `Switch`, `Checkbox`, `TextField`) following the desktop app's patterns. See the desktop app's [`settings-general.tsx`](../../../app/src/components/settings-general.tsx) for reference. The `LanguageTab` already demonstrates this pattern with `Select`.

#### Acceptance criteria

- Settings shell uses `Tabs` with vertical orientation and `variant="settings"`
- Icons use kilo-ui `Icon` component
- Tab switching works correctly

---

### Phase 3: Chat UI enhancement

**Goal**: Upgrade the chat experience with rich content rendering. This is the highest-impact phase for user experience.

#### 3.1 Add content rendering providers

Update [`App.tsx`](../webview-ui/src/App.tsx) to include the content providers:

```tsx
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Code } from "@kilocode/kilo-ui/code"

// Inside the provider hierarchy:
;<MarkedProvider>
  <DiffComponentProvider component={Diff}>
    <CodeComponentProvider component={Code}>{/* ... existing providers ... */}</CodeComponentProvider>
  </DiffComponentProvider>
</MarkedProvider>
```

#### 3.2 Replace markdown rendering

**File**: [`Message.tsx`](../webview-ui/src/components/chat/Message.tsx:15) — `TextPartView`

Currently renders assistant text as plain text. Replace with:

```tsx
import { Markdown } from "@kilocode/kilo-ui/markdown"

// Before
const TextPartView: Component<{ part: TextPart }> = (props) => {
  return <div class="message-text">{props.part.text}</div>
}

// After
const TextPartView: Component<{ part: TextPart }> = (props) => {
  return <Markdown content={props.part.text} />
}
```

This brings: rendered headings, lists, links, inline code, code blocks with syntax highlighting (via shiki), and LaTeX math (via katex).

#### 3.3 Replace code blocks

**File**: [`Message.tsx`](../webview-ui/src/components/chat/Message.tsx:38) — `ToolPartView` (tool input/output display)

Replace raw `<pre>` tags with:

```tsx
import { Code } from "@kilocode/kilo-ui/code"
;<Code language="json" content={toolOutput} />
```

#### 3.4 Adopt chat-specific components

**File**: [`Message.tsx`](../webview-ui/src/components/chat/Message.tsx)

Consider adopting kilo-ui's higher-level chat components:

```tsx
import { MessagePart } from "@kilocode/kilo-ui/message-part"
import { SessionTurn } from "@kilocode/kilo-ui/session-turn"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
```

These components handle the rendering of message parts (text, tool calls, reasoning) with proper styling and interaction patterns. This would replace the custom `TextPartView`, `ToolPartView`, and `ReasoningPartView` components.

**Important**: These components expect data in the format provided by `DataProvider`. A bridge between the current session store format and `DataProvider`'s expected format will be needed:

```tsx
import { DataProvider } from "@kilocode/kilo-ui/context/data"
;<DataProvider data={adaptedSessionData} directory={workspaceDir} onPermissionRespond={handlePermission}>
  {/* chat content */}
</DataProvider>
```

#### 3.5 Adopt `DiffChanges` for file diffs

```tsx
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
```

Use when displaying file modifications from tool calls.

#### 3.6 Replace expand/collapse in tool and reasoning views

**File**: [`Message.tsx`](../webview-ui/src/components/chat/Message.tsx:20) — `ReasoningPartView`, [`Message.tsx`](../webview-ui/src/components/chat/Message.tsx:38) — `ToolPartView`

```tsx
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
;<Collapsible>
  <Collapsible.Trigger>Thinking...</Collapsible.Trigger>
  <Collapsible.Content>{reasoningText}</Collapsible.Content>
</Collapsible>
```

#### Acceptance criteria

- Assistant messages render markdown (headings, lists, code blocks, links)
- Code blocks have syntax highlighting
- Tool call displays use `BasicTool` or `Collapsible` with `Code`
- Reasoning blocks are collapsible
- No regressions in message streaming or auto-scroll behavior

---

### Phase 4: Advanced features

**Goal**: Adopt remaining kilo-ui components for polish and feature completeness.

#### 4.1 Tooltips

```tsx
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
;<Tooltip content="Send message">
  <IconButton onClick={send}>
    <Icon name="send" />
  </IconButton>
</Tooltip>
```

Add tooltips to: send button, abort button, settings tab icons, session list actions.

#### 4.2 Dropdown and context menus

```tsx
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
```

Use for: session list item actions (rename, delete), message actions (copy, retry).

#### 4.3 Toast notifications

```tsx
import { Toast, showToast, toaster } from "@kilocode/kilo-ui/toast"

// Add Toast container to App.tsx
;<Toast />

// Use imperatively
showToast({
  variant: "success",
  icon: "circle-check",
  title: "Session created",
})
```

Use for: connection status changes, error notifications, copy confirmations.

#### 4.4 Session list with `List`

**File**: [`SessionList.tsx`](../webview-ui/src/components/history/SessionList.tsx)

Replace custom list with kilo-ui `List` for keyboard navigation and accessibility:

```tsx
import { List } from "@kilocode/kilo-ui/list"
;<List items={sessions()} onSelect={(session) => onSelectSession(session.id)}>
  {(session) => (
    <List.Item>
      <span>{session.title}</span>
      <span>{formatDate(session.updatedAt)}</span>
    </List.Item>
  )}
</List>
```

#### 4.5 Popover

```tsx
import { Popover } from "@kilocode/kilo-ui/popover"
```

Use for: model selector, mode selector, provider info cards.

#### Acceptance criteria

- Tooltips on all interactive elements
- Context menu on session list items
- Toast notifications for key user actions
- Session list uses `List` with keyboard navigation
- All interactive elements are keyboard-accessible

---

## 6. Component Migration Reference Table

| Current Component             | File                                    | kilo-ui Replacement | Import Path                       |
| ----------------------------- | --------------------------------------- | ------------------- | --------------------------------- |
| Raw `<button>` elements       | Multiple files                          | `Button`            | `@kilocode/kilo-ui/button`        |
| SVG icon buttons              | `PromptInput.tsx`                       | `IconButton`        | `@kilocode/kilo-ui/icon-button`   |
| Emoji spinners (`⏳`, `⚙️`)   | `Message.tsx`                           | `Spinner`           | `@kilocode/kilo-ui/spinner`       |
| Custom overlay dialog         | `PermissionDialog.tsx`                  | `Dialog`            | `@kilocode/kilo-ui/dialog`        |
| Inline-styled cards           | `ProfileView.tsx`, `DeviceAuthCard.tsx` | `Card`              | `@kilocode/kilo-ui/card`          |
| Custom tab navigation         | `Settings.tsx`                          | `Tabs`              | `@kilocode/kilo-ui/tabs`          |
| Custom list items             | `SessionList.tsx`                       | `List`              | `@kilocode/kilo-ui/list`          |
| Custom toggle expand/collapse | `Message.tsx`                           | `Collapsible`       | `@kilocode/kilo-ui/collapsible`   |
| Lucide icons                  | `Settings.tsx`                          | `Icon`              | `@kilocode/kilo-ui/icon`          |
| Plain text messages           | `Message.tsx`                           | `Markdown`          | `@kilocode/kilo-ui/markdown`      |
| Raw `<pre>` code blocks       | `Message.tsx`                           | `Code`              | `@kilocode/kilo-ui/code`          |
| Custom message parts          | `Message.tsx`                           | `MessagePart`       | `@kilocode/kilo-ui/message-part`  |
| Custom tool display           | `Message.tsx`                           | `BasicTool`         | `@kilocode/kilo-ui/basic-tool`    |
| _(not implemented)_           | —                                       | `Tooltip`           | `@kilocode/kilo-ui/tooltip`       |
| _(not implemented)_           | —                                       | `Toast`             | `@kilocode/kilo-ui/toast`         |
| _(not implemented)_           | —                                       | `DropdownMenu`      | `@kilocode/kilo-ui/dropdown-menu` |
| _(not implemented)_           | —                                       | `ContextMenu`       | `@kilocode/kilo-ui/context-menu`  |
| _(not implemented)_           | —                                       | `Select`            | `@kilocode/kilo-ui/select`        |
| _(not implemented)_           | —                                       | `Switch`            | `@kilocode/kilo-ui/switch`        |
| _(not implemented)_           | —                                       | `Checkbox`          | `@kilocode/kilo-ui/checkbox`      |
| _(not implemented)_           | —                                       | `TextField`         | `@kilocode/kilo-ui/text-field`    |
| _(not implemented)_           | —                                       | `DiffChanges`       | `@kilocode/kilo-ui/diff-changes`  |
| _(not implemented)_           | —                                       | `Popover`           | `@kilocode/kilo-ui/popover`       |

---

## 7. Risks and Mitigations

### 7.1 Bundle size impact

**Risk**: kilo-ui brings `@kobalte/core`, `shiki`, `marked`, `katex`, `dompurify`, `luxon`, `morphdom`, `virtua`, and other transitive dependencies. The webview JS bundle could grow significantly.

**Mitigation**:

- kilo-ui uses deep subpath imports — only imported components and their dependencies are bundled (tree-shaking via esbuild).
- Defer heavy dependencies: `shiki`, `marked`, `katex` are only pulled in when `Markdown`/`Code` components are used (Phase 3). Phases 0–2 should have modest bundle growth.
- Monitor bundle size at each phase. esbuild's `metafile` option can generate a bundle analysis.
- Consider lazy-loading the `Markdown` and `Code` components if bundle size becomes problematic.

### 7.2 Tailwind dependency

**Risk**: Some kilo-ui components may use Tailwind utility classes in their JSX. The non-Tailwind CSS entry point (`@kilocode/kilo-ui/styles`) does not process Tailwind utilities.

**Mitigation**:

- Analysis shows only 2 of ~45 upstream `@opencode-ai/ui` component files use Tailwind classes directly (`code.tsx` and `session-turn.tsx`). Most components use `[data-component]` CSS selectors.
- Start with the non-Tailwind path. If specific components render incorrectly, add targeted CSS overrides or consider adding a Tailwind build step later.
- If Tailwind is eventually needed, use the `@tailwindcss/cli` as a pre-build step rather than integrating into esbuild.

### 7.3 CSS specificity conflicts

**Risk**: The existing [`chat.css`](../webview-ui/src/styles/chat.css) (552 lines) may conflict with kilo-ui's component styles, causing visual glitches.

**Mitigation**:

- kilo-ui uses `[data-component]` attribute selectors which are unlikely to collide with the class-based selectors in `chat.css`.
- Migrate incrementally: when a component is replaced, remove its corresponding CSS rules from `chat.css`.
- Keep `chat.css` as a shrinking file — each phase removes sections until it can be deleted entirely.

### 7.4 Breaking changes in upstream @opencode-ai/ui

**Risk**: `@opencode-ai/ui` is under active development. API changes could break kilo-ui and transitively break kilo-vscode.

**Mitigation**:

- kilo-ui acts as a facade — it can absorb upstream API changes by overriding re-exports with custom implementations.
- Pin workspace dependency versions during active development.
- The `kilo-ui` package comment explicitly states: _"All component imports can be individually overridden by replacing the re-export with a custom implementation."_

### 7.5 esbuild CSS @import resolution

**Risk**: esbuild may not resolve `@import "@opencode-ai/ui/styles"` in CSS files via package.json exports maps.

**Mitigation**:

- Test the CSS package resolve plugin described in [4.2](#42-esbuildjs-changes).
- **Fallback**: Create a local CSS file that imports the resolved file paths directly:
  ```css
  /* webview-ui/src/styles/kilo-ui.css */
  @import "../../../kilo-ui/src/styles/index.css";
  ```
  This bypasses package resolution entirely by using relative paths within the monorepo.

### 7.6 Web Workers in VS Code webview

**Risk**: kilo-ui's `WorkerPoolProvider` and shiki's web worker usage may not work in VS Code webviews, which have restrictions on worker script loading.

**Mitigation**:

- Do not set up `WorkerPoolProvider` initially. Syntax highlighting via shiki can run on the main thread (slower but functional).
- If worker support is needed later, bundle the worker script separately and load it via `webview.asWebviewUri()`.

### 7.7 localStorage in webview

**Risk**: kilo-ui's `ThemeProvider` persists theme ID and color scheme to `localStorage`. VS Code webviews have `localStorage` but it may be cleared when the webview is disposed.

**Mitigation**:

- For the VS Code extension, the theme is always `kilo-vscode` and the color scheme follows VS Code's theme. The `ThemeProvider` persistence is a no-op in practice.
- If needed, override persistence by passing `defaultTheme="kilo-vscode"` and not exposing theme switching UI.

---

## 8. Testing Strategy

### Per-phase verification

Each phase has specific acceptance criteria (listed above). The general verification approach:

1. **Build verification**: `bun run compile` succeeds without errors or warnings.
2. **Load verification**: Open the webview in VS Code — no blank screen, no CSP errors in the developer console (`Help > Toggle Developer Tools`).
3. **Visual verification**: Compare before/after screenshots for each modified component.
4. **Functional verification**: Test all interactive elements (buttons click, dialogs open/close, tabs switch, forms submit).
5. **Theme verification**: Test with at least 3 VS Code themes (one light, one dark, one high-contrast) to ensure the `vscode-bridge.css` mappings work correctly.

### Visual regression approach

- **Manual screenshots**: Before starting each phase, capture screenshots of all views (chat, history, profile, settings). After the phase, compare.
- **Automated**: Consider adding Playwright tests that launch VS Code with the extension and capture webview screenshots. This is a stretch goal — manual verification is sufficient for the initial migration.

### Specific test scenarios

| Scenario            | What to verify                                                   |
| ------------------- | ---------------------------------------------------------------- |
| Fresh webview load  | Styles load, no FOUC, providers initialize                       |
| Send a message      | Button works, message appears, streaming works                   |
| Permission dialog   | Dialog opens, buttons work, dialog closes                        |
| Settings navigation | Tabs switch, form controls work                                  |
| Session history     | List renders, selection works, navigation back to chat           |
| Login flow          | Device auth card renders, QR code displays, success/error states |
| Theme switching     | Change VS Code theme → webview updates automatically             |
| Sidebar ↔ tab      | Both webview hosts render identically                            |
| Markdown content    | Headers, lists, code blocks, links render correctly              |
| Long conversations  | Auto-scroll works, performance is acceptable                     |

---

## 9. Progress Tracker

| Phase                        | Status        | Date       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: Foundation          | ✅ Complete   | 2026-02-10 | Build system, CSP, providers, styles wired up. `I18nProvider` locale corrected to accessor. Font loaders (`.woff`, `.woff2`, `.ttf`) added to esbuild. `solidDedupePlugin` added to force single solid-js copy across monorepo.                                                                                                                                                                                                                          |
| Phase 1.1: Buttons           | ✅ Complete   | 2026-02-10 | All buttons in PromptInput, PermissionDialog, ProfileView, DeviceAuthCard, Settings replaced with `Button`. `IconButton` not used — requires named `icon` prop incompatible with inline SVGs. Settings tab sidebar buttons left as native `<button>` (complex active state styling).                                                                                                                                                                     |
| Phase 1.2: Spinners          | ✅ Complete   | 2026-02-10 | Emoji loading indicators (`⏳`, `⚙️`) in Message.tsx and DeviceAuthCard.tsx replaced with `Spinner`. Status icons (`✓`, `✕`) kept as-is.                                                                                                                                                                                                                                                                                                                 |
| Phase 1.3: Permission Dialog | ✅ Complete   | 2026-02-11 | Custom overlay replaced with `Dialog` via `useDialog()` hook + `BasicTool` for collapsible header + `data-component="permission-prompt"` for actions. Removed 7 custom CSS classes. Direct `@kobalte/core` dep removed to avoid dual-package context mismatch.                                                                                                                                                                                           |
| Phase 1.4: Cards             | ✅ Complete   | 2026-02-11 | Inline-styled card divs in ProfileView (profile + balance) and DeviceAuthCard (5 state cards) replaced with `Card` component. Removed `cardStyle` constant.                                                                                                                                                                                                                                                                                              |
| Phase 1.5: Icons             | ✅ Complete   | 2026-02-11 | All 15 lucide-solid icons replaced with kilo-ui `Icon`. `lucide-solid` dep removed. Many icons use approximate matches (see deviation #7).                                                                                                                                                                                                                                                                                                               |
| Phase 2: Settings shell      | ✅ Complete   | 2026-02-11 | Settings shell uses kilo-ui `Tabs` (vertical, `variant="settings"`). ~80 lines of inline styles removed. Icons use `Icon` component. Settings tab _content_ (form controls, backend wiring) is out of scope for this plan. `LanguageTab` demonstrates `Select` usage as reference.                                                                                                                                                                       |
| Phase 3: Chat UI             | ✅ Complete   | 2026-02-11 | Surpassed original plan: `Message.tsx` now uses kilo-ui's higher-level `Message` component (from `@kilocode/kilo-ui/message-part`) which internally handles Markdown, tool calls (BasicTool), reasoning (Collapsible), and more. `DataProvider` bridge in `App.tsx` adapts session store to SDK format. `MarkedProvider` active. `DiffComponentProvider` and `CodeComponentProvider` deferred (not needed while `Message` handles rendering internally). |
| Phase 4.5: Popover           | ✅ Complete   | 2026-02-11 | ModelSelector and ModeSwitcher replaced with kilo-ui `Popover`. Removed ~85 lines of custom CSS (positioning, click-outside, z-index). Popover handles dismiss, positioning, and animations via Kobalte.                                                                                                                                                                                                                                                 |
| I18n system                  | ✅ Complete   | 2026-02-11 | **Beyond original plan.** Full `LanguageProvider` context with 16 locales, 3-layer dictionary merging (app + ui + kilo-i18n), locale resolution (user override → VS Code → browser → "en"), template parameter interpolation. `@kilocode/kilo-i18n` added as dependency.                                                                                                                                                                                 |
| Phase 4.1: Tooltips          | ✅ Complete   | 2026-02-11 | Added `Tooltip` to send/abort buttons (PromptInput), settings back button, and profile refresh button. Uses `value` prop (not `content`) with i18n keys.                                                                                                                                                                                                                                                                                                 |
| Phase 4.3: Toast             | ✅ Complete   | 2026-02-11 | `Toast.Region` added to `App.tsx`. `showToast()` used for copy confirmations in `DeviceAuthCard`. Removed `copied` signal state in favor of toast feedback.                                                                                                                                                                                                                                                                                              |
| Phase 4.4: List              | ✅ Complete   | 2026-02-11 | `SessionList` replaced custom `<div>`-based list with kilo-ui `List` component. Gains keyboard navigation (arrow keys + Enter), fuzzy search on session titles, and `[data-component="list"]` styling. Removed ~55 lines of custom session-list CSS.                                                                                                                                                                                                     |
| CSS cleanup                  | ✅ Complete   | 2026-02-11 | Removed 91 lines: unused `.prompt-send-button`/`.prompt-abort-button` classes (replaced by kilo-ui `Button`), and `.session-item`/`.session-list-empty` classes (replaced by kilo-ui `List`). `chat.css` now at ~306 lines.                                                                                                                                                                                                                              |
| Phase 4.2: Menus             | ⬚ Not started | —          | DropdownMenu + ContextMenu for session list actions (rename, delete) and message actions (copy, retry). Depends on backend supporting these operations.                                                                                                                                                                                                                                                                                                  |

### Deviations from plan

1. **`I18nProvider` locale type**: The plan specified `locale: "en"` (string) but the actual `UiI18n` type requires `Accessor<string>`, so it was implemented as `locale: () => "en"`.
2. **`IconButton` not used**: The plan suggested using `IconButton` for icon-only buttons (send, abort). However, `IconButton` requires a named `icon` prop (not children), making it incompatible with inline SVGs. All buttons use `Button` instead.
3. **Font loaders added to esbuild**: The plan didn't mention font file handling, but kilo-ui's katex dependency bundles `.woff`, `.woff2`, and `.ttf` fonts that needed `file` loaders in esbuild.
4. **`Spinner` has no `size` prop**: The plan assumed `Spinner` would accept a `size` prop. The actual component is sized via CSS `style` prop (`width`/`height`).
5. **Settings tab sidebar buttons**: Left as native `<button>` elements because they have complex active/hover state styling that would need significant rework to use `Button`.
6. **Permission dialog vs inline prompt**: The desktop app renders permissions inline in the prompt dock area (replacing the input). The vscode webview keeps a `Dialog` wrapper because the layout differs. The inner content uses the same `BasicTool` + `data-component="permission-prompt"` pattern as the app. The args are shown as raw JSON rather than `perm.patterns` because the vscode permission data shape differs from the app's SDK format.
7. **Icon mapping uses approximate matches**: kilo-ui only has 38 icons. The plan's mapping assumed icons like `providers`, `console`, `branch`, `server`, `help` exist — they don't. Current mapping uses best-available alternatives (e.g. `cloud-upload` for Providers, `chevron-right` for Terminal). These should be replaced with proper icons once they're added to the UI library.
8. **`solidDedupePlugin` added to esbuild**: Not in the original plan. Needed to force all `solid-js` imports (from kilo-ui and the webview) to resolve to the same copy, otherwise SolidJS contexts can't see each other across packages in the monorepo.
9. **`DataProvider` bridge**: The plan mentioned `DataProvider` as a possibility in Phase 3.4, but the actual implementation builds it as a mandatory bridge in `App.tsx` (`DataBridge` component) that adapts the session store format to what kilo-ui's `Message` component expects.
10. **Higher-level `Message` component**: Instead of individually adopting `Markdown`, `Code`, `BasicTool`, and `Collapsible` as the plan described in Phase 3.1–3.6, the implementation jumped to using kilo-ui's composite `Message` component directly. This is simpler but means the extension is more tightly coupled to kilo-ui's rendering pipeline.
11. **Full i18n system**: The plan's Phase 0 had a trivial `I18nProvider value={{ locale: () => "en", t: (key) => key }}`. The actual implementation is a full multi-locale system with 16 languages, dictionary merging, and the `@kilocode/kilo-i18n` package — this was built as an unplanned but necessary feature.
12. **`chat.css` reduced to ~306 lines** (from 552 in the plan's baseline): Permission dialog CSS (~7 classes), tool/reasoning CSS (~150 lines), popover CSS (~85 lines), session-list CSS (~55 lines), and unused button classes (~35 lines) removed. Settings tab inline styles (~80 lines) eliminated. Remaining CSS covers layout (chat-view, prompt-input, model-selector popover internals, mode-switcher popover internals, permission-details pre formatting).
