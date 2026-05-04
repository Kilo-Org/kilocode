import { createContext, createMemo, useContext, type Accessor, type ParentComponent } from "solid-js"
import { useConfig } from "./config"

interface DisplayContextValue {
  reasoningAutoCollapse: Accessor<boolean>
  setReasoningAutoCollapse: (collapse: boolean) => void
}

export const DisplayContext = createContext<DisplayContextValue>()

export const DisplayProvider: ParentComponent = (props) => {
  const { config, updateConfig } = useConfig()
  const reasoningAutoCollapse = createMemo(() => config().auto_collapse_reasoning ?? false)

  return (
    <DisplayContext.Provider
      value={{
        reasoningAutoCollapse,
        setReasoningAutoCollapse: (collapse) => updateConfig({ auto_collapse_reasoning: collapse }),
      }}
    >
      {props.children}
    </DisplayContext.Provider>
  )
}

export function useDisplay(): DisplayContextValue {
  const context = useContext(DisplayContext)
  if (!context) {
    throw new Error("useDisplay must be used within a DisplayProvider")
  }
  return context
}
