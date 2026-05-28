// kilocode_change - new file
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { lazy } from "@/util/lazy"
import { errors } from "../../error"

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
      "/setEnabled",
      describeRoute({
        summary: "Set PostHog telemetry enabled state",
        description:
          "Update the PostHog client's opt-in/out state at runtime. " +
          "The CLI reads KILO_TELEMETRY_LEVEL once at spawn — this route lets clients " +
          "(e.g. the VS Code extension) propagate runtime telemetry consent changes.",
        operationId: "telemetry.setEnabled",
        responses: {
          200: {
            description: "State updated",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => {
        const body = c.req.valid("json")
        Telemetry.setEnabled(body.enabled)
        return c.json(true)
      },
    ),
)
