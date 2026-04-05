/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Card } from "@opencode-ai/ui/card"

const meta: Meta<typeof Card> = {
  title: "Components/Card",
  component: Card,
  argTypes: {
    variant: { control: "select", options: ["normal", "error", "warning", "success", "info"] },
  },
}

export default meta
type Story = StoryObj<typeof Card>

export const Normal: Story = {
  args: { variant: "normal", children: "This is a normal card" },
}

export const Error: Story = {
  args: { variant: "error", children: "This is an error card" },
}

export const Warning: Story = {
  args: { variant: "warning", children: "This is a warning card" },
}

export const Success: Story = {
  args: { variant: "success", children: "This is a success card" },
}

export const Info: Story = {
  args: { variant: "info", children: "This is an info card" },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "8px", width: "300px" }}>
      <Card variant="normal">Normal card content</Card>
      <Card variant="error">Error card content</Card>
      <Card variant="warning">Warning card content</Card>
      <Card variant="success">Success card content</Card>
      <Card variant="info">Info card content</Card>
    </div>
  ),
}
