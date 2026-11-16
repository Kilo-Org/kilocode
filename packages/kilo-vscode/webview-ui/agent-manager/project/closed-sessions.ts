/**
 * Session tabs the user closed before the host confirmed the close.
 *
 * A close is optimistic in the webview: the tab disappears at once, while a
 * state push that was already in flight can still list the session and its tab
 * order. The dismissed id stays suppressed until the host state no longer files
 * it, a later state push prunes it, or the user opens the session again.
 */
import { createSignal } from "solid-js"
import { pruneClosed } from "../../src/utils/local-tabs"

export function createClosedSessions() {
  const [ids, setIds] = createSignal<ReadonlySet<string>>(new Set())

  const dismiss = (id: string) =>
    setIds((prev) => {
      if (prev.has(id)) return prev
      return new Set([...prev, id])
    })

  const resume = (id: string) =>
    setIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  const prune = (sessions: readonly { id: string }[]) => setIds((prev) => pruneClosed(prev, sessions) ?? prev)

  return { ids, dismiss, resume, prune }
}
