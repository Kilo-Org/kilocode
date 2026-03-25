/** @jsxImportSource solid-js */
/**
 * Stories for Settings and ProvidersTab components.
 */

import { onMount } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { SessionContext } from "../context/session"
import Settings from "../components/settings/Settings"
import ProvidersTab from "../components/settings/ProvidersTab"
import AgentBehaviourTab from "../components/settings/AgentBehaviourTab"
import type { AgentConfig } from "../types/messages"

const meta: Meta = {
  title: "Settings",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

function noop() {}

const MOCK_AGENTS = [
  { name: "code", description: "General-purpose coding agent", mode: "primary" as const, native: true },
  { name: "debug", description: "Diagnose and fix bugs", mode: "primary" as const, native: true },
  { name: "architect", description: "Design systems and plan features", mode: "all" as const, native: true },
  {
    name: "reviewer",
    description: "Review code for quality and best practices",
    mode: "primary" as const,
    native: false,
  },
]

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
      agents: () => MOCK_AGENTS,
      removeMode: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
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

export const AgentBehaviourEditCustomMode: Story = {
  name: "AgentBehaviourTab — edit custom mode",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "edit-mode-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      removeMode: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    const cfg: Record<string, AgentConfig> = {
      reviewer: {
        description: "Review code for quality and best practices",
        prompt: "You are a code reviewer. Focus on code quality, best practices, and potential bugs.",
        model: "anthropic/claude-sonnet-4-20250514",
        temperature: 0.3,
      },
    }
    return (
      <StoryProviders sessionID="edit-mode-story" status="idle" config={{ agent: cfg } as any}>
        <SessionContext.Provider value={session as any}>
          <EditModeWrapper />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

/**
 * Renders AgentBehaviourTab and clicks into the "reviewer" custom mode's
 * edit view on mount. Uses requestAnimationFrame to ensure the DOM is
 * fully rendered before querying for the list item.
 */
function EditModeWrapper() {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      if (!ref) return
      const items = Array.from(ref.querySelectorAll<HTMLDivElement>("[style*='cursor: pointer']"))
      for (const item of items) {
        if (item.textContent?.includes("reviewer")) {
          item.click()
          return
        }
      }
    })
  })
  return (
    <div ref={ref} style={{ width: "420px", height: "700px", overflow: "auto" }}>
      <AgentBehaviourTab />
    </div>
  )
}
