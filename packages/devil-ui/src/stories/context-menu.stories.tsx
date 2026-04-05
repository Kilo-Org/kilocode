/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { ContextMenu } from "@opencode-ai/ui/context-menu"

const meta: Meta = {
  title: "Components/ContextMenu",
  decorators: [
    (Story) => (
      <div style={{ padding: "64px", display: "flex", "justify-content": "center" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenu.Trigger>
        <div
          style={{
            padding: "32px 48px",
            border: "1px dashed var(--border-base)",
            "border-radius": "4px",
            color: "var(--text-weak)",
            "font-size": "13px",
          }}
        >
          Right-click here
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Item>Cut</ContextMenu.Item>
          <ContextMenu.Item>Copy</ContextMenu.Item>
          <ContextMenu.Item>Paste</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item>Select All</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  ),
}

export const WithGroups: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenu.Trigger>
        <div
          style={{
            padding: "32px 48px",
            border: "1px dashed var(--border-base)",
            "border-radius": "4px",
            color: "var(--text-weak)",
            "font-size": "13px",
          }}
        >
          Right-click for file menu
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Group>
            <ContextMenu.GroupLabel>Edit</ContextMenu.GroupLabel>
            <ContextMenu.Item>Rename</ContextMenu.Item>
            <ContextMenu.Item>Move to...</ContextMenu.Item>
          </ContextMenu.Group>
          <ContextMenu.Separator />
          <ContextMenu.Item>Delete</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  ),
}
