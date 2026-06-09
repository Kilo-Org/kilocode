import { createContext, useContext, createSignal, onCleanup } from "solid-js"
import type { Accessor, ParentComponent } from "solid-js"
import { useVSCode } from "./vscode"
import { useConfig } from "./config"
import type { ExtensionMessage } from "../types/messages"
import {
  buildWorkStyleApplyPlan,
  type WorkStyle,
  type WorkStyleSettings,
  type WorkStyleState,
} from "../../../src/shared/work-style-presets"

interface WorkStyleContextValue {
  style: Accessor<WorkStyleState>
  shown: Accessor<boolean>
  loading: Accessor<boolean>
  shouldShowOnboarding: Accessor<boolean>
  apply: (style: WorkStyle, opts?: { force?: boolean; source?: "onboarding" | "settings" }) => void
  dismiss: () => void
}

export const WorkStyleContext = createContext<WorkStyleContextValue>()

export const WorkStyleProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const cfg = useConfig()
  const [style, setStyle] = createSignal<WorkStyleState>("unset")
  const [shown, setShown] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [defaults, setDefaults] = createSignal<Partial<Record<keyof WorkStyleSettings, boolean>>>({})

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "workStyleLoaded") return
    setStyle(message.style)
    setShown(message.onboardingShown)
    setDefaults(message.defaults)
    setLoading(false)
  })

  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestWorkStyle" })

  function apply(style: WorkStyle, opts?: { force?: boolean; source?: "onboarding" | "settings" }) {
    const source = opts?.source ?? "settings"
    const plan = buildWorkStyleApplyPlan({
      style,
      config: cfg.config(),
      force: opts?.force,
      settingDefault: (key) => defaults()[key] ?? true,
    })

    if (Object.keys(plan.config).length > 0) {
      if (source === "onboarding") vscode.postMessage({ type: "updateConfig", config: plan.config })
      else cfg.updateConfig(plan.config)
    }
    for (const [key, value] of Object.entries(plan.settings)) {
      vscode.postMessage({ type: "updateSetting", key, value })
    }

    setStyle(style)
    setShown(true)
    vscode.postMessage({ type: "setWorkStyle", style, shown: true, source })
  }

  function dismiss() {
    setShown(true)
    vscode.postMessage({ type: "setWorkStyle", style: "custom", shown: true, source: "onboarding" })
  }

  const value: WorkStyleContextValue = {
    style,
    shown,
    loading,
    shouldShowOnboarding: () => !loading() && !cfg.loading() && !shown() && style() === "unset",
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
