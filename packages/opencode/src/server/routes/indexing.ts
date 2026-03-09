import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { lazy } from "@/util/lazy"
import { KiloIndexing } from "@/kilocode/indexing"

export const IndexingRoutes = lazy(() =>
  new Hono().get(
    "/status",
    describeRoute({
      summary: "Get indexing status",
      description: "Retrieve the current code indexing status for the active project.",
      operationId: "indexing.status",
      responses: {
        200: {
          description: "Indexing status",
          content: {
            "application/json": {
              schema: resolver(KiloIndexing.Status),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await KiloIndexing.current())
    },
  ),
)
