import { showToast } from "@kilocode/kilo-ui/toast"
import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import type { WorkStyle, WorkStyleState } from "../../../src/shared/work-style-presets"
import { TelemetryEventName } from "../../../src/services/telemetry/types"
import { useLanguage } from "./language"
import { useVSCode } from "./vscode"
import { resolveWorkStyleOnboarding } from "./work-style-state"

export interface WorkStyleContextValue {
  style: Accessor<WorkStyleState>
  loading: Accessor<boolean>
  applying: Accessor<boolean>
  shouldShowOnboarding: Accessor<boolean>
  apply: (style: WorkStyle) => void
  skip: () => void
}

const WorkStyleContext = createContext<WorkStyleContextValue>()

export const WorkStyleProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()
  const [style, setStyle] = createSignal<WorkStyleState>("unset")
  const [loading, setLoading] = createSignal(true)
  const [applying, setApplying] = createSignal(false)
  const [display, setDisplay] = createSignal(false)

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "workStyleLoaded") {
      if (applying()) return
      setStyle(message.style)
      setDisplay((current) => resolveWorkStyleOnboarding(current, message.style))
      setLoading(false)
      return
    }
    if (message.type === "workStyleApplied") {
      setApplying(false)
      setStyle(message.style)
      setDisplay(false)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("workStyle.toast.saved.title"),
        duration: 2000,
      })
      return
    }
    if (message.type !== "workStyleApplyFailed") return
    setApplying(false)
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: message.message,
      persistent: message.rollbackFailed,
    })
  })
  onMount(() => vscode.postMessage({ type: "requestWorkStyle" }))
  onCleanup(unsubscribe)

  // One event each time the onboarding appears.
  const shown = { acknowledged: false }
  createEffect(() => {
    if (loading() || !display()) {
      shown.acknowledged = false
      return
    }
    if (shown.acknowledged) return
    shown.acknowledged = true
    vscode.postMessage({ type: "telemetry", event: TelemetryEventName.WORK_STYLE_ONBOARDING_SHOWN })
  })

  const value: WorkStyleContextValue = {
    style,
    loading,
    applying,
    shouldShowOnboarding: () => !loading() && display(),
    apply: (choice) => {
      if (applying()) return
      setApplying(true)
      vscode.postMessage({ type: "telemetry", event: TelemetryEventName.WORK_STYLE_SELECTED, properties: { style: choice } })
      vscode.postMessage({ type: "applyWorkStyle", style: choice })
    },
    skip: () => {
      if (applying() || !display()) return
      setDisplay(false)
      setStyle("skipped")
      vscode.postMessage({ type: "setWorkStyle", style: "skipped" })
    },
  }

  return <WorkStyleContext.Provider value={value}>{props.children}</WorkStyleContext.Provider>
}

export function useWorkStyle(): WorkStyleContextValue {
  const context = useContext(WorkStyleContext)
  if (!context) throw new Error("useWorkStyle must be used within a WorkStyleProvider")
  return context
}

export function useWorkStyleOptional(): WorkStyleContextValue | undefined {
  return useContext(WorkStyleContext)
}
