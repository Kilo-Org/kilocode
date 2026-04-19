/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StageCoverageIndicator } from "../primitives/stage-coverage-indicator"
import { RenderTargetProvider } from "../context/render-target"
import { createDomAdapter } from "../adapters/dom"

const meta: Meta<typeof StageCoverageIndicator> = {
  title: "Primitives/StageCoverageIndicator",
  component: StageCoverageIndicator,
  decorators: [
    (Story) => (
      <RenderTargetProvider adapter={createDomAdapter()}>
        <Story />
      </RenderTargetProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof StageCoverageIndicator>

export const Complete: Story = { args: { missingStages: [] } }
export const OneMissing: Story = { args: { missingStages: ["ship"] } }
export const AllMissing: Story = {
  args: { missingStages: ["plan", "challenge", "contract", "build", "review", "ship", "retro"] },
}
export const Compact: Story = { args: { missingStages: ["ship"], compact: true } }
