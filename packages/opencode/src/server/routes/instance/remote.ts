// kilocode_change - new file
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { lazy } from "@/util/lazy"

const Status = z.object({
  enabled: z.boolean(),
  connected: z.boolean(),
})

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
        },
      }),
      async (c) => {
        try {
          await KiloSessions.enableRemote()
        } catch (err) {
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 401)
        }
        return c.json(KiloSessions.remoteStatus())
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
        KiloSessions.disableRemote()
        return c.json(KiloSessions.remoteStatus())
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
        return c.json(KiloSessions.remoteStatus())
      },
    ),
)
