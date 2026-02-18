/** @jsxImportSource solid-js */
import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"

const meta: Meta = {
  title: "Components/ResizeHandle",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

export const Horizontal: Story = {
  render: () => {
    const [width, setWidth] = createSignal(200)
    return (
      <div style={{ display: "flex", height: "200px", border: "1px solid var(--border-base)" }}>
        <div
          style={{
            width: `${width()}px`,
            "background-color": "var(--surface-base)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-size": "12px",
            color: "var(--text-weak)",
          }}
        >
          {width()}px
        </div>
        <ResizeHandle direction="horizontal" size={width()} min={80} max={400} onResize={setWidth} />
        <div
          style={{
            flex: 1,
            "background-color": "var(--background-weak)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
          }}
        >
          Main content
        </div>
      </div>
    )
  },
}

export const Vertical: Story = {
  render: () => {
    const [height, setHeight] = createSignal(120)
    return (
      <div
        style={{ display: "flex", "flex-direction": "column", height: "300px", border: "1px solid var(--border-base)" }}
      >
        <div
          style={{
            height: `${height()}px`,
            "background-color": "var(--surface-base)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-size": "12px",
            color: "var(--text-weak)",
          }}
        >
          {height()}px
        </div>
        <ResizeHandle direction="vertical" size={height()} min={60} max={240} onResize={setHeight} />
        <div
          style={{
            flex: 1,
            "background-color": "var(--background-weak)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
          }}
        >
          Main content
        </div>
      </div>
    )
  },
}
