// Temporary development gate. PR3 replaces this after worktree-only Send is ready.
export const AGENT_MANAGER_UPSELL = false

export function showAgentManagerUpsell(state: {
  enabled: boolean
  sidebar: boolean
  git: boolean
  status: string
  reason?: string
  files?: number
  dismissed: boolean
}) {
  return (
    state.enabled &&
    state.sidebar &&
    state.git &&
    state.status === "idle" &&
    state.reason === "completed" &&
    (state.files ?? 0) > 0 &&
    !state.dismissed
  )
}
