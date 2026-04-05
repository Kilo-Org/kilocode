/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Popover } from "@opencode-ai/ui/popover"
import { Button } from "@opencode-ai/ui/button"

const meta: Meta = {
  title: "Components/Popover",
  decorators: [
    (Story) => (
      <div style={{ padding: "64px" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <Popover title="Popover Title" trigger={<Button variant="secondary">Open Popover</Button>}>
      <div style={{ padding: "8px" }}>
        <p>This is popover content. Click outside to close.</p>
      </div>
    </Popover>
  ),
}

export const WithDescription: Story = {
  render: () => (
    <Popover
      title="Settings"
      description="Configure your preferences"
      trigger={<Button variant="secondary">Settings</Button>}
    >
      <div style={{ padding: "8px" }}>
        <p>Settings content goes here.</p>
      </div>
    </Popover>
  ),
}

export const NoTitle: Story = {
  render: () => (
    <Popover trigger={<Button variant="secondary">Open</Button>}>
      <div style={{ padding: "12px" }}>
        <p>Simple popover without title.</p>
      </div>
    </Popover>
  ),
}
