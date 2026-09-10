import { createContext, createSignal, onCleanup, useContext, type Accessor, type ParentComponent } from "solid-js"
import {
  EMPTY_KILO_EMBEDDING_MODEL_CATALOG,
  type KiloEmbeddingModelCatalog,
} from "@kilocode/kilo-indexing/embedding-models"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"

type KiloEmbeddingModelsContextValue = {
  catalog: Accessor<KiloEmbeddingModelCatalog>
}

export const KiloEmbeddingModelsContext = createContext<KiloEmbeddingModelsContextValue>()

export const KiloEmbeddingModelsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [catalog, setCatalog] = createSignal<KiloEmbeddingModelCatalog>(EMPTY_KILO_EMBEDDING_MODEL_CATALOG)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "kiloEmbeddingModelsLoaded") return
    setCatalog(message.catalog)
  })

  vscode.postMessage({ type: "requestKiloEmbeddingModels" })

  onCleanup(unsubscribe)

  return <KiloEmbeddingModelsContext.Provider value={{ catalog }}>{props.children}</KiloEmbeddingModelsContext.Provider>
}

export function useKiloEmbeddingModels(): KiloEmbeddingModelsContextValue {
  const context = useContext(KiloEmbeddingModelsContext)
  if (!context) {
    throw new Error("useKiloEmbeddingModels must be used within a KiloEmbeddingModelsProvider")
  }
  return context
}
