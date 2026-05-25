import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { AppRuntime } from "@/effect/app-runtime"
import { errors } from "../../server/error"
import { lazy } from "../../util/lazy"
import { AllowEverythingPermission } from "./allow-everything"

const allowEverything = (input: AllowEverythingPermission.Input) =>
  AppRuntime.runPromise(AllowEverythingPermission.effect(input))

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
      await allowEverything(body)
      return c.json(true)
    },
  ),
)
