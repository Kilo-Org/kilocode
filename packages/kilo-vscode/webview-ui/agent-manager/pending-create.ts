import { createSignal } from "solid-js"

/**
 * Tracks a cross-project worktree creation so the target project is activated
 * once its worktree is ready, and abandons the pending activation when the
 * creation fails or completes through another flow.
 */
export function usePendingCreate(
  active: () => string | undefined,
  activate: (projectId: string, worktreeId: string) => void,
) {
  const [pending, setPending] = createSignal<{ projectId: string }>()

  const schedule = (projectId: string) => {
    if (projectId === active()) return
    if (pending()) return
    setPending({ projectId })
  }

  const abandon = (projectId?: string) => {
    if (pending()?.projectId === projectId) setPending(undefined)
  }

  const setup = (ev: { status: string; projectId?: string; worktreeId?: string }) => {
    if (pending()?.projectId !== ev.projectId) return
    if (ev.status === "ready" && ev.projectId && ev.worktreeId) {
      setPending(undefined)
      activate(ev.projectId, ev.worktreeId)
    }
    if (ev.status === "error") setPending(undefined)
  }

  return { schedule, abandon, setup }
}
