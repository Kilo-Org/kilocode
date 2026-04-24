---
name: vscode-visual-regression
description: Write Storybook stories and visual regression tests for the Kilo VS Code extension webview UI
---

Use this skill when the user asks you to add visual regression tests, screenshot tests, or Storybook stories for components in `packages/kilo-vscode/`.

# Architecture

The VS Code extension uses **Storybook + Playwright** for visual regression testing:

1. **Storybook stories** define UI scenarios using SolidJS components with mock contexts
2. **Playwright** auto-discovers all stories, renders each in headless Chromium, and compares screenshots against baseline PNGs using `toHaveScreenshot()`
3. **Baselines** are Linux-only Chromium PNGs stored in `tests/visual-regression.spec.ts-snapshots/` (tracked via Git LFS)

The test runner at `tests/visual-regression.spec.ts` is fully automatic — it fetches ALL stories from the Storybook index and creates one Playwright test per story. You do NOT write Playwright test code. You only write stories.

# How to add a visual regression test

## Step 1: Decide which story file to use

Stories live in `packages/kilo-vscode/webview-ui/src/stories/`. Existing files and their scope:

| File                        | Components covered                                       |
| --------------------------- | -------------------------------------------------------- |
| `agent-manager.stories.tsx` | FileTree, DiffPanel, FullScreenDiffView, WorktreeItem    |
| `chat.stories.tsx`          | ChatView, QuestionDock                                   |
| `composite.stories.tsx`     | AssistantMessage with tool cards, permissions, questions |
| `prompt-input.stories.tsx`  | PromptInput (sidebar prompt bar)                         |
| `settings.stories.tsx`      | Settings panel, ProvidersTab                             |
| `history.stories.tsx`       | SessionList                                              |
| `shared.stories.tsx`        | ModelSelector and shared controls                        |

Add to an existing file if the component fits. Create a new file only for a genuinely new component area.

## Step 2: Write the story

Every story file follows this exact structure:

```tsx
/** @jsxImportSource solid-js */
/**
 * Stories for [ComponentName].
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
// Import the component(s) under test
import { MyComponent } from "../components/path/MyComponent"

const meta: Meta = {
  title: "MyCategory", // Becomes the snapshot subdirectory name (lowercased)
  parameters: { layout: "padded" }, // or "fullscreen"
}
export default meta
type Story = StoryObj

export const MyStoryName: Story = {
  name: "MyComponent — description of variant",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <MyComponent someProp="value" />
      </div>
    </StoryProviders>
  ),
}
```

### Key rules

- **Always start with `/** @jsxImportSource solid-js \*/`\*\* — required for SolidJS JSX compilation.
- **Always wrap in `<StoryProviders>`** — provides all required contexts (VSCode, Server, Config, Provider, Session, I18n, Dialog, Marked, Data, Diff, Code). Without it, components that call `useVSCode()`, `useSession()`, etc. will throw.
- **Do NOT set an explicit `width` on the wrapper div.** The Playwright viewport is already 420px wide (or 200px for narrow stories). Setting `width: "420px"` leaves no room for a vertical scrollbar and causes right-side cropping in screenshots. Let the viewport control the width.
- **Use `max-height` not `height` for the wrapper div** when you need to constrain vertical size. A fixed `height` forces a scrollbar even when content is short; `max-height` avoids unnecessary scrollbars that would eat into the available horizontal space.
- **Meta `title`** determines the snapshot subdirectory. Use PascalCase or slash-notation (e.g., `"Composite/Webview"`). Playwright transforms it: `"Composite/Webview"` becomes `composite-webview/` in the snapshots folder.
- **Export name** determines the story ID. The Storybook ID is `{lowercase-title}--{kebab-export-name}`. For example, `title: "Chat"` + `export const ChatViewIdle` produces ID `chat--chat-view-idle`.
- **Snapshot path** is derived automatically: `tests/visual-regression.spec.ts-snapshots/{title-slug}/{variant-slug}.png`. Example: `chat/chat-view-idle-chromium-linux.png`.

### StoryProviders props

