import { createContext, useContext, type ParentComponent } from "solid-js"

interface ToolActionsValue {
  abort?: (sessionID: string) => void
}

const ToolActionsContext = createContext<ToolActionsValue>({})

export function useToolActions() {
  return useContext(ToolActionsContext)
}

export const ToolActionsProvider: ParentComponent<ToolActionsValue> = (props) => {
  return <ToolActionsContext.Provider value={props}>{props.children}</ToolActionsContext.Provider>
}
