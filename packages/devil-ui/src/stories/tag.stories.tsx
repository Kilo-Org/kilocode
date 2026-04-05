/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Tag } from "@opencode-ai/ui/tag"

const meta: Meta<typeof Tag> = {
  title: "Components/Tag",
  component: Tag,
  argTypes: {
    size: { control: "select", options: ["normal", "large"] },
  },
}

export default meta
type Story = StoryObj<typeof Tag>

export const Normal: Story = {
  args: { size: "normal", children: "Tag" },
}

export const Large: Story = {
  args: { size: "large", children: "Tag Large" },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <Tag size="normal">Normal</Tag>
      <Tag size="large">Large</Tag>
    </div>
  ),
}
