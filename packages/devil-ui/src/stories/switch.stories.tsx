/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Switch } from "@opencode-ai/ui/switch"

const meta: Meta<typeof Switch> = {
  title: "Components/Switch",
  component: Switch,
  argTypes: {
    disabled: { control: "boolean" },
    checked: { control: "boolean" },
  },
}

export default meta
type Story = StoryObj<typeof Switch>

export const Off: Story = {
  args: { children: "Feature disabled" },
}

export const On: Story = {
  args: { children: "Feature enabled", checked: true },
}

export const Disabled: Story = {
  args: { children: "Disabled switch", disabled: true },
}

export const DisabledOn: Story = {
  args: { children: "Disabled on", disabled: true, checked: true },
}

export const WithDescription: Story = {
  args: { children: "Auto-save", description: "Automatically save changes as you type" },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
      <Switch>Off</Switch>
      <Switch checked>On</Switch>
      <Switch disabled>Disabled Off</Switch>
      <Switch disabled checked>
        Disabled On
      </Switch>
      <Switch description="Save changes automatically">Auto-save</Switch>
    </div>
  ),
}
