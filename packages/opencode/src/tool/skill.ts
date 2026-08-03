import path from "path"
import { pathToFileURL } from "url"
import { Effect, Schema } from "effect"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"
// kilocode_change start - gate + run shell injection in skill bodies
import { Config } from "@/config/config"
import { Shell } from "@opencode-ai/core/shell"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ShellPermission } from "./shell"
import { SkillInject } from "@/kilocode/skills/inject"
// kilocode_change end

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const ripgrep = yield* Ripgrep.Service
    const flags = yield* RuntimeFlags.Service // kilocode_change
    const permission = yield* ShellPermission // kilocode_change - decompose skill commands like the bash tool
    const config = yield* Config.Service // kilocode_change - resolve a parseable shell for injection

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* skill
            .require(params.name)
            .pipe(Effect.catchTag("Skill.NotFoundError", (error) => Effect.die(new Error(error.message))))

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          // kilocode_change start - render `!`cmd`` shell injection, gated by trust + kill-switch + batch approval
          const cfg = yield* config.get()
          const content = yield* SkillInject.render({
            content: info.content,
            trusted: info.trusted === true,
            disabled: flags.disableSkillShell,
            cwd: yield* InstanceState.directory,
            skill: info.name,
            shell: Shell.acceptable(cfg.shell),
            ctx,
            decompose: permission.decompose,
          })
          // kilocode_change end

          // kilocode_change start - built-in skills have no filesystem directory
          if (info.location === Skill.BUILTIN_LOCATION) {
            return {
              title: `Loaded skill: ${info.name}`,
              output: [
                `<skill_content name="${info.name}">`,
                `# Skill: ${info.name}`,
                "",
                content.trim(), // kilocode_change
                "</skill_content>",
              ].join("\n"),
              metadata: {
                name: info.name,
                dir: Skill.BUILTIN_LOCATION,
              },
            }
          }
          // kilocode_change end

          const dir = path.dirname(info.location)
          const base = pathToFileURL(dir).href
          const files = yield* ripgrep.find({
            cwd: dir,
            pattern: "!**/SKILL.md",
            hidden: true,
            follow: false,
            signal: ctx.abort,
            limit: 10,
          })

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              content.trim(), // kilocode_change
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files.map((file) => `<file>${path.resolve(dir, file.path)}</file>`).join("\n"),
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
