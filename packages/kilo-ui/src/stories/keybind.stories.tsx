/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Keybind } from "@opencode-ai/ui/keybind"

const meta: Meta<typeof Keybind> = {
  title: "Components/Keybind",
  component: Keybind,
}

export default meta
type Story = StoryObj<typeof Keybind>

export const Default: Story = {
  args: { children: "⌘K" },
}

export const Combination: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <Keybind>⌘K</Keybind>
      <Keybind>Ctrl+S</Keybind>
      <Keybind>Alt+F4</Keybind>
      <Keybind>⇧⌘P</Keybind>
    </div>
  ),
}
