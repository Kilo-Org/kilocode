import { lazy } from "@/util/lazy"
import { createIndexingRoutes } from "@kilocode/kilo-indexing/server"

export const IndexingRoutes = lazy(() =>
  createIndexingRoutes({
    current: async () => {
      const mod = await import("@/kilocode/indexing")
      return mod.KiloIndexing.current()
    },
  }),
)
