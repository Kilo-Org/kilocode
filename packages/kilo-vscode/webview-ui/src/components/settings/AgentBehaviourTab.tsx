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
          <Button variant="secondary" size="small" onClick={() => setAgentView("create")}>
            {language.t("settings.agentBehaviour.createMode")}
          </Button>
        </div>

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
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    padding: "8px 0",
                    "border-bottom": index() < mcpEntries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                  }}
                >
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{ "font-weight": "500" }}>{name}</div>
                    <div
                      style={{
                        "font-size": "12px",
                        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        "margin-top": "4px",
                        "font-family": "var(--vscode-editor-font-family, monospace)",
                      }}
                    >
                      <Show when={mcp.command}>
                        <div>
                          command:{" "}
                          {Array.isArray(mcp.command)
                            ? mcp.command.join(" ")
                            : `${mcp.command} ${(mcp.args ?? []).join(" ")}`}
                        </div>
                      </Show>
                      <Show when={mcp.url}>
                        <div>url: {mcp.url}</div>
                      </Show>
                    </div>
                  </div>
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    onClick={(e: MouseEvent) => {
                      e.stopPropagation()
                      confirmRemoveMcp(name)
                    }}
                  />
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
              onClick={() => {
                setActiveSubtab(subtab.id)
                // Reset agent view when switching subtabs
                if (subtab.id === "agents") {
                  setAgentView("list")
                  setEditingAgent("")
                }
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
