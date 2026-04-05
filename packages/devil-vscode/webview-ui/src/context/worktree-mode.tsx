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
}

const WorktreeModeContext = createContext<WorktreeModeContextValue>()

export const WorktreeModeProvider: ParentComponent = (props) => {
  const [mode, setMode] = createSignal<SessionMode>("local")

  return <WorktreeModeContext.Provider value={{ mode, setMode }}>{props.children}</WorktreeModeContext.Provider>
}

/**
 * Returns the worktree mode context, or undefined if not inside Agent Manager.
 */
export function useWorktreeMode(): WorktreeModeContextValue | undefined {
  return useContext(WorktreeModeContext)
}
