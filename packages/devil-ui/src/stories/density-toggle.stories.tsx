/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { DensityToggle } from "../primitives/density-toggle"
import { DensityProvider } from "../context/density"
import { RenderTargetProvider } from "../context/render-target"
import { createDomAdapter } from "../adapters/dom"

const meta: Meta<typeof DensityToggle> = {
  title: "Primitives/DensityToggle",
  component: DensityToggle,
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
type Story = StoryObj<typeof DensityToggle>

export const Default: Story = {}
export const CompactInitial: Story = {
  decorators: [
    (Story) => (
      <RenderTargetProvider adapter={createDomAdapter()}>
        <DensityProvider initial="compact">
          <Story />
        </DensityProvider>
      </RenderTargetProvider>
    ),
  ],
}
export const CustomLabels: Story = {
  args: { compactLabel: "Dense", expandedLabel: "Spacious" },
}
