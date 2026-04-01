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
import ModeEditView from "../components/settings/ModeEditView"
import McpEditView from "../components/settings/McpEditView"
import type { AgentConfig, AgentInfo, CommandConfig } from "../types/messages"

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
      <div style={{ height: "700px", display: "flex", "flex-direction": "column" }}>
        <Settings />
      </div>
    </StoryProviders>
  ),
}

export const ProvidersConfigure: Story = {
  name: "ProvidersTab — no providers configured",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "700px", overflow: "auto" }}>
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
      allAgents: () => MOCK_AGENTS,
      removeMode: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="agents-story" status="idle">
        <SessionContext.Provider value={session as any}>
          <div style={{ "max-height": "700px", overflow: "auto" }}>
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
      allAgents: () => MOCK_AGENTS,
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
    <div ref={ref} style={{ height: "700px", overflow: "auto" }}>
      <AgentBehaviourTab />
    </div>
  )
}

/** Clicks the given subtab button on mount. */
function SubtabWrapper(props: { tab: string }) {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      if (!ref) return
      const buttons = Array.from(ref.querySelectorAll<HTMLButtonElement>("button"))
      for (const btn of buttons) {
        if (btn.textContent?.toLowerCase().includes(props.tab.toLowerCase())) {
          btn.click()
          return
        }
      }
    })
  })
  return (
    <div ref={ref} style={{ height: "700px", overflow: "auto" }}>
      <AgentBehaviourTab />
    </div>
  )
}

const MOCK_COMMANDS: Record<string, CommandConfig> = {
  review: {
    template: "Review the changes in the current branch and provide feedback on code quality.",
    description: "Run a code review on the current branch",
  },
  deploy: {
    template: "Build and deploy the application to the staging environment.",
    description: "Deploy to staging",
  },
  test: {
    template: "Run the full test suite and report any failures.",
  },
}

