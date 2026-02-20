/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"

const meta: Meta<typeof ProgressCircle> = {
  title: "Components/ProgressCircle",
  component: ProgressCircle,
  argTypes: {
    percentage: { control: { type: "range", min: 0, max: 100 } },
    size: { control: { type: "number", min: 12, max: 64 } },
    strokeWidth: { control: { type: "number", min: 1, max: 8 } },
  },
}

export default meta
type Story = StoryObj<typeof ProgressCircle>

export const Quarter: Story = {
  args: { percentage: 25 },
}

export const Half: Story = {
  args: { percentage: 50 },
}

export const ThreeQuarters: Story = {
  args: { percentage: 75 },
}

export const Complete: Story = {
  args: { percentage: 100 },
}

export const Empty: Story = {
  args: { percentage: 0 },
}

export const Large: Story = {
  args: { percentage: 65, size: 48, strokeWidth: 4 },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <ProgressCircle percentage={0} />
      <ProgressCircle percentage={25} />
      <ProgressCircle percentage={50} />
      <ProgressCircle percentage={75} />
      <ProgressCircle percentage={100} />
      <ProgressCircle percentage={65} size={32} strokeWidth={4} />
    </div>
  ),
}
