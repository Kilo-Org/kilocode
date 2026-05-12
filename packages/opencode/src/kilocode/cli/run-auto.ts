// kilocode_change - new file
export namespace KiloRunAuto {
  export interface State {
    root: string
    sessions: Set<string>
  }

  export interface Part {
    type?: string
    tool?: string
    sessionID?: string
    state?: unknown
  }

  export function create(root: string): State {
    return {
      root,
      sessions: new Set([root]),
    }
  }

  export function allowed(state: State, sessionID: string) {
    return state.sessions.has(sessionID)
  }

  export function track(state: State, part: Part) {
    if (part.type !== "tool") return
    if (part.tool !== "task") return
    if (part.sessionID !== state.root) return
    const id = child(meta(part.state))
    if (!id) return
    state.sessions.add(id)
  }

  function meta(state: unknown) {
    if (!state || typeof state !== "object") return
    return (state as Record<string, unknown>).metadata
  }

  function child(meta: unknown) {
    if (!meta || typeof meta !== "object") return
    const id = (meta as Record<string, unknown>).sessionId
    if (typeof id !== "string") return
    if (!id) return
    return id
  }
}
