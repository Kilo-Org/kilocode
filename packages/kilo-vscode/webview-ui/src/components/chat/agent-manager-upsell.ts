// Temporary development gate; the separate opt-in PR adds the Experimental setting.
export const AGENT_MANAGER_UPSELL = false

/** Track only turns observed running on this sidebar, never restored conversation summaries. */
export function sidebarTurns() {
  const running = new Map<string, string>()
  const finished = new Set<string>()
  return (state: { id?: string; turn?: string; busy: boolean; reason?: string; files?: number }) => {
    if (!state.id || !state.turn) return false
    if (state.busy) {
      running.set(state.id, state.turn)
      finished.delete(state.turn)
      return false
    }
    if (state.reason == null) return false
    if (running.get(state.id) === state.turn && state.reason === "completed") finished.add(state.turn)
    if (state.reason !== "completed") finished.delete(state.turn)
    running.delete(state.id)
    return finished.has(state.turn) && (state.files ?? 0) > 0
  }
}
