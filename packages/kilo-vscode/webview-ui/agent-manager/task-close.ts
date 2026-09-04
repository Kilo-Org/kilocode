// Task-tab close helpers for the Agent Manager view. They live outside
// AgentManagerApp.tsx so the bulk-close flow stays unit testable without a
// webview, and so the view keeps room under its enforced file-size cap.
interface CloseAllTasksDeps {
  tabs: readonly { id: string }[]
  freeze: () => void
  pending: (id: string) => boolean
  local: ReadonlySet<string>
  clear: () => void
  setPending: (id: string | undefined) => void
  forget: (id: string) => void
  setLocal: (next: (ids: string[]) => string[]) => void
  submitting: (id: string) => boolean
  sending: (id: string) => boolean
  discard: (id: string) => void
  closed: Set<string>
  remove: (id: string) => void
  post: (ids: string[]) => void
  restore: () => void
}

export function closeFocusedTask(
  id: string | undefined,
  tabs: ReadonlyMap<string, unknown>,
  close: (id: string) => void,
) {
  if (!id || !tabs.has(id)) return
  close(id)
}

export function closeAllTasks(deps: CloseAllTasksDeps) {
  if (deps.tabs.length === 0) return
  deps.freeze()
  const ids = deps.tabs.map((tab) => tab.id)
  const local = new Set(ids.filter((id) => deps.pending(id) || deps.local.has(id)))
  const drafts = ids.filter(deps.pending)
  deps.clear()
  deps.setPending(undefined)
  for (const id of ids) deps.forget(id)
  if (local.size > 0) deps.setLocal((tabs) => tabs.filter((id) => !local.has(id)))
  for (const id of drafts) {
    deps.closed.add(id)
    if (deps.submitting(id) || deps.sending(id)) deps.discard(id)
  }
  if (drafts.length > 0) queueMicrotask(() => drafts.forEach(deps.remove))
  deps.post(ids)
  deps.restore()
}
