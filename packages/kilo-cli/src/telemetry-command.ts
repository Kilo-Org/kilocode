import { Flock } from "@opencode-ai/util/flock"
import { Effect } from "effect"
import path from "node:path"
import { type Layout, preflight } from "./paths"
import { EXPORTABLE_EVENT_TYPES, resolveConfig } from "./telemetry"
import { TelemetrySettings } from "./telemetry-settings"

export function configureTelemetry(
  input: Layout,
  command: { action: "status" | "enable" | "disable"; endpoint?: string },
) {
  return Effect.gen(function* () {
    preflight(input)
    if (command.action !== "status") {
      const config = resolveConfig({ enabled: command.action === "enable", endpoint: command.endpoint }, {})
      if (command.action === "enable" && !config.enabled)
        throw new Error("Telemetry enable requires a valid HTTP(S) collector endpoint")
      // A running exporter cannot observe a file update. Refuse edits until its host
      // releases the lease, rather than claiming that a live exporter was disabled.
      yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: (signal) =>
            Flock.acquire("kilo2-interactive", {
              dir: path.join(input.paths.state, "locks"),
              timeoutMs: 1000,
              signal,
            }),
          catch: () => new Error("Stop the Kilo TUI or daemon before changing telemetry consent"),
        }),
        (lease) => Effect.promise(() => lease.release()),
      )
      yield* Effect.promise(() =>
        TelemetrySettings.write(input.telemetryConfig, {
          version: 1,
          enabled: config.enabled,
          ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        }),
      )
    }
    const config = yield* Effect.promise(() => TelemetrySettings.resolve(input.telemetryConfig))
    return {
      enabled: config.enabled,
      appliesTo: "next-host-start" as const,
      file: input.telemetryConfig,
      eventTypes: EXPORTABLE_EVENT_TYPES,
    }
  })
}
