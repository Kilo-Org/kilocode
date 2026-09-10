/** @jsxImportSource solid-js */
import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"

const meta: Meta = {
  title: "IconButton",
  parameters: {
    layout: "centered",
  },
}

export default meta
type Story = StoryObj

export const States: Story = {
  name: "Shared states",
  render: () => {
    const [pressed, setPressed] = createSignal(false)
    const [activated, setActivated] = createSignal(false)
    return (
      <div
        data-testid="icon-button-states"
        style={{ display: "flex", "flex-direction": "column", gap: "16px", padding: "16px" }}
      >
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <Tooltip value="Create item" placement="top" openDelay={0}>
            <IconButton
              icon="plus"
              variant="primary"
              aria-label="Create item"
              data-testid="icon-button-tooltip"
              onClick={() => setActivated(true)}
            />
          </Tooltip>
          <IconButton icon="edit" variant="secondary" aria-label="Edit item" />
          <IconButton icon="close" variant="ghost" aria-label="Close item" />
          <IconButton icon="trash" variant="ghost" aria-label="Delete item" disabled />
          <IconButton icon="refresh" variant="ghost" aria-label="Refresh item" loading />
          <IconButton icon="layers" variant="ghost" aria-label="Show changes" data-testid="icon-button-with-content">
            <span>4f</span>
          </IconButton>
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <IconButton icon="database" variant="ghost" aria-label="Indexing" />
          <IconButton icon="globe" variant="ghost" aria-label="Browser" />
          <IconButton icon="wand-sparkles" variant="ghost" aria-label="Enhance" />
          <IconButton icon="send" variant="ghost" aria-label="Send" />
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <IconButton
            icon="layers"
            variant="ghost"
            aria-label="Toggle changes"
            aria-pressed={pressed()}
            data-active={pressed() ? "" : undefined}
            onClick={() => setPressed(!pressed())}
          />
          <span data-testid="icon-button-status">{activated() ? "Activated" : pressed() ? "Pressed" : "Idle"}</span>
        </div>
      </div>
    )
  },
}
