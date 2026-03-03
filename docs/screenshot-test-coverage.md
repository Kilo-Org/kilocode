# Screenshot Test Coverage Analysis

> cc @markijbema

## How screenshot tests work

The visual regression suite in [`packages/kilo-ui/tests/visual-regression.spec.ts`](../packages/kilo-ui/tests/visual-regression.spec.ts) is **fully dynamic**: it fetches the Storybook index at runtime and automatically generates one Playwright screenshot test per story. This means **having a Storybook story is sufficient** to get screenshot coverage — no manual test code is needed.

A handful of non-visual or non-deterministic stories are explicitly skipped:

| Skipped story | Reason |
|---|---|
| `components-font--*` | Injects into `<head>`, no visible content |
| `components-favicon--*` | Injects into `<head>`, no visible content |
| `components-typewriter--*` | Uses `setTimeout` + `Math.random()`, inherently non-deterministic |

---

## `packages/kilo-ui` — primitive component library

### ✅ Components with screenshot coverage (have stories)

accordion, app-icon, avatar, basic-tool, button, card, checkbox, code, collapsible, context-menu, dialog, diff, diff-changes, diff-ssr, dropdown-menu, favicon *(skipped — head-only)*, file-icon, font *(skipped — head-only)*, hover-card, icon, icon-button, image-preview, inline-input, keybind, line-comment, list, logo, markdown, message-nav, message-part, popover, progress, progress-circle, provider-icon, radio-group, resize-handle, select, session-review, session-turn, spinner, sticky-accordion-header, switch, tabs, tag, text-field, toast, tooltip, typewriter *(skipped — non-deterministic)*

### ❌ Components missing screenshot coverage (no stories)

| Component file | Description | Priority |
|---|---|---|
| [`packages/kilo-ui/src/components/dock-prompt.tsx`](../packages/kilo-ui/src/components/dock-prompt.tsx) | Prompt dock shown at the bottom of the chat surface | High |
| [`packages/kilo-ui/src/components/dock-surface.tsx`](../packages/kilo-ui/src/components/dock-surface.tsx) | Container/surface for the dock area | High |

**Recommendation:** Add `packages/kilo-ui/src/stories/dock-prompt.stories.tsx` and `packages/kilo-ui/src/stories/dock-surface.stories.tsx`. No changes to the test runner are needed.

---

## `packages/kilo-vscode` — VS Code extension webview

The extension webview has its own Storybook (configured in [`packages/kilo-vscode/.storybook/`](../packages/kilo-vscode/.storybook/)) and a single composite story file at [`packages/kilo-vscode/webview-ui/src/stories/composite.stories.tsx`](../packages/kilo-vscode/webview-ui/src/stories/composite.stories.tsx).

### ✅ Composite scenarios with screenshot coverage

The existing composite story covers these scenarios:

| Story | What it tests |
|---|---|
| `Glob + Inline Permission` | Tool card with inline permission prompt (glob) |
| `Bash + Inline Permission` | Tool card with inline permission prompt (bash) |
| `Permission Dock` | Non-tool dock-level permission prompt |
| `Tool Cards` | Multiple completed tool cards (read, glob, grep, ls) |
| `Chat Idle` | Prompt input placeholder in idle state |
| `Chat Busy` | Working indicator while agent is running |
| `Multiple Tool Calls` | Several tool calls in one assistant message |
| `Inline Question` | Question tool rendered inline in message flow |

### ❌ Conceptual components/views missing screenshot coverage

The following components exist in the webview but have **no dedicated story** and are not exercised by the composite story:

#### Chat components (`webview-ui/src/components/chat/`)

