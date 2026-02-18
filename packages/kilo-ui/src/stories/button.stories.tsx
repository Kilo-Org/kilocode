/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Button } from "@opencode-ai/ui/button"

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  argTypes: {
    variant: { control: "select", options: ["primary", "secondary", "ghost"] },
    size: { control: "select", options: ["small", "normal", "large"] },
    disabled: { control: "boolean" },
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: { variant: "primary", children: "Primary Button" },
}

export const Secondary: Story = {
  args: { variant: "secondary", children: "Secondary Button" },
}

export const Ghost: Story = {
  args: { variant: "ghost", children: "Ghost Button" },
}

export const Small: Story = {
  args: { variant: "secondary", size: "small", children: "Small" },
}

export const Normal: Story = {
  args: { variant: "secondary", size: "normal", children: "Normal" },
}

export const Large: Story = {
  args: { variant: "secondary", size: "large", children: "Large" },
}

export const WithIcon: Story = {
  args: { variant: "primary", icon: "plus-small", children: "With Icon" },
}

export const Disabled: Story = {
  args: { variant: "primary", disabled: true, children: "Disabled" },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", "align-items": "center" }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="primary" size="small">
        Small Primary
      </Button>
      <Button variant="primary" size="large">
        Large Primary
      </Button>
      <Button variant="secondary" icon="plus-small">
        With Icon
      </Button>
      <Button variant="primary" disabled>
        Disabled
      </Button>
    </div>
  ),
}
