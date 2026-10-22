import { createContext, createSignal, useContext, type Accessor, type ParentComponent } from "solid-js"

export type DiffStyle = "unified" | "split"

interface DiffStyleContextValue {
  style: Accessor<DiffStyle>
  setStyle: (style: DiffStyle) => void
}

const DiffStyleContext = createContext<DiffStyleContextValue>()

export const DiffStyleProvider: ParentComponent = (props) => {
  const [style, setStyle] = createSignal<DiffStyle>("unified")
  return <DiffStyleContext.Provider value={{ style, setStyle }}>{props.children}</DiffStyleContext.Provider>
}

export function useDiffStyle(): DiffStyleContextValue | undefined {
  return useContext(DiffStyleContext)
}
