import { createContext, onCleanup, onMount, useContext, type ParentComponent } from "solid-js"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { useVSCode } from "./vscode"

const Context = createContext(false)

export const RichProvider: ParentComponent = (props) => {
  if (useContext(Context)) return props.children
  const vscode = useVSCode()
  onMount(() => {
    const save = (event: Event) => {
      const detail = (event as CustomEvent<{ dataUrl: string; filename: string }>).detail
      if (!detail?.dataUrl || !detail.filename) return
      event.preventDefault()
      vscode.postMessage({ type: "saveImage", dataUrl: detail.dataUrl, filename: detail.filename })
    }
    window.addEventListener("kilo:save-image", save)
    onCleanup(() => window.removeEventListener("kilo:save-image", save))
  })

  return (
    <Context.Provider value={true}>
      <MarkedProvider>
        <DiffComponentProvider component={Diff}>
          <CodeComponentProvider component={Code}>
            <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
          </CodeComponentProvider>
        </DiffComponentProvider>
      </MarkedProvider>
    </Context.Provider>
  )
}
