/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Spinner } from "@kilocode/kilo-ui/spinner"

const meta: Meta<typeof Spinner> = {
  title: "Components/Spinner",
  component: Spinner,
}

export default meta
type Story = StoryObj<typeof Spinner>

export const Default: Story = {}

export const Small: Story = {
  render: () => <Spinner style={{ width: "16px", height: "16px" }} />,
}

export const Large: Story = {
  render: () => <Spinner style={{ width: "48px", height: "48px" }} />,
}

export const Parallel: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
      {Array.from({ length: 24 }, () => (
        <Spinner style={{ width: "16px", height: "16px" }} />
      ))}
    </div>
  ),
}

export const Colored: Story = {
  render: () => <Spinner style={{ width: "24px", height: "24px", color: "var(--text-interactive-base)" }} />,
}
