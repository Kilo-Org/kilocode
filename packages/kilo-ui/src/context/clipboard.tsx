import { createContext, type ParentComponent, useContext } from "solid-js"

type ClipboardContextValue = {
  write: (text: string) => void | Promise<void>
}

const ClipboardContext = createContext<ClipboardContextValue>({
  write: (text) => navigator.clipboard.writeText(text),
})

export const ClipboardProvider: ParentComponent<ClipboardContextValue> = (props) => (
  <ClipboardContext.Provider value={{ write: props.write }}>{props.children}</ClipboardContext.Provider>
)

export function useClipboard() {
  return useContext(ClipboardContext)
}
