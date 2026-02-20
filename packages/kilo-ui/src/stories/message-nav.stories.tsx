/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { MessageNav } from "@opencode-ai/ui/message-nav"
import type { UserMessage } from "@kilocode/sdk/v2"

const meta: Meta = {
  title: "Components/MessageNav",
  decorators: [
    (Story) => (
      <div style={{ "background-color": "var(--background-base)", padding: "8px", width: "280px" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

const mockMessage = (id: string, title: string, additions: number, deletions: number): UserMessage => ({
  id,
  sessionID: "session-1",
  role: "user",
  time: { created: Date.now() },
  agent: "default",
  model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
  summary: {
    title,
    diffs: [{ file: "src/file.ts", before: "", after: "", additions, deletions }],
  },
})

const mockMessages = [
  mockMessage("msg-1", "Add authentication", 45, 12),
  mockMessage("msg-2", "Fix navigation bug", 8, 3),
  mockMessage("msg-3", "Update dependencies", 2, 2),
  mockMessage("msg-4", "Add dark mode support", 120, 45),
]

export const Normal: Story = {
  render: () => (
    <MessageNav
      messages={mockMessages}
      current={mockMessages[1]}
      size="normal"
      onMessageSelect={(msg) => console.log("Selected:", msg.id)}
    />
  ),
}

export const Compact: Story = {
  render: () => (
    <MessageNav
      messages={mockMessages}
      current={mockMessages[0]}
      size="compact"
      onMessageSelect={(msg) => console.log("Selected:", msg.id)}
    />
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px" }}>
      <div>
        <div style={{ "font-size": "12px", color: "var(--text-weak)", "margin-bottom": "8px" }}>Normal</div>
        <MessageNav
          messages={mockMessages}
          current={mockMessages[0]}
          size="normal"
          onMessageSelect={(msg) => console.log("Selected:", msg.id)}
        />
      </div>
      <div>
        <div style={{ "font-size": "12px", color: "var(--text-weak)", "margin-bottom": "8px" }}>Compact</div>
        <MessageNav
          messages={mockMessages}
          current={mockMessages[1]}
          size="compact"
          onMessageSelect={(msg) => console.log("Selected:", msg.id)}
        />
      </div>
    </div>
  ),
}
