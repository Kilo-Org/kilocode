/** @jsxImportSource solid-js */
import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { IconButton } from "../components/icon-button"
import { Tooltip } from "../components/tooltip"

const meta: Meta<typeof IconButton> = {
  title: "Components/IconButton",
  component: IconButton,
  argTypes: {
    variant: { control: "select", options: ["primary", "secondary", "ghost"] },
    size: { control: "select", options: ["small", "normal", "large"] },
    disabled: { control: "boolean" },
  },
}

export default meta
type Story = StoryObj<typeof IconButton>

export const Primary: Story = {
  args: { variant: "primary", icon: "plus-small", "aria-label": "Create" },
}

export const Secondary: Story = {
  args: { variant: "secondary", icon: "edit", "aria-label": "Edit" },
}

export const Ghost: Story = {
  args: { variant: "ghost", icon: "close", "aria-label": "Close" },
}

export const Small: Story = {
  args: { variant: "secondary", size: "small", icon: "magnifying-glass", "aria-label": "Search" },
}

export const Large: Story = {
  args: { variant: "secondary", size: "large", icon: "settings-gear", "aria-label": "Settings" },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <IconButton variant="primary" icon="plus-small" aria-label="Create" />
      <IconButton variant="secondary" icon="edit" aria-label="Edit" />
      <IconButton variant="ghost" icon="close" aria-label="Close" />
      <IconButton variant="secondary" size="small" icon="magnifying-glass" aria-label="Search" />
      <IconButton variant="secondary" size="large" icon="settings-gear" aria-label="Settings" />
      <IconButton variant="primary" disabled icon="trash" aria-label="Delete" />
    </div>
  ),
}

export const States: Story = {
  name: "States and accessibility",
  render: () => {
    const [pressed, setPressed] = createSignal(false)
    return (
      <div
        data-testid="icon-button-states"
        style={{ display: "flex", "flex-direction": "column", gap: "16px", padding: "16px" }}
      >
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <Tooltip value="Create item" placement="top">
            <IconButton icon="plus" variant="primary" aria-label="Create item" data-testid="icon-button-tooltip" />
          </Tooltip>
          <IconButton icon="edit" variant="secondary" aria-label="Edit item" />
          <IconButton icon="close" variant="ghost" aria-label="Close item" />
          <IconButton icon="trash" variant="ghost" aria-label="Delete item" disabled />
          <IconButton icon="refresh" variant="ghost" aria-label="Refresh item" loading />
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
          <span>{pressed() ? "Pressed" : "Idle"}</span>
        </div>
      </div>
    )
  },
}
