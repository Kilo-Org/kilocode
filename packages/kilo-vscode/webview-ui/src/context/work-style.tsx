import { createContext, useContext, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Accessor, ParentComponent } from "solid-js"
import { useVSCode } from "./vscode"
import { useLanguage } from "./language"
import { resolveWorkStyleOnboarding } from "./work-style-state"
import { createWorkStyleToasts } from "./onboarding/work-style-toasts"
import type { ExtensionMessage } from "../types/messages"
import { TelemetryEventName } from "../../../src/services/telemetry/types"
import type { WorkStyle, WorkStyleState } from "../../../src/shared/work-style-presets"

export interface WorkStyleContextValue {
  style: Accessor<WorkStyleState>
  loading: Accessor<boolean>
  applying: Accessor<boolean>
  shouldShowOnboarding: Accessor<boolean>
  apply: (style: WorkStyle) => void
}

export const WorkStyleContext = createContext<WorkStyleContextValue>()

export const WorkStyleProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()
  const [style, setStyle] = createSignal<WorkStyleState>("unset")
  const [loading, setLoading] = createSignal(true)
  const [applying, setApplying] = createSignal(false)
  const [display, setDisplay] = createSignal(false)
  const toast = createWorkStyleToasts(language.t)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
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
      toast.saved()
      return
    }
    if (message.type !== "workStyleApplyFailed") return
    setApplying(false)
    toast.failed(message.message, message.rollbackFailed)
  })

  const request = () => vscode.postMessage({ type: "requestWorkStyle" })

  request()

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    if (loading()) request()
  })

  const onNewTaskRequest = () => {
    if (applying() || !display()) return
    setDisplay(false)
    setStyle("skipped")
    vscode.postMessage({ type: "setWorkStyle", style: "skipped" })
  }
  window.addEventListener("newTaskRequest", onNewTaskRequest)

  onCleanup(() => {
    unsubscribe()
    unsubReady()
    window.removeEventListener("newTaskRequest", onNewTaskRequest)
  })

  function apply(style: WorkStyle) {
    if (applying()) return
    setApplying(true)
    vscode.postMessage({
      type: "telemetry",
      event: TelemetryEventName.WORK_STYLE_SELECTED,
      properties: { style },
    })
    vscode.postMessage({ type: "applyWorkStyle", style })
  }

  const ready = createMemo(() => !loading())
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
  })

  const value: WorkStyleContextValue = {
    style,
    loading: () => !ready(),
    applying,
    shouldShowOnboarding: onboarding,
    apply,
  }

  return <WorkStyleContext.Provider value={value}>{props.children}</WorkStyleContext.Provider>
}

export function useWorkStyle(): WorkStyleContextValue {
  const context = useContext(WorkStyleContext)
  if (!context) throw new Error("useWorkStyle must be used within a WorkStyleProvider")
  return context
}
