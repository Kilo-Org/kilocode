/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Logo, Mark, Splash } from "@opencode-ai/ui/logo"

const meta: Meta = {
  title: "Components/Logo",
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj

export const FullLogo: Story = {
  render: () => (
    <div style={{ width: "160px", height: "auto" }}>
      <Logo />
    </div>
  ),
}

export const Mark_: Story = {
  name: "Mark",
  render: () => (
    <div style={{ width: "32px", height: "40px" }}>
      <Mark />
    </div>
  ),
}

export const SplashMark: Story = {
  render: () => (
    <div style={{ width: "64px", height: "80px" }}>
      <Splash />
    </div>
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "32px", "align-items": "center" }}>
      <div style={{ width: "160px" }}>
        <Logo />
      </div>
      <div style={{ width: "48px", height: "60px" }}>
        <Splash />
      </div>
      <div style={{ width: "24px", height: "30px" }}>
        <Mark />
      </div>
    </div>
  ),
}
