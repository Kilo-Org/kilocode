import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { KiloAgentRpc } from "@opencode/schema/kilocode/agent"
import { Component, For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { useLanguage } from "../../../context/language"
import { useV2 } from "../../../v2/client"
import type { Delivery } from "../../../v2/pending-actions"
import { useSettingsConfig } from "../../../v2/settings-config"
import SettingsRow from "../SettingsRow"
import Switch from "../Switch"
import {
  agentConfig,
  agentPath,
  agentRows,
  clearDefaultAgent,
  isDefinedAgent,
  primaryAgents,
  removeAgentConfig,
  removableScopes,
  type AgentRow,
} from "./agent-list"
import ModeCreateView from "./ModeCreateView"
import ModeEditView from "./ModeEditView"
import { MAX_IMPORT_SIZE, parseImport, type ImportError } from "./mode-io"

type View = "list" | "create" | "edit"

const DELIVERY_OPTIONS: Delivery[] = ["steer", "queue"]

interface Option {
  value: string
  label: string
}

const AgentsSubtab: Component<{ navigation?: number }> = (props) => {
  const language = useLanguage()
  const v2 = useV2()
  const config = useSettingsConfig()
  const dialog = useDialog()
  const delivery = (): Delivery => (config.setting("chat.sendWhileRunning") === "queue" ? "queue" : "steer")
  const rpc = v2.api.rpc(KiloAgentRpc.Definition)
  const location = { directory: v2.directory }

  const [view, setView] = createSignal<View>("list")
  const [removable, setRemovable] = createSignal<readonly { name: string; scope: "global" | "project" }[]>([])
  const [editing, setEditing] = createSignal("")
  const [created, setCreated] = createSignal<string[]>([])
  const [importError, setImportError] = createSignal("")

  // The agents the `kilocode.agent` RPC may delete: the ones a markdown file defines. A config-defined or built-in
  // agent has no file, so the list offers no remove control for it.
  const refreshRemovable = (): Promise<void> => {
    if (v2.connection.status() !== "connected") return Promise.resolve()
    return rpc
      .removable({}, { location })
      .then((agents) => {
        setRemovable(agents.map((agent) => ({ name: agent.name, scope: agent.scope })))
      })
  }
  const scopes = (id: string) => removableScopes(id, removable())
  const isRemovable = (id: string) => scopes(id).length > 0

  createEffect(
    on(v2.connection.status, (status) => {
      if (status !== "connected") return
      void Promise.all([
        v2.data.location.agent.sync(),
        v2.data.location.model.sync(),
        v2.data.location.provider.sync(),
      ])
        .then(refreshRemovable)
        .catch(v2.report)
    }),
  )

  const serverAgents = () => v2.data.location.agent.list() ?? []
  const mergedAgents = () => (config.value(["agents"]) as Record<string, unknown> | undefined) ?? {}
  const isDefined = (id: string) => isDefinedAgent(id, config.raw("project"), config.raw("global"))
  const extraIds = () => {
    const ids = Object.keys(mergedAgents())
    for (const id of created()) if (!ids.includes(id)) ids.push(id)
    return ids
  }
  const rows = createMemo(() => agentRows(serverAgents(), extraIds(), (id) => agentConfig(config.value, id), isDefined))
  const editingRow = () => rows().find((row) => row.id === editing())

  const defaultOptions = createMemo<Option[]>(() => [
    { value: "", label: language.t("common.default") },
    ...primaryAgents(serverAgents()).map((agent) => ({ value: agent.id, label: agent.name })),
  ])
  const currentDefault = () => (config.value(["default_agent"]) as string | undefined) ?? ""
  const defaultScope = () => config.source(["default_agent"]) ?? "global"

  // Kilo Swarm is on unless a config file turns it off. The config API can drop this Kilo key, so the raw target files
  // are the fallback for the merged value.
  const sharedBoard = () => {
    const value = config.value(["shared_agent_board"])
    if (typeof value === "boolean") return value
    const project = config.raw("project")?.shared_agent_board
    if (typeof project === "boolean") return project
    return config.raw("global")?.shared_agent_board !== false
  }
  const setSharedBoard = (checked: boolean) =>
    config.set(["shared_agent_board"], checked, config.source(["shared_agent_board"]) ?? "global")

  const chooseDefault = (value: string) => {
    if (!value) {
      void clearDefaultAgent(config, currentDefault() ? defaultScope() : undefined)
      return
    }
    if (value === currentDefault()) return
    config.set(["default_agent"], value, defaultScope())
  }

  const errorKey = (tag: ImportError) => `settings.agentBehaviour.importMode.${tag}` as const

  const importMode = (file: File) => {
    setImportError("")
    if (file.size > MAX_IMPORT_SIZE) {
      setImportError(language.t(errorKey("tooLarge")))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = parseImport(reader.result as string, rows().map((row) => row.id))
      if (!result.ok) {
        setImportError(language.t(errorKey(result.error)))
        return
      }
      void config.set(agentPath(result.name), result.config)
      setCreated((ids) => (ids.includes(result.name) ? ids : [...ids, result.name]))
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

  const create = (id: string) => setCreated((ids) => (ids.includes(id) ? ids : [...ids, id]))

  const startEdit = (id: string) => {
    setEditing(id)
    setView("edit")
  }

  const back = () => {
    setView("list")
    setEditing("")
  }

  createEffect(
    on(
      () => props.navigation,
      () => back(),
      { defer: true },
    ),
  )

  const confirmRemove = (row: AgentRow) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.removeAgent.title")} fit>
        <div class="dialog-confirm-body">
          <span>
            {language.t(
              scopes(row.id).length > 1
                ? "settings.agentBehaviour.removeAgent.confirmAll"
                : "settings.agentBehaviour.removeAgent.confirm",
              { name: row.label },
            )}
          </span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                // Delay until after the dialog close animation, as v1, so the list re-render does not
                // fire a click on a shifted row under the overlay.
                setTimeout(() => {
                  // The row leaves the list only after the removal succeeds; a failure keeps it, so the list
                  // still matches what the server reports.
                  void (async () => {
                    // A markdown agent is removed through the RPC, which deletes the file that defines it; a
                    // config-defined row only has its config keys dropped.
                    if (isRemovable(row.id)) {
                      // One definition narrows the removal to its scope; two cannot be narrowed, so the confirm copy
                      // says both go.
                      const editable = scopes(row.id)
                      const only = editable.length === 1 ? editable[0] : undefined
                      const removed = await rpc
                        .remove(only === undefined ? { name: row.id } : { name: row.id, scope: only }, { location })
                        .then(
                          () => true,
                          (error: unknown) => {
                            v2.report(error)
                            return false
                          },
                        )
                      if (!removed) return
                      // A row can also be defined by a config entry; deleting only the file would bring it back.
                      if (row.defined) await removeAgentConfig(config, row.id)
                      v2.data.location.agent.invalidate()
                      await v2.data.location.agent.sync()
                      await refreshRemovable()
                    } else {
                      await removeAgentConfig(config, row.id)
                    }
                    // As v1, clear a file's default_agent only when that file itself names the removed agent.
                    for (const scope of ["project", "global"] as const) {
                      const raw = config.raw(scope) as Record<string, unknown> | undefined
                      if (raw?.["default_agent"] === row.id) await config.unset(["default_agent"], scope)
                    }
                    setCreated((ids) => ids.filter((id) => id !== row.id))
                    if (editing() === row.id) back()
                  })().catch(v2.report)
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

  return (
    <>
      <Show when={view() === "create"}>
        <ModeCreateView
          taken={rows().map((row) => row.id)}
          onBack={back}
          onCreated={(id) => {
            create(id)
            back()
          }}
        />
      </Show>
      <Show when={view() === "edit" ? editingRow() : undefined}>
        {(row) => <ModeEditView row={row} onBack={back} onRemove={confirmRemove} />}
      </Show>
      <Show when={view() === "list"}>
        <ListView />
      </Show>
    </>
  )

  function ListView() {
    return (
      <div>
        <Card style={{ "margin-bottom": "12px" }}>
          <SettingsRow
            title={language.t("settings.agentBehaviour.defaultAgent.title")}
            description={language.t("settings.agentBehaviour.defaultAgent.description")}
          >
            <Select
              options={defaultOptions()}
              current={defaultOptions().find((option) => option.value === currentDefault())}
              value={(option: Option) => option.value}
              label={(option: Option) => option.label}
              onSelect={(option: Option | undefined) => {
                if (option) chooseDefault(option.value)
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.agentBehaviour.sendWhileRunning.title")}
            description={language.t("settings.agentBehaviour.sendWhileRunning.description")}
          >
            <Select
              options={DELIVERY_OPTIONS}
              current={delivery()}
              value={(option: Delivery) => option}
              label={(option: Delivery) => language.t(`settings.agentBehaviour.sendWhileRunning.${option}`)}
              onSelect={(option: Delivery | undefined) => {
                if (!option || option === delivery()) return
                config.setSetting("chat.sendWhileRunning", option)
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
              checked={config.setting("agentManager.pushFixes") !== false}
              onChange={(checked) => config.setSetting("agentManager.pushFixes", checked)}
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
            <Switch checked={sharedBoard()} onChange={(checked) => void setSharedBoard(checked)} hideLabel>
              {language.t("settings.agentBehaviour.sharedAgentBoard.title")}
            </Switch>
          </SettingsRow>
        </Card>

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
            <Button variant="secondary" size="small" onClick={() => setView("create")}>
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

        <Show
          when={rows().length > 0}
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
            <For each={rows()}>
              {(row, index) => (
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    padding: "8px 4px",
                    "border-bottom": index() < rows().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                    "border-radius": "4px",
                    cursor: "pointer",
                    opacity: row.disabled ? "0.5" : "1",
                  }}
                  onClick={() => startEdit(row.id)}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = "var(--bg-hover-base, var(--vscode-list-hoverBackground))"
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = "transparent"
                  }}
                >
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                      <div style={{ "font-weight": "500", "font-size": "var(--kilo-font-size-13)" }}>{row.label}</div>
                      <Show when={!row.builtIn}>
                        <Badge text="custom" />
                      </Show>
                      <Show when={row.mode === "subagent"}>
                        <Badge text={language.t("settings.agentBehaviour.badge.subagent")} />
                      </Show>
                      <Show when={row.hidden}>
                        <Badge text={language.t("settings.agentBehaviour.badge.hidden")} />
                      </Show>
                      <Show when={row.disabled}>
                        <Badge
                          text={language.t("settings.agentBehaviour.badge.disabled")}
                          background="var(--vscode-errorForeground, #f44)"
                          color="var(--vscode-errorForeground-foreground, #fff)"
                        />
                      </Show>
                    </div>
                    <Show when={row.description}>
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
                        {row.description}
                      </div>
                    </Show>
                  </div>
                  <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                    {/* A config-defined row is removed through its config keys; a markdown-defined agent only has a
                        file, which the `kilocode.agent` RPC deletes, so both kinds offer the control. */}
                    <Show when={row.removable || isRemovable(row.id)}>
                      <IconButton
                        size="small"
                        variant="ghost"
                        icon="close"
                        title={language.t("settings.agentBehaviour.removeAgent.button")}
                        onClick={(event: MouseEvent) => {
                          event.stopPropagation()
                          confirmRemove(row)
                        }}
                      />
                    </Show>
                    <IconButton size="small" variant="ghost" icon="chevron-right" />
                  </div>
                </div>
              )}
            </For>
          </Card>
        </Show>
      </div>
    )
  }
}

const Badge: Component<{ text: string; background?: string; color?: string }> = (props) => (
  <span
    style={{
      "font-size": "var(--kilo-font-size-10)",
      padding: "1px 5px",
      "border-radius": "3px",
      background: props.background ?? "var(--bg-subtle-base, var(--vscode-badge-background))",
      color: props.color ?? "var(--text-weak-base, var(--vscode-badge-foreground))",
    }}
  >
    {props.text}
  </span>
)

export default AgentsSubtab
