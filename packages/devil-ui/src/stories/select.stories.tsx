/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Select } from "@opencode-ai/ui/select"

const meta: Meta = {
  title: "Components/Select",
  decorators: [
    (Story) => (
      <div style={{ width: "240px", padding: "8px" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

const fruits = ["Apple", "Banana", "Cherry", "Date", "Elderberry", "Fig", "Grape"]

export const Default: Story = {
  render: () => (
    <Select<string> options={fruits} placeholder="Select a fruit..." onSelect={(v) => console.log("Selected:", v)} />
  ),
}

export const WithCurrentValue: Story = {
  render: () => <Select<string> options={fruits} current="Banana" onSelect={(v) => console.log("Selected:", v)} />,
}

export const SettingsVariant: Story = {
  render: () => (
    <Select<string>
      options={fruits}
      placeholder="Choose..."
      triggerVariant="settings"
      onSelect={(v) => console.log("Selected:", v)}
    />
  ),
}

export const WithGroupBy: Story = {
  render: () => {
    type Item = { name: string; category: string }
    const items: Item[] = [
      { name: "Apple", category: "Fruit" },
      { name: "Banana", category: "Fruit" },
      { name: "Carrot", category: "Vegetable" },
      { name: "Daikon", category: "Vegetable" },
      { name: "Elderberry", category: "Fruit" },
    ]
    return (
      <Select<Item>
        options={items}
        placeholder="Pick one..."
        value={(x) => x.name}
        label={(x) => x.name}
        groupBy={(x) => x.category}
        onSelect={(v) => console.log("Selected:", v)}
      />
    )
  },
}

export const Disabled: Story = {
  render: () => (
    <Select<string> options={fruits} placeholder="Disabled" disabled onSelect={(v) => console.log("Selected:", v)} />
  ),
}
