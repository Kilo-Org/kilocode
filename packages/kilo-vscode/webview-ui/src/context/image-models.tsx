import { createContext, createSignal, onCleanup, useContext, type Accessor, type ParentComponent } from "solid-js"
import { useVSCode } from "./vscode"
import { useConfig } from "./config"
import type { Config, ExtensionMessage } from "../types/messages"

export type ImageModel = {
  id: string
  name: string
  description?: string
}

type ImageModelsContextValue = {
  models: Accessor<ImageModel[]>
  loading: Accessor<boolean>
  error: Accessor<string | undefined>
  ready: Accessor<boolean>
  refresh: () => void
}

export const ImageModelsContext = createContext<ImageModelsContextValue>()

function source(cfg: Config) {
  const url = cfg.experimental?.image_generation_base_url?.trim().replace(/\/+$/, "")
  return url ? JSON.stringify([url, cfg.experimental?.image_generation_api_key?.trim() ?? ""]) : ""
}

export const ImageModelsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const config = useConfig().config
  const [models, setModels] = createSignal<ImageModel[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [saved, setSaved] = createSignal(source(config()))
  let sequence = 0
  const ready = () => source(config()) === saved()

  const request = () => {
    setModels([])
    setError(undefined)
    setLoading(true)
    vscode.postMessage({ type: "requestImageModels", request: ++sequence })
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "extensionDataReady") {
      request()
      return
    }
    if (
      (message.type === "configLoaded" || message.type === "configUpdated" || message.type === "configUpdateFailed") &&
      message.config
    ) {
      const next = source(message.config)
      if (next === saved()) return
      setSaved(next)
      request()
      return
    }
    if (message.type !== "imageModelsLoaded" || message.request !== sequence) return
    setModels(message.models)
    setError(message.error)
    setLoading(false)
    if (!message.error) clearTimeout(retry)
  })

  request()

  // Retry once after a delay in case the backend wasn't ready for the initial request.
  const retry = setTimeout(request, 3000)
  onCleanup(() => clearTimeout(retry))

  onCleanup(unsubscribe)

  return (
    <ImageModelsContext.Provider
      value={{
        models: () => (ready() ? models() : []),
        error: () => (ready() ? error() : undefined),
        loading,
        ready,
        refresh: () => {
          if (ready()) request()
        },
      }}
    >
      {props.children}
    </ImageModelsContext.Provider>
  )
}

export function useImageModels(): ImageModelsContextValue {
  const context = useContext(ImageModelsContext)
  if (!context) {
    throw new Error("useImageModels must be used within an ImageModelsProvider")
  }
  return context
}
