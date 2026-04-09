import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Config } from "@/config/config"
import { PermissionNext } from "@/permission/next"
import { Session } from "@/session"
import { errors } from "../../server/error"
import { lazy } from "../../util/lazy"

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
      const rules: PermissionNext.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

      if (!body.enable) {
        if (body.sessionID) {
          const session = await Session.get(body.sessionID)
          await Session.setPermission({
            sessionID: body.sessionID,
            permission: (session.permission ?? []).filter(
              (rule) => !(rule.permission === "*" && rule.pattern === "*" && rule.action === "allow"),
            ),
          })
          await PermissionNext.allowEverything({ enable: false, sessionID: body.sessionID })
          return c.json(true)
        }

        await Config.updateGlobal({ permission: { "*": { "*": null } } }, { dispose: false })
        await PermissionNext.allowEverything({ enable: false })
        return c.json(true)
      }

      if (body.sessionID) {
        const session = await Session.get(body.sessionID)
        await Session.setPermission({
          sessionID: body.sessionID,
          permission: [...(session.permission ?? []), ...rules],
        })
      } else {
        await Config.updateGlobal({ permission: PermissionNext.toConfig(rules) }, { dispose: false })
      }

      await PermissionNext.allowEverything({
        enable: true,
        requestID: body.requestID,
        sessionID: body.sessionID,
      })

      return c.json(true)
    },
  ),
)
