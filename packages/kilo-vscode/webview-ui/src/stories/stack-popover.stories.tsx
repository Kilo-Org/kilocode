/** @jsxImportSource solid-js */
/**
 * Stories for the StackPopover component (prompt-area Stack icon + popup).
 *
 * Covers two states:
 *   - No stack/MCP/skills → gray status circle
 *   - Stack configured + MCP + skills → colored status circle
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { type ParentComponent, createSignal } from "solid-js"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { SessionContext } from "../context/session"
import { ConfigContext } from "../context/config"
import { StackSummaryContext, type StackSummaryValue } from "../context/stack-summary"
import StackPopover from "../components/shared/StackPopover"
import type { Config, FeatureFlags } from "../types/messages"

const features: FeatureFlags = { indexing: false, project_stack: true }

const StackStoryProviders: ParentComponent<{ stackSummary: StackSummaryValue; config?: Partial<Config> }> = (props) => {
  const cfg = createSignal<Config>({ mcp: {}, ...props.config })
  const configValue = {
    config: () => cfg[0](),
    globalConfig: () => ({}),
    projectConfig: () => ({}),
    settings: () => ({}),
    features: () => features,
    loading: () => false,
    isDirty: () => false,
    saving: () => false,
    saveError: () => null,
    updateConfig: () => {},
    updateGlobalConfig: () => {},
    updateProjectConfig: () => {},
    updateSetting: () => {},
    saveConfig: () => {},
    discardConfig: () => {},
  }
  const base = mockSessionValue({ status: "idle" })
  return (
    <StoryProviders>
      <ConfigContext.Provider value={configValue as any}>
        <SessionContext.Provider value={base as any}>
          <StackSummaryContext.Provider value={props.stackSummary}>
            {props.children}
          </StackSummaryContext.Provider>
        </SessionContext.Provider>
      </ConfigContext.Provider>
    </StoryProviders>
  )
}

const emptySummary: StackSummaryValue = {
  technologies: () => [],
  configured: () => false,
  projectDirectory: () => undefined,
  loaded: () => true,
  refresh: () => {},
}

const configuredSummary: StackSummaryValue = {
  technologies: () => [
    { id: "nextjs", name: "Next.js" },
    { id: "typescript", name: "TypeScript" },
    { id: "tailwind", name: "Tailwind CSS" },
  ],
  configured: () => true,
  projectDirectory: () => "/home/user/project",
  loaded: () => true,
  refresh: () => {},
}

const meta: Meta = {
  title: "Stack Popover",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

export const Empty420: Story = {
  name: "No stack — 420px",
  render: () => (
    <StackStoryProviders stackSummary={emptySummary}>
      <div style={{ padding: "16px", display: "flex", "align-items": "center", gap: "8px" }}>
        <StackPopover />
      </div>
    </StackStoryProviders>
  ),
}

export const Configured420: Story = {
  name: "Stack configured — 420px",
  render: () => (
    <StackStoryProviders
      stackSummary={configuredSummary}
      config={{ mcp: { "github": { enabled: true }, "filesystem": { enabled: true } } }}
    >
      <div style={{ padding: "16px", display: "flex", "align-items": "center", gap: "8px" }}>
        <StackPopover />
      </div>
    </StackStoryProviders>
  ),
}