export const AgentBehaviourWorkflows: Story = {
  name: "AgentBehaviourTab — workflows with commands",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "workflows-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeMode: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="workflows-story" status="idle" config={{ command: MOCK_COMMANDS } as any}>
        <SessionContext.Provider value={session as any}>
          <SubtabWrapper tab="workflows" />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const AgentBehaviourWorkflowsEmpty: Story = {
  name: "AgentBehaviourTab — workflows empty state",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "workflows-empty-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeMode: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="workflows-empty-story" status="idle">
        <SessionContext.Provider value={session as any}>
          <SubtabWrapper tab="workflows" />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const McpEditViewLocal: Story = {
  name: "McpEditView — local server (stdio)",
  render: () => (
    <StoryProviders
      config={
        {
          mcp: {
            filesystem: {
              type: "local",
              command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
            },
          },
        } as any
      }
    >
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <McpEditView name="filesystem" onBack={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}

export const McpEditViewLocalWithEnv: Story = {
  name: "McpEditView — local server with env vars",
  render: () => (
    <StoryProviders
      config={
        {
          mcp: {
            "my-mcp": {
              type: "local",
              command: ["node", "dist/index.js"],
              environment: { API_KEY: "sk-abc123", NODE_ENV: "production" },
            },
          },
        } as any
      }
    >
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <McpEditView name="my-mcp" onBack={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}

export const McpEditViewRemote: Story = {
  name: "McpEditView — remote server (SSE)",
  render: () => (
    <StoryProviders
      config={
        {
          mcp: {
            "remote-mcp": {
              type: "remote",
              url: "https://mcp.example.com/sse",
            },
          },
        } as any
      }
    >
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <McpEditView name="remote-mcp" onBack={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}

const MOCK_SYSTEM_PROMPT = `You are a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.

When the user asks you to perform a task, you should:
1. Think through the problem carefully
2. Break it down into clear steps
3. Implement the solution methodically

You have access to tools for reading/writing files, running commands, and searching code.`

const MOCK_SUBAGENTS: AgentInfo[] = [
  {
    name: "subagent",
    displayName: "Sub-agent",
    description: "Executes delegated subtasks from the primary agent",
    mode: "subagent" as const,
    native: true,
    prompt: `You are a sub-agent executing a focused subtask delegated by the primary agent.

Complete only what was asked. Do not expand scope or ask clarifying questions.
Return a concise result when done.`,
  },
  {
    name: "researcher",
    displayName: "Researcher",
    description: "Searches the web and gathers information",
    mode: "subagent" as const,
    native: true,
    prompt: undefined,
  },
]

/** Renders ModeEditView for a native mode (e.g. "code") and clicks the
 * DefaultPromptSection chevron to expand it. */
function ExpandedPromptWrapper() {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      if (!ref) return
      // Click the first chevron button inside the DefaultPromptSection card
      const btns = Array.from(ref.querySelectorAll<HTMLButtonElement>("button"))
      for (const btn of btns) {
        const icon = btn.querySelector("svg, [data-icon]")
        if (icon || btn.closest("[style*='cursor: pointer']")) {
          // Find the DefaultPromptSection toggle — it's the card that follows
          // the prompt-override textarea. We look for the card header div.
          const headerDivs = Array.from(ref.querySelectorAll<HTMLDivElement>("[style*='cursor: pointer']"))
          if (headerDivs.length > 0) {
            headerDivs[0].click()
            return
          }
        }
      }
    })
  })
  const session = {
    ...mockSessionValue({ id: "prompt-expanded", status: "idle" }),
    agents: () => [
      {
        name: "code",
        displayName: "Code",
        description: "General-purpose coding agent",
        mode: "primary" as const,
        native: true,
        prompt: MOCK_SYSTEM_PROMPT,
      },
    ],
    subagents: () => [] as AgentInfo[],
    removeMode: noop,
    removeMcp: noop,
    skills: () => [],
    refreshSkills: noop,
    removeSkill: noop,
  }
  return (
    <StoryProviders sessionID="prompt-expanded" status="idle">
      <SessionContext.Provider value={session as any}>
        <div ref={ref} style={{ "max-height": "700px", overflow: "auto" }}>
          <ModeEditView name="code" onBack={noop} onRemove={noop} />
        </div>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

/** Renders ModeEditView for the "code" agent (native) that has a system prompt. */
export const ModeEditNativeWithPrompt: Story = {
  name: "ModeEditView — native mode with default system prompt (collapsed)",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "native-prompt", status: "idle" }),
      agents: () => [
        {
          name: "code",
          displayName: "Code",
          description: "General-purpose coding agent",
          mode: "primary" as const,
          native: true,
          prompt: MOCK_SYSTEM_PROMPT,
        },
      ],
      subagents: () => [] as AgentInfo[],
      removeMode: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="native-prompt" status="idle">
        <SessionContext.Provider value={session as any}>
          <div style={{ "max-height": "700px", overflow: "auto" }}>
            <ModeEditView name="code" onBack={noop} onRemove={noop} />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const ModeEditNativePromptExpanded: Story = {
  name: "ModeEditView — native mode with default system prompt (expanded)",
  render: () => <ExpandedPromptWrapper />,
}

/** Renders ModeEditView with subagents section visible and collapsed. */
export const ModeEditWithSubagents: Story = {
  name: "ModeEditView — with sub-agents section (collapsed)",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "subagents-story", status: "idle" }),
      agents: () => [
        {
          name: "code",
          displayName: "Code",
          description: "General-purpose coding agent",
          mode: "primary" as const,
          native: true,
          prompt: MOCK_SYSTEM_PROMPT,
        },
      ],
      subagents: () => MOCK_SUBAGENTS,
      removeMode: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="subagents-story" status="idle">
        <SessionContext.Provider value={session as any}>
          <div style={{ "max-height": "700px", overflow: "auto" }}>
            <ModeEditView name="code" onBack={noop} onRemove={noop} />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

/** Renders ModeEditView with the sub-agents section expanded to show each sub-agent. */
function ExpandedSubagentsWrapper() {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      if (!ref) return
      // Find all cursor:pointer divs (collapsible section headers) and click the
      // last one which corresponds to the SubagentsSection.
      const headers = Array.from(ref.querySelectorAll<HTMLDivElement>("[style*='cursor: pointer']"))
      if (headers.length > 0) {
        headers[headers.length - 1].click()
      }
    })
  })
  const session = {
    ...mockSessionValue({ id: "subagents-expanded", status: "idle" }),
    agents: () => [
      {
        name: "code",
        displayName: "Code",
        description: "General-purpose coding agent",
        mode: "primary" as const,
        native: true,
        prompt: MOCK_SYSTEM_PROMPT,
      },
    ],
    subagents: () => MOCK_SUBAGENTS,
    removeMode: noop,
    removeMcp: noop,
    skills: () => [],
    refreshSkills: noop,
    removeSkill: noop,
  }
  return (
    <StoryProviders sessionID="subagents-expanded" status="idle">
      <SessionContext.Provider value={session as any}>
        <div ref={ref} style={{ "max-height": "700px", overflow: "auto" }}>
          <ModeEditView name="code" onBack={noop} onRemove={noop} />
        </div>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

export const ModeEditSubagentsExpanded: Story = {
  name: "ModeEditView — with sub-agents section (expanded)",
  render: () => <ExpandedSubagentsWrapper />,
}

export const ModeEditExport: Story = {
  name: "ModeEditView — export button",
  render: () => {
    const cfg: Record<string, AgentConfig> = {
      reviewer: {
        description: "Review code for quality and best practices",
        prompt: "You are a code reviewer. Focus on code quality, best practices, and potential bugs.",
        model: "anthropic/claude-sonnet-4-20250514",
        temperature: 0.3,
      },
    }
    const session = {
      ...mockSessionValue({ id: "export-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeMode: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="export-story" status="idle" config={{ agent: cfg } as any}>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "420px", height: "700px", overflow: "auto" }}>
            <ModeEditView name="reviewer" onBack={noop} onRemove={noop} />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}
