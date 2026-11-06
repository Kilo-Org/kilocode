import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import {
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import { useV2 } from "../v2/client"

export type KiloEmbeddingModel = KiloGatewayRpc.EmbeddingCatalog["models"][number]
export type KiloEmbeddingModelCatalog = KiloGatewayRpc.EmbeddingCatalog

export const EMPTY_KILO_EMBEDDING_MODEL_CATALOG: KiloEmbeddingModelCatalog = {
  defaultModel: "",
  models: [],
  aliases: {},
}

export function normalizeKiloEmbeddingModelId(model: string | undefined, catalog = EMPTY_KILO_EMBEDDING_MODEL_CATALOG) {
  if (!model) return undefined
  return catalog.aliases[model] ?? model
}

export function getKiloEmbeddingModel(model: string | undefined, catalog = EMPTY_KILO_EMBEDDING_MODEL_CATALOG) {
  const id = normalizeKiloEmbeddingModelId(model, catalog)
  return catalog.models.find((item) => item.id === id)
}

export function formatKiloEmbeddingModelLabel(model: KiloEmbeddingModel): string {
  const note = model.note ? `${model.note}, ` : ""
  return `${model.name} (${note}${model.dimension}d)`
}

type KiloEmbeddingModelsContextValue = {
  catalog: Accessor<KiloEmbeddingModelCatalog>
}

const KiloEmbeddingModelsContext = createContext<KiloEmbeddingModelsContextValue>()

export const KiloEmbeddingModelsProvider: ParentComponent = (props) => {
  const v2 = useV2()
  const [catalog, setCatalog] = createSignal<KiloEmbeddingModelCatalog>(EMPTY_KILO_EMBEDDING_MODEL_CATALOG)
  let read = 0

  const refresh = () => {
    const token = ++read
    void v2.api
      .rpc(KiloGatewayRpc.Definition)
      ["models.embeddings"]({}, { location: { directory: v2.directory } })
      .then((next) => {
        if (token === read) setCatalog(next)
      })
      .catch((error: unknown) => {
        console.error("Kilo embedding models failed", error)
        if (token === read) setCatalog(EMPTY_KILO_EMBEDDING_MODEL_CATALOG)
      })
  }

  createEffect(
    on(v2.connection.status, (connection) => {
      if (connection === "connected") refresh()
    }),
  )
  onCleanup(() => read++)

  return <KiloEmbeddingModelsContext.Provider value={{ catalog }}>{props.children}</KiloEmbeddingModelsContext.Provider>
}

export function useKiloEmbeddingModels(): KiloEmbeddingModelsContextValue {
  const context = useContext(KiloEmbeddingModelsContext)
  if (!context) {
    throw new Error("useKiloEmbeddingModels must be used within a KiloEmbeddingModelsProvider")
  }
  return context
}
