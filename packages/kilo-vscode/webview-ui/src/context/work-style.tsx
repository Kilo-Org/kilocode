import { createContext, useContext, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Accessor, ParentComponent } from "solid-js"
import { useVSCode } from "./vscode"
import { useLanguage } from "./language"
import { advance, initial, update, type Page } from "./work-style-state"
import { createWorkStyleToasts } from "./onboarding/work-style-toasts"
import type { ExtensionMessage } from "../types/messages"
import { TelemetryEventName } from "../../../src/services/telemetry/types"
import type { OnboardingAgent, WorkStyle, WorkStyleState } from "../../../src/shared/work-style-presets"

export interface WorkStyleContextValue {
  style: Accessor<WorkStyleState>
  page: Accessor<Page>
  loading: Accessor<boolean>
  applying: Accessor<boolean>
  shouldShowOnboarding: Accessor<boolean>
  select: (style: WorkStyle) => void
  complete: (agent: OnboardingAgent) => void
}

export const WorkStyleContext = createContext<WorkStyleContextValue>()

export const WorkStyleProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()
  const [style, setStyle] = createSignal<WorkStyleState>("unset")
  const [loading, setLoading] = createSignal(true)
  const [applying, setApplying] = createSignal(false)
  const [state, setState] = createSignal(initial())
  const toast = createWorkStyleToasts(language.t)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "workStyleLoaded") {
      if (applying()) return
      setStyle(message.style)
      setState((value) =>
        update(value, {
          type: "loaded",
          style: message.style,
          available: message.dataAgentAvailable,
        }),
      )
      setLoading(false)
      return
    }
    if (message.type === "workStyleApplied") {
      setApplying(false)
      setStyle(message.style)
      setState((value) => update(value, { type: "completed" }))
      vscode.postMessage({
        type: "telemetry",
        event: TelemetryEventName.WORK_STYLE_SELECTED,
        properties: { style: message.style, agent: message.agent },
      })
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

  const dismiss = (event: Event) => {
    if (!loading() && !state().visible) return
    if (applying()) {
      if (event.cancelable) event.preventDefault()
      return
    }
    setState((value) => update(value, { type: "skipped" }))
    setStyle("skipped")
    vscode.postMessage({ type: "setWorkStyle", style: "skipped" })
  }
  window.addEventListener("newTaskRequest", dismiss)
  window.addEventListener("taskSubmitRequest", dismiss)

  onCleanup(() => {
    unsubscribe()
    unsubReady()
    window.removeEventListener("newTaskRequest", dismiss)
    window.removeEventListener("taskSubmitRequest", dismiss)
  })

  function select(style: WorkStyle) {
    if (applying()) return
    const next = advance(state(), style)
    setState(next.state)
    if (!next.agent) return

    setApplying(true)
    vscode.postMessage({ type: "applyWorkStyle", style, agent: next.agent })
  }

  function complete(agent: OnboardingAgent) {
    const pending = state().style
    if (applying() || !pending) return
    setApplying(true)
    vscode.postMessage({ type: "applyWorkStyle", style: pending, agent })
  }

  const ready = createMemo(() => !loading())
  const onboarding = createMemo(() => ready() && state().visible)
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
    page: () => state().page,
    loading: () => !ready(),
    applying,
    shouldShowOnboarding: onboarding,
    select,
    complete,
  }

  return <WorkStyleContext.Provider value={value}>{props.children}</WorkStyleContext.Provider>
}

export function useWorkStyle(): WorkStyleContextValue {
  const context = useContext(WorkStyleContext)
  if (!context) throw new Error("useWorkStyle must be used within a WorkStyleProvider")
  return context
}
