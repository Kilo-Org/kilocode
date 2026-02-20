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

export const WithImage: Story = {
  args: {
    fallback: "OC",
    src: "https://avatars.githubusercontent.com/u/154330673?s=48",
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
