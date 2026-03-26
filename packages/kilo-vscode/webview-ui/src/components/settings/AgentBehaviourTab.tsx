import { Component, createSignal, createMemo, createEffect, For, Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"

import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { AgentInfo, SkillInfo } from "../../types/messages"
import ModeEditView from "./ModeEditView"
import ModeCreateView from "./ModeCreateView"
import McpEditView from "./McpEditView"
import WorkflowsTab from "./agent-behaviour/WorkflowsTab"
import { parseImport, MAX_IMPORT_SIZE } from "./mode-io"
import type { ImportError } from "./mode-io"

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

// View states for the agents subtab
type AgentView = "list" | "create" | "edit"

const AgentBehaviourTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const session = useSession()
  const dialog = useDialog()
  const [activeSubtab, setActiveSubtab] = createSignal<SubtabId>("agents")
  const [newSkillPath, setNewSkillPath] = createSignal("")
  const [newSkillUrl, setNewSkillUrl] = createSignal("")
  const [newInstruction, setNewInstruction] = createSignal("")

  // Agent view state
  const [agentView, setAgentView] = createSignal<AgentView>("list")
  const [editingAgent, setEditingAgent] = createSignal<string>("")

  // MCP view state
  const [editingMcp, setEditingMcp] = createSignal<string>("")

  // Fetch skills whenever the skills subtab becomes active
  createEffect(() => {
    if (activeSubtab() === "skills") {
      session.refreshSkills()
    }
  })

  const agentNames = createMemo(() => {
    const names = session.agents().map((a) => a.name)
    // Also include any agents from config that might not be in the agent list
    const agents = Object.keys(config().agent ?? {})
    for (const name of agents) {
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

  const confirmRemoveSkill = (skill: SkillInfo) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.removeSkill.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.agentBehaviour.removeSkill.confirm", { name: skill.name })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                session.removeSkill(skill.location)
                dialog.close()
              }}
            >
              {language.t("settings.agentBehaviour.removeSkill.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const removableModes = createMemo(() => session.agents().filter((a) => !a.native))

  const confirmRemoveMode = (agent: AgentInfo) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.removeMode.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.agentBehaviour.removeMode.confirm", { name: agent.name })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                // Delay optimistic removal until after dialog close animation (100ms)
                // to prevent the reactive list re-render from firing click handlers
                // on shifted list items while the dialog overlay is still present.
                setTimeout(() => {
                  session.removeMode(agent.name)
                  // If we were editing this mode, go back to list
                  if (editingAgent() === agent.name) {
                    setAgentView("list")
                    setEditingAgent("")
                  }
                }, 150)
              }}
            >
              {language.t("settings.agentBehaviour.removeMode.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const startEdit = (name: string) => {
    setEditingAgent(name)
    setAgentView("edit")
  }

  const back = () => {
    setAgentView("list")
    setEditingAgent("")
  }

  const [importError, setImportError] = createSignal("")

  const errorKey = (tag: ImportError) => `settings.agentBehaviour.importMode.${tag}` as const

  const importMode = (file: File) => {
    setImportError("")
    if (file.size > MAX_IMPORT_SIZE) {
      setImportError(language.t(errorKey("tooLarge")))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = parseImport(reader.result as string, agentNames())
      if (!result.ok) {
        setImportError(language.t(errorKey(result.error)))
        return
      }
      const existing = config().agent ?? {}
      updateConfig({ agent: { ...existing, [result.name]: result.config } })
      setImportError("")
    }
    reader.readAsText(file)
  }

  const triggerImport = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json"
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) importMode(file)
    }
    input.click()
  }

  const renderAgentsSubtab = () => {
    const view = agentView()
    if (view === "create") return <ModeCreateView taken={agentNames()} onBack={back} />
    if (view === "edit") return <ModeEditView name={editingAgent()} onBack={back} onRemove={confirmRemoveMode} />

    return (
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
              onSelect={(o) => {
                if (!o) return
                const next = o.value || undefined
                if (next === (config().default_agent ?? undefined)) return
                updateConfig({ default_agent: next })
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
        </Card>

        {/* Available agents list header + create button */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            "margin-bottom": "8px",
            "margin-top": "16px",
          }}
        >
          <div data-slot="settings-row-label-title">{language.t("settings.agentBehaviour.availableAgents")}</div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="ghost" size="small" onClick={triggerImport}>
              {language.t("settings.agentBehaviour.importMode")}
            </Button>
            <Button variant="secondary" size="small" onClick={() => setAgentView("create")}>
              {language.t("settings.agentBehaviour.createMode")}
            </Button>
          </div>
        </div>

        <Show when={importError()}>
          <div
            style={{
              "font-size": "12px",
              color: "var(--vscode-errorForeground)",
              "margin-bottom": "8px",
            }}
          >
            {importError()}
          </div>
        </Show>

        {/* Agents list - clickable to edit */}
        <Show
          when={agentNames().length > 0}
          fallback={
            <Card style={{ "margin-bottom": "12px" }}>
              <div
                style={{
                  "font-size": "12px",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                }}
              >
                {language.t("settings.agentBehaviour.noModesFound")}
              </div>
            </Card>
          }
        >
          <Card style={{ "margin-bottom": "12px" }}>
            <For each={agentNames()}>
              {(name, index) => {
                const agent = () => session.agents().find((a) => a.name === name)
                const isCustom = () => !agent()?.native
                const agentCfg = () => config().agent?.[name] ?? {}
                const disabled = () => agentCfg().disable ?? false
                const hidden = () => agentCfg().hidden ?? false
                return (
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "space-between",
                      padding: "8px 4px",
                      "border-bottom": index() < agentNames().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                      "border-radius": "4px",
                      cursor: "pointer",
                      opacity: disabled() ? "0.5" : "1",
                    }}
                    onClick={() => startEdit(name)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover-base, var(--vscode-list-hoverBackground))"
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent"
                    }}
                  >
                    <div style={{ flex: 1, "min-width": 0 }}>
                      <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                        <div style={{ "font-weight": "500", "font-size": "13px" }}>{name}</div>
                        <Show when={isCustom()}>
                          <span
                            style={{
                              "font-size": "10px",
                              padding: "1px 5px",
                              "border-radius": "3px",
                              background: "var(--bg-subtle-base, var(--vscode-badge-background))",
                              color: "var(--text-weak-base, var(--vscode-badge-foreground))",
                            }}
                          >
                            custom
                          </span>
                        </Show>
                        <Show when={hidden()}>
                          <span
                            style={{
                              "font-size": "10px",
                              padding: "1px 5px",
                              "border-radius": "3px",
                              background: "var(--bg-subtle-base, var(--vscode-badge-background))",
                              color: "var(--text-weak-base, var(--vscode-badge-foreground))",
                            }}
                          >
                            {language.t("settings.agentBehaviour.badge.hidden")}
                          </span>
                        </Show>
                        <Show when={disabled()}>
                          <span
                            style={{
                              "font-size": "10px",
                              padding: "1px 5px",
                              "border-radius": "3px",
                              background: "var(--vscode-errorForeground, #f44)",
                              color: "var(--vscode-errorForeground-foreground, #fff)",
                            }}
                          >
                            {language.t("settings.agentBehaviour.badge.disabled")}
                          </span>
                        </Show>
                      </div>
                      <Show when={agent()?.description}>
                        <div
                          style={{
                            "font-size": "11px",
                            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                            "margin-top": "2px",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {agent()!.description}
                        </div>
                      </Show>
                    </div>
                    <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                      <Show when={isCustom()}>
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon="close"
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            const a = agent()
                            if (a) confirmRemoveMode(a)
                          }}
                        />
                      </Show>
                      <IconButton size="small" variant="ghost" icon="chevron-right" />
                    </div>
                  </div>
                )
              }}
            </For>
          </Card>
        </Show>
      </div>
    )
  }

  const confirmRemoveMcp = (name: string) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.removeMcp.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.agentBehaviour.removeMcp.confirm", { name })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                setTimeout(() => session.removeMcp(name), 150)
              }}
            >
              {language.t("settings.agentBehaviour.removeMcp.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const renderMcpSubtab = () => {
    const mcpEntries = createMemo(() => Object.entries(config().mcp ?? {}))
    const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})

    const toggle = (name: string) => {
      setExpanded((prev) => ({ ...prev, [name]: !prev[name] }))
    }

    if (editingMcp()) {
      return (
        <McpEditView
          name={editingMcp()}
          onBack={() => setEditingMcp("")}
          onRemove={(name) => {
            confirmRemoveMcp(name)
            setEditingMcp("")
          }}
        />
      )
    }

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
              {([name, mcp], index) => {
                const open = () => expanded()[name] ?? false
                const env = () => Object.entries(mcp.environment ?? mcp.env ?? {})
                return (
                  <div
                    style={{
                      "border-bottom": index() < mcpEntries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                    }}
                  >
                    {/* Header row */}
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "space-between",
                        padding: "8px 0",
                        cursor: "pointer",
                      }}
                      onClick={() => toggle(name)}
                    >
                      <div style={{ display: "flex", "align-items": "center", gap: "6px", flex: 1, "min-width": 0 }}>
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon={open() ? "chevron-down" : "chevron-right"}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            toggle(name)
                          }}
                        />
                        <div style={{ "font-weight": "500" }}>{name}</div>
                        <span
                          style={{
                            "font-size": "10px",
                            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                          }}
                        >
                          {mcp.url ? "remote" : "stdio"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "4px" }}>
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon="close"
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            confirmRemoveMcp(name)
                          }}
                        />
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon="chevron-right"
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            setEditingMcp(name)
                          }}
                        />
                      </div>
                    </div>

                    {/* Expandable detail */}
                    <Show when={open()}>
                      <div
                        style={{
                          "padding-left": "28px",
                          "padding-bottom": "8px",
                          "font-size": "12px",
                          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        }}
                      >
                        <Show when={mcp.command}>
                          <div style={{ "margin-bottom": "4px" }}>
                            <span style={{ "font-weight": "500" }}>
                              {language.t("settings.agentBehaviour.mcpDetail.command")}:{" "}
                            </span>
                            <span style={{ "font-family": "var(--vscode-editor-font-family, monospace)" }}>
                              {Array.isArray(mcp.command) ? mcp.command[0] : mcp.command}
                            </span>
                          </div>
                          <Show
                            when={
                              (Array.isArray(mcp.command) && mcp.command.length > 1) ||
                              (!Array.isArray(mcp.command) && mcp.args && mcp.args.length > 0)
                            }
                          >
                            <div style={{ "margin-bottom": "4px" }}>
                              <span style={{ "font-weight": "500" }}>
                                {language.t("settings.agentBehaviour.mcpDetail.args")}:{" "}
                              </span>
                              <span style={{ "font-family": "var(--vscode-editor-font-family, monospace)" }}>
                                {Array.isArray(mcp.command)
                                  ? (mcp.command as string[]).slice(1).join(" ")
                                  : (mcp.args ?? []).join(" ")}
                              </span>
                            </div>
                          </Show>
                        </Show>
                        <Show when={mcp.url}>
                          <div style={{ "margin-bottom": "4px" }}>
                            <span style={{ "font-weight": "500" }}>URL: </span>
                            <span style={{ "font-family": "var(--vscode-editor-font-family, monospace)" }}>
                              {mcp.url}
                            </span>
                          </div>
                        </Show>
                        <Show when={env().length > 0}>
                          <div style={{ "margin-bottom": "4px" }}>
                            <span style={{ "font-weight": "500" }}>
                              {language.t("settings.agentBehaviour.mcpDetail.env")}:
                            </span>
                          </div>
                          <For each={env()}>
                            {([key, val]) => (
                              <div
                                style={{
                                  "padding-left": "8px",
                                  "font-family": "var(--vscode-editor-font-family, monospace)",
                                }}
                              >
                                {key}={val}
                              </div>
                            )}
                          </For>
                        </Show>
                        <Show when={mcp.enabled === false}>
                          <div
                            style={{
                              "margin-top": "4px",
                              color: "var(--vscode-errorForeground)",
                            }}
                          >
                            {language.t("settings.agentBehaviour.mcpDetail.disabled")}
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </Card>
        </Show>
      </div>
    )
  }

  const renderSkillsSubtab = () => (
    <div>
      {/* Discovered skills */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>
        {language.t("settings.agentBehaviour.discoveredSkills")}
      </h4>
      <Show
        when={session.skills().length > 0}
        fallback={
          <Card style={{ "margin-bottom": "16px" }}>
            <div data-slot="settings-row-label-subtitle">{language.t("settings.agentBehaviour.noSkillsFound")}</div>
          </Card>
        }
      >
        <Card style={{ "margin-bottom": "16px" }}>
          <For each={session.skills()}>
            {(skill, index) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "8px 0",
                  "border-bottom": index() < session.skills().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div data-slot="settings-row-label-title" style={{ "margin-bottom": "0" }}>
                    {skill.name}
                  </div>
                  <div
                    data-slot="settings-row-label-subtitle"
                    style={{
                      "margin-top": "4px",
                      "font-family": "var(--vscode-editor-font-family, monospace)",
                    }}
                  >
                    <div>{skill.description}</div>
                    <div>{skill.location}</div>
                  </div>
                </div>
                <IconButton size="small" variant="ghost" icon="close" onClick={() => confirmRemoveSkill(skill)} />
              </div>
            )}
          </For>
        </Card>
      </Show>

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
          <Button variant="secondary" onClick={addSkillPath}>
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
          <Button variant="secondary" onClick={addSkillUrl}>
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
      {/* Description */}
      <div
        style={{
          "font-size": "12px",
          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
          "margin-bottom": "12px",
          "line-height": "1.5",
        }}
      >
        {language.t("settings.agentBehaviour.rules.description")}
      </div>

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
              "font-size": "12px",
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
          <Button variant="secondary" onClick={addInstruction}>
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
        return <WorkflowsTab />
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
              onClick={() => {
                setActiveSubtab(subtab.id)
                // Reset views when switching subtabs
                if (subtab.id === "agents") {
                  setAgentView("list")
                  setEditingAgent("")
                }
                setEditingMcp("")
              }}
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
