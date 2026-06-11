import { createContext, useContext, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Accessor, ParentComponent } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "./vscode"
import { useConfig } from "./config"
import { useLanguage } from "./language"
import { resolveWorkStyleOnboarding } from "./work-style-state"
import type { ExtensionMessage } from "../types/messages"
import { TelemetryEventName } from "../../../src/services/telemetry/types"
import {
  buildWorkStyleApplyPlan,
  type WorkStyle,
  type WorkStyleSettings,
  type WorkStyleState,
} from "../../../src/shared/work-style-presets"

export interface WorkStyleContextValue {
  style: Accessor<WorkStyleState>
  loading: Accessor<boolean>
  shouldShowOnboarding: Accessor<boolean>
  apply: (style: WorkStyle) => void
  dismiss: () => void
}

export const WorkStyleContext = createContext<WorkStyleContextValue>()

export const WorkStyleProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const cfg = useConfig()
  const language = useLanguage()
  const [style, setStyle] = createSignal<WorkStyleState>("unset")
  const [loading, setLoading] = createSignal(true)
  const [display, setDisplay] = createSignal(false)
  const [defaults, setDefaults] = createSignal<Partial<Record<keyof WorkStyleSettings, boolean>>>({})

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "workStyleLoaded") return
    setStyle(message.style)
    setDisplay((current) => resolveWorkStyleOnboarding(current, message.style))
    setDefaults(message.defaults)
    setLoading(false)
  })

  const request = () => vscode.postMessage({ type: "requestWorkStyle" })

  request()

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    if (loading()) request()
  })

  const end = () => setDisplay(false)
  window.addEventListener("newTaskRequest", end)

  onCleanup(() => {
    unsubscribe()
    unsubReady()
    window.removeEventListener("newTaskRequest", end)
  })

  function apply(style: WorkStyle) {
    vscode.postMessage({
      type: "telemetry",
      event: TelemetryEventName.WORK_STYLE_SELECTED,
      properties: { style },
    })

    const plan = buildWorkStyleApplyPlan({
      style,
      config: cfg.config(),
      settingDefault: (key) => defaults()[key] ?? true,
    })

    if (Object.keys(plan.config).length > 0) {
      vscode.postMessage({ type: "updateConfig", config: plan.config })
    }
    for (const [key, value] of Object.entries(plan.settings)) {
      vscode.postMessage({ type: "updateSetting", key, value })
    }

    setDisplay(false)
    setStyle(style)
    vscode.postMessage({ type: "setWorkStyle", style })
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("workStyle.toast.saved.title"),
      description: language.t("workStyle.toast.saved.description"),
      actions: [
        {
          label: language.t("workStyle.toast.saved.action"),
          onClick: () => vscode.postMessage({ type: "openSettingsPanel", tab: "autoApprove" }),
        },
      ],
    })
  }

  function dismiss() {
    setDisplay(false)
    setStyle("skipped")
    vscode.postMessage({ type: "setWorkStyle", style: "skipped" })
  }

  const ready = createMemo(() => !loading() && !cfg.loading())
  const onboarding = createMemo(() => ready() && display())
  let acknowledged = false

  createEffect(() => {
    if (!onboarding()) {
      acknowledged = false
      return
    }
    if (acknowledged) return
    acknowledged = true
    vscode.postMessage({
      type: "telemetry",
      event: TelemetryEventName.WORK_STYLE_ONBOARDING_SHOWN,
    })
    // This onboarding display is a one-off. Persist skipped now while keeping this mounted view visible.
    vscode.postMessage({ type: "setWorkStyle", style: "skipped" })
  })

  const value: WorkStyleContextValue = {
    style,
    loading: () => !ready(),
    shouldShowOnboarding: onboarding,
    apply,
    dismiss,
  }

  return <WorkStyleContext.Provider value={value}>{props.children}</WorkStyleContext.Provider>
}

export function useWorkStyle(): WorkStyleContextValue {
  const context = useContext(WorkStyleContext)
  if (!context) throw new Error("useWorkStyle must be used within a WorkStyleProvider")
  return context
}
