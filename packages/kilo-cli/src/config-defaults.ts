export * as KiloConfigDefaults from "./config-defaults"

import { Config } from "@opencode/cli/config/index"
import { Effect, Layer } from "effect"

// The single Config.Service wrapper the Kilo host uses for its CLI defaults. Callers chain overlays and provide
// the layer underneath, so each default stays in its own Kilo-owned module.
export const overlay = (defaults: (config: Config.Info) => Config.Info) =>
  Layer.effect(
    Config.Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return Config.Service.of({
        path: config.path,
        get: () => config.get().pipe(Effect.map(defaults)),
        update: (update) => config.update(update).pipe(Effect.map(defaults)),
      })
    }),
  )
