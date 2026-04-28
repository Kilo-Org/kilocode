import { lazy } from "@/util/lazy"
import { KiloIndexing } from "@/kilocode/indexing"
import { createIndexingRoutes } from "@kilocode/kilo-indexing/server"

export const IndexingRoutes = lazy(() =>
  createIndexingRoutes({
    current: () => KiloIndexing.current(),
  }),
)
