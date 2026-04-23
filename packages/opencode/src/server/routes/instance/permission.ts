import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { AppRuntime } from "@/effect/app-runtime"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"

export const PermissionRoutes = lazy(() =>
  new Hono()
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Respond to permission request",
        description: "Approve or deny a permission request from the AI assistant.",
        operationId: "permission.reply",
        responses: {
          200: {
            description: "Permission processed successfully",
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
        "param",
        z.object({
          requestID: PermissionID.zod,
        }),
      ),
      validator("json", z.object({ reply: Permission.Reply.zod, message: z.string().optional() })),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await AppRuntime.runPromise(
          Permission.Service.use((svc) =>
            svc.reply({
              requestID: params.requestID,
              reply: json.reply,
              message: json.message,
            }),
          ),
        )
        return c.json(true)
      },
    )
    // kilocode_change start
    .post(
      "/:requestID/always-rules",
      describeRoute({
        summary: "Save always-allow/deny permission rules",
        description: "Save approved/denied always-rules for a pending permission request.",
        operationId: "permission.saveAlwaysRules",
        responses: {
          200: {
            description: "Always rules saved successfully",
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
        "param",
        z.object({
          requestID: PermissionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          approvedAlways: z.string().array().optional(),
          deniedAlways: z.string().array().optional(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await AppRuntime.runPromise(
          Permission.Service.use((svc) =>
            svc.saveAlwaysRules({
              requestID: params.requestID,
              approvedAlways: json.approvedAlways,
              deniedAlways: json.deniedAlways,
            }),
          ),
        )
        return c.json(true)
      },
    )
    // kilocode_change end
    .get(
      "/",
      describeRoute({
        summary: "List pending permissions",
        description: "Get all pending permission requests across all sessions.",
        operationId: "permission.list",
        responses: {
          200: {
            description: "List of pending permissions",
            content: {
              "application/json": {
                schema: resolver(Permission.Request.zod.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const permissions = await AppRuntime.runPromise(Permission.Service.use((svc) => svc.list()))
        return c.json(permissions)
      },
    ),
)
