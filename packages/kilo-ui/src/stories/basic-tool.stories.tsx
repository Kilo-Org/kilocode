/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { ToolCall, GenericTool } from "@opencode-ai/ui/basic-tool"

const meta: Meta = {
  title: "Components/BasicTool",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <ToolCall variant="panel" icon="code" trigger={{ title: "Read file", subtitle: "src/index.ts" }}>
      <pre style={{ padding: "8px", margin: 0, "font-size": "12px" }}>{`export const hello = () => "world"`}</pre>
    </ToolCall>
  ),
}

export const WithArgs: Story = {
  render: () => (
    <ToolCall variant="panel" icon="console" trigger={{ title: "Run command", args: ["npm", "install", "--save-dev"] }}>
      <pre style={{ padding: "8px", margin: 0, "font-size": "12px" }}>{"added 42 packages in 3s"}</pre>
    </ToolCall>
  ),
}

export const DefaultOpen: Story = {
  render: () => (
    <ToolCall variant="panel" icon="magnifying-glass" trigger={{ title: "Search", subtitle: "*.ts" }} defaultOpen>
      <div style={{ padding: "8px", "font-size": "12px" }}>Found 12 matches across 5 files.</div>
    </ToolCall>
  ),
}

export const NoChildren: Story = {
  render: () => <ToolCall variant="row" icon="mcp" trigger={{ title: "Tool call", subtitle: "No output" }} />,
}

export const Locked: Story = {
  render: () => (
    <ToolCall
      variant="panel"
      icon="folder"
      trigger={{ title: "Writing file", subtitle: "output.txt" }}
      defaultOpen
      locked
    >
      <pre style={{ padding: "8px", margin: 0, "font-size": "12px" }}>{"Hello, world!"}</pre>
    </ToolCall>
  ),
}

export const Generic: Story = {
  render: () => <GenericTool tool="my_custom_tool" />,
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "8px", width: "400px" }}>
      <ToolCall variant="panel" icon="code" trigger={{ title: "Read file", subtitle: "src/index.ts" }}>
        <pre style={{ padding: "8px", margin: 0, "font-size": "12px" }}>content here</pre>
      </ToolCall>
      <ToolCall variant="panel" icon="console" trigger={{ title: "Run command", args: ["bun", "test"] }} defaultOpen>
        <pre style={{ padding: "8px", margin: 0, "font-size": "12px" }}>All tests passed!</pre>
      </ToolCall>
      <ToolCall variant="row" icon="mcp" trigger={{ title: "MCP tool call" }} />
      <GenericTool tool="generic_tool" />
    </div>
  ),
}
