/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { For } from "solid-js"
import { AppIcon } from "@opencode-ai/ui/app-icon"
import type { IconName } from "@opencode-ai/ui/icons/app"

const meta: Meta = {
  title: "Components/AppIcon",
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj

const ALL_ICONS: IconName[] = [
  "vscode",
  "cursor",
  "zed",
  "file-explorer",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "xcode",
  "android-studio",
  "antigravity",
  "textmate",
  "powershell",
  "sublime-text",
]

export const VSCode: Story = {
  render: () => <AppIcon id="vscode" style={{ width: "32px", height: "32px" }} />,
}

export const Cursor: Story = {
  render: () => <AppIcon id="cursor" style={{ width: "32px", height: "32px" }} />,
}

export const Zed: Story = {
  render: () => <AppIcon id="zed" style={{ width: "32px", height: "32px" }} />,
}

export const AllIcons: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-wrap": "wrap", gap: "16px", "align-items": "center", padding: "8px" }}>
      <For each={ALL_ICONS}>
        {(id) => (
          <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "4px" }}>
            <AppIcon id={id} style={{ width: "32px", height: "32px" }} />
            <span style={{ "font-size": "10px" }}>{id}</span>
          </div>
        )}
      </For>
    </div>
  ),
}
