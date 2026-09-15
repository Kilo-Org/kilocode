import { batch, createSignal, type Accessor } from "solid-js"
import { SidePanel } from "./side-panel-layout"

const ownership: Record<SidePanel, "worktree" | "session"> = {
  [SidePanel.Diff]: "worktree",
  [SidePanel.PR]: "worktree",
  [SidePanel.Terminal]: "worktree",
  [SidePanel.Documents]: "worktree",
  [SidePanel.Subagents]: "session",
  [SidePanel.EditPreview]: "session",
  [SidePanel.Browser]: "session",
}

export function createSidePanel(opts: {
  project: Accessor<string | undefined>
  selection: Accessor<string | null>
  current: Accessor<string | undefined>
  visible?: (panel: SidePanel) => boolean
}) {
  const [worktrees, setWorktrees] = createSignal<Record<string, SidePanel | null>>({})
  const [sessions, setSessions] = createSignal<Record<string, SidePanel | null | undefined>>({})
  const worktree = () => JSON.stringify([opts.project() ?? "single", opts.selection()])
  const session = () => {
    const id = opts.current()
    return id ? JSON.stringify([opts.project() ?? "single", id]) : undefined
  }
  // A draft can show the browser's no-session guidance without creating a backend session.
  const owner = () => session() ?? JSON.stringify([opts.project() ?? "single", opts.selection(), null])
  const selected = () => {
    const override = sessions()[owner()]
    return override !== undefined ? override : (worktrees()[worktree()] ?? null)
  }
  const panel = () => {
    const value = selected()
    return value && opts.visible?.(value) === false ? null : value
  }
  const open = (value: SidePanel) => {
    const id = session()
    if (ownership[value] === "session") {
      if (id || value === SidePanel.Browser) setSessions((prev) => ({ ...prev, [owner()]: value }))
      return
    }
    const key = worktree()
    batch(() => {
      setWorktrees((prev) => ({ ...prev, [key]: value }))
      setSessions((prev) => ({ ...prev, [owner()]: undefined }))
    })
  }
  const close = (expected?: SidePanel) => {
    const value = selected()
    if (!value || (expected && value !== expected)) return
    if (ownership[value] === "session") {
      setSessions((prev) => ({ ...prev, [owner()]: null }))
      return
    }
    setWorktrees((prev) => ({ ...prev, [worktree()]: null }))
  }
  const toggle = (value: SidePanel) => (panel() === value ? close(value) : open(value))

  return { panel, selected, session, open, close, toggle }
}
