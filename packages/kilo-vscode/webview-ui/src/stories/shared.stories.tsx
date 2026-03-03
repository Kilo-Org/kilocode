/** @jsxImportSource solid-js */
/**
 * Stories for shared controls: ModelSelector and ModeSwitcher.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import { ModelSelectorBase } from "../components/shared/ModelSelector"
import { ModeSwitcherBase, ModeSwitcher } from "../components/shared/ModeSwitcher"

const agents = [
  { name: "code", description: "Write, edit and review code", mode: "primary" as const },
  { name: "ask", description: "Answer questions without making changes", mode: "primary" as const },
  { name: "architect", description: "Plan and design before implementation", mode: "primary" as const },
  { name: "debug", description: "Diagnose and fix issues", mode: "primary" as const },
]

const meta: Meta = {
  title: "Shared",
  parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// ModelSelector
// ---------------------------------------------------------------------------

export const ModelSelectorNoProviders: Story = {
  name: "ModelSelector — no providers",
  render: () => (
    <StoryProviders>
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <ModelSelectorBase
          value={{ providerID: "kilo", modelID: "kilo/auto" }}
          onSelect={() => {}}
          placement="bottom-start"
        />
      </div>
    </StoryProviders>
  ),
}

export const ModelSelectorAllowClear: Story = {
  name: "ModelSelector — allow clear",
  render: () => (
    <StoryProviders>
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <ModelSelectorBase
          value={null}
          onSelect={() => {}}
          placement="bottom-start"
          allowClear
          clearLabel="Use default model"
        />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// ModeSwitcher
// ---------------------------------------------------------------------------

export const ModeSwitcherSingle: Story = {
  name: "ModeSwitcherBase — single agent (hidden)",
  render: () => (
    <StoryProviders>
      <ModeSwitcherBase
        agents={[{ name: "code", description: "Code mode", mode: "primary" as const }]}
        value="code"
        onSelect={() => {}}
      />
    </StoryProviders>
  ),
}

export const ModeSwitcherMultiple: Story = {
  name: "ModeSwitcherBase — multiple agents",
  render: () => (
    <StoryProviders>
      <ModeSwitcherBase agents={agents} value="code" onSelect={() => {}} />
    </StoryProviders>
  ),
}

export const ModeSwitcherAskSelected: Story = {
  name: "ModeSwitcherBase — ask mode selected",
  render: () => (
    <StoryProviders>
      <ModeSwitcherBase agents={agents} value="ask" onSelect={() => {}} />
    </StoryProviders>
  ),
}

export const ModeSwitcherFromSession: Story = {
  name: "ModeSwitcher — wired to session context",
  render: () => (
    <StoryProviders>
      <ModeSwitcher />
    </StoryProviders>
  ),
}
