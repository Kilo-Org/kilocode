/** @jsxImportSource solid-js */
/**
 * Stories for Settings and ProvidersTab components.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { SessionContext } from "../context/session"
import Settings from "../components/settings/Settings"
import ProvidersTab from "../components/settings/ProvidersTab"
import AgentBehaviourTab from "../components/settings/AgentBehaviourTab"

const meta: Meta = {
  title: "Settings",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

export const SettingsPanel: Story = {
  name: "Settings — full panel",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "700px", display: "flex", "flex-direction": "column" }}>
        <Settings />
      </div>
    </StoryProviders>
  ),
}

export const ProvidersConfigure: Story = {
  name: "ProvidersTab — no providers configured",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", "max-height": "700px", overflow: "auto" }}>
        <ProvidersTab />
      </div>
    </StoryProviders>
  ),
}

export const AgentBehaviourAgents: Story = {
  name: "AgentBehaviourTab — available agents list",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "agents-story", status: "idle" }),
      agents: () => [
        { name: "code", description: "General-purpose coding agent", mode: "primary" },
        { name: "debug", description: "Diagnose and fix bugs", mode: "primary" },
        { name: "architect", description: "Design systems and plan features", mode: "all" },
        { name: "review", description: "Review code for issues and improvements", mode: "subagent" },
      ],
    }
    return (
      <StoryProviders sessionID="agents-story" status="idle">
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "420px", "max-height": "700px", overflow: "auto" }}>
            <AgentBehaviourTab />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}
