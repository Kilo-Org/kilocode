export * as KiloSkillConfigPlugin from "./config"

import { define } from "@opencode/plugin/effect/plugin"
import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { Effect } from "effect"
import KILO_CONFIG from "./kilo-config.txt"

const RELEASE_NAMES = `# Config names in this process

KILO_USE_RELEASE_CONFIG=1 is set, which overrides the names in the guide below: the config files are \`kilo.json\` and \`kilo.jsonc\` instead of \`kilo2.json\` and \`kilo2.jsonc\`, in the global directory too, and the project directory is \`.kilo\` instead of \`.kilo2\` (plans are in \`.kilo/plans\`). \`.kilo2\` is not read, except for the Agent Manager state in \`.kilo2/agent-manager.json\`. The global, data and state directories keep the \`kilo2\` name, and the \`kilo2\` command is unchanged. Where the guide says to use only the \`kilo2\` names or never to search \`.kilo/\`, apply it to \`.kilo2\` instead.

`

const DESCRIPTION =
  "Use for any question about Kilo itself: kilo2.json and kilo2.jsonc paths, config directories, commands, agents, skills, permissions and policies, MCP servers, providers and Kilo Gateway sign-in, plugins, indexing, sandbox, session sync, importing v1 sessions, the CLI and TUI settings in cli.json, slash commands, themes and keybinds, /periodic, scheduled Flows, wakeups and cron, the background service and service install, the kilo2 api command, Agent Manager worktrees and setup, run and state files, troubleshooting and the Kilo documentation. Use it to locate loaded config or change settings."

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
          content: KiloConfigFiles.releaseNames ? RELEASE_NAMES + KILO_CONFIG : KILO_CONFIG,
        }),
      )
    })
  }),
})
