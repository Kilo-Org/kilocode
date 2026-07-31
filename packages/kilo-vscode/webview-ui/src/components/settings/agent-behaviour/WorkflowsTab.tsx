import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

import { useConfig } from "../../../context/config"
import { useLanguage } from "../../../context/language"
import { useProvider } from "../../../context/provider"
import { ModelSelectorBase } from "../../shared/ModelSelector"
import { ThinkingSelectorBase } from "../../shared/ThinkingSelector"
import { parseModelString } from "../../../../../src/shared/provider-model"
import type { CommandConfig } from "../../../types/messages"

const WorkflowsTab: Component = () => {
  const language = useLanguage()
  const { config, globalConfig, globalDraft, updateGlobalConfig } = useConfig()
  const provider = useProvider()

  const cmds = createMemo(() => Object.entries(config().command ?? {}))
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})

  const toggle = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  const update = (name: string, patch: Partial<CommandConfig>) => {
    updateGlobalConfig({ command: { [name]: patch } })
  }

  const scoped = (cmd: CommandConfig, name: string) => ({
    ...cmd,
    ...globalConfig().command?.[name],
    ...globalDraft().command?.[name],
  })

  const model = (cmd: CommandConfig, name: string) => {
    const value = scoped(cmd, name).model
    return value === null ? null : parseModelString(value ?? undefined)
  }

  const variant = (cmd: CommandConfig, name: string) => {
    const value = scoped(cmd, name).variant
    return value === null ? undefined : (value ?? undefined)
  }

  const variants = (cmd: CommandConfig, name: string) =>
    Object.keys(provider.findModel(model(cmd, name))?.variants ?? {})

  const selectModel = (name: string, providerID: string, modelID: string) => {
    const list = Object.keys(provider.findModel({ providerID, modelID })?.variants ?? {})
    const current = variant(config().command?.[name] ?? {}, name)
    update(name, {
      model: providerID && modelID ? `${providerID}/${modelID}` : null,
      ...(current && !list.includes(current) ? { variant: null } : {}),
    })
  }

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
        when={cmds().length > 0}
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
          <For each={cmds()}>
            {([name, cmd], index) => {
              const open = () => expanded()[name] ?? false
              return (
                <div
                  style={{
                    "border-bottom": index() < cmds().length - 1 ? "1px solid var(--border-weak-base)" : "none",
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
                      <span
                        style={{
                          "font-weight": "500",
                          "font-family": "var(--vscode-editor-font-family, monospace)",
                        }}
                      >
                        /{name}
                      </span>
                      <Show when={cmd.description}>
                        <span
                          style={{
                            "font-size": "var(--kilo-font-size-12)",
                            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {cmd.description}
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
                      <Show when={cmd.description}>
                        <div style={{ "margin-bottom": "4px" }}>
                          <span style={{ "font-weight": "500" }}>
                            {language.t("settings.agentBehaviour.workflows.detail.description")}:{" "}
                          </span>
                          {cmd.description}
                        </div>
                      </Show>
                      <div
                        style={{
                          display: "flex",
                          "flex-wrap": "wrap",
                          gap: "8px",
                          "margin-bottom": "8px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ModelSelectorBase
                          value={model(cmd, name)}
                          onSelect={(providerID, modelID) => selectModel(name, providerID, modelID)}
                          placement="bottom-start"
                          allowClear
                          clearLabel={language.t("settings.providers.notSet")}
                          label={`${name} ${language.t("settings.agentBehaviour.workflows.model")}`}
                          description={language.t("settings.agentBehaviour.workflows.modelDescription")}
                        />
                        <Show when={variants(cmd, name).length > 0 || !!variant(cmd, name)}>
                          <ThinkingSelectorBase
                            variants={variants(cmd, name)}
                            value={variant(cmd, name)}
                            onSelect={(variant) => update(name, { variant })}
                            onClear={() => update(name, { variant: null })}
                            allowClear
                            clearLabel={language.t("settings.providers.notSet")}
                            placement="bottom-start"
                            globalTrigger={false}
                            label={`${name} ${language.t("settings.agentBehaviour.workflows.variant")}`}
                          />
                        </Show>
                      </div>
                      <Show when={cmd.template}>
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
                            {cmd.template}
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

export default WorkflowsTab
