import { createEffect, createSignal, on, onCleanup } from "solid-js"
import type { AgentManagerSidebarTarget } from "../src/types/messages"
import type { ProjectStore } from "./project/store"
import { LOCAL, nextSelectionAfterDelete } from "./navigate"
import { buildSidebarOrder, buildTopLevelItems, sortWorktrees } from "./section-helpers"

const MODIFIERS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"])

/**
 * Delete/Backspace on a selected worktree triggers inline delete confirmation.
 * Two separate key presses (within the 2500ms window) confirm the delete.
 */
export function createDeleteKey(opts: {
  guard: (target: EventTarget | null) => boolean
  selection: () => string | null | undefined
  close: () => void
}) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return
    if (opts.guard(e.target)) return
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return
    const sel = opts.selection()
    if (!sel || sel === LOCAL) return
    e.preventDefault()
    if (e.repeat) return
    opts.close()
  }
}

export function createWorktreeDelete(opts: {
  store: (projectId: string) => ProjectStore | undefined
  project: () => string | undefined
  selection: () => string | undefined
  busy: (projectId: string, id: string) => boolean
  blocked: (projectId: string, id: string) => boolean
  select: (target: AgentManagerSidebarTarget) => void
  remove: (projectId: string, worktreeId: string) => void
  reveal: (projectId: string, worktreeId: string) => void
  view?: Window
}) {
  const [pending, setPending] = createSignal<{ projectId: string; worktreeId: string }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    setPending(undefined)
  }
  // VS Code also runs keybinding commands for auto-repeat keydowns, and host actions
  // cannot see `repeat`. Each repeat opens a short window that covers the host round
  // trip. Held modifiers do not count, so a held Ctrl+Shift before W still works.
  const view = opts.view ?? window
  let held = 0
  const hold = (e: KeyboardEvent) => {
    if (e.repeat && !MODIFIERS.has(e.key)) held = performance.now() + 300
  }
  view.addEventListener("keydown", hold, true)
  onCleanup(() => view.removeEventListener("keydown", hold, true))
  // Catalog refreshes can recompute accessors without changing the selected target.
  createEffect(
    on(
      [opts.project, opts.selection],
      (value, previous) => {
        if (value.at(0) === previous?.at(0) && value.at(1) === previous?.at(1)) return
        cancel()
      },
      { defer: true },
    ),
  )
  onCleanup(cancel)

  const select = (projectId: string, id: string) => {
    const store = opts.store(projectId)
    if (!store || opts.project() !== projectId || opts.selection() !== id) return
    const sorted = sortWorktrees(store.worktrees(), store.worktreeOrder())
    const sections = store.sections()
    const top = buildTopLevelItems(
      sections,
      sorted.filter((wt) => !wt.sectionId),
      sorted,
      store.worktreeOrder(),
    )
    const order = buildSidebarOrder(
      top,
      sorted,
      sections,
      (section) => sorted.filter((wt) => wt.sectionId === section),
      id,
    )
      .filter((item) => item.type === "wt")
      .map((item) => item.id)
    const ids = new Set(store.managedSessions().map((item) => item.worktreeId))
    const next = nextSelectionAfterDelete(
      id,
      order,
      (id) => ids.has(id) && !opts.busy(projectId, id) && !store.staleWorktreeIds().has(id),
    )
    opts.select(next === LOCAL ? { projectId, kind: "local" } : { projectId, kind: "worktree", worktreeId: next })
  }

  const confirm = (projectId: string, worktreeId: string) => {
    if (performance.now() < held) return
    const store = opts.store(projectId)
    const run = store?.runStatuses()[worktreeId]?.state
    if (
      !store?.worktrees().some((wt) => wt.id === worktreeId) ||
      opts.busy(projectId, worktreeId) ||
      opts.blocked(projectId, worktreeId) ||
      (run && run !== "idle")
    ) {
      cancel()
      return
    }
    if (pending()?.projectId === projectId && pending()?.worktreeId === worktreeId) {
      cancel()
      store.setBusy((prev) => new Map([...prev, [worktreeId, { reason: "deleting" as const }]]))
      opts.remove(projectId, worktreeId)
      select(projectId, worktreeId)
      return
    }
    cancel()
    opts.reveal(projectId, worktreeId)
    setPending({ projectId, worktreeId })
    timer = setTimeout(cancel, 2500)
  }

  return { pending, cancel, confirm, select }
}

export type WorktreeDelete = ReturnType<typeof createWorktreeDelete>
