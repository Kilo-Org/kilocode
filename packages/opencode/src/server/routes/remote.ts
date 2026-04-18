// devilcode_change - new file
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { DevilSessions } from "@/kilo-sessions/kilo-sessions"
import { lazy } from "../../util/lazy"

const Status = z.object({
  enabled: z.boolean(),
  connected: z.boolean(),
})

// devilcode_change - audit N13: shared 401 schema so the SDK type for failures is generated.
const RemoteError = z.object({
  error: z.string(),
})

const unauthorizedResponse = {
  description: "Unauthorized — Devil session ingest credentials missing or invalid",
  content: {
    "application/json": {
      schema: resolver(RemoteError),
    },
  },
}

export const RemoteRoutes = lazy(() =>
  new Hono()
    .post(
      "/enable",
      describeRoute({
        summary: "Enable remote connection",
        description: "Enable WebSocket connection to UserConnectionDO for real-time session relay and commands.",
        operationId: "remote.enable",
        responses: {
          200: {
            description: "Remote connection enabled",
            content: {
              "application/json": {
                schema: resolver(Status),
              },
            },
          },
          401: unauthorizedResponse,
        },
      }),
      async (c) => {
        try {
          await DevilSessions.enableRemote()
        } catch (err) {
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 401)
        }
        return c.json(DevilSessions.remoteStatus())
      },
    )
    .post(
      "/disable",
      describeRoute({
        summary: "Disable remote connection",
        description: "Close the remote WebSocket connection to UserConnectionDO.",
        operationId: "remote.disable",
        responses: {
          200: {
            description: "Remote connection disabled",
            content: {
              "application/json": {
                schema: resolver(Status),
              },
            },
          },
        },
      }),
      async (c) => {
        DevilSessions.disableRemote()
        return c.json(DevilSessions.remoteStatus())
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get remote connection status",
        description: "Get the current state of the remote WebSocket connection.",
        operationId: "remote.status",
        responses: {
          200: {
            description: "Remote connection status",
            content: {
              "application/json": {
                schema: resolver(Status),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(DevilSessions.remoteStatus())
      },
    ),
)