```tsx
interface StoryProvidersProps {
  data?: any // Override mock data (messages, parts, permissions, etc.)
  permissions?: PermissionRequest[] // Active permission requests
  questions?: QuestionRequest[] // Active question requests
  status?: string // Session status: "idle" | "busy"
  sessionID?: string // Custom session ID
  noPadding?: boolean // Skip the default 12px padding wrapper
}
```

### Overriding session state

For stories that need custom session behavior (messages, agents, model overrides), use `mockSessionValue()` and override the `SessionContext`:

```tsx
import { mockSessionValue } from "./StoryProviders"
import { SessionContext } from "../context/session"

export const MyCustomStory: Story = {
  name: "Component — custom state",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "my-session", status: "idle" }),
      messages: () => [{ id: "msg-001" }] as any[],
      totalCost: () => 0.0023,
    }
    return (
      <StoryProviders sessionID="my-session" status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <MyComponent />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}
```

### Overriding data context (messages, parts, permissions)

For stories showing assistant messages with tool parts or permissions, build a custom `data` object:

```tsx
import { defaultMockData } from "./StoryProviders"

const SESSION_ID = "story-session-001"
const ASST_MSG_ID = "asst-msg-001"

// Build mock message + parts
const baseMessage = {
  id: ASST_MSG_ID,
  sessionID: SESSION_ID,
  role: "assistant",
  // ... see composite.stories.tsx for full shape
}

const myPart = {
  id: "part-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  tool: "read",
  // ... see composite.stories.tsx for full ToolPart shape
}

function dataWith(parts: any[], permissions?: PermissionRequest[]) {
  return {
    ...defaultMockData,
    message: { [SESSION_ID]: [baseMessage] },
    part: { [ASST_MSG_ID]: parts },
    permission: permissions ? { [SESSION_ID]: permissions } : {},
  }
}

export const MyToolStory: Story = {
  name: "Tool — with custom parts",
  render: () => (
    <StoryProviders data={dataWith([myPart])} sessionID={SESSION_ID}>
      <AssistantMessage message={baseMessage} />
    </StoryProviders>
  ),
}
```

## Step 3: Handle narrow viewports

For components that should be tested at multiple widths, create separate stories. Stories whose Storybook ID ends in `-200` are automatically rendered at 200px width by the test runner:

```tsx
export const Default420: Story = {
  name: "Default — 420px",
  render: () => (
    <StoryProviders>
      <MyComponent />
    </StoryProviders>
  ),
}

export const Default200: Story = {
  name: "Default — 200px", // Storybook ID will end in -200
  render: () => (
    <StoryProviders>
      <MyComponent />
    </StoryProviders>
  ),
}
```

The naming convention with `-200` suffix on the **export name** (e.g., `Default200`) produces the ID `mycategory--default-200`, which the test runner detects and uses a 200px viewport for.

## Step 4: Handle animations / non-deterministic content

The test runner injects CSS to disable all animations and transitions. If a story still produces non-deterministic frames (e.g., a spinner captured at a random rotation), add the story ID to the `SKIP` set in `tests/visual-regression.spec.ts`:

```ts
const SKIP = new Set<string>(["agentmanager--worktree-item-busy"])
```

Only skip stories as a last resort. Prefer making the story deterministic (e.g., use a static state instead of an animated one).

## Step 5: Generate baseline images

Baselines are generated on **Linux CI only** (font rendering differs on macOS). The CI workflow at `.github/workflows/visual-regression.yml` auto-runs `bun run test:visual:update` and commits new baselines to the PR branch.

**You do NOT need to generate baseline PNGs locally.** Just write the story, push, and CI handles the rest.

To preview stories locally:

```bash
# From packages/kilo-vscode/
bun run storybook
# Opens at http://localhost:6007
```

# Reference: snapshot directory structure

Snapshots live at `packages/kilo-vscode/tests/visual-regression.spec.ts-snapshots/`:

```
tests/visual-regression.spec.ts-snapshots/
  {title-slug}/
    {variant-slug}-chromium-linux.png
```