| Component | Description | Priority |
|---|---|---|
| [`ChatView.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/ChatView.tsx) | Top-level chat panel layout (message list + input) | High |
| [`MessageList.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/MessageList.tsx) | Scrollable list of all session messages | High |
| [`PromptInput.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/PromptInput.tsx) | Rich text prompt input with file mentions, attachments | High |
| [`QuestionDock.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/QuestionDock.tsx) | Bottom dock for agent questions (non-inline) | High |
| [`TaskHeader.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/TaskHeader.tsx) | Header showing current task/session info | Medium |
| [`TaskToolExpanded.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/TaskToolExpanded.tsx) | Expanded tool detail view | Medium |
| [`VscodeSessionTurn.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/VscodeSessionTurn.tsx) | VS Code-specific session turn wrapper | Medium |
| [`KiloNotifications.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/KiloNotifications.tsx) | In-chat notification banners | Medium |
| [`CloudImportDialog.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/CloudImportDialog.tsx) | Dialog for importing cloud sessions | Low |

#### History components (`webview-ui/src/components/history/`)

| Component | Description | Priority |
|---|---|---|
| [`SessionList.tsx`](../packages/kilo-vscode/webview-ui/src/components/history/SessionList.tsx) | List of past sessions in the history panel | High |
| [`CloudSessionList.tsx`](../packages/kilo-vscode/webview-ui/src/components/history/CloudSessionList.tsx) | Cloud-synced session list variant | Medium |

#### Profile components (`webview-ui/src/components/profile/`)

| Component | Description | Priority |
|---|---|---|
| [`ProfileView.tsx`](../packages/kilo-vscode/webview-ui/src/components/profile/ProfileView.tsx) | User profile / account panel | Medium |
| [`DeviceAuthCard.tsx`](../packages/kilo-vscode/webview-ui/src/components/profile/DeviceAuthCard.tsx) | Device authentication card (OAuth flow) | Medium |

#### Settings components (`webview-ui/src/components/settings/`)

| Component | Description | Priority |
|---|---|---|
| [`Settings.tsx`](../packages/kilo-vscode/webview-ui/src/components/settings/Settings.tsx) | Settings panel shell with tab navigation | High |
| [`ProvidersTab.tsx`](../packages/kilo-vscode/webview-ui/src/components/settings/ProvidersTab.tsx) | AI provider configuration tab | High |
| [`AutoApproveTab.tsx`](../packages/kilo-vscode/webview-ui/src/components/settings/AutoApproveTab.tsx) | Auto-approve permissions settings | Medium |
| [`AutocompleteTab.tsx`](../packages/kilo-vscode/webview-ui/src/components/settings/AutocompleteTab.tsx) | Autocomplete feature settings | Medium |
| [`AgentBehaviourTab.tsx`](../packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx) | Agent behaviour configuration | Medium |
| [`DisplayTab.tsx`](../packages/kilo-vscode/webview-ui/src/components/settings/DisplayTab.tsx) | Display/theme settings | Low |
| [`SettingsRow.tsx`](../packages/kilo-vscode/webview-ui/src/components/settings/SettingsRow.tsx) | Reusable settings row layout primitive | Medium |

#### Shared components (`webview-ui/src/components/shared/`)

| Component | Description | Priority |
|---|---|---|
| [`ModelSelector.tsx`](../packages/kilo-vscode/webview-ui/src/components/shared/ModelSelector.tsx) | Model picker dropdown (VS Code variant) | High |
| [`ModeSwitcher.tsx`](../packages/kilo-vscode/webview-ui/src/components/shared/ModeSwitcher.tsx) | Agent mode switcher control | High |
| [`ThinkingSelector.tsx`](../packages/kilo-vscode/webview-ui/src/components/shared/ThinkingSelector.tsx) | Thinking-level selector | Medium |
| [`WorkingIndicator.tsx`](../packages/kilo-vscode/webview-ui/src/components/shared/WorkingIndicator.tsx) | Animated "agent is working" indicator | Medium |

#### Agent Manager webview (`webview-ui/agent-manager/`)

| Component | Description | Priority |
|---|---|---|
| [`AgentManagerApp.tsx`](../packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx) | Root Agent Manager panel layout | High |
| [`FileTree.tsx`](../packages/kilo-vscode/webview-ui/agent-manager/FileTree.tsx) | File tree showing worktree changes | High |
| [`DiffPanel.tsx`](../packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx) | Inline diff panel for reviewing changes | High |
| [`FullScreenDiffView.tsx`](../packages/kilo-vscode/webview-ui/agent-manager/FullScreenDiffView.tsx) | Full-screen diff review view | High |
| [`MultiModelSelector.tsx`](../packages/kilo-vscode/webview-ui/agent-manager/MultiModelSelector.tsx) | Multi-agent model selector | Medium |
| [`ApplyDialog.tsx`](../packages/kilo-vscode/webview-ui/agent-manager/ApplyDialog.tsx) | Dialog for applying agent changes | Medium |
| [`sortable-tab.tsx`](../packages/kilo-vscode/webview-ui/agent-manager/sortable-tab.tsx) | Draggable/sortable agent session tab | Medium |

---

## Summary

| Package | Total components | With coverage | Missing coverage |
|---|---|---|---|
| `packages/kilo-ui` | 50 | 48 | **2** |
| `packages/kilo-vscode` webview | ~30 | 8 (composite) | **~22** |

The biggest gap is in `packages/kilo-vscode` — the composite story covers only 8 high-level scenarios and leaves most individual components untested. Priority targets are: `ChatView`, `MessageList`, `PromptInput`, `SessionList`, `Settings`, `ModelSelector`, `ModeSwitcher`, and the Agent Manager components (`AgentManagerApp`, `FileTree`, `DiffPanel`, `FullScreenDiffView`).
