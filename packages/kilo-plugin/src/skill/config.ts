export * as KiloSkillConfigPlugin from "./config"

import { define } from "@opencode/plugin/effect/plugin"
import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import { Effect } from "effect"
import KILO_CONFIG from "./kilo-config.txt"

const DESCRIPTION =
  "Use for any question about Kilo itself: kilo2.json and kilo2.jsonc paths, config directories, commands, agents, skills, permissions and policies, MCP servers, providers and Kilo Gateway sign-in, plugins, indexing, sandbox, session sync, importing v1 sessions, the CLI and TUI settings in cli.json, slash commands, themes and keybinds, the background service, the kilo2 api command, Agent Manager worktrees and setup, run and state files, troubleshooting and the Kilo documentation. Use it to locate loaded config or change settings."

// The upstream built-in skills document OpenCode itself. Kilo hides them and registers its own guide, which carries
// the parts of the OpenCode guide that hold for Kilo, so a question about Kilo does not reach another product's docs. The plugin runs after the
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
