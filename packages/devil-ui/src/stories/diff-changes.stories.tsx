/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"

const meta: Meta = {
  title: "Components/DiffChanges",
  decorators: [
    (Story) => (
      <div style={{ padding: "16px" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

const sampleChanges = [
  { additions: 12, deletions: 3 },
  { additions: 5, deletions: 0 },
  { additions: 2, deletions: 2 },
  { additions: 0, deletions: 15 },
]

export const Default: Story = {
  render: () => <DiffChanges changes={sampleChanges} />,
}

export const Bars: Story = {
  render: () => <DiffChanges changes={sampleChanges} variant="bars" />,
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "24px" }}>
      <div>
        <div style={{ "font-size": "12px", color: "var(--text-weak)", "margin-bottom": "8px" }}>Default</div>
        <DiffChanges changes={sampleChanges} />
      </div>
      <div>
        <div style={{ "font-size": "12px", color: "var(--text-weak)", "margin-bottom": "8px" }}>Bars</div>
        <DiffChanges changes={sampleChanges} variant="bars" />
      </div>
    </div>
  ),
}
