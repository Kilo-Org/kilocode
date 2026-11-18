import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { Config } from "@/config/config"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import {
  TelemetryCapturePayload,
  TelemetryLevelPayload,
  TelemetrySetEnabledPayload,
} from "../groups/telemetry"

export const telemetryHandlers = HttpApiBuilder.group(InstanceHttpApi, "telemetry", (handlers) =>
  Effect.gen(function* () {
    const capture = Effect.fn("TelemetryHttpApi.capture")(function* (ctx: {
      payload: typeof TelemetryCapturePayload.Type
    }) {
      // fire-and-forget: log instead of swallowing
      yield* Effect.sync(() =>
        Telemetry.track(ctx.payload.event as any, ctx.payload.properties as Record<string, unknown> | undefined),
      ).pipe(Effect.catchCause((cause) => Effect.logWarning("telemetry.capture failed", cause)))
      return true
    })

    const setEnabled = Effect.fn("TelemetryHttpApi.setEnabled")(function* (ctx: {
      payload: typeof TelemetrySetEnabledPayload.Type
    }) {
      yield* Effect.sync(() => Telemetry.setEnabled(ctx.payload.enabled))
      return true
    })

    const config = yield* Config.Service

    const level = Effect.fn("TelemetryHttpApi.level")(function* () {
      const cfg = yield* config.getGlobal()
      return { enabled: cfg.experimental?.openTelemetry !== false }
    })

    const setLevel = Effect.fn("TelemetryHttpApi.setLevel")(function* (ctx: {
      payload: typeof TelemetryLevelPayload.Type
    }) {
      yield* config.updateGlobal({ experimental: { openTelemetry: ctx.payload.enabled } }, { dispose: false })
      yield* Effect.sync(() => Telemetry.setEnabled(ctx.payload.enabled))
      return { enabled: ctx.payload.enabled }
    })

    return handlers.handle("capture", capture).handle("setEnabled", setEnabled).handle("level", level).handle("setLevel", setLevel)
  }),
)
