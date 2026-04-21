/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StagePositionBadge } from "../primitives/stage-position-badge"
import { RenderTargetProvider } from "../context/render-target"
import { createDomAdapter } from "../adapters/dom"
import type { StagePositionInfo } from "../hooks/use-stage-position"

const meta: Meta<typeof StagePositionBadge> = {
  title: "Primitives/StagePositionBadge",
  component: StagePositionBadge,
  decorators: [
    (Story) => (
      <RenderTargetProvider adapter={createDomAdapter()}>
        <Story />
      </RenderTargetProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof StagePositionBadge>

const coveredInfo: StagePositionInfo = {
  stage: "build",
  position: "developer",
  roleLabel: "Developer",
  modelLabel: "claude-sonnet-4",
  requiredCapability: "implementation",
}

const uncoveredInfo: StagePositionInfo = {
  stage: "ship",
  position: undefined,
  roleLabel: undefined,
  modelLabel: undefined,
  requiredCapability: "release",
}

export const Covered: Story = { args: { info: coveredInfo } }
export const Uncovered: Story = { args: { info: uncoveredInfo } }
export const Compact: Story = { args: { info: coveredInfo, compact: true } }
export const CompactUncovered: Story = { args: { info: uncoveredInfo, compact: true } }
