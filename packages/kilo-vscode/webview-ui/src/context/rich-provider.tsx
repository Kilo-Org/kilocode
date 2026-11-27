import { createContext, lazy, onCleanup, onMount, Suspense, useContext, type Component, type ParentComponent } from "solid-js"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { useVSCode } from "./vscode"

// Load Pierre-backed Code, Diff, and File viewers lazily so initial chat/Agent Manager startup
// does not parse `@pierre/diffs` + Shiki/Oniguruma before any code or diff card is mounted.
const LazyCode = lazy(() =>
  import("@kilocode/kilo-ui/code").then((mod) => ({ default: mod.Code as unknown as Component<Record<string, unknown>> })),
)
const LazyDiff = lazy(() =>
  import("@kilocode/kilo-ui/diff").then((mod) => ({ default: mod.Diff as unknown as Component<Record<string, unknown>> })),
)
const LazyFile = lazy(() =>
  import("@kilocode/kilo-ui/file").then((mod) => ({ default: mod.File as unknown as Component<Record<string, unknown>> })),
)

const Code: Component<Record<string, unknown>> = (props) => (
  <Suspense>
    <LazyCode {...props} />
  </Suspense>
)
const Diff: Component<Record<string, unknown>> = (props) => (
  <Suspense>
    <LazyDiff {...props} />
  </Suspense>
)
const File: Component<Record<string, unknown>> = (props) => (
  <Suspense>
    <LazyFile {...props} />
  </Suspense>
)

const Context = createContext(false)

export const RichProvider: ParentComponent = (props) => {
  if (useContext(Context)) return props.children
  const vscode = useVSCode()
  onMount(() => {
    const save = (event: Event) => {
      const detail = (event as CustomEvent<{ dataUrl: string; filename: string; sessionID?: string }>).detail
      if (!detail?.dataUrl || !detail.filename) return
      event.preventDefault()
      vscode.postMessage({
        type: "saveImage",
        dataUrl: detail.dataUrl,
        filename: detail.filename,
        sessionID: detail.sessionID,
      })
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
