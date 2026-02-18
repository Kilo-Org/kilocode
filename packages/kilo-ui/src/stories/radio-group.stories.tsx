/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { RadioGroup } from "@opencode-ai/ui/radio-group"

const meta: Meta = {
  title: "Components/RadioGroup",
}

export default meta
type Story = StoryObj

const options = ["Option A", "Option B", "Option C"]

export const Small: Story = {
  render: () => <RadioGroup<string> options={options} defaultValue="Option A" size="small" />,
}

export const Medium: Story = {
  render: () => <RadioGroup<string> options={options} defaultValue="Option B" size="medium" />,
}

export const WithCustomLabels: Story = {
  render: () => (
    <RadioGroup<string>
      options={["left", "center", "right"]}
      defaultValue="center"
      size="medium"
      label={(x) => x.charAt(0).toUpperCase() + x.slice(1)}
    />
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <RadioGroup<string> options={options} defaultValue="Option A" size="small" />
      <RadioGroup<string> options={options} defaultValue="Option B" size="medium" />
    </div>
  ),
}
