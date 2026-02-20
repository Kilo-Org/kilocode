/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { List } from "@opencode-ai/ui/list"

const meta: Meta = {
  title: "Components/List",
  decorators: [
    (Story) => (
      <div
        style={{
          width: "280px",
          height: "320px",
          border: "1px solid var(--border-base)",
          "border-radius": "4px",
          overflow: "hidden",
        }}
      >
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

type Item = { id: string; label: string; description?: string }

const items: Item[] = [
  { id: "1", label: "Apple", description: "A sweet fruit" },
  { id: "2", label: "Banana", description: "A yellow fruit" },
  { id: "3", label: "Cherry", description: "A small red fruit" },
  { id: "4", label: "Date", description: "A sweet dried fruit" },
  { id: "5", label: "Elderberry", description: "A dark berry" },
  { id: "6", label: "Fig", description: "A soft sweet fruit" },
  { id: "7", label: "Grape", description: "Grows in clusters" },
]

export const Default: Story = {
  render: () => (
    <List<Item> items={items} key={(item) => item.id} onSelect={(item) => console.log("Selected:", item)}>
      {(item) => (
        <div style={{ padding: "4px 8px" }}>
          <div style={{ "font-size": "13px" }}>{item.label}</div>
          <div style={{ "font-size": "11px", color: "var(--text-weak)" }}>{item.description}</div>
        </div>
      )}
    </List>
  ),
}

export const WithSearch: Story = {
  render: () => (
    <List<Item>
      items={items}
      key={(item) => item.id}
      filterKeys={["label"]}
      search={{ placeholder: "Search fruits...", autofocus: true }}
      onSelect={(item) => console.log("Selected:", item)}
    >
      {(item) => (
        <div style={{ padding: "4px 8px" }}>
          <div style={{ "font-size": "13px" }}>{item.label}</div>
        </div>
      )}
    </List>
  ),
}

export const WithCurrent: Story = {
  render: () => (
    <List<Item>
      items={items}
      key={(item) => item.id}
      current={items[1]}
      onSelect={(item) => console.log("Selected:", item)}
    >
      {(item) => (
        <div style={{ padding: "4px 8px" }}>
          <div style={{ "font-size": "13px" }}>{item.label}</div>
        </div>
      )}
    </List>
  ),
}

export const Empty: Story = {
  render: () => (
    <List<Item>
      items={[]}
      key={(item) => item.id}
      emptyMessage="No fruits found"
      onSelect={(item) => console.log("Selected:", item)}
    >
      {(item) => <div style={{ padding: "4px 8px" }}>{item.label}</div>}
    </List>
  ),
}
