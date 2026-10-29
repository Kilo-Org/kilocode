// The Workflows subtab: one row per command, from `api.command.list` plus the config `commands`. Description and the
// read-only template come from the config; the per-command model and variant live in `commands.<n>.model`.
import { Component, For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useLanguage } from "../../../context/language"
import { useV2 } from "../../../v2/client"
import { useSettingsConfig } from "../../../v2/settings-config"
import ModelPicker, { type ModelPickerValue } from "../ModelPicker"
import { parseCommandModel, serializeCommandModel } from "./command-model"

const WorkflowsSubtab: Component = () => {
  const language = useLanguage()
  const v2 = useV2()
  const config = useSettingsConfig()
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})

  createEffect(
    on(v2.connection.status, (status) => {
      if (status === "connected") void v2.data.location.command.sync().catch(v2.report)
    }),
  )

  const configured = (): Record<string, unknown> => {
    const value = config.value(["commands"])
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  }

  const names = createMemo(() => {
    const set = new Set<string>((v2.data.location.command.list() ?? []).map((command) => command.name))
    for (const name of Object.keys(configured())) set.add(name)
    return [...set].sort()
  })

  const discovered = (name: string) => (v2.data.location.command.list() ?? []).find((command) => command.name === name)

  const description = (name: string) => {
    const entry = configured()[name]
    const configuredDescription =
      entry && typeof entry === "object" ? (entry as { description?: unknown }).description : undefined
    return discovered(name)?.description ?? (typeof configuredDescription === "string" ? configuredDescription : undefined)
  }

  const template = (name: string) => {
    const entry = configured()[name]
    const value = entry && typeof entry === "object" ? (entry as { template?: unknown }).template : undefined
    return typeof value === "string" ? value : undefined
  }

  const model = (name: string) => parseCommandModel(config.value(["commands", name, "model"]))

  const setModel = (name: string, value: ModelPickerValue | undefined) => {
    if (!value) config.unset(["commands", name, "model"])
    else config.set(["commands", name, "model"], serializeCommandModel(value))
  }

  const toggle = (name: string) => setExpanded((prev) => ({ ...prev, [name]: !prev[name] }))

  return (
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
        {language.t("settings.agentBehaviour.workflows.description")}
      </div>

      <Show
        when={names().length > 0}
        fallback={
          <Card>
            <div
              style={{
                "font-size": "var(--kilo-font-size-12)",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {language.t("settings.agentBehaviour.workflows.empty")}
            </div>
          </Card>
        }
      >
        <Card>
          <For each={names()}>
            {(name, index) => {
              const open = () => expanded()[name] ?? false
              return (
                <div
                  style={{
                    "border-bottom": index() < names().length - 1 ? "1px solid var(--border-weak-base)" : "none",
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
                        label={`/${name}`}
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation()
                          toggle(name)
                        }}
                      />
                      <span
                        style={{
                          "font-weight": "500",
                          "font-family": "var(--vscode-editor-font-family, monospace)",
                        }}
                      >
                        /{name}
                      </span>
                      <Show when={description(name)}>
                        <span
                          style={{
                            "font-size": "var(--kilo-font-size-12)",
                            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {description(name)}
                        </span>
                      </Show>
                    </div>
                  </div>

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
                      <Show when={description(name)}>
                        <div style={{ "margin-bottom": "4px" }}>
                          <span style={{ "font-weight": "500" }}>
                            {language.t("settings.agentBehaviour.workflows.detail.description")}:{" "}
                          </span>
                          {description(name)}
                        </div>
                      </Show>
                      <div
                        style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", "margin-bottom": "8px" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ModelPicker
                          value={model(name)}
                          onChange={(value) => setModel(name, value)}
                          clearable
                          clearLabel={language.t("settings.providers.notSet")}
                        />
                      </div>
                      <Show when={template(name)}>
                        <div>
                          <span style={{ "font-weight": "500" }}>
                            {language.t("settings.agentBehaviour.workflows.detail.template")}:{" "}
                          </span>
                          <div
                            style={{
                              "margin-top": "4px",
                              "font-family": "var(--vscode-editor-font-family, monospace)",
                              "font-size": "var(--kilo-font-size-11)",
                              "white-space": "pre-wrap",
                              "word-break": "break-word",
                            }}
                          >
                            {template(name)}
                          </div>
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

export default WorkflowsSubtab
