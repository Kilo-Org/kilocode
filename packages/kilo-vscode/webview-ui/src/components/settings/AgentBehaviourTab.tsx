import { Component, createSignal, createMemo, For, Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { AgentConfig } from "../../types/messages"

type SubtabId = "agents" | "mcpServers" | "rules" | "workflows" | "skills"

interface SubtabConfig {
  id: SubtabId
  labelKey: string
}

const subtabs: SubtabConfig[] = [
  { id: "agents", labelKey: "settings.agentBehaviour.subtab.agents" },
  { id: "mcpServers", labelKey: "settings.agentBehaviour.subtab.mcpServers" },
  { id: "rules", labelKey: "settings.agentBehaviour.subtab.rules" },
  { id: "workflows", labelKey: "settings.agentBehaviour.subtab.workflows" },
  { id: "skills", labelKey: "settings.agentBehaviour.subtab.skills" },
]

interface SelectOption {
  value: string
  label: string
}

import SettingsRow from "./SettingsRow"

const Placeholder: Component<{ text: string }> = (props) => (
  <Card>
    <p
      style={{
        "font-size": "12px",
        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
        margin: 0,
        "line-height": "1.5",
      }}
    >
      <strong>{useLanguage().t("settings.agentBehaviour.notImplemented")}</strong> {props.text}
    </p>
  </Card>
)

const AgentBehaviourTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const session = useSession()
  const [activeSubtab, setActiveSubtab] = createSignal<SubtabId>("agents")
  const [selectedAgent, setSelectedAgent] = createSignal<string>("")
  const [newSkillPath, setNewSkillPath] = createSignal("")
  const [newSkillUrl, setNewSkillUrl] = createSignal("")
  const [newInstruction, setNewInstruction] = createSignal("")

  const agentNames = createMemo(() => {
    const names = session.agents().map((a) => a.name)
    // Also include any agents from config that might not be in the agent list
    const configAgents = Object.keys(config().agent ?? {})
    for (const name of configAgents) {
      if (!names.includes(name)) {
        names.push(name)
      }
    }
    return names.sort()
  })

  const defaultAgentOptions = createMemo<SelectOption[]>(() => [
    { value: "", label: language.t("common.default") },
    ...agentNames().map((name) => ({ value: name, label: name })),
  ])

  const agentSelectorOptions = createMemo<SelectOption[]>(() => [
    { value: "", label: language.t("settings.agentBehaviour.selectAgent") },
    ...agentNames().map((name) => ({ value: name, label: name })),
  ])

  const currentAgentConfig = createMemo<AgentConfig>(() => {
    const name = selectedAgent()
    if (!name) {
      return {}
    }
    return config().agent?.[name] ?? {}
  })

  const updateAgentConfig = (name: string, partial: Partial<AgentConfig>) => {
    const existing = config().agent ?? {}
    const current = existing[name] ?? {}
    updateConfig({
      agent: {
        ...existing,
        [name]: { ...current, ...partial },
      },
    })
  }

  const instructions = () => config().instructions ?? []

  const addInstruction = () => {
    const value = newInstruction().trim()
    if (!value) {
      return
    }
    const current = [...instructions()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ instructions: current })
    }
    setNewInstruction("")
  }

  const removeInstruction = (index: number) => {
    const current = [...instructions()]
    current.splice(index, 1)
    updateConfig({ instructions: current })
  }

  const skillPaths = () => config().skills?.paths ?? []
  const skillUrls = () => config().skills?.urls ?? []

  const addSkillPath = () => {
    const value = newSkillPath().trim()
    if (!value) {
      return
    }
    const current = [...skillPaths()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ skills: { ...config().skills, paths: current } })
    }
    setNewSkillPath("")
  }

  const removeSkillPath = (index: number) => {
    const current = [...skillPaths()]
    current.splice(index, 1)
    updateConfig({ skills: { ...config().skills, paths: current } })
  }

  const addSkillUrl = () => {
    const value = newSkillUrl().trim()
    if (!value) {
      return
    }
    const current = [...skillUrls()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ skills: { ...config().skills, urls: current } })
    }
    setNewSkillUrl("")
  }

  const removeSkillUrl = (index: number) => {
    const current = [...skillUrls()]
    current.splice(index, 1)
    updateConfig({ skills: { ...config().skills, urls: current } })
  }

  const renderAgentsSubtab = () => (
    <div>
      {/* Default agent */}
      <Card style={{ "margin-bottom": "12px" }}>
        <SettingsRow
          title={language.t("settings.agentBehaviour.defaultAgent.title")}
          description={language.t("settings.agentBehaviour.defaultAgent.description")}
          last
        >
          <Select
            options={defaultAgentOptions()}
            current={defaultAgentOptions().find((o) => o.value === (config().default_agent ?? ""))}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => o && updateConfig({ default_agent: o.value || undefined })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
      </Card>

      {/* Agent selector */}
      <div style={{ "margin-bottom": "12px" }}>
        <Select
          options={agentSelectorOptions()}
          current={agentSelectorOptions().find((o) => o.value === selectedAgent())}
          value={(o) => o.value}
          label={(o) => o.label}
          onSelect={(o) => o && setSelectedAgent(o.value)}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </div>

      <Show when={selectedAgent()}>
        <Card>
          {/* Model override */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.modelOverride.title")}
            description={language.t("settings.agentBehaviour.modelOverride.description")}
          >
            <TextField
              value={currentAgentConfig().model ?? ""}
              placeholder="e.g. anthropic/claude-sonnet-4-20250514"
              onChange={(val) =>
                updateAgentConfig(selectedAgent(), {
                  model: val.trim() || undefined,
                })
              }
            />
          </SettingsRow>

          {/* System prompt */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.prompt.title")}
            description={language.t("settings.agentBehaviour.prompt.description")}
          >
            <TextField
              value={currentAgentConfig().prompt ?? ""}
              placeholder="Custom instructions…"
              multiline
              onChange={(val) =>
                updateAgentConfig(selectedAgent(), {
                  prompt: val.trim() || undefined,
                })
              }
            />
          </SettingsRow>

          {/* Temperature */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.temperature.title")}
            description={language.t("settings.agentBehaviour.temperature.description")}
          >
            <TextField
              value={currentAgentConfig().temperature?.toString() ?? ""}
              placeholder={language.t("common.default")}
              onChange={(val) => {
                const parsed = parseFloat(val)
                updateAgentConfig(selectedAgent(), { temperature: isNaN(parsed) ? undefined : parsed })
              }}
            />
          </SettingsRow>

          {/* Top-p */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.topP.title")}
            description={language.t("settings.agentBehaviour.topP.description")}
          >
            <TextField
              value={currentAgentConfig().top_p?.toString() ?? ""}
              placeholder={language.t("common.default")}
              onChange={(val) => {
                const parsed = parseFloat(val)
                updateAgentConfig(selectedAgent(), { top_p: isNaN(parsed) ? undefined : parsed })
              }}
            />
          </SettingsRow>

          {/* Max steps */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.maxSteps.title")}
            description={language.t("settings.agentBehaviour.maxSteps.description")}
            last
          >
            <TextField
              value={currentAgentConfig().steps?.toString() ?? ""}
              placeholder={language.t("common.default")}
              onChange={(val) => {
                const parsed = parseInt(val, 10)
                updateAgentConfig(selectedAgent(), { steps: isNaN(parsed) ? undefined : parsed })
              }}
            />
          </SettingsRow>
        </Card>
      </Show>
    </div>
  )

  const renderMcpSubtab = () => {
    const mcpEntries = createMemo(() => Object.entries(config().mcp ?? {}))

    return (
      <div>
        <Show
          when={mcpEntries().length > 0}
          fallback={
            <Card>
              <div
                style={{
                  "font-size": "12px",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                }}
              >
                {language.t("settings.agentBehaviour.mcpEmpty")}
              </div>
            </Card>
          }
        >
          <Card>
            <For each={mcpEntries()}>
              {([name, mcp], index) => (
                <div
                  style={{
                    padding: "8px 0",
                    "border-bottom": index() < mcpEntries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                  }}
                >
                  <div style={{ "font-weight": "500" }}>{name}</div>
                  <div
                    style={{
                      "font-size": "11px",
                      color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                      "margin-top": "4px",
                      "font-family": "var(--vscode-editor-font-family, monospace)",
                    }}
                  >
                    <Show when={mcp.command}>
                      <div>
                        command: {mcp.command} {(mcp.args ?? []).join(" ")}
                      </div>
                    </Show>
                    <Show when={mcp.url}>
                      <div>url: {mcp.url}</div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Card>
        </Show>
      </div>
    )
  }

  const renderSkillsSubtab = () => (
    <div>
      {/* Skill paths */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentBehaviour.skillPaths")}</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": skillPaths().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newSkillPath()}
              placeholder="e.g. ./skills"
              onChange={(val) => setNewSkillPath(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addSkillPath()
              }}
            />
          </div>
          <Button size="small" onClick={addSkillPath}>
            {language.t("common.add")}
          </Button>
        </div>
        <For each={skillPaths()}>
          {(path, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < skillPaths().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "12px",
                }}
              >
                {path}
              </span>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => removeSkillPath(index())} />
            </div>
          )}
        </For>
      </Card>

      {/* Skill URLs */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentBehaviour.skillUrls")}</h4>
      <Card>
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": skillUrls().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newSkillUrl()}
              placeholder="e.g. https://example.com/skills"
              onChange={(val) => setNewSkillUrl(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addSkillUrl()
              }}
            />
          </div>
          <Button size="small" onClick={addSkillUrl}>
            {language.t("common.add")}
          </Button>
        </div>
        <For each={skillUrls()}>
          {(url, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < skillUrls().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "12px",
                }}
              >
                {url}
              </span>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => removeSkillUrl(index())} />
            </div>
          )}
        </For>
      </Card>
    </div>
  )

  const renderRulesSubtab = () => (
    <div>
      <Card>
        <div
          style={{
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          <div style={{ "font-weight": "500" }}>{language.t("settings.agentBehaviour.instructionFiles")}</div>
          <div
            style={{
              "font-size": "11px",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-top": "2px",
            }}
          >
            {language.t("settings.agentBehaviour.instructionFiles.description")}
          </div>
        </div>

        {/* Add new instruction path */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": instructions().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newInstruction()}
              placeholder="e.g. ./INSTRUCTIONS.md"
              onChange={(val) => setNewInstruction(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addInstruction()
              }}
            />
          </div>
          <Button size="small" onClick={addInstruction}>
            {language.t("common.add")}
          </Button>
        </div>

        {/* Instructions list */}
        <For each={instructions()}>
          {(path, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < instructions().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "12px",
                }}
              >
                {path}
              </span>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => removeInstruction(index())} />
            </div>
          )}
        </For>
      </Card>
    </div>
  )

  const renderSubtabContent = () => {
    switch (activeSubtab()) {
      case "agents":
        return renderAgentsSubtab()
      case "mcpServers":
        return renderMcpSubtab()
      case "rules":
        return renderRulesSubtab()
      case "workflows":
        return <Placeholder text={language.t("settings.agentBehaviour.workflowsPlaceholder")} />
      case "skills":
        return renderSkillsSubtab()
      default:
        return null
    }
  }

  return (
    <div>
      {/* Horizontal subtab bar */}
      <div
        style={{
          display: "flex",
          gap: "0",
          "border-bottom": "1px solid var(--vscode-panel-border)",
          "margin-bottom": "16px",
        }}
      >
        <For each={subtabs}>
          {(subtab) => (
            <button
              onClick={() => setActiveSubtab(subtab.id)}
              style={{
                padding: "8px 16px",
                border: "none",
                background: "transparent",
                color:
                  activeSubtab() === subtab.id ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                "font-size": "13px",
                "font-family": "var(--vscode-font-family)",
                cursor: "pointer",
                "border-bottom":
                  activeSubtab() === subtab.id ? "2px solid var(--vscode-foreground)" : "2px solid transparent",
                "margin-bottom": "-1px",
              }}
              onMouseEnter={(e) => {
                if (activeSubtab() !== subtab.id) {
                  e.currentTarget.style.color = "var(--vscode-foreground)"
                }
              }}
              onMouseLeave={(e) => {
                if (activeSubtab() !== subtab.id) {
                  e.currentTarget.style.color = "var(--vscode-descriptionForeground)"
                }
              }}
            >
              {language.t(subtab.labelKey)}
            </button>
          )}
        </For>
      </div>

      {/* Subtab content */}
      {renderSubtabContent()}
    </div>
  )
}

export default AgentBehaviourTab
