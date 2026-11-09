export * as KiloSkillConfigPlugin from "./config"

import { define } from "@opencode/plugin/effect/plugin"
import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import { Effect } from "effect"
import KILO_CONFIG from "./kilo-config.txt"

const DESCRIPTION =
  "Guide for Kilo configuration: kilo2.json and kilo2.jsonc paths, config directories, commands, agents, skills, permissions, MCPs, and Agent Manager setup, run and state files. Use for Kilo config questions, locating loaded config, or changing settings."

// The upstream built-in skills document OpenCode itself. Kilo hides them and registers its own config guide, so a
// question about Kilo configuration does not reach another product's documentation. The plugin runs after the
// built-in plugins and before the config plugins, so a user skill with the same ID still overrides this one.
export const Plugin = define({
  id: "kilocode.skill-config",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((editor) => {
      editor.remove("opencode")
      editor.remove("report")
      editor.add(
        Skill.Info.make({
          id: Skill.ID.make("kilo-config"),
          name: Skill.Name.make("kilo-config"),
          description: DESCRIPTION,
          path: AbsolutePath.make("/builtin/kilo-config.md"),
          content: KILO_CONFIG,
        }),
      )
    })
  }),
})
