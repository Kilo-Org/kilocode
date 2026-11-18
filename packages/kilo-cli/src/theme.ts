export * as KiloTheme from "./theme"

import { Config } from "@opencode/cli/config/index"
import { Layer } from "effect"
import { KiloConfigDefaults } from "./config-defaults"

export const layer = KiloConfigDefaults.overlay(defaults).pipe(Layer.provide(Config.layer))

function defaults(config: Config.Info): Config.Info {
  if (config.theme?.name !== undefined) return config
  return { ...config, theme: { ...config.theme, name: "kilo" } }
}
