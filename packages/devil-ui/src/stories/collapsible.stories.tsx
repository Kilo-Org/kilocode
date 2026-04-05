/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Collapsible } from "@opencode-ai/ui/collapsible"

const meta: Meta = {
  title: "Components/Collapsible",
  decorators: [
    (Story) => (
      <div style={{ width: "320px" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

export const Normal: Story = {
  render: () => (
    <Collapsible variant="normal" defaultOpen>
      <Collapsible.Trigger>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", width: "100%", padding: "8px" }}>
          <Collapsible.Arrow />
          <span>Normal Collapsible</span>
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div style={{ padding: "8px 16px" }}>
          <p>This is the collapsible content. Click the trigger to collapse.</p>
        </div>
      </Collapsible.Content>
    </Collapsible>
  ),
}

export const Ghost: Story = {
  render: () => (
    <Collapsible variant="ghost" defaultOpen>
      <Collapsible.Trigger>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", width: "100%", padding: "8px" }}>
          <Collapsible.Arrow />
          <span>Ghost Collapsible</span>
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div style={{ padding: "8px 16px" }}>
          <p>Ghost variant has a more subtle appearance.</p>
        </div>
      </Collapsible.Content>
    </Collapsible>
  ),
}

export const Collapsed: Story = {
  render: () => (
    <Collapsible variant="normal">
      <Collapsible.Trigger>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", width: "100%", padding: "8px" }}>
          <Collapsible.Arrow />
          <span>Click to expand</span>
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div style={{ padding: "8px 16px" }}>
          <p>Hidden content revealed on expand.</p>
        </div>
      </Collapsible.Content>
    </Collapsible>
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
      <Collapsible variant="normal" defaultOpen>
        <Collapsible.Trigger>
          <div style={{ display: "flex", "align-items": "center", gap: "8px", width: "100%", padding: "8px" }}>
            <Collapsible.Arrow />
            <span>Normal</span>
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div style={{ padding: "8px 16px" }}>Normal content</div>
        </Collapsible.Content>
      </Collapsible>
      <Collapsible variant="ghost" defaultOpen>
        <Collapsible.Trigger>
          <div style={{ display: "flex", "align-items": "center", gap: "8px", width: "100%", padding: "8px" }}>
            <Collapsible.Arrow />
            <span>Ghost</span>
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div style={{ padding: "8px 16px" }}>Ghost content</div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  ),
}
