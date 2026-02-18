/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"

const meta: Meta = {
  title: "Components/Tooltip",
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <Tooltip value="This is a tooltip">
      <Button variant="secondary">Hover me</Button>
    </Tooltip>
  ),
}

export const ForceOpen: Story = {
  render: () => (
    <Tooltip value="Always visible tooltip" forceOpen>
      <Button variant="secondary">Force open</Button>
    </Tooltip>
  ),
}

export const WithKeybind: Story = {
  render: () => (
    <TooltipKeybind title="Open Command Palette" keybind="⌘K">
      <IconButton variant="ghost" icon="magnifying-glass-menu" />
    </TooltipKeybind>
  ),
}

export const Placement: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", padding: "64px", "flex-wrap": "wrap" }}>
      <Tooltip value="Top tooltip" placement="top" forceOpen>
        <Button variant="secondary">Top</Button>
      </Tooltip>
      <Tooltip value="Bottom tooltip" placement="bottom" forceOpen>
        <Button variant="secondary">Bottom</Button>
      </Tooltip>
      <Tooltip value="Left tooltip" placement="left" forceOpen>
        <Button variant="secondary">Left</Button>
      </Tooltip>
      <Tooltip value="Right tooltip" placement="right" forceOpen>
        <Button variant="secondary">Right</Button>
      </Tooltip>
    </div>
  ),
}
