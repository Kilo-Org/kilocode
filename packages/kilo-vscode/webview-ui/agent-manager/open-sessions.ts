import { createEffect } from "solid-js"
import type { Accessor } from "solid-js"

/** Reactive effect: reports open (non-pending) session IDs to the extension for heartbeat. */
export function trackOpenSessions(
  local: Accessor<string[]>,
  pending: (id: string) => boolean,
  managed: Accessor<Array<{ id: string }>>,
  post: (msg: { type: "agentManager.openSessions"; sessionIDs: string[] }) => void,
): void {
  createEffect(() => {
    const ids = [...new Set([...local().filter((id) => !pending(id)), ...managed().map((s) => s.id)])]
    post({ type: "agentManager.openSessions", sessionIDs: ids })
  })
}
