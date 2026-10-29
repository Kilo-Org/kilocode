// The v2 contract of the Agents subtab: the default agent select, the agent list with its badges, and the create,
// edit, import and remove actions. Config edits are staged into the shared save bar through `useSettingsConfig`.
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { Component, For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { useLanguage } from "../../../context/language"
import { useV2 } from "../../../v2/client"
import { useSettingsConfig } from "../../../v2/settings-config"
import SettingsRow from "../SettingsRow"
import { agentConfig, agentPath, agentRows, primaryAgents, type AgentRow } from "./agents"
import ModeCreateView from "./ModeCreateView"
import ModeEditView from "./ModeEditView"
import { MAX_IMPORT_SIZE, parseImport, type ImportError } from "./mode-io"

type View = "list" | "create" | "edit"

interface Option {
  value: string
  label: string
}

const AgentsSubtab: Component = () => {
  const language = useLanguage()
  const v2 = useV2()
  const config = useSettingsConfig()
  const dialog = useDialog()

  const [view, setView] = createSignal<View>("list")
  const [editing, setEditing] = createSignal("")
  const [created, setCreated] = createSignal<string[]>([])
  const [importError, setImportError] = createSignal("")

  createEffect(
    on(v2.connection.status, (status) => {
      if (status !== "connected") return
      void Promise.all([
        v2.data.location.agent.sync(),
        v2.data.location.model.sync(),
        v2.data.location.provider.sync(),
      ]).catch(v2.report)
    }),
  )

  const serverAgents = () => v2.data.location.agent.list() ?? []
  const mergedAgents = () => (config.value(["agents"]) as Record<string, unknown> | undefined) ?? {}
  const isDefined = (id: string) => config.source(agentPath(id)) !== undefined || created().includes(id)
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

  const chooseDefault = (value: string) => {
    if (!value) {
      config.unset(["default_agent"], defaultScope())
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

  const confirmRemove = (row: AgentRow) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.removeAgent.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.agentBehaviour.removeAgent.confirm", { name: row.label })}</span>
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
                  config.unset(agentPath(row.id), config.source(agentPath(row.id)) ?? "global")
                  setCreated((ids) => ids.filter((id) => id !== row.id))
                  if (editing() === row.id) back()
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
      <Show when={view() === "edit" ? editingRow() : undefined} keyed>
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
            last
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
                    <Show when={row.removable}>
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
