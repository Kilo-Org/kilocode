// The image models of the current location, read with the `image` model type so the list matches what the
// `experimental_image_generate` tool can use. Only the Experimental tab shows them, and the tab mounts this provider
// itself, so the Settings shell does not read the catalog.
import type { ModelInfo } from "@opencode/client"
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

type KiloImageModelsContextValue = {
  /** The enabled image models; undefined until the first read answers. */
  models: Accessor<ModelInfo[] | undefined>
}

const KiloImageModelsContext = createContext<KiloImageModelsContextValue>()

export const KiloImageModelsProvider: ParentComponent = (props) => {
  const v2 = useV2()
  const [models, setModels] = createSignal<ModelInfo[]>()
  let read = 0

  const refresh = () => {
    const token = ++read
    void v2.api.model
      .list({ location: { directory: v2.directory }, types: ["image"] })
      .then((result) => {
        if (token === read) setModels(result.data)
      })
      .catch((error: unknown) => {
        console.error("Kilo image models failed", error)
        if (token === read) setModels([])
      })
  }

  createEffect(
    on(v2.connection.status, (connection) => {
      if (connection === "connected") refresh()
    }),
  )
  onCleanup(() => read++)

  return <KiloImageModelsContext.Provider value={{ models }}>{props.children}</KiloImageModelsContext.Provider>
}

export function useKiloImageModels(): KiloImageModelsContextValue {
  const context = useContext(KiloImageModelsContext)
  if (!context) {
    throw new Error("useKiloImageModels must be used within a KiloImageModelsProvider")
  }
  return context
}
