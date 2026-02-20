/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Progress } from "@opencode-ai/ui/progress"

const meta: Meta<typeof Progress> = {
  title: "Components/Progress",
  component: Progress,
  argTypes: {
    value: { control: { type: "range", min: 0, max: 100 } },
    minValue: { control: { type: "number" } },
    maxValue: { control: { type: "number" } },
    hideLabel: { control: "boolean" },
    showValueLabel: { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "16px", width: "320px" }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj<typeof Progress>

export const Default: Story = {
  args: { value: 50 },
}

export const WithLabel: Story = {
  render: () => <Progress value={65}>Loading files...</Progress>,
}

export const WithValueLabel: Story = {
  render: () => (
    <Progress value={42} showValueLabel>
      Uploading
    </Progress>
  ),
}

export const HiddenLabel: Story = {
  render: () => (
    <Progress value={80} hideLabel>
      Processing
    </Progress>
  ),
}

export const Empty: Story = {
  args: { value: 0 },
}

export const Full: Story = {
  args: { value: 100 },
}

export const CustomRange: Story = {
  render: () => (
    <Progress value={750} minValue={0} maxValue={1000} showValueLabel>
      Tokens used
    </Progress>
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px", width: "320px" }}>
      <Progress value={0}>Empty (0%)</Progress>
      <Progress value={25}>Quarter (25%)</Progress>
      <Progress value={50}>Half (50%)</Progress>
      <Progress value={75}>Three Quarters (75%)</Progress>
      <Progress value={100}>Full (100%)</Progress>
      <Progress value={60} showValueLabel>
        With value label
      </Progress>
    </div>
  ),
}
