// kilocode_change - new file
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const TelemetryRoutes = lazy(() =>
  new Hono()
    .post(
      "/capture",
      describeRoute({
        summary: "Capture telemetry event",
        description: "Forward a telemetry event to PostHog via kilo-telemetry.",
        operationId: "telemetry.capture",
        responses: {
          200: {
            description: "Event captured",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          event: z.string().meta({ description: "Event name" }),
          properties: z.record(z.string(), z.any()).optional().meta({ description: "Event properties" }),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        try {
          Telemetry.track(body.event as any, body.properties)
        } catch {
          // fire-and-forget: swallow errors
        }
        return c.json(true)
      },
    )
    .post(
      "/set-enabled",
      describeRoute({
        summary: "Set telemetry enabled state",
        description:
          "Dynamically enable or disable telemetry at runtime. Used by the VS Code extension to sync the user's telemetry preference after the CLI process has started.",
        operationId: "telemetry.setEnabled",
        responses: {
          200: {
            description: "Telemetry state updated",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          enabled: z.boolean().meta({ description: "Whether telemetry should be enabled" }),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        Telemetry.setEnabled(body.enabled)
        return c.json(true)
      },
    ),
)
