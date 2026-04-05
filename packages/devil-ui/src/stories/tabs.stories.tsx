/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Tabs } from "@opencode-ai/ui/tabs"

const meta: Meta = {
  title: "Components/Tabs",
  decorators: [
    (Story) => (
      <div style={{ width: "400px" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

function TabsDemo(props: {
  variant?: "normal" | "alt" | "pill" | "settings"
  orientation?: "horizontal" | "vertical"
}) {
  return (
    <Tabs defaultValue="tab1" variant={props.variant} orientation={props.orientation}>
      <Tabs.List>
        <Tabs.Trigger value="tab1">Files</Tabs.Trigger>
        <Tabs.Trigger value="tab2">Explorer</Tabs.Trigger>
        <Tabs.Trigger value="tab3">Search</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="tab1">
        <div style={{ padding: "16px" }}>Files content</div>
      </Tabs.Content>
      <Tabs.Content value="tab2">
        <div style={{ padding: "16px" }}>Explorer content</div>
      </Tabs.Content>
      <Tabs.Content value="tab3">
        <div style={{ padding: "16px" }}>Search content</div>
      </Tabs.Content>
    </Tabs>
  )
}

export const Normal: Story = {
  render: () => <TabsDemo variant="normal" />,
}

export const Alt: Story = {
  render: () => <TabsDemo variant="alt" />,
}

export const Pill: Story = {
  render: () => <TabsDemo variant="pill" />,
}

export const Settings: Story = {
  render: () => <TabsDemo variant="settings" />,
}

export const Vertical: Story = {
  render: () => (
    <div style={{ height: "200px" }}>
      <TabsDemo variant="normal" orientation="vertical" />
    </div>
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "24px" }}>
      <div>
        <div style={{ "font-size": "12px", "margin-bottom": "8px", color: "var(--text-weak)" }}>Normal</div>
        <TabsDemo variant="normal" />
      </div>
      <div>
        <div style={{ "font-size": "12px", "margin-bottom": "8px", color: "var(--text-weak)" }}>Alt</div>
        <TabsDemo variant="alt" />
      </div>
      <div>
        <div style={{ "font-size": "12px", "margin-bottom": "8px", color: "var(--text-weak)" }}>Pill</div>
        <TabsDemo variant="pill" />
      </div>
      <div>
        <div style={{ "font-size": "12px", "margin-bottom": "8px", color: "var(--text-weak)" }}>Settings</div>
        <TabsDemo variant="settings" />
      </div>
    </div>
  ),
  parameters: { layout: "padded" },
}
