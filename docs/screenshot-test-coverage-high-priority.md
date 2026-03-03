# High-Priority Screenshot Test Coverage Gaps

> cc @markijbema

The visual regression suite auto-generates one Playwright screenshot test per Storybook story.
The components below have **no story** and therefore **no screenshot coverage**.
These are the highest-priority gaps to address.

---

## `packages/kilo-ui` — primitive component library

| Component | File | Why it matters |
|---|---|---|
| DockPrompt | `packages/kilo-ui/src/components/dock-prompt.tsx` | Prompt dock shown at the bottom of the chat surface — core UX surface |
| DockSurface | `packages/kilo-ui/src/components/dock-surface.tsx` | Container/surface for the dock area — wraps DockPrompt |

**Fix:** Add `packages/kilo-ui/src/stories/dock-prompt.stories.tsx` and `packages/kilo-ui/src/stories/dock-surface.stories.tsx`. No changes to the test runner are needed.

---

## `packages/kilo-vscode` webview — chat components

| Component | File | Why it matters |
|---|---|---|
| ChatView | `packages/kilo-vscode/webview-ui/src/components/chat/ChatView.tsx` | Top-level chat panel — the main user-facing surface |
| MessageList | `packages/kilo-vscode/webview-ui/src/components/chat/MessageList.tsx` | Scrollable list of all session messages |
| PromptInput | `packages/kilo-vscode/webview-ui/src/components/chat/PromptInput.tsx` | Rich text prompt input with file mentions and attachments |
| QuestionDock | `packages/kilo-vscode/webview-ui/src/components/chat/QuestionDock.tsx` | Bottom dock for agent questions (non-inline variant) |

## `packages/kilo-vscode` webview — history

| Component | File | Why it matters |
|---|---|---|
| SessionList | `packages/kilo-vscode/webview-ui/src/components/history/SessionList.tsx` | List of past sessions — primary navigation surface |

## `packages/kilo-vscode` webview — settings

| Component | File | Why it matters |
|---|---|---|
| Settings | `packages/kilo-vscode/webview-ui/src/components/settings/Settings.tsx` | Settings panel shell with tab navigation |
| ProvidersTab | `packages/kilo-vscode/webview-ui/src/components/settings/ProvidersTab.tsx` | AI provider configuration — frequently changed by users |

## `packages/kilo-vscode` webview — shared controls

| Component | File | Why it matters |
|---|---|---|
| ModelSelector | `packages/kilo-vscode/webview-ui/src/components/shared/ModelSelector.tsx` | Model picker dropdown — appears in every session |
| ModeSwitcher | `packages/kilo-vscode/webview-ui/src/components/shared/ModeSwitcher.tsx` | Agent mode switcher — prominent control in the chat header |

## `packages/kilo-vscode` webview — Agent Manager

| Component | File | Why it matters |
|---|---|---|
| AgentManagerApp | `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx` | Root Agent Manager panel — entire multi-agent orchestration UI |
| FileTree | `packages/kilo-vscode/webview-ui/agent-manager/FileTree.tsx` | File tree showing worktree changes per agent |
| DiffPanel | `packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx` | Inline diff panel for reviewing agent changes |
| FullScreenDiffView | `packages/kilo-vscode/webview-ui/agent-manager/FullScreenDiffView.tsx` | Full-screen diff review — critical review surface |

---

## How to add coverage

For each component above, add a Storybook story file alongside the component. The test runner in `packages/kilo-ui/tests/visual-regression.spec.ts` and `packages/kilo-vscode` pick up all stories automatically — no changes to the test runner are needed.
