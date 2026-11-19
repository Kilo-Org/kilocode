import { Effect, Semaphore } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { Config } from "@/config/config"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { TelemetryCapturePayload, TelemetryLevelPayload, TelemetrySetEnabledPayload } from "../groups/telemetry"

export const telemetryHandlers = HttpApiBuilder.group(InstanceHttpApi, "telemetry", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    // Keep host updates from applying an old preference while a write is in flight.
    const lock = Semaphore.makeUnsafe(1)

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
      const cfg = yield* config.getGlobal()
      yield* Effect.sync(() => Telemetry.setHostEnabled(ctx.payload.enabled, cfg.experimental?.openTelemetry !== false))
      return true
    }, lock.withPermit)

    const level = Effect.fn("TelemetryHttpApi.level")(function* () {
      const cfg = yield* config.getGlobal()
      return { enabled: Telemetry.level(cfg.experimental?.openTelemetry !== false) }
    }, lock.withPermit)

    const setLevel = Effect.fn("TelemetryHttpApi.setLevel")(function* (ctx: {
      payload: typeof TelemetryLevelPayload.Type
    }) {
      yield* config.updateGlobal({ experimental: { openTelemetry: ctx.payload.enabled } }, { dispose: false })
      const enabled = yield* Effect.sync(() => Telemetry.setEnabled(ctx.payload.enabled))
      return { enabled }
    }, lock.withPermit)

    return handlers
      .handle("capture", capture)
      .handle("setEnabled", setEnabled)
      .handle("level", level)
      .handle("setLevel", setLevel)
  }),
)
