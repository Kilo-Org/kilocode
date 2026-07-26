/** @jsxImportSource solid-js */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { SessionTabSwitcher } from "../components/chat/SessionTabSwitcher"
import { StoryProviders } from "./StoryProviders"

const rows = [
  { id: "refactor", title: "Refactor shared search menu styles", active: false, busy: false, pending: false },
  { id: "current", title: "Run the extension test suite", active: true, busy: true, pending: false },
  { id: "pending", title: "Untitled session", active: false, busy: false, pending: true },
  { id: "idle", title: "Review keyboard navigation behavior", active: false, busy: false, pending: false },
]

const noop = () => {}
const focus = () => document.querySelector<HTMLTextAreaElement>('[data-slot="session-prompt-focus-target"]')?.focus()
const meta: Meta = {
  title: "Session Tabs",
  parameters: { layout: "fullscreen" },
}

export default meta
type Story = StoryObj

export const SwitcherOpen: Story = {
  name: "Session tab switcher — open",
  render: () => (
    <StoryProviders noPadding>
      <div
        style={{
          display: "flex",
          "min-height": "420px",
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
              busy: "Working",
            }}
            onSelect={noop}
            onRestore={focus}
            onClose={noop}
            defaultOpen
            portal={false}
          />
        </div>
      </div>
    </StoryProviders>
  ),
}
