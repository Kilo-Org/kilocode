import { Component, createSignal, createMemo, createEffect, For, Show, onCleanup } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Spinner } from "@kilocode/kilo-ui/spinner"

import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { AgentInfo, ExtensionMessage, SkillInfo } from "../../types/messages"
import ModeEditView from "./ModeEditView"
import ModeCreateView from "./ModeCreateView"
import McpEditView from "./McpEditView"
import WorkflowsTab from "./agent-behaviour/WorkflowsTab"
import {
  mcpConfigScope,
  mcpEnabledPatch,
  mcpStatusDetailVisible,
  mcpStatusError,
  pruneMcpExpanded,
  removable,
  selectedDefaultAgentValue,
} from "./agent-behaviour-patches"
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

const builtin = (skill: SkillInfo) => skill.location === "builtin" || skill.location === "<built-in>"

// View states for the agents subtab
type AgentView = "list" | "create" | "edit"

interface Props {
  /** Deep-linked subtab, e.g. from the prompt's session-issues menu or Settings navigation. */
  subtab?: string
  /** Deep-linked row to expand and scroll into view once its subtab is active. The token makes repeat requests for the same name observable. */
  focus?: { token: number; value: string }
  onNavigationConsumed?: () => void
}

const AgentBehaviourTab: Component<Props> = (props) => {
  const language = useLanguage()
  const { config, collections, settings, updateConfig, updateGlobalConfig, updateProjectConfig, updateSetting } =
    useConfig()
  const session = useSession()
  const dialog = useDialog()
  const vscode = useVSCode()
  const [activeSubtab, setActiveSubtab] = createSignal<SubtabId>("agents")
  const [stale, setStale] = createSignal<Set<SubtabId>>(new Set())
  const [newSkillPath, setNewSkillPath] = createSignal("")
  const [newSkillUrl, setNewSkillUrl] = createSignal("")
  const [newInstruction, setNewInstruction] = createSignal("")
  const [claudeCompat, setClaudeCompat] = createSignal(false)
  const browse = () => vscode.postMessage({ type: "openMarketplacePanel" })

  const unsubscribeInvalidation = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "agentBehaviourInvalidated") return
    setStale(new Set(subtabs.map((tab) => tab.id)))
  })
  onCleanup(unsubscribeInvalidation)

  createEffect(() => {
    const tab = activeSubtab()
    if (!stale().has(tab)) return
    vscode.postMessage({ type: "requestConfig" })
    if (tab === "agents") vscode.postMessage({ type: "requestAgents" })
    if (tab === "mcpServers") {
      vscode.postMessage({ type: "requestMcpStatus" })
      session.refreshMcpBundles()
    }
    if (tab === "skills") {
      session.refreshSkills()
      session.refreshMcpBundles()
    }
    if (tab === "workflows") vscode.postMessage({ type: "requestCommands" })
    setStale((current) => {
      const next = new Set(current)
      next.delete(tab)
      return next
    })
  })

  // MCP row expand/collapse, lifted out of renderMcpSubtab() so a deep-linked
  // focus request (from the prompt's "Open in Settings" action) can expand
  // and scroll to a specific server row.
  const [mcpExpanded, setMcpExpanded] = createSignal<Record<string, boolean>>({})
  const mcpRowRefs = new Map<string, HTMLElement>()

  createEffect(() => {
    const subtab = props.subtab
    const focus = props.focus
    if (!subtab && !focus) return
    if (subtab && subtabs.some((entry) => entry.id === subtab)) setActiveSubtab(subtab as SubtabId)
    if (focus) {
      setActiveSubtab("mcpServers")
      setMcpExpanded((prev) => ({ ...prev, [focus.value]: true }))
      queueMicrotask(() => mcpRowRefs.get(focus.value)?.scrollIntoView({ block: "nearest" }))
    }
    props.onNavigationConsumed?.()
  })

  createEffect(() => {
    const names = new Set(Object.keys(config().mcp ?? {}))
    for (const name of mcpRowRefs.keys()) {
      if (!names.has(name)) mcpRowRefs.delete(name)
    }
    setMcpExpanded((prev) => pruneMcpExpanded(prev, names))
  })
  onCleanup(() => mcpRowRefs.clear())

  // Load the VS Code setting for Claude Code compatibility
  vscode.postMessage({ type: "requestClaudeCompatSetting" })
  const unsubClaudeCompat = vscode.onMessage((msg) => {
    if (msg.type === "claudeCompatSettingLoaded") {
      setClaudeCompat(msg.enabled)
    }
  })
  onCleanup(unsubClaudeCompat)

  // Agent view state
  const [agentView, setAgentView] = createSignal<AgentView>("list")
  const [editingAgent, setEditingAgent] = createSignal<string>("")

  // MCP view state
  const [editingMcp, setEditingMcp] = createSignal<string>("")

  // Fetch skills whenever the skills subtab becomes active.
  createEffect(() => {
    if (activeSubtab() === "skills") {
      session.refreshSkills()
    }
  })

  // Fetch the marketplace MCP+companion-skill bundles on either subtab that
  // can trigger a bundle-aware removal confirmation (Skills removes a
  // companion skill and must offer to uninstall the whole MCP server;
  // MCP Servers removes a server and must mention the companion skills it owns).
  createEffect(() => {
    if (activeSubtab() === "skills" || activeSubtab() === "mcpServers") {
      session.refreshMcpBundles()
    }
  })

  const agentNames = createMemo(() => {
    // Exclude server-side hidden internal modes (compaction, title, summary)
    // from the list. Config-only agents are still added below.
    const names = session
      .allAgents()
      .filter((a) => !a.hidden)
      .map((a) => a.name)
    // Also include any agents from config that might not be in the agent list
    const agents = Object.keys(config().agent ?? {})
    for (const name of agents) {
      if (!names.includes(name)) {
        names.push(name)
      }
    }
    return names.sort()
  })

  // Default-agent picker must only show visible primary agents (not subagents
  // or hidden modes) since the CLI rejects those as default_agent values.
  const defaultAgentOptions = createMemo<SelectOption[]>(() => {
    const visible = session.agents().map((a) => a.name)
    return [
      { value: "", label: language.t("common.default") },
      ...visible.map((name) => ({ value: name, label: name })),
    ]
  })

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
    const bundle = session.mcpBundles().find((b) => b.skills.includes(skill.location))
    const message = bundle
      ? language.t("settings.agentBehaviour.removeSkill.bundleConfirm", { name: skill.name, mcp: bundle.id })
      : language.t("settings.agentBehaviour.removeSkill.confirm", { name: skill.name })
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.removeSkill.title")} fit>
        <div class="dialog-confirm-body">
          <span>{message}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                if (bundle) {
                  vscode.postMessage({ type: "removeMcp", name: bundle.id })
                } else {
                  session.removeSkill(skill.location)
                }
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

  const confirmRemoveMode = (agent: AgentInfo) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.removeAgent.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.agentBehaviour.removeAgent.confirm", { name: agent.name })}</span>
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
                  session.removeAgent(agent.name)
                  // If we were editing this mode, go back to list
                  if (editingAgent() === agent.name) {
                    setAgentView("list")
                    setEditingAgent("")
                  }
                }, 150)
              }}
            >
              {language.t("settings.agentBehaviour.removeAgent.button")}
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
          >
            <Select
              options={defaultAgentOptions()}
              current={defaultAgentOptions().find((o) => o.value === (config().default_agent ?? ""))}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => {
                if (!o) return
                const next = selectedDefaultAgentValue(o.value)
                if (next === (config().default_agent ?? null)) return
                updateConfig({ default_agent: next })
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.agentBehaviour.pushFixes.title")}
            description={language.t("settings.agentBehaviour.pushFixes.description")}
          >
            <Switch
              checked={settings()["agentManager.pushFixes"] !== false}
              onChange={(checked: boolean) => updateSetting("agentManager.pushFixes", checked)}
              hideLabel
            >
              {language.t("settings.agentBehaviour.pushFixes.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.agentBehaviour.sharedAgentBoard.title")}
            description={language.t("settings.agentBehaviour.sharedAgentBoard.description")}
            last
          >
            <Switch
              checked={config().shared_agent_board ?? true}
              onChange={(checked: boolean) => updateConfig({ shared_agent_board: checked })}
              hideLabel
            >
              {language.t("settings.agentBehaviour.sharedAgentBoard.title")}
            </Switch>
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
            <Button variant="ghost" size="small" onClick={browse}>
              {language.t("settings.agentBehaviour.mcpBrowseMarketplace")}
            </Button>
            <Button variant="secondary" size="small" onClick={() => setAgentView("create")}>
              {language.t("settings.agentBehaviour.createMode")}
            </Button>
          </div>
        </div>

        <Show when={importError()}>
          <div
            style={{
              "font-size": "var(--kilo-font-size-12)",
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
                  "font-size": "var(--kilo-font-size-12)",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                }}
              >
                {language.t("settings.agentBehaviour.noAgentsFound")}
              </div>
            </Card>
          }
        >
          <Card style={{ "margin-bottom": "12px" }}>
            <For each={agentNames()}>
              {(name, index) => {
                const agent = () => session.allAgents().find((a) => a.name === name)
                const isCustom = () => !agent()?.native
                const allowed = () => removable(agent())
                const agentCfg = () => config().agent?.[name] ?? {}
                const disabled = () => agentCfg().disable ?? false
                const hidden = () => agentCfg().hidden ?? false
                const deprecated = () => agent()?.deprecated ?? false
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
                        <div style={{ "font-weight": "500", "font-size": "var(--kilo-font-size-13)" }}>{name}</div>
                        <Show when={isCustom()}>
                          <span
                            style={{
                              "font-size": "var(--kilo-font-size-10)",
                              padding: "1px 5px",
                              "border-radius": "3px",
                              background: "var(--bg-subtle-base, var(--vscode-badge-background))",
                              color: "var(--text-weak-base, var(--vscode-badge-foreground))",
                            }}
                          >
                            custom
                          </span>
                        </Show>
                        <Show when={agent()?.mode === "subagent"}>
                          <span
                            style={{
                              "font-size": "var(--kilo-font-size-10)",
                              padding: "1px 5px",
                              "border-radius": "3px",
                              background: "var(--bg-subtle-base, var(--vscode-badge-background))",
                              color: "var(--text-weak-base, var(--vscode-badge-foreground))",
                            }}
                          >
                            {language.t("settings.agentBehaviour.badge.subagent")}
                          </span>
                        </Show>
                        <Show when={hidden()}>
                          <span
                            style={{
                              "font-size": "var(--kilo-font-size-10)",
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
                              "font-size": "var(--kilo-font-size-10)",
                              padding: "1px 5px",
                              "border-radius": "3px",
                              background: "var(--vscode-errorForeground, #f44)",
                              color: "var(--vscode-errorForeground-foreground, #fff)",
                            }}
                          >
                            {language.t("settings.agentBehaviour.badge.disabled")}
                          </span>
                        </Show>
                        <Show when={deprecated()}>
                          <span
                            style={{
                              "font-size": "var(--kilo-font-size-10)",
                              padding: "1px 5px",
                              "border-radius": "3px",
                              background: "var(--vscode-editorWarning-foreground, #cca700)",
                              color: "var(--vscode-editorWarning-foreground-text, #1e1e1e)",
                            }}
                          >
                            {language.t("settings.agentBehaviour.badge.deprecated")}
                          </span>
                        </Show>
                      </div>
                      <Show when={agent()?.description}>
                        <div
                          style={{
                            "font-size": "var(--kilo-font-size-11)",
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
                      <Show when={allowed()}>
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
    const bundled = session.mcpBundles().some((b) => b.id === name)
    const message = bundled
      ? language.t("settings.agentBehaviour.removeMcp.bundleConfirm", { name })
      : language.t("settings.agentBehaviour.removeMcp.confirm", { name })
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.removeMcp.title")} fit>
        <div class="dialog-confirm-body">
          <span>{message}</span>
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

  const confirmResetMcpAuth = (name: string) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.mcpResetAuth.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.agentBehaviour.mcpResetAuth.confirm", { name })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                setTimeout(() => session.resetMcpAuth(name), 150)
              }}
            >
              {language.t("settings.agentBehaviour.mcpResetAuth")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const renderMcpSubtab = () => {
    const mcpEntries = createMemo(() => Object.entries(config().mcp ?? {}))
    const expanded = mcpExpanded
    const setExpanded = setMcpExpanded

    const toggle = (name: string) => {
      setExpanded((prev) => ({ ...prev, [name]: !prev[name] }))
    }

    const statusColor = (name: string) => {
      const s = session.mcpStatus()[name]?.status
      if (s === "connected") return "var(--vscode-testing-iconPassed, #4caf50)"
      if (s === "failed") return "var(--vscode-testing-iconFailed, #f44336)"
      if (s === "needs_auth" || s === "needs_client_registration")
        return "var(--vscode-editorWarning-foreground, #ff9800)"
      if (s === "disabled") return "var(--vscode-disabledForeground, #888)"
      return "var(--vscode-disabledForeground, #888)"
    }

    const statusLabel = (name: string) => {
      const s = session.mcpStatus()[name]?.status
      if (!s) return ""
      const key = {
        connected: "mcp.status.connected",
        failed: "mcp.status.failed",
        needs_auth: "mcp.status.needs_auth",
        disabled: "mcp.status.disabled",
        needs_client_registration: "mcp.status.needs_registration",
      }[s]
      return key ? language.t(key) : s
    }

    const isConnected = (name: string) => session.mcpStatus()[name]?.status === "connected"
    const needsAuth = (name: string) => session.mcpStatus()[name]?.status === "needs_auth"
    const isSigningIn = (name: string) => session.mcpAuth().busy.includes(name)
    const isRemoving = (name: string) => session.mcpRemoving().includes(name)

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
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "flex-end",
            "margin-bottom": "8px",
          }}
        >
          <Button variant="secondary" size="small" onClick={browse}>
            {language.t("settings.agentBehaviour.mcpBrowseMarketplace")}
          </Button>
        </div>
        <Show
          when={mcpEntries().length > 0}
          fallback={
            <Card>
              <div
                style={{
                  "font-size": "var(--kilo-font-size-12)",
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
                const status = () => session.mcpStatus()[name]
                const error = () => mcpStatusError(status())
                return (
                  <div
                    ref={(el) => mcpRowRefs.set(name, el)}
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
                        {/* Status dot */}
                        <div
                          style={{
                            width: "6px",
                            height: "6px",
                            "border-radius": "50%",
                            "background-color": statusColor(name),
                            "flex-shrink": "0",
                          }}
                        />
                        <div style={{ "font-weight": "500" }}>{name}</div>
                        <Show when={mcpStatusDetailVisible(status()?.status)}>
                          <Show
                            when={error()}
                            fallback={
                              <span
                                style={{
                                  "font-size": "var(--kilo-font-size-10)",
                                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                                }}
                              >
                                {statusLabel(name) || (mcp.url ? "remote" : "stdio")}
                              </span>
                            }
                          >
                            <Tooltip
                              value={
                                <>
                                  {statusLabel(name)}
                                  <br />
                                  {error()}
                                </>
                              }
                              placement="top"
                            >
                              <span
                                style={{
                                  "font-size": "var(--kilo-font-size-10)",
                                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                                  "text-decoration": "underline dotted",
                                }}
                              >
                                {statusLabel(name)}
                              </span>
                            </Tooltip>
                          </Show>
                        </Show>
                      </div>
                      <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
                        <Show when={isRemoving(name)}>
                          <div
                            style={{
                              display: "flex",
                              "align-items": "center",
                              gap: "6px",
                              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                              "font-size": "var(--kilo-font-size-12)",
                            }}
                          >
                            <Spinner />
                            <span>{language.t("settings.agentBehaviour.mcpRemoving")}</span>
                          </div>
                        </Show>
                        <Show when={needsAuth(name) && !isRemoving(name)}>
                          <div onClick={(e: MouseEvent) => e.stopPropagation()}>
                            <Show
                              when={isSigningIn(name)}
                              fallback={
                                <Button variant="primary" size="small" onClick={() => session.signInMcp(name)}>
                                  {language.t("common.signIn")}
                                </Button>
                              }
                            >
                              <Button variant="ghost" size="small" onClick={() => session.cancelMcpSignIn(name)}>
                                {language.t("settings.agentBehaviour.mcpSignIn.cancel")}
                              </Button>
                            </Show>
                          </div>
                        </Show>
                        <Show when={!needsAuth(name) && !isRemoving(name)}>
                          <div onClick={(e: MouseEvent) => e.stopPropagation()}>
                            <Switch
                              checked={isConnected(name)}
                              disabled={session.mcpLoading() === name}
                              onChange={(enabled: boolean) => {
                                const scope = mcpConfigScope(name, collections())
                                if (scope) {
                                  const update = scope === "project" ? updateProjectConfig : updateGlobalConfig
                                  update(mcpEnabledPatch(name, enabled))
                                }
                                if (!enabled) {
                                  session.disconnectMcp(name)
                                  return
                                }
                                session.connectMcp(name)
                              }}
                              hideLabel
                            >
                              {name}
                            </Switch>
                          </div>
                        </Show>
                        <Show
                          when={
                            !isRemoving(name) &&
                            isConnected(name) &&
                            (mcp.type ?? (mcp.url ? "remote" : "local")) === "remote"
                          }
                        >
                          <div onClick={(e: MouseEvent) => e.stopPropagation()}>
                            <Button variant="ghost" size="small" onClick={() => confirmResetMcpAuth(name)}>
                              {language.t("settings.agentBehaviour.mcpResetAuth")}
                            </Button>
                          </div>
                        </Show>
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon="close"
                          disabled={isRemoving(name)}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            confirmRemoveMcp(name)
                          }}
                        />
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon="chevron-right"
                          disabled={isRemoving(name)}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation()
                            setEditingMcp(name)
                          }}
                        />
                      </div>
                    </div>

                    {/* Error message */}
                    <Show when={error()}>
                      <div
                        style={{
                          "padding-left": "28px",
                          "padding-bottom": "4px",
                          "font-size": "var(--kilo-font-size-11)",
                          color: "var(--vscode-errorForeground)",
                        }}
                      >
                        {error()}
                      </div>
                    </Show>

                    {/* Expandable detail */}
                    <Show when={open()}>
                      <div
                        style={{
                          "padding-left": "28px",
                          "padding-bottom": "8px",
                          "font-size": "var(--kilo-font-size-12)",
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
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "flex-end",
          "margin-bottom": "8px",
        }}
      >
        <Button variant="secondary" size="small" onClick={browse}>
          {language.t("settings.agentBehaviour.mcpBrowseMarketplace")}
        </Button>
      </div>
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
                    {!builtin(skill) && <div>{skill.location}</div>}
                  </div>
                </div>
                {!builtin(skill) && (
                  <IconButton size="small" variant="ghost" icon="close" onClick={() => confirmRemoveSkill(skill)} />
                )}
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
          <div style={{ flex: 1, "min-width": 0 }}>
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
              <Tooltip value={path} class="settings-skills-row-trigger" contentClass="settings-skills-tooltip-content">
                <span
                  style={{
                    width: "100%",
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "font-size": "var(--kilo-font-size-12)",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {path}
                </span>
              </Tooltip>
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
          <div style={{ flex: 1, "min-width": 0 }}>
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
              <Tooltip value={url} class="settings-skills-row-trigger" contentClass="settings-skills-tooltip-content">
                <span
                  style={{
                    width: "100%",
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "font-size": "var(--kilo-font-size-12)",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {url}
                </span>
              </Tooltip>
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
          "font-size": "var(--kilo-font-size-12)",
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
              "font-size": "var(--kilo-font-size-12)",
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
                  "font-size": "var(--kilo-font-size-12)",
                }}
              >
                {path}
              </span>
              <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                <IconButton
                  size="small"
                  variant="ghost"
                  icon="pencil-line"
                  onClick={() => vscode.postMessage({ type: "openFile", filePath: path })}
                />
                <IconButton size="small" variant="ghost" icon="close" onClick={() => removeInstruction(index())} />
              </div>
            </div>
          )}
        </For>
      </Card>

      {/* Claude Code compatibility */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.agentBehaviour.claudeCompat.heading")}
      </h4>
      <Card>
        <SettingsRow
          title={language.t("settings.agentBehaviour.claudeCompat.title")}
          description={language.t("settings.agentBehaviour.claudeCompat.description")}
          last
        >
          <Switch
            checked={claudeCompat()}
            onChange={(checked: boolean) => {
              setClaudeCompat(checked)
              vscode.postMessage({ type: "updateSetting", key: "claudeCodeCompat", value: checked })
            }}
            hideLabel
          >
            {language.t("settings.agentBehaviour.claudeCompat.title")}
          </Switch>
        </SettingsRow>
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
                "font-size": "var(--kilo-font-size-13)",
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
