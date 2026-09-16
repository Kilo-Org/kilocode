/** @jsxImportSource solid-js */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { For } from "solid-js"
import { SessionTab } from "../components/chat/SessionTab"
import { SessionTabSwitcher } from "../components/chat/SessionTabSwitcher"
import type { Activity } from "../utils/session-activity"
import { StoryProviders } from "./StoryProviders"

const rows = [
  {
    id: "refactor",
    title: "Refactor shared search menu styles",
    active: false,
    state: "done" as const,
    stateLabel: "Done",
    pending: false,
  },
  {
    id: "current",
    title: "Run the extension test suite",
    active: true,
    state: "busy" as const,
    stateLabel: "Running",
    pending: false,
  },
  {
    id: "waiting",
    title: "Approve a pending command",
    active: false,
    state: "waiting" as const,
    stateLabel: "Needs input",
    pending: false,
  },
  {
    id: "error",
    title: "Review the failed session",
    active: false,
    state: "error" as const,
    stateLabel: "Error",
    pending: false,
  },
  {
    id: "pending",
    title: "Untitled session",
    active: false,
    state: "idle" as const,
    stateLabel: "Current session",
    pending: true,
  },
  {
    id: "idle",
    title: "Review keyboard navigation behavior",
    active: false,
    state: "idle" as const,
    stateLabel: "Current session",
    pending: false,
  },
]

const noop = () => {}
const focus = () => document.querySelector<HTMLTextAreaElement>('[data-slot="session-prompt-focus-target"]')?.focus()
const meta: Meta = {
  title: "Session Tabs",
  parameters: { layout: "fullscreen" },
}

export default meta
type Story = StoryObj

const states: { state: Activity; title: string }[] = [
  { state: "busy", title: "Running" },
  { state: "waiting", title: "Needs input" },
  { state: "done", title: "Completed" },
  { state: "retry", title: "Retrying" },
  { state: "error", title: "Error" },
  { state: "idle", title: "Idle" },
]

const tabs = (items: typeof states) => (
  <div class="session-tab-bar">
    <div class="am-tab-list" role="tablist" aria-label="Session states" style={{ "--tab-count": items.length }}>
      <For each={items}>
        {(item) => (
          <div class="am-tab-sortable">
            <SessionTab
              title={item.title}
              active={false}
              state={item.state}
              stateLabel={item.title}
              closeTitle="Close tab"
              closeLabel="Close tab"
              role="tab"
              selected={false}
              tabIndex={0}
              onSelect={noop}
              onMiddleClick={noop}
              onClose={noop}
            />
          </div>
        )}
      </For>
    </div>
  </div>
)

const gallery = (groups: (typeof states)[]) => (
  <StoryProviders noPadding>
    <div data-activity-story style={{ padding: "12px", background: "var(--surface-base)" }}>
      <style>{'[data-activity-story] [data-component="spinner"] rect { animation: none !important; }'}</style>
      <For each={groups}>{tabs}</For>
    </div>
  </StoryProviders>
)

export const ActivityStates: Story = {
  name: "Session tabs - all activity states",
  render: () => gallery(states.map((item) => [item])),
}

export const ActivityStates1280: Story = {
  name: "Session tabs - all activity states - 1280px",
  render: () => gallery([states]),
}

export const MultipleSessions: Story = {
  name: "Sidebar session tabs - multiple sessions",
  render: () => gallery([states.slice(0, 3)]),
}

export const MultipleSessions200: Story = {
  name: "Sidebar session tabs - multiple sessions - 200px",
  render: () => gallery([states.slice(0, 3)]),
}

export const SwitcherOpen: Story = {
  name: "Session tab switcher — open",
  render: () => (
    <StoryProviders noPadding>
      <div
        style={{
          display: "flex",
          "min-height": "560px",
          "justify-content": "flex-end",
          "align-items": "flex-start",
          padding: "16px",
          background: "var(--surface-base)",
        }}
      >
        <textarea class="sr-only" aria-label="Chat input" data-slot="session-prompt-focus-target" />
        <div class="session-tab-switcher-wrap">
          <SessionTabSwitcher
            items={() => rows}
            labels={{
              open: "Show open tabs",
              search: "Search open tabs",
              close: "Close tab",
              current: "Current",
              pending: "New",
            }}
            onSelect={noop}
            onRestore={focus}
            onClose={noop}
            defaultOpen
          />
        </div>
      </div>
    </StoryProviders>
  ),
}
