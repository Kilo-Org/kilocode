/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { PositionPicker } from "../components/position-picker"
import { RenderTargetProvider } from "../context/render-target"
import { createDomAdapter } from "../adapters/dom"

// ─── Adapter ──────────────────────────────────────────────────────────────────

const adapter = createDomAdapter()

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta<typeof PositionPicker> = {
  title: "Components/PositionPicker",
  component: PositionPicker,
  decorators: [
    (Story) => (
      <RenderTargetProvider adapter={adapter}>
        <div style={{ width: "100vw", height: "100vh", background: "#11111b", position: "relative" }}>
          <Story />
        </div>
      </RenderTargetProvider>
    ),
  ],
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj<typeof PositionPicker>

const noop = () => {}

// ─── Stories ──────────────────────────────────────────────────────────────────

export const Open: Story = {
  args: { open: true, excludeIds: [], onSelect: noop, onClose: noop },
}

export const Closed: Story = {
  args: { open: false, excludeIds: [], onSelect: noop, onClose: noop },
}

export const WithExclusions: Story = {
  args: {
    open: true,
    excludeIds: ["architect", "coordinator", "senior-dev"],
    onSelect: noop,
    onClose: noop,
  },
}

export const HeavilyFiltered: Story = {
  args: {
    open: true,
    excludeIds: [
      "architect",
      "coordinator",
      "spec-writer",
      "senior-dev",
      "developer",
      "frontend-specialist",
      "backend-specialist",
    ],
    onSelect: noop,
    onClose: noop,
  },
}
