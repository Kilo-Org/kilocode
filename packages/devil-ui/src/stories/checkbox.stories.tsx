/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Checkbox } from "@opencode-ai/ui/checkbox"

const meta: Meta<typeof Checkbox> = {
  title: "Components/Checkbox",
  component: Checkbox,
  argTypes: {
    disabled: { control: "boolean" },
    checked: { control: "boolean" },
    indeterminate: { control: "boolean" },
  },
}

export default meta
type Story = StoryObj<typeof Checkbox>

export const Unchecked: Story = {
  args: { children: "Unchecked" },
}

export const Checked: Story = {
  args: { children: "Checked", checked: true },
}

export const Indeterminate: Story = {
  args: { children: "Indeterminate", indeterminate: true },
}

export const Disabled: Story = {
  args: { children: "Disabled", disabled: true },
}

export const DisabledChecked: Story = {
  args: { children: "Disabled Checked", disabled: true, checked: true },
}

export const WithDescription: Story = {
  args: { children: "Enable feature", description: "This enables the experimental feature" },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
      <Checkbox>Unchecked</Checkbox>
      <Checkbox checked>Checked</Checkbox>
      <Checkbox indeterminate>Indeterminate</Checkbox>
      <Checkbox disabled>Disabled</Checkbox>
      <Checkbox disabled checked>
        Disabled Checked
      </Checkbox>
      <Checkbox description="Some extra info about this option">With Description</Checkbox>
    </div>
  ),
}
