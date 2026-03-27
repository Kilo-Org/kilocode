/**
 * WorktreeMode context -- provides Local/Worktree mode toggle state.
 * Only active inside the Agent Manager. In the sidebar, the context is undefined
 * so consumers can check `useWorktreeMode()` to decide whether to render the toggle.
 *
 * When the mode changes, a message is posted to the extension so the interceptor
 * knows whether to create a worktree for the next session.
 */

import { createContext, useContext, createSignal, ParentComponent, Accessor } from "solid-js"

export type SessionMode = "local" | "worktree"

interface WorktreeModeContextValue {
  mode: Accessor<SessionMode>
  setMode: (mode: SessionMode) => void
  /** Active pending tab ID (e.g. "pending:1") — set by Agent Manager so PromptInput can key drafts per tab. */
  pendingId: Accessor<string | undefined>
  setPendingId: (id: string | undefined) => void
}

const WorktreeModeContext = createContext<WorktreeModeContextValue>()

export const WorktreeModeProvider: ParentComponent = (props) => {
  const [mode, setMode] = createSignal<SessionMode>("local")
  const [pendingId, setPendingId] = createSignal<string | undefined>()

  return (
    <WorktreeModeContext.Provider value={{ mode, setMode, pendingId, setPendingId }}>
      {props.children}
    </WorktreeModeContext.Provider>
  )
}

/**
 * Returns the worktree mode context, or undefined if not inside Agent Manager.
 */
export function useWorktreeMode(): WorktreeModeContextValue | undefined {
  return useContext(WorktreeModeContext)
}
