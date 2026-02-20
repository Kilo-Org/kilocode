/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { For } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"

const meta: Meta = {
  title: "Components/FileIcon",
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj

export const TypeScriptFile: Story = {
  render: () => <FileIcon node={{ path: "src/index.ts", type: "file" }} style={{ width: "20px", height: "20px" }} />,
}

export const JavaScriptFile: Story = {
  render: () => <FileIcon node={{ path: "app.js", type: "file" }} style={{ width: "20px", height: "20px" }} />,
}

export const MarkdownFile: Story = {
  render: () => <FileIcon node={{ path: "README.md", type: "file" }} style={{ width: "20px", height: "20px" }} />,
}

export const Folder: Story = {
  render: () => <FileIcon node={{ path: "src", type: "directory" }} style={{ width: "20px", height: "20px" }} />,
}

export const FolderExpanded: Story = {
  render: () => (
    <FileIcon node={{ path: "src", type: "directory" }} expanded style={{ width: "20px", height: "20px" }} />
  ),
}

const FILES = [
  { path: "index.ts", type: "file" as const },
  { path: "App.tsx", type: "file" as const },
  { path: "styles.css", type: "file" as const },
  { path: "package.json", type: "file" as const },
  { path: "Dockerfile", type: "file" as const },
  { path: "README.md", type: "file" as const },
  { path: "main.py", type: "file" as const },
  { path: "src", type: "directory" as const },
  { path: "node_modules", type: "directory" as const },
  { path: "docs", type: "directory" as const },
]

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-wrap": "wrap", gap: "16px", "align-items": "center", padding: "8px" }}>
      <For each={FILES}>
        {(node) => (
          <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "4px" }}>
            <FileIcon node={node} style={{ width: "20px", height: "20px" }} />
            <span style={{ "font-size": "10px" }}>{node.path}</span>
          </div>
        )}
      </For>
    </div>
  ),
}
