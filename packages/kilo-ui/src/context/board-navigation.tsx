import { createContext, useContext, type ParentComponent } from "solid-js"

export type BoardSessionNavigation = (sessionID: string, title?: string) => void

const BoardNavigationContext = createContext<BoardSessionNavigation>()

export const BoardNavigationProvider: ParentComponent<{ open: BoardSessionNavigation }> = (props) => (
  <BoardNavigationContext.Provider value={props.open}>{props.children}</BoardNavigationContext.Provider>
)

export function useBoardNavigation() {
  return useContext(BoardNavigationContext)
}
