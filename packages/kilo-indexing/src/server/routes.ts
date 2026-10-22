import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { IndexingStatus, type IndexingStatus as Status } from "../status"

export function createIndexingRoutes(input: { current(): Promise<Status> }) {
  return new Hono().get(
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
              schema: resolver(IndexingStatus),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await input.current())
    },
  )
}
