import { createContext, useContext, type ParentComponent } from "solid-js"
import type { BoardSessionNode } from "../components/board-route"

export type BoardSessionNavigation = (sessionID: string, title?: string) => void

const BoardNavigationContext = createContext<BoardSessionNavigation>()

export const BoardNavigationProvider: ParentComponent<{ open: BoardSessionNavigation }> = (props) => (
  <BoardNavigationContext.Provider value={props.open}>{props.children}</BoardNavigationContext.Provider>
)

export function useBoardNavigation() {
  return useContext(BoardNavigationContext)
}

/**
 * The sessions a board post can address, as a host that keeps a session store reads them. A card uses this for the
 * optimistic route while the post streams; without it, the route appears when the tool result arrives.
 */
export type BoardSessions = (sessionID: string) => readonly BoardSessionNode[]

const BoardSessionsContext = createContext<BoardSessions>()

export const BoardSessionsProvider: ParentComponent<{ sessions: BoardSessions }> = (props) => (
  <BoardSessionsContext.Provider value={props.sessions}>{props.children}</BoardSessionsContext.Provider>
)

export function useBoardSessions() {
  return useContext(BoardSessionsContext)
}