The title-slug is derived from the meta `title` (lowercased, slashes become hyphens). The variant-slug is derived from the story export name (kebab-cased). Chromium and Linux suffixes are appended by Playwright.

Example mapping:

| Meta title            | Export name          | Snapshot path                                               |
| --------------------- | -------------------- | ----------------------------------------------------------- |
| `"Chat"`              | `ChatViewIdle`       | `chat/chat-view-idle-chromium-linux.png`                    |
| `"Composite/Webview"` | `GlobWithPermission` | `composite-webview/glob-with-permission-chromium-linux.png` |
| `"Prompt Input"`      | `Default200`         | `prompt-input/default-200-chromium-linux.png`               |
| `"AgentManager"`      | `WorktreeItemActive` | `agentmanager/worktree-item-active-chromium-linux.png`      |

# Reference: Playwright config

Key settings in `packages/kilo-vscode/playwright.config.ts`:

- Default viewport: **420x720** (VS Code sidebar dimensions)
- Narrow stories (ID ending `-200`): **200x720**
- Max pixel diff ratio: **0.01** (1% tolerance)
- Browser: **Chromium only**
- Storybook: built and served statically on port **6007**
- Animations: forced off via `reducedMotion: "reduce"` + injected CSS

# Reference: CI pipeline

The `visual-regression.yml` workflow triggers on PRs when these paths change:

- `packages/kilo-ui/**`
- `packages/ui/**`
- `packages/util/**`
- `packages/sdk/js/**`
- `packages/kilo-vscode/webview-ui/**`
- `packages/kilo-vscode/.storybook/**`
- `packages/kilo-vscode/tests/visual-regression*`
- `.github/workflows/visual-regression.yml`

CI auto-commits new baselines via Git LFS and fails if screenshots changed, requiring developer review.

# Reference: import paths

Sidebar webview components live in `webview-ui/src/components/` and are imported relative to the stories directory:

```tsx
import { ChatView } from "../components/chat/ChatView"
import { PromptInput } from "../components/chat/PromptInput"
import { AssistantMessage } from "../components/chat/AssistantMessage"
```

Agent Manager components live in `webview-ui/agent-manager/` (one level up from the stories dir):

```tsx
import { FileTree } from "../../agent-manager/FileTree"
import { DiffPanel } from "../../agent-manager/DiffPanel"
import { WorktreeItem } from "../../agent-manager/WorktreeItem"
import "../../agent-manager/agent-manager.css" // Required for AM component styles
```

kilo-ui components are imported via deep subpaths:

```tsx
import { Part } from "@kilocode/kilo-ui/message-part"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { Button } from "@kilocode/kilo-ui/button"
```

SDK types for mock data:

```tsx
import type { AssistantMessage as SDKAssistantMessage, TextPart, ToolPart } from "@kilocode/sdk/v2"
import type { PermissionRequest, QuestionRequest } from "../types/messages"
```

# Reference: Storybook theme globals

The test runner renders every story with dark theme globals:

```
globals=colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern
```

The `.storybook/preview.tsx` applies these via a decorator that calls `applyVscodeTheme()` / `applyKiloTheme()` from kilo-ui. Stories do NOT need to handle theming — it happens automatically.

# Reference: tool override registration

If your story renders `AssistantMessage` with tool parts, you may need to register VS Code tool overrides at the top of the file (outside any story), as done in `composite.stories.tsx`:

```tsx
import { registerVscodeToolOverrides } from "../components/chat/VscodeToolOverrides"
registerVscodeToolOverrides()
```

This ensures tool cards like `bash` render with their VS Code-specific expanded/collapsed behavior.

# Checklist for adding a new visual regression test

1. Identify or create the story file in `webview-ui/src/stories/`
2. Import the component and `StoryProviders` (and optionally `mockSessionValue`, `defaultMockData`)
3. Write the story with explicit dimensions and mock data
4. Wrap in `<StoryProviders>` with appropriate props
5. If testing multiple widths, create separate exports with the `-200` suffix convention
6. If the component has animated states, prefer a static variant or add to the SKIP set
7. Push to PR — CI generates baseline PNGs automatically
8. Review the auto-committed baseline images in the PR diff
