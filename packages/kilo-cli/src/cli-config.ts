export * as KiloCliConfig from "./cli-config"

import { Config } from "@opencode/cli/config/index"
import { Effect, Layer } from "effect"
import { KiloTheme } from "./theme"

// Tab is also the autocomplete completer; its layer is active only while the suggestion list is open, so it
// takes priority there and the agent cycle receives Tab in the prompt otherwise.
const keybinds: NonNullable<Config.Info["keybinds"]> = {
  "agent.cycle": "tab",
  "agent.cycle.reverse": "shift+tab",
}

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
).pipe(Layer.provide(KiloTheme.layer))

function defaults(config: Config.Info): Config.Info {
  return { ...config, keybinds: { ...keybinds, ...config.keybinds } }
}
