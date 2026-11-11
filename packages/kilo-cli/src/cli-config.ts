export * as KiloCliConfig from "./cli-config"

import { Config } from "@opencode/cli/config/index"
import { Layer } from "effect"
import { KiloConfigDefaults } from "./config-defaults"
import { KiloTheme } from "./theme"

// Tab is also the autocomplete completer; its layer is active only while the suggestion list is open, so it
// takes priority there and the agent cycle receives Tab in the prompt otherwise.
const keybinds: NonNullable<Config.Info["keybinds"]> = {
  "agent.cycle": "tab",
  "agent.cycle.reverse": "shift+tab",
}

export const layer = KiloConfigDefaults.overlay(defaults).pipe(Layer.provide(KiloTheme.layer))

function defaults(config: Config.Info): Config.Info {
  return { ...config, keybinds: { ...keybinds, ...config.keybinds } }
}
