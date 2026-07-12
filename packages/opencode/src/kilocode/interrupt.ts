export namespace Interrupt {
  export type StatusType = "idle" | "busy" | "retry" | "offline"

  export type Action =
    | { type: "abort" }
    | { type: "success" }
    | { type: "error"; message: string }
    | { type: "clearPending" }

  export interface State {
    pending: boolean
    escapeCount: number
    firstEscapeAt: number | null
    target: "child" | "normal" | null
  }

  export interface Config {
    windowMs: number
  }

  export interface MessageLike {
    id: string
  }

  export interface PartLike {
    type: string
    tool?: string
    state?: {
      status?: string
      metadata?: unknown
    }
  }

  export function available(status: StatusType | undefined, active: boolean) {
    if (status === undefined) return active
    return status !== "idle" || active
  }

  export function foregroundTaskActive(input: {
    childID: string | undefined
    parentID: string | undefined
    messages: readonly MessageLike[]
    parts: Record<string, readonly PartLike[] | undefined>
  }) {
    if (!input.childID || !input.parentID) return false

    return input.messages.some((message) =>
      (input.parts[message.id] ?? []).some((part) => {
        if (part.type !== "tool") return false
        if (part.tool !== "task") return false
        if (part.state?.status !== "running") return false

        const metadata = part.state.metadata as
          | {
              sessionId?: string
            }
          | undefined

        return metadata?.sessionId === input.childID
      }),
    )
  }

  export function onEscape(
    state: State,
    now: number,
    cfg: Config,
  ): { state: State; actions: Action[] } {
    let firstEscapeAt = state.firstEscapeAt
    let escapeCount = state.escapeCount
    if (firstEscapeAt === null || now - firstEscapeAt > cfg.windowMs) {
      firstEscapeAt = now
      escapeCount = 1
    } else {
      escapeCount = escapeCount + 1
    }
    const actions: Action[] = []
    if (escapeCount >= 2) {
      actions.push({ type: "abort" })
      escapeCount = 0
      firstEscapeAt = null
    }
    return { state: { pending: state.pending, escapeCount, firstEscapeAt, target: state.target }, actions }
  }

  export function onStatus(
    state: State,
    prev: StatusType | undefined,
    next: StatusType,
    childPresent: boolean,
    active: boolean,
  ): { state: State; actions: Action[] } {
    if (state.target === "normal") {
      if (prev === undefined || prev === "idle") return { state, actions: [] }
      if (next !== "idle") return { state, actions: [] }
      return { state: { ...state, target: null }, actions: [] }
    }

    if (state.target !== "child" || !state.pending) {
      if (state.target === null) return { state, actions: [] }
      return { state: { ...state, target: null }, actions: [] }
    }

    if (active) return { state, actions: [] }
    if (!childPresent) return { state: { ...state, pending: false, target: null }, actions: [{ type: "clearPending" }] }
    if (prev === undefined || prev === "idle") return { state, actions: [] }
    if (next !== "idle") return { state, actions: [] }
    return { state, actions: [] }
  }

  export function onForegroundTask(
    state: State,
    prev: boolean,
    next: boolean,
  ): { state: State; actions: Action[] } {
    if (state.target !== "child" || !state.pending) return { state, actions: [] }
    if (next) return { state, actions: [] }
    if (prev) return { state: { ...state, pending: false, target: null }, actions: [{ type: "success" }] }
    return { state: { ...state, pending: false, target: null }, actions: [{ type: "clearPending" }] }
  }

  export function onAbortReject(state: State, message: string): { state: State; actions: Action[] } {
    if (state.target === "normal") {
      return { state: { ...state, target: null }, actions: [{ type: "error", message }] }
    }
    if (state.target === "child" && state.pending) {
      return { state: { ...state, pending: false, target: null }, actions: [{ type: "error", message }] }
    }
    return { state: { ...state, target: null }, actions: [] }
  }

  export function onChildRemoved(state: State, active: boolean): { state: State; actions: Action[] } {
    if (state.target === "child" && state.pending && !active) {
      return { state: { ...state, pending: false, target: null }, actions: [{ type: "clearPending" }] }
    }
    return { state, actions: [] }
  }
}
