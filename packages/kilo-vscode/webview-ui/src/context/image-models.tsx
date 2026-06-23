import { createContext, createSignal, onCleanup, useContext, type Accessor, type ParentComponent } from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"

export type ImageModel = {
  id: string
  name: string
  description?: string
}

type ImageModelsContextValue = {
  models: Accessor<ImageModel[]>
}

export const ImageModelsContext = createContext<ImageModelsContextValue>()

export const ImageModelsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [models, setModels] = createSignal<ImageModel[]>([])

  const request = () => vscode.postMessage({ type: "requestImageModels" })

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "imageModelsLoaded") return
    setModels(message.models)
  })

  request()

  // Retry once after a delay in case the backend wasn't ready for the initial request.
  const retry = setTimeout(request, 3000)
  onCleanup(() => clearTimeout(retry))

  onCleanup(unsubscribe)

  return <ImageModelsContext.Provider value={{ models }}>{props.children}</ImageModelsContext.Provider>
}

export function useImageModels(): ImageModelsContextValue {
  const context = useContext(ImageModelsContext)
  if (!context) {
    throw new Error("useImageModels must be used within an ImageModelsProvider")
  }
  return context
}
