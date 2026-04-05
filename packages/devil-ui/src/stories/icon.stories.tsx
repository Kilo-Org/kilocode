/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Icon } from "@opencode-ai/ui/icon"

const meta: Meta<typeof Icon> = {
  title: "Components/Icon",
  component: Icon,
  argTypes: {
    size: { control: "select", options: ["small", "normal", "medium", "large"] },
  },
}

export default meta
type Story = StoryObj<typeof Icon>

export const Default: Story = {
  args: { name: "settings-gear", size: "normal" },
}

export const Small: Story = {
  args: { name: "settings-gear", size: "small" },
}

export const Medium: Story = {
  args: { name: "settings-gear", size: "medium" },
}

export const Large: Story = {
  args: { name: "settings-gear", size: "large" },
}

const iconNames = [
  "align-right",
  "arrow-up",
  "arrow-left",
  "arrow-right",
  "archive",
  "brain",
  "bullet-list",
  "check-small",
  "chevron-down",
  "chevron-right",
  "circle-x",
  "close",
  "code",
  "code-lines",
  "collapse",
  "console",
  "copy",
  "edit",
  "eye",
  "folder",
  "github",
  "magnifying-glass",
  "plus-small",
  "plus",
  "pencil-line",
  "settings-gear",
  "trash",
  "sliders",
  "check",
  "share",
  "download",
  "menu",
  "expand",
  "bubble-5",
  "checklist",
  "circle-check",
  "circle-ban-sign",
  "discord",
  "dot-grid",
  "comment",
  "branch",
  "help",
  "link",
  "providers",
  "models",
  "mcp",
  "photo",
  "enter",
  "server",
  "keyboard",
  "selector",
  "arrow-down-to-line",
  "task",
  "stop",
  "layout-left",
  "layout-right",
  "layout-bottom",
] as const

export const AllIcons: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(auto-fill, 80px)",
        gap: "12px",
        padding: "16px",
      }}
    >
      {iconNames.map((name) => (
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            gap: "4px",
          }}
        >
          <Icon name={name} size="normal" />
          <span style={{ "font-size": "10px", color: "var(--text-weak)", "text-align": "center" }}>{name}</span>
        </div>
      ))}
    </div>
  ),
  parameters: { layout: "fullscreen" },
}
