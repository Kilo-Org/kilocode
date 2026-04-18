// devilcode_change - new file
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Telemetry } from "@devilcode/kilo-telemetry"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { Log } from "../../util/log"

const log = Log.create({ service: "telemetry" })

export const TelemetryRoutes = lazy(() =>
  new Hono().post(
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
              schema: resolver(z.object({ ok: z.boolean() })),
            },
          },
        },
        502: {
          description: "Telemetry backend unavailable",
          content: {
            "application/json": {
              schema: resolver(z.object({ ok: z.literal(false), error: z.string() })),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        event: z.string().max(100).meta({ description: "Event name" }),
        properties: z.record(z.string(), z.any()).optional().meta({ description: "Event properties" }), // devilcode_change - removed .max(50); ZodRecord lacks .max() in Zod 4
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      // devilcode_change start - audit N4: surface telemetry failures to caller instead of always reporting success.
      try {
        Telemetry.track(body.event as any, body.properties)
        return c.json({ ok: true })
      } catch (err) {
        log.error("telemetry failed", { error: err, event: body.event })
        return c.json({ ok: false as const, error: err instanceof Error ? err.message : "telemetry failed" }, 502)
      }
      // devilcode_change end
    },
  ),
)
