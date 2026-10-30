// The Workflows subtab: one row per command, from `api.command.list` plus the config `commands` (and the v1 `command`
// key). The server supplies the effective description, template and model; model-only entries override a discovered
// workflow without copying its template.
import { Component, For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useLanguage } from "../../../context/language"
import { getVSCodeAPI } from "../../../context/vscode"
import { useV2 } from "../../../v2/client"
import { useSettingsConfig } from "../../../v2/settings-config"
import { preserveVariant } from "../../../v2/variant"
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
  const entry = (name: string, modelOnly = false): CommandEntry | undefined => {
    for (const scope of ["project", "global"] as const) {
      const document = config.raw(scope) as CommandDocument | undefined
      const native = document?.commands?.[name]
      const legacy = document?.command?.[name]
      const key = native && typeof native === "object" ? "commands" : "command"
      const value = key === "commands" ? native : legacy
      if (!value || typeof value !== "object" || Array.isArray(value)) continue
      const command = value as Record<string, unknown>
      if (
        modelOnly &&
        ("template" in command || Object.keys(command).some((part) => part !== "model" && part !== "variant"))
      )
        continue
      return { scope, key, value: command }
    }
    return undefined
  }

  const completeLegacy = (name: string, scope: "project" | "global") => {
    const value = (config.raw(scope) as CommandDocument | undefined)?.command?.[name]
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).template === "string"
    )
  }

  const names = createMemo(() => {
    const set = new Set<string>((v2.data.location.command.list() ?? []).map((command) => command.name))
    for (const scope of ["project", "global"] as const) {
      const document = config.raw(scope) as CommandDocument | undefined
      for (const key of ["commands", "command"] as const) {
        for (const [name, value] of Object.entries(document?.[key] ?? {})) {
          if (value && typeof value === "object" && "template" in value && typeof value.template === "string") set.add(name)
        }
      }
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
    return discovered(name)?.template ?? (typeof value === "string" ? value : undefined)
  }

  // The v2 key normally keeps the model and the variant in one Selection value, but a model-only entry may use a
  // separate variant; the v1 key keeps them separate.
  const model = (name: string): ModelPickerValue | undefined => {
    const found = entry(name, true) ?? entry(name)
    const path = ["commands", name]
    if (config.pending(path)) {
      const value = config.value(path) as { model?: unknown; variant?: unknown } | undefined
      const parsed = parseCommandModel(value?.model)
      return parsed && !parsed.variant && typeof value?.variant === "string"
        ? { ...parsed, variant: value.variant }
        : parsed
    }
    const modelPath = [...path, "model"]
    if (config.pending(modelPath)) return parseCommandModel(config.value(modelPath))
    const effective = discovered(name)
    const configured = parseCommandModel(found?.value.model)
    const base =
      found && (typeof found.value.template !== "string" || found.value.template === effective?.template)
        ? (configured ?? parseCommandModel(effective?.model))
        : (parseCommandModel(effective?.model) ?? configured)
    if (!base) return undefined
    const variant =
      found && !base.variant && typeof found.value.variant === "string" ? found.value.variant : undefined
    return variant ? { ...base, variant } : base
  }

  const overridden = (name: string) => {
    const found = entry(name, true) ?? entry(name)
    return !!found && found.value.model !== undefined
  }

  const variants = (value: ModelPickerValue) =>
    v2.data.location.model
      .list()
      ?.find((item) => item.providerID === value.providerID && item.id === value.modelID)
      ?.variants.map((variant) => variant.id) ?? []

  const blocked = (name: string) => {
    const found = entry(name)
    return (
      template(name) === undefined ||
      (!!found &&
        typeof found.value.template !== "string" &&
        Object.keys(found.value).some((key) => key !== "model" && key !== "variant"))
    )
  }

  const save = (path: string[], value: unknown, scope: "project" | "global", preserveAliases = false) => {
    void config.set(path, value, scope, preserveAliases).then((ok) => {
      if (ok) getVSCodeAPI().postMessage({ type: "configRead" } as never)
    })
  }

  const setModel = (name: string, value: ModelPickerValue | undefined) => {
    const found = entry(name, true) ?? entry(name)
    if (blocked(name)) return
    const previous = model(name)
    const changedModel =
      value !== undefined &&
      previous !== undefined &&
      (value.providerID !== previous.providerID || value.modelID !== previous.modelID)
    const preserved = changedModel && value ? preserveVariant(previous?.variant, variants(value)) : undefined
    const next = value && changedModel && !value.variant && preserved ? { ...value, variant: preserved } : value
    if (!found) {
      if (!next) return
      save(["commands", name], { model: serializeCommandModel(next) }, "global")
      return
    }
    const keepAliases = found.key === "commands" && completeLegacy(name, found.scope)
    if (typeof found.value.template !== "string") {
      save(["commands", name], next ? { model: serializeCommandModel(next) } : undefined, found.scope, keepAliases)
      return
    }
    if (found.key === "commands") {
      save(["commands", name, "model"], next ? serializeCommandModel(next) : undefined, found.scope)
      return
    }
    const entryValue = { ...found.value }
    delete entryValue.variant
    if (next) entryValue.model = serializeCommandModel(next)
    else delete entryValue.model
    save(["commands", name], entryValue, found.scope)
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
                          clearable={overridden(name)}
                          clearLabel={language.t("settings.providers.notSet")}
                          blocked={blocked(name)}
                          preserveVariantOnReselect
                          showUnavailableVariant
                          modelLabel={`/${name} ${language.t("settings.agentBehaviour.workflows.model")}`}
                          variantLabel={`/${name} ${language.t("settings.agentBehaviour.workflows.variant")}`}
                          clearButtonLabel={`/${name} ${language.t("settings.providers.notSet")}`}
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
