export * as KiloTheme from "./theme"

import { Config } from "@opencode/cli/config/index"
import { Effect, Layer } from "effect"

export const layer = Layer.effect(
  Config.Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    return Config.Service.of({
      path: config.path,
      get: () => config.get().pipe(Effect.map(defaults)),
      update: (update) => config.update(update).pipe(Effect.map(defaults)),
    })
  }),
).pipe(Layer.provide(Config.layer))

function defaults(config: Config.Info): Config.Info {
  if (config.theme?.name !== undefined) return config
  return { ...config, theme: { ...config.theme, name: "kilo" } }
}
