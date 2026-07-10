/** @jsxImportSource solid-js */
/**
 * Stories for Settings and ProvidersTab components.
 */

import { onMount, createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { SessionContext } from "../context/session"
import { KiloEmbeddingModelsContext } from "../context/kilo-embedding-models"
import Settings from "../components/settings/Settings"
import ProvidersTab from "../components/settings/ProvidersTab"
import ModelsTab from "../components/settings/ModelsTab"
import AgentBehaviourTab from "../components/settings/AgentBehaviourTab"
import AutoApproveTab from "../components/settings/AutoApproveTab"
import ModeEditView from "../components/settings/ModeEditView"
import McpEditView from "../components/settings/McpEditView"
import type { AgentConfig, CommandConfig, Config } from "../types/messages"
import IndexingTab from "../components/settings/IndexingTab"
import { SidebarEmptyState } from "../components/chat/SidebarEmptyState"
import { WorkStyleContext, type WorkStyleContextValue } from "../context/work-style"

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

export const AutoApproveBashOnly: Story = {
  name: "AutoApproveTab — Bash-only config defaults",
  render: () => (
    <StoryProviders config={{ permission: { bash: { "*": "ask", "git status *": "allow" } } } as any}>
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <AutoApproveTab />
      </div>
    </StoryProviders>
  ),
}

export const SandboxingPanel: Story = {
  name: "Settings — sandboxing controls",
  render: () => (
    <StoryProviders config={{ sandbox: { network: "deny" } }} features={{ sandboxControls: true }}>
      <div style={{ height: "700px", display: "flex", "flex-direction": "column" }}>
        <Settings tab="sandboxing" />
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

/** Opens the Disabled Providers collapsible on mount so the expanded list has coverage. */
function OpenDisabledProviders() {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      ref?.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')?.click()
    })
  })
  return (
    <div ref={ref} style={{ "max-height": "700px", overflow: "auto" }}>
      <ProvidersTab />
    </div>
  )
}

export const ProvidersDisabledExpanded: Story = {
  name: "ProvidersTab — disabled providers expanded",
  render: () => (
    <StoryProviders config={{ disabled_providers: ["openai", "anthropic"] } as any}>
      <OpenDisabledProviders />
    </StoryProviders>
  ),
}

export const ModelsAutocompleteOpen: Story = {
  name: "ModelsTab — autocomplete model picker open",
  render: () => (
    <StoryProviders config={{} as any}>
      <OpenModelPicker>
        <ModelsTab />
      </OpenModelPicker>
    </StoryProviders>
  ),
}

export const ModelsAccessibleLabels: Story = {
  name: "ModelsTab — accessible model labels",
  render: () => (
    <StoryProviders config={{} as any}>
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <ModelsTab />
      </div>
    </StoryProviders>
  ),
}

export const ModelsSpeechToText: Story = {
  name: "ModelsTab — speech-to-text model",
  render: () => (
    <StoryProviders kiloAuth config={{ experimental: { speech_to_text_model: "google/chirp-3" } } as any}>
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <ModelsTab />
      </div>
    </StoryProviders>
  ),
}

function OpenModelPicker(props: { children: any }) {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      ref?.querySelector<HTMLButtonElement>('button[title="mistralai/codestral-2508"]')?.click()
    })
  })
  return (
    <div ref={ref} style={{ "max-height": "700px", overflow: "auto" }}>
      {props.children}
    </div>
  )
}

const work: WorkStyleContextValue = {
  style: () => "unset",
  loading: () => false,
  applying: () => false,
  shouldShowOnboarding: () => true,
  apply: noop,
}

function WorkStyleOnboarding() {
  return (
    <StoryProviders noPadding>
      <WorkStyleContext.Provider value={work}>
        <div style={{ height: "700px", overflow: "auto" }}>
          <SidebarEmptyState />
        </div>
      </WorkStyleContext.Provider>
    </StoryProviders>
  )
}

export const WorkStyleOnboardingDefault: Story = {
  name: "Work style onboarding — default width",
  render: () => <WorkStyleOnboarding />,
}

export const WorkStyleOnboarding200: Story = {
  name: "Work style onboarding — narrow width",
  render: () => <WorkStyleOnboarding />,
}

