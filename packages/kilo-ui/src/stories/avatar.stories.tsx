/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Avatar } from "@opencode-ai/ui/avatar"

const meta: Meta<typeof Avatar> = {
  title: "Components/Avatar",
  component: Avatar,
  argTypes: {
    size: { control: "select", options: ["small", "normal", "large"] },
  },
}

export default meta
type Story = StoryObj<typeof Avatar>

export const Default: Story = {
  args: { fallback: "JD" },
}

export const Small: Story = {
  args: { fallback: "AB", size: "small" },
}

export const Normal: Story = {
  args: { fallback: "CD", size: "normal" },
}

export const Large: Story = {
  args: { fallback: "EF", size: "large" },
}

export const WithCustomColors: Story = {
  args: { fallback: "KL", background: "#1a4d8f", foreground: "#ffffff" },
}

// Inline data URI so the visual regression test never depends on network.
// 32×32 avatar silhouette (blue circle, white head, light-blue shoulders).
const AVATAR_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAq0lEQVR4nNXUyw2AIBBFUfuyO9u0Awtwqa5IjIDzeW8cIZml3CMGp2n0NS/7+WlMO2lhKgQJwxBpw9aiITxxGgKJUxBoXIMIfXvoFFIBmqvEBFSIIQCsWwABJIRlHzegh7Du4Y4zJxUBfYI0wLod4oQANGErRA3wxDUI1e8Yib8hqngLwIj3EE3AExEF6MZ/ASgIZvyOEONRCFO8LCbAHGdBoDACoYYlFPL8Bcdqxc2w0JfIAAAAAElFTkSuQmCC"

export const WithImage: Story = {
  args: {
    fallback: "OC",
    src: AVATAR_DATA_URI,
  },
}

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
      <Avatar fallback="SM" size="small" />
      <Avatar fallback="NO" size="normal" />
      <Avatar fallback="LG" size="large" />
      <Avatar fallback="CO" background="#7c3aed" foreground="#ffffff" />
    </div>
  ),
}
