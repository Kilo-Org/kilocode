/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { Avatar } from "@opencode-ai/ui/avatar"

const meta: Meta = {
  title: "Components/HoverCard",
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
    <HoverCard
      trigger={
        <a href="#" style={{ color: "var(--text-interactive-base)" }}>
          @opencode
        </a>
      }
    >
      <div style={{ "max-width": "240px" }}>
        <div style={{ display: "flex", gap: "12px", "align-items": "center", "margin-bottom": "8px" }}>
          <Avatar fallback="OC" size="large" />
          <div>
            <div style={{ "font-weight": "600" }}>OpenCode</div>
            <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>@opencode</div>
          </div>
        </div>
        <p style={{ "font-size": "13px", margin: "0" }}>AI-powered coding assistant built for developers.</p>
      </div>
    </HoverCard>
  ),
}

export const WithUserCard: Story = {
  render: () => (
    <HoverCard trigger={<Avatar fallback="JD" background="#1a4d8f" foreground="#ffffff" />}>
      <div style={{ "max-width": "200px", padding: "4px" }}>
        <div style={{ "font-weight": "600", "margin-bottom": "4px" }}>Jane Doe</div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Senior Engineer</div>
      </div>
    </HoverCard>
  ),
}