export const AgentBehaviourAgents: Story = {
  name: "AgentBehaviourTab — available agents list",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "agents-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeAgent: noop,
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
      removeAgent: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    const cfg: Record<string, AgentConfig> = {
      reviewer: {
        description: "Review code for quality and best practices",
        prompt: "You are a code reviewer. Focus on code quality, best practices, and potential bugs.",
        model: "kilo/anthropic/claude-sonnet-4-6",
        variant: "high",
        temperature: 0.3,
        permission: {
          read: "allow",
          grep: "allow",
          glob: "allow",
          edit: "deny",
          bash: "deny",
          task: "ask",
        },
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
      removeAgent: noop,
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
      removeAgent: noop,
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
      removeAgent: noop,
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

export const ModeEditPermissions: Story = {
  name: "ModeEditView — per-agent permissions",
  render: () => {
    const cfg: Record<string, AgentConfig> = {
      reviewer: {
        description: "Review code without editing it",
        prompt: "Find bugs, regressions, and missing tests.",
        permission: {
          "*": "deny",
          read: "allow",
          grep: "allow",
          glob: "allow",
          edit: { "*": "deny", "**/*.md": "allow" },
          bash: "deny",
          task: "ask",
          skill: "deny",
        },
      },
    }
    const session = {
      ...mockSessionValue({ id: "permissions-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeAgent: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders
        sessionID="permissions-story"
        status="idle"
        config={{ permission: { bash: "ask", external_directory: "ask" }, agent: cfg } as any}
      >
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "460px", height: "760px", overflow: "auto" }}>
            <ModeEditView name="reviewer" onBack={noop} onRemove={noop} />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const IndexingProviderBlurRace: Story = {
  name: "IndexingTab",
  render: () => {
    const [saved, setSaved] = createSignal<Record<string, unknown>>({})
    const cfg: Config = {
      indexing: {
        provider: "openai",
        model: "text-embedding-3-large",
        dimension: 3072,
        openai: { apiKey: "" },
        gemini: { apiKey: "" },
      },
    }
    return (
      <>
        <StoryProviders
          config={cfg}
          onConfigChange={(next: Config) => setSaved((next.indexing ?? {}) as Record<string, unknown>)}
        >
          <div style={{ width: "420px", "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </StoryProviders>
        <pre data-testid="indexing-provider-save">{JSON.stringify(saved(), null, 2)}</pre>
      </>
    )
  },
}

export const IndexingScopeSwitch: Story = {
  name: "IndexingTab - global and local scopes",
  render: () => {
    const [global, setGlobal] = createSignal<Record<string, unknown>>({})
    const [project, setProject] = createSignal<Record<string, unknown>>({})
    const globalConfig: Config = {
      indexing: {
        enabled: true,
        provider: "openai",
        model: "text-embedding-3-large",
        dimension: 3072,
        vectorStore: "qdrant",
        openai: { apiKey: "global-secret" },
        qdrant: { url: "http://global:6333", apiKey: "global-qdrant" },
        searchMinScore: 0.4,
      },
    }
    const projectConfig: Config = {
      indexing: {
        model: null,
        qdrant: { apiKey: "project-qdrant" },
      },
    }
    return (
      <>
        <StoryProviders
          config={globalConfig}
          globalConfig={globalConfig}
          projectConfig={projectConfig}
          onGlobalConfigChange={(next) => setGlobal((next.indexing ?? {}) as Record<string, unknown>)}
          onProjectConfigChange={(next) => setProject((next.indexing ?? {}) as Record<string, unknown>)}
        >
          <div style={{ width: "420px", "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </StoryProviders>
        <pre data-testid="indexing-global-save">{JSON.stringify(global(), null, 2)}</pre>
        <pre data-testid="indexing-project-save">{JSON.stringify(project(), null, 2)}</pre>
      </>
    )
  },
}

export const IndexingKiloModelPreset: Story = {
  name: "IndexingTab - Kilo stale custom model fallback",
  render: () => {
    const cfg: Config = {
      indexing: {
        provider: "kilo",
        model: "custom/model",
        dimension: 2048,
      },
    }
    const catalog = {
      defaultModel: "provider/model",
      models: [
        { id: "provider/model", name: "Provider Model", dimension: 1024, scoreThreshold: 0.4 },
        { id: "provider/compact", name: "Provider Compact", dimension: 512, scoreThreshold: 0.35 },
      ],
      aliases: {},
    }
    return (
      <StoryProviders config={cfg}>
        <KiloEmbeddingModelsContext.Provider value={{ catalog: () => catalog }}>
          <div style={{ "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </KiloEmbeddingModelsContext.Provider>
      </StoryProviders>
    )
  },
}

export const IndexingKiloCatalogLoading: Story = {
  name: "IndexingTab - Kilo catalog loading",
  render: () => {
    const [saved, setSaved] = createSignal<Record<string, unknown>>({})
    const cfg: Config = {
      indexing: {},
    }
    return (
      <>
        <StoryProviders
          config={cfg}
          kiloAuth
          onConfigChange={(next: Config) => setSaved((next.indexing ?? {}) as Record<string, unknown>)}
        >
          <div style={{ "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </StoryProviders>
        <pre data-testid="indexing-kilo-loading-save">{JSON.stringify(saved(), null, 2)}</pre>
      </>
    )
  },
}
