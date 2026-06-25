import type { WorkStyle, WorkStyleState } from "../../../src/shared/work-style-presets"

export type Page = "style" | "agent"

export interface State {
  visible: boolean
  page: Page
  available: boolean
  style?: WorkStyle
}

type Event = { type: "loaded"; style: WorkStyleState; available: boolean } | { type: "completed" } | { type: "skipped" }

interface Selection {
  state: State
  agent?: "code"
}

export function initial(): State {
  return { visible: false, page: "style", available: false }
}

export function advance(state: State, style: WorkStyle): Selection {
  if (state.available) return { state: { ...state, visible: true, page: "agent", style } }
  return { state: { ...state, visible: true, page: "style", style }, agent: "code" }
}

export function update(state: State, event: Event): State {
  if (event.type === "completed" || event.type === "skipped") return initial()
  if (event.style === "unset") {
    // Preserve the initial capability across retries.
    if (state.visible) return state
    return { ...state, visible: true, available: event.available }
  }
  if (event.style === "skipped") return state
  return initial()
}
