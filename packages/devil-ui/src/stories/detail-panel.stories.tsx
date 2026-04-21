/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { DetailPanel } from "../primitives/detail-panel"
import { RenderTargetProvider } from "../context/render-target"
import { DensityProvider } from "../context/density"
import { createDomAdapter } from "../adapters/dom"

const meta: Meta<typeof DetailPanel> = {
  title: "Primitives/DetailPanel",
  component: DetailPanel,
  decorators: [
    (Story) => (
      <RenderTargetProvider adapter={createDomAdapter()}>
        <DensityProvider initial="expanded">
          <Story />
        </DensityProvider>
      </RenderTargetProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DetailPanel>

const LONG_BODY = `This is a detailed explanation of the current workflow stage.
It may contain multiple lines of context, file paths, and role assignments.
The panel expands to show the full text with proper word wrapping.`

export const Default: Story = {
  args: { title: "Build Stage", body: LONG_BODY, open: true },
}

export const Collapsed: Story = {
  args: { title: "Review Stage", body: LONG_BODY, open: false },
}

export const Compact: Story = {
  decorators: [
    (Story) => (
      <RenderTargetProvider adapter={createDomAdapter()}>
        <DensityProvider initial="compact">
          <Story />
        </DensityProvider>
      </RenderTargetProvider>
    ),
  ],
  args: { title: "Ship Stage (Compact)", body: LONG_BODY, open: true },
}
