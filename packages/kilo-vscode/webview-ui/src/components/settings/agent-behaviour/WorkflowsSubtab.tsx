// The Workflows subtab: one row per command, from `api.command.list` plus the config `commands` (and the v1 `command`
// key). Description and the read-only template come from the config; the per-command model and variant live in the
// command's `model`. The effective entry is read per config document, because core merges commands per name.
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

  type CommandDocument = { commands?: Record<string, unknown>; command?: Record<string, unknown> }
  type CommandEntry = { scope: "project" | "global"; key: "commands" | "command"; value: Record<string, unknown> }

  // Core loads commands per document and merges them per name, so the effective entry is the one from the
  // highest-priority document (project, then global), under the v2 `commands` key or the v1 `command` key. The shallow
  // merged config keeps only the last document that defines `commands`, so read the raw documents instead.
  const entry = (name: string): CommandEntry | undefined => {
    for (const scope of ["project", "global"] as const) {
      const document = config.raw(scope) as CommandDocument | undefined
      const native = document?.commands?.[name]
      if (native && typeof native === "object")
        return { scope, key: "commands", value: native as Record<string, unknown> }
      const legacy = document?.command?.[name]
      if (legacy && typeof legacy === "object")
        return { scope, key: "command", value: legacy as Record<string, unknown> }
    }
    return undefined
  }

  const names = createMemo(() => {
    const set = new Set<string>((v2.data.location.command.list() ?? []).map((command) => command.name))
    for (const scope of ["project", "global"] as const) {
      const document = config.raw(scope) as CommandDocument | undefined
      for (const key of ["commands", "command"] as const)
        for (const name of Object.keys(document?.[key] ?? {})) set.add(name)
    }
    return [...set].sort()
  })

  const discovered = (name: string) => (v2.data.location.command.list() ?? []).find((command) => command.name === name)

  const description = (name: string) => {
    const value = entry(name)?.value.description
    return discovered(name)?.description ?? (typeof value === "string" ? value : undefined)
  }

  const template = (name: string) => {
    const value = entry(name)?.value.template
    return typeof value === "string" ? value : undefined
  }

  // The v2 key keeps the model and the variant in one Selection value; the v1 key keeps a plain `model` and a separate
  // `variant`.
  const model = (name: string): ModelPickerValue | undefined => {
    const found = entry(name)
    if (!found) return undefined
    const base = parseCommandModel(found.value.model)
    if (!base) return undefined
    const variant = found.key === "command" && typeof found.value.variant === "string" ? found.value.variant : undefined
    return variant ? { ...base, variant } : base
  }

  // A v2 command entry requires a template, so the model override only applies where a template exists. Write to the
  // document that defines the command; migrate a v1 `command` entry to `commands` in the same write (the host removes
  // the `command` alias), with the variant folded into the model.
  const blocked = (name: string) => template(name) === undefined

  const setModel = (name: string, value: ModelPickerValue | undefined) => {
    const found = entry(name)
    if (!found || blocked(name)) return
    if (found.key === "commands") {
      config.set(["commands", name, "model"], value ? serializeCommandModel(value) : undefined, found.scope)
      return
    }
    const next = { ...found.value }
    delete next.variant
    if (value) next.model = serializeCommandModel(value)
    else delete next.model
    config.set(["commands", name], next, found.scope)
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
                          blocked={blocked(name)}
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
