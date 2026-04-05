/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { IconButton } from "@opencode-ai/ui/icon-button"

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
  args: { variant: "primary", icon: "plus-small" },
}

export const Secondary: Story = {
  args: { variant: "secondary", icon: "edit" },
}

export const Ghost: Story = {
  args: { variant: "ghost", icon: "close" },
}

export const Small: Story = {
  args: { variant: "secondary", size: "small", icon: "magnifying-glass" },
}

export const Large: Story = {
  args: { variant: "secondary", size: "large", icon: "settings-gear" },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <IconButton variant="primary" icon="plus-small" />
      <IconButton variant="secondary" icon="edit" />
      <IconButton variant="ghost" icon="close" />
      <IconButton variant="secondary" size="small" icon="magnifying-glass" />
      <IconButton variant="secondary" size="large" icon="settings-gear" />
      <IconButton variant="primary" disabled icon="trash" />
    </div>
  ),
}
