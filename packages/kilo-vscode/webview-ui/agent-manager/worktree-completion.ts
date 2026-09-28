import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { WorktreeState } from "../src/types/messages"
import { useVSCode } from "../src/context/vscode"

/** Retain only acknowledged deletions for presentation, never in project state. */
export function createWorktreeCompletion(
  source: () => WorktreeState[],
  project: () => string | undefined,
  label: (worktree: WorktreeState) => string,
) {
  const vscode = useVSCode()
  const [retained, setRetained] = createSignal(new Map<string, { worktree: WorktreeState; index: number }>())
  const known = new Map<string, { worktree: WorktreeState; index: number }>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const release = (id: string) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    setRetained((prev) => new Map([...prev].filter(([key]) => key !== id)))
  }
  createEffect(() => {
    const id = project()
    known.clear()
    setRetained(new Map())
    onCleanup(
      vscode.onMessage((message) => {
        if (message.type !== "agentManager.worktreeDeleted" || (id !== undefined && message.projectId !== id)) return
        const current = source().findIndex((item) => item.id === message.worktreeId)
        const stored = known.get(message.worktreeId)
        const index = current >= 0 ? current : (stored?.index ?? -1)
        const worktree = current >= 0 ? source().at(current) : stored?.worktree
        if (index < 0 || !worktree || timers.has(worktree.id)) return
        setRetained(
          (prev) => new Map([...prev, [worktree.id, { worktree: { ...worktree, label: label(worktree) }, index }]]),
        )
        // Fallback for hidden webviews or interrupted CSS animations.
        timers.set(
          worktree.id,
          setTimeout(() => release(worktree.id), 900),
        )
      }),
    )
    onCleanup(() => {
      timers.forEach(clearTimeout)
      timers.clear()
    })
  })
  const rows = createMemo(() => {
    const current = source()
    current.forEach((worktree, index) => known.set(worktree.id, { worktree, index }))
    const rows = current.map((worktree) => retained().get(worktree.id)?.worktree ?? worktree)
    for (const { worktree, index } of retained().values()) {
      if (!rows.some((item) => item.id === worktree.id)) rows.splice(index, 0, worktree)
    }
    return rows
  })
  return { rows, completed: (id: string) => retained().has(id), release }
}
