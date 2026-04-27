import { createContext, useContext, createMemo, createSignal, onCleanup, createEffect } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage, IndexingStatus } from "../types/messages"
import { formatIndexingLabel, indexingTone } from "./indexing-utils"
import { useConfig } from "./config"

interface IndexingContextValue {
  status: Accessor<IndexingStatus>
  loading: Accessor<boolean>
  label: Accessor<string>
  tone: Accessor<"muted" | "warning" | "success" | "error">
}

const initial: IndexingStatus = {
  state: "Disabled",
  message: "Indexing disabled.",
  processedFiles: 0,
  totalFiles: 0,
  percent: 0,
}

export { formatIndexingLabel, indexingTone } from "./indexing-utils"

const IndexingContext = createContext<IndexingContextValue>()

export const IndexingProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const { features } = useConfig()
  const [status, setStatus] = createSignal<IndexingStatus>(initial)
  const [loading, setLoading] = createSignal(true)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (!features().indexing) return
    if (message.type !== "indexingStatusLoaded") return
    setStatus(message.status)
    setLoading(false)
  })

  onCleanup(unsubscribe)

  createEffect(() => {
    if (!features().indexing) {
      setStatus(initial)
      setLoading(false)
      return
    }

    setLoading(true)
    let retries = 0
    const maxRetries = 5
    const retryMs = 500

    vscode.postMessage({ type: "requestIndexingStatus" })

    const retryTimer = setInterval(() => {
      retries++
      if (!loading() || retries >= maxRetries) {
        clearInterval(retryTimer)
        return
      }
      vscode.postMessage({ type: "requestIndexingStatus" })
    }, retryMs)

    onCleanup(() => clearInterval(retryTimer))
  })

  const value: IndexingContextValue = {
    status,
    loading,
    label: createMemo(() => formatIndexingLabel(status())),
    tone: createMemo(() => indexingTone(status())),
  }

  return <IndexingContext.Provider value={value}>{props.children}</IndexingContext.Provider>
}

export function useIndexing(): IndexingContextValue {
  const context = useContext(IndexingContext)
  if (!context) {
    throw new Error("useIndexing must be used within an IndexingProvider")
  }
  return context
}
