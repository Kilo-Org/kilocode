/** @jsxImportSource solid-js */
/**
 * Prototype stories for Agent Manager layout experiments.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, defaultMockData, mockSessionValue } from "./StoryProviders"
import { ChatView } from "../components/chat/ChatView"
import { SessionContext } from "../context/session"
import { WorktreeModeProvider } from "../context/worktree-mode"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import type { Message, Part } from "../types/messages"
import type { JSX } from "solid-js"
import "../../agent-manager/agent-manager.css"
import "../../agent-manager/agent-manager-review.css"

const meta: Meta = {
  title: "Prototypes/AgentManager",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

export const ReadableChatLane: Story = {
  name: "Readable chat lane",
  render: () => <BreakpointGuide />,
}

const MockTab = (props: { title: string; active?: boolean }) => (
  <div class="am-tab-sortable">
    <ContextMenu>
      <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
        <TooltipKeybind title={props.title} keybind="⌘1" placement="bottom" inactive={props.active}>
          <div class={`am-tab ${props.active ? "am-tab-active" : ""}`}>
            <span class="am-tab-label">{props.title}</span>
            <TooltipKeybind title="Close" keybind="⌘W" placement="bottom" class="am-tab-close-wrap">
              <IconButton icon="close-small" size="small" variant="ghost" label="Close" class="am-tab-close" />
            </TooltipKeybind>
          </div>
        </TooltipKeybind>
      </ContextMenu.Trigger>
    </ContextMenu>
  </div>
)

const MockTabsSearchButton = () => (
  <button class="am-tabs-menu-trigger" type="button" aria-label="Search open tabs">
    <svg class="am-tabs-search-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6.8" cy="6.8" r="4.3" />
      <path d="M10.2 10.2L13.5 13.5" />
    </svg>
  </button>
)

const MockTabLeading = () => (
  <div class="am-tab-leading">
    <MockTabsSearchButton />
  </div>
)

const MockTabAdd = () => (
  <div class="am-tab-add-wrap">
    <div class="am-tab-add-separator" />
    <div class="am-split-button am-tab-add-split">
      <TooltipKeybind title="New session" keybind="⌘T" placement="bottom">
        <IconButton icon="plus" size="small" variant="ghost" label="New session" class="am-tab-add" />
      </TooltipKeybind>
    </div>
  </div>
)

// ---------------------------------------------------------------------------
// Prototype - readable Agent Manager chat lanes on wide screens.
// ---------------------------------------------------------------------------

const prototypeSessionID = "story-session-agent-manager-layout"
const prototypeNow = 1_700_000_200_000

const prototypeMessages: Message[] = [
  {
    id: "prototype-user-001",
    sessionID: prototypeSessionID,
    role: "user",
    createdAt: new Date(prototypeNow - 12_000).toISOString(),
    time: { created: prototypeNow - 12_000 },
  },
  {
    id: "prototype-assistant-001",
    sessionID: prototypeSessionID,
    role: "assistant",
    parentID: "prototype-user-001",
    createdAt: new Date(prototypeNow - 9_000).toISOString(),
    time: { created: prototypeNow - 9_000, completed: prototypeNow - 7_000 },
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "default",
    agent: "code",
    path: { cwd: "/project", root: "/project" },
    finish: "stop",
  },
  {
    id: "prototype-user-002",
    sessionID: prototypeSessionID,
    role: "user",
    createdAt: new Date(prototypeNow - 5_000).toISOString(),
    time: { created: prototypeNow - 5_000 },
  },
  {
    id: "prototype-assistant-002",
    sessionID: prototypeSessionID,
    role: "assistant",
    parentID: "prototype-user-002",
    createdAt: new Date(prototypeNow - 3_000).toISOString(),
    time: { created: prototypeNow - 3_000, completed: prototypeNow - 1_000 },
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "default",
    agent: "code",
    path: { cwd: "/project", root: "/project" },
    finish: "stop",
  },
]

const prototypeParts: Record<string, Part[]> = {
  "prototype-user-001": [
    {
      id: "prototype-user-part-001",
      sessionID: prototypeSessionID,
      messageID: "prototype-user-001",
      type: "text",
      text: "The Agent Manager chat is easy to scan on a narrow panel, but on a wide editor the user turn lands far away from the assistant response. Can you propose a readable layout that still leaves room for tool output and diffs?",
    },
  ],
  "prototype-assistant-001": [
    {
      id: "prototype-assistant-part-001",
      sessionID: prototypeSessionID,
      messageID: "prototype-assistant-001",
      type: "text",
      text: [
        "The current transcript uses the entire editor width. That is fine for short tool output, but long explanations become harder to read because each turn starts from a different horizontal edge.",
        "",
        "I would test a bounded reading lane first. It preserves the wide Agent Manager chrome while keeping normal prose near an 80 character line length. The prompt should align with the same lane so the conversation feels like one continuous column rather than separate bubbles floating across the editor.",
        "",
        "```css",
        ".am-chat-wrapper {",
        "  --chat-content-width: 820px;",
        "}",
        "```",
      ].join("\n"),
    },
    {
      id: "prototype-tool-part-001",
      sessionID: prototypeSessionID,
      messageID: "prototype-assistant-001",
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "bun run --cwd packages/kilo-vscode storybook", description: "Start Storybook" },
        output: "Storybook started at http://localhost:6007\nWatching Agent Manager stories for changes...",
        title: "Start Storybook",
        metadata: {},
      },
    },
  ],
  "prototype-user-002": [
    {
      id: "prototype-user-part-002",
      sessionID: prototypeSessionID,
      messageID: "prototype-user-002",
      type: "text",
      text: "Can we compare a fixed reading lane, a character-based line length, and a responsive lane that changes as the editor grows?",
    },
  ],
  "prototype-assistant-002": [
    {
      id: "prototype-assistant-part-002",
      sessionID: prototypeSessionID,
      messageID: "prototype-assistant-002",
      type: "text",
      text: [
        "Yes. The main comparison should answer three questions:",
        "",
        "1. Does the prose stay easy to scan after the editor becomes very wide?",
        "2. Does a character-based width feel more natural than a fixed pixel width?",
        "3. Does the layout still feel intentional as the available space changes?",
        "",
        "The best option should keep prose easy to scan, preserve space for code and tools, and avoid making the reader jump across the editor.",
      ].join("\n"),
    },
  ],
}

const prototypeData = {
  ...defaultMockData,
  message: { [prototypeSessionID]: prototypeMessages },
  part: prototypeParts,
}

const makeSession = (parts: Record<string, Part[]>) => ({
  ...mockSessionValue({ id: prototypeSessionID, status: "idle" }),
  messages: () => prototypeMessages,
  visibleMessages: () => prototypeMessages,
  userMessages: () => prototypeMessages.filter((msg) => msg.role === "user"),
  getParts: (id: string) => parts[id] ?? [],
  currentSession: () => ({
    id: prototypeSessionID,
    title: "Improve Agent Manager chat readability",
    createdAt: new Date(prototypeNow - 12_000).toISOString(),
    updatedAt: new Date(prototypeNow).toISOString(),
  }),
  contextUsage: () => ({ tokens: 11840, percentage: 12 }),
  costBreakdown: () => [{ label: "Session", cost: 0.18 }],
})

const prototypeSession = makeSession(prototypeParts)

const prototypeStyles = `
.am-chat-prototype {
  padding: 16px;
  background: var(--background-base);
}

.am-chat-prototype-frame {
  width: min(1280px, calc(100vw - 32px));
  height: 860px;
  margin: 0 auto;
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--surface-base);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
}

.am-chat-prototype-frame .am-layout {
  flex: 1;
  min-height: 0;
  height: auto;
}

.am-chat-prototype-sidebar {
  width: 248px;
}

.am-chat-prototype-sidebar-note {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-inset-base);
  color: var(--text-weak);
  font-size: var(--kilo-font-size-11);
  line-height: 1.4;
}

.am-chat-prototype-worktree {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-base);
}

.am-chat-prototype-worktree-active {
  background: var(--surface-interactive-base);
  color: var(--text-on-interactive-base);
}

.am-chat-prototype-worktree-title {
  font-size: var(--font-size-base);
  font-weight: 500;
}

.am-chat-prototype-worktree-meta {
  color: var(--text-weaker);
  font-size: var(--kilo-font-size-10);
}

.am-chat-prototype-worktree-active .am-chat-prototype-worktree-meta {
  color: color-mix(in srgb, var(--text-on-interactive-base) 70%, transparent);
}

.am-chat-prototype .am-detail-content {
  flex: 1;
}

.am-chat-prototype .am-chat-wrapper {
  --am-prototype-lane: 820px;
}

.am-chat-prototype .message-list-content {
  width: min(100%, var(--am-prototype-lane));
  margin-inline: auto;
}

.am-chat-prototype .chat-input > * {
  width: min(100%, var(--am-prototype-lane));
  margin-inline: auto;
}

.am-chat-prototype-breakpoint-guide-hybrid {
  width: calc(100vw - 32px);
  margin: 0 auto;
  container-type: inline-size;
}

.am-chat-prototype-breakpoint-guide-hybrid .am-chat-prototype-ruler,
.am-chat-prototype-breakpoint-guide-hybrid .am-chat-prototype-frame {
  width: 100%;
}

.am-chat-prototype-hybrid .am-chat-wrapper {
  --am-hybrid-gutter: 96px;
  --am-hybrid-color: rgba(71, 120, 181, 0.18);
  --am-prototype-lane: min(78ch, calc(100% - var(--am-hybrid-gutter) - var(--am-hybrid-gutter)));
  background: linear-gradient(
    to right,
    var(--am-hybrid-color) 0 var(--am-hybrid-gutter),
    transparent var(--am-hybrid-gutter) calc(100% - var(--am-hybrid-gutter)),
    var(--am-hybrid-color) calc(100% - var(--am-hybrid-gutter)) 100%
  );
  box-shadow:
    inset var(--am-hybrid-gutter) 0 color-mix(in srgb, var(--am-hybrid-color) 38%, transparent),
    inset calc(0px - var(--am-hybrid-gutter)) 0 color-mix(in srgb, var(--am-hybrid-color) 38%, transparent);
}

@container (max-width: 1100px) {
  .am-chat-prototype-hybrid .am-chat-wrapper {
    --am-hybrid-gutter: 64px;
    --am-hybrid-color: rgba(191, 132, 43, 0.18);
    --am-prototype-lane: min(78ch, calc(100% - var(--am-hybrid-gutter) - var(--am-hybrid-gutter)));
  }

  .am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-active {
    background: rgba(191, 132, 43, 0.14);
  }

  .am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-active::before {
    content: "Active: medium / 64px side gutters";
  }

  .am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-segment[data-range="wide"] {
    opacity: 0.48;
    background: color-mix(in srgb, var(--surface-base) 44%, transparent);
    box-shadow: none;
  }

  .am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-segment[data-range="medium"] {
    opacity: 1;
    background: rgba(191, 132, 43, 0.14);
    box-shadow: inset 0 -2px rgba(191, 132, 43, 0.82);
  }
}

@container (max-width: 820px) {
  .am-chat-prototype-hybrid .am-chat-wrapper {
    --am-hybrid-gutter: 32px;
    --am-hybrid-color: rgba(67, 142, 91, 0.18);
    --am-prototype-lane: calc(100% - var(--am-hybrid-gutter) - var(--am-hybrid-gutter));
  }

  .am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-active {
    background: rgba(67, 142, 91, 0.14);
  }

  .am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-active::before {
    content: "Active: compact / 32px side gutters";
  }

  .am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-segment[data-range="medium"] {
    opacity: 0.48;
    background: color-mix(in srgb, var(--surface-inset-base) 20%, transparent);
    box-shadow: none;
  }

  .am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-segment[data-range="compact"] {
    opacity: 1;
    background: rgba(67, 142, 91, 0.14);
    box-shadow: inset 0 -2px rgba(67, 142, 91, 0.82);
  }
}

.am-chat-prototype-breakpoint-guide {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.am-chat-prototype-breakpoint-guide .am-chat-prototype {
  padding: 0;
}

.am-chat-prototype-ruler {
  width: calc(100vw - 32px);
  margin: 0 auto;
  padding: 10px 12px 12px;
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-inset-base) 78%, transparent);
}

.am-chat-prototype-ruler-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
  color: var(--text-weak);
  font-size: var(--kilo-font-size-11);
}

.am-chat-prototype-ruler-header strong {
  color: var(--text-base);
  font-weight: 600;
}

.am-chat-prototype-ruler-active {
  display: none;
}

.am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-active {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border: 1px solid var(--border-weak-base);
  border-radius: 999px;
  background: rgba(71, 120, 181, 0.12);
  color: var(--text-base);
  font-family: var(--font-mono, monospace);
  font-size: var(--kilo-font-size-10);
}

.am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-active::before {
  content: "Active: wide / 96px side gutters";
}

.am-chat-prototype-ruler-track {
  position: relative;
  display: flex;
  height: 42px;
  border-top: 1px solid var(--border-weak-base);
  background-image: repeating-linear-gradient(to right, transparent 0, transparent 23px, color-mix(in srgb, var(--border-weak-base) 60%, transparent) 24px);
}

.am-chat-prototype-ruler-segment {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: flex-end;
  gap: 2px;
  padding: 7px 8px 5px;
  border-left: 1px solid var(--border-weak-base);
  color: var(--text-weak);
  font-size: var(--kilo-font-size-10);
}

.am-chat-prototype-ruler-segment:first-child {
  border-left: 0;
}

.am-chat-prototype-ruler-segment strong {
  color: var(--text-base);
  font-weight: 600;
}

.am-chat-prototype-ruler-segment[data-range="compact"] {
  background: color-mix(in srgb, var(--surface-inset-base) 38%, transparent);
}

.am-chat-prototype-ruler-segment[data-range="medium"] {
  background: color-mix(in srgb, var(--surface-inset-base) 20%, transparent);
}

.am-chat-prototype-ruler-segment[data-range="wide"] {
  background: color-mix(in srgb, var(--surface-base) 44%, transparent);
}

.am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-segment {
  opacity: 0.48;
}

.am-chat-prototype-ruler-hybrid .am-chat-prototype-ruler-segment[data-range="wide"] {
  opacity: 1;
  background: rgba(71, 120, 181, 0.14);
  box-shadow: inset 0 -2px rgba(71, 120, 181, 0.82);
}

.am-chat-prototype-ruler-tick {
  position: absolute;
  top: -5px;
  width: 1px;
  height: 12px;
  background: var(--text-weak);
}

.am-chat-prototype-ruler-tick[data-tick="820"] {
  left: 33.333%;
}

.am-chat-prototype-ruler-tick[data-tick="1100"] {
  left: 66.666%;
}

.am-chat-prototype-ruler-tick-label {
  position: absolute;
  top: -22px;
  transform: translateX(-50%);
  color: var(--text-weaker);
  font-family: var(--font-mono, monospace);
  font-size: var(--kilo-font-size-10);
}

.am-chat-prototype-ruler-tick-label[data-tick="820"] {
  left: 33.333%;
}

.am-chat-prototype-ruler-tick-label[data-tick="1100"] {
  left: 66.666%;
}
`

const PrototypeSidebar = () => (
  <div class="am-sidebar am-chat-prototype-sidebar">
    <button class="am-local-item">
      <Icon name="folder" size="small" class="am-local-icon" />
      <span class="am-local-text">
        <span class="am-local-label">Local repo</span>
        <span class="am-local-branch">main</span>
      </span>
    </button>
    <div class="am-section">
      <div class="am-section-header">
        <span class="am-section-label">Worktrees</span>
      </div>
      <div class="am-worktree-list">
        <div class="am-chat-prototype-worktree am-chat-prototype-worktree-active">
          <span class="am-chat-prototype-worktree-title">feat/chat-layout</span>
          <span class="am-chat-prototype-worktree-meta">2 sessions - +32 -8</span>
        </div>
        <div class="am-chat-prototype-worktree">
          <span class="am-chat-prototype-worktree-title">fix/diff-panel</span>
          <span class="am-chat-prototype-worktree-meta">1 session - +12 -4</span>
        </div>
        <div class="am-chat-prototype-worktree">
          <span class="am-chat-prototype-worktree-title">research/prototype</span>
          <span class="am-chat-prototype-worktree-meta">3 sessions - +6 -1</span>
        </div>
      </div>
    </div>
    <div class="am-section-grow" />
    <div class="am-chat-prototype-sidebar-note">
      Wide-screen prototype. Compare how quickly your eye can return to the next turn.
    </div>
  </div>
)

const PrototypeTabBar = () => (
  <div class="am-tab-bar">
    <MockTabLeading />
    <div class="am-tab-scroll-area">
      <div class="am-tab-list-wrap">
        <div class="am-tab-list" style={{ "--tab-count": "3" } as JSX.CSSProperties}>
          <MockTab title="Improve chat layout" active />
          <MockTab title="Review diff panel" />
          <MockTab title="Run visual tests" />
        </div>
      </div>
    </div>
    <MockTabAdd />
    <div class="am-tab-actions">
      <button class="am-diff-toggle-btn am-diff-toggle-has-changes">
        <Icon name="layers" size="small" />
        <span class="am-diff-toggle-stats">
          <span class="am-stat-files">4f</span>
          <span class="am-stat-additions">+32</span>
          <span class="am-stat-deletions">−8</span>
        </span>
      </button>
      <IconButton icon="console" size="small" variant="ghost" label="Terminal" />
    </div>
  </div>
)

const AgentManagerChatSolution = () => {
  return (
    <StoryProviders data={prototypeData} sessionID={prototypeSessionID} status="idle" noPadding>
      <SessionContext.Provider value={prototypeSession as any}>
        <WorktreeModeProvider>
          <style>{prototypeStyles}</style>
          <div class="am-chat-prototype am-chat-prototype-hybrid">
            <div class="am-chat-prototype-frame">
              <div class="am-layout">
                <PrototypeSidebar />
                <div class="am-detail">
                  <PrototypeTabBar />
                  <div class="am-detail-stack">
                    <div class="am-detail-content">
                      <div class="am-main-pane">
                        <div class="am-chat-wrapper">
                          <ChatView promptBoxId="agent-manager:readable-chat-lane" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </WorktreeModeProvider>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

const BreakpointGuide = () => (
  <div class="am-chat-prototype-breakpoint-guide am-chat-prototype-breakpoint-guide-hybrid">
    <div class="am-chat-prototype-ruler am-chat-prototype-ruler-hybrid">
      <div class="am-chat-prototype-ruler-header">
        <strong>Responsive gutter rules</strong>
        <span class="am-chat-prototype-ruler-active" />
        <span>Resize the Storybook viewport to cross the marked thresholds.</span>
      </div>
      <div class="am-chat-prototype-ruler-track">
        <span class="am-chat-prototype-ruler-tick-label" data-tick="820">
          820px
        </span>
        <span class="am-chat-prototype-ruler-tick-label" data-tick="1100">
          1100px
        </span>
        <span class="am-chat-prototype-ruler-tick" data-tick="820" />
        <span class="am-chat-prototype-ruler-tick" data-tick="1100" />
        <div class="am-chat-prototype-ruler-segment" data-range="compact">
          <strong>&lt; 820px</strong>
          <span>32px gutters</span>
        </div>
        <div class="am-chat-prototype-ruler-segment" data-range="medium">
          <strong>820 - 1100px</strong>
          <span>64px gutters</span>
        </div>
        <div class="am-chat-prototype-ruler-segment" data-range="wide">
          <strong>&gt; 1100px</strong>
          <span>96px gutters</span>
        </div>
      </div>
    </div>
    <AgentManagerChatSolution />
  </div>
)
