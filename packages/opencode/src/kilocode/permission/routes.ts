import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Bus } from "@/bus"
import * as Config from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Permission } from "@/permission"
import { Session } from "@/session"
import { SessionID } from "@/session/schema" // kilocode_change
import { Event } from "../../server/event"
import { errors } from "../../server/error"
import { lazy } from "../../util/lazy"

const allowEverything = (input: z.infer<typeof Permission.AllowEverythingInput>) =>
  AppRuntime.runPromise(Permission.Service.use((svc) => svc.allowEverything(input)))

export const PermissionKilocodeRoutes = lazy(() =>
  new Hono().post(
    "/allow-everything",
    describeRoute({
      summary: "Allow everything",
      description: "Enable or disable allowing all permissions without prompts.",
      operationId: "permission.allowEverything",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "json",
      z.object({
        enable: z.boolean(),
        requestID: z.string().optional(),
        sessionID: z.string().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      const rules: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

      if (!body.enable) {
        if (body.sessionID) {
          const session = await Session.get(SessionID.make(body.sessionID))
          await Session.setPermission({
            sessionID: SessionID.make(body.sessionID),
            permission: (session.permission ?? []).filter(
              (rule) => !(rule.permission === "*" && rule.pattern === "*" && rule.action === "allow"),
            ),
          })
          await allowEverything({ enable: false, sessionID: SessionID.make(body.sessionID) })
          return c.json(true)
        }

        await Config.updateGlobal({ permission: { "*": { "*": null } } }, { dispose: false })
        await allowEverything({ enable: false })
        await Bus.publish(Event.ConfigUpdated, {})
        return c.json(true)
      }

      if (body.sessionID) {
        const session = await Session.get(SessionID.make(body.sessionID))
        await Session.setPermission({
          sessionID: SessionID.make(body.sessionID),
          permission: [...(session.permission ?? []), ...rules],
        })
      } else {
        await Config.updateGlobal({ permission: Permission.toConfig(rules) }, { dispose: false })
        await Bus.publish(Event.ConfigUpdated, {})
      }

      await allowEverything({
        enable: true,
        requestID: body.requestID,
        sessionID: body.sessionID ? SessionID.make(body.sessionID) : undefined,
      })

      return c.json(true)
    },
  ),
)
