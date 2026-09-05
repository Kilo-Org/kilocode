import { define, type Context } from "@opencode-ai/plugin/effect/plugin"
import { Skill } from "@opencode-ai/schema/skill"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Effect } from "effect"
import { realpathSync } from "node:fs"
import path from "node:path"
import kiloConfigContent from "./skill-policy-kilo-config.md" with { type: "text" }
import type { SkillShell } from "./skill-shell"

export const KILO_CONFIG_ID = Skill.ID.make("kilo-config")
export const BUILTIN_LOCATION = AbsolutePath.make(path.join(import.meta.dir, "skill-policy-kilo-config.md"))
export const KILO_CONFIG_CONTENT = kiloConfigContent

export const KILO_CONFIG_DESCRIPTION =
  "Use this skill for Kilo v2 project configuration, custom agents, and skills, including explicit project-config opt-in and safe project-boundary loading."
export const KILO_CONFIG_COLLISION_MESSAGE =
  'The project skill ID "kilo-config" is reserved by Kilo; the project definition was ignored.'

export function createSkillPolicy(options: { readonly skillShell?: SkillShell } = {}) {
  return define({
    id: "kilocode.skill-policy",
    effect: Effect.fn("KiloSkillPolicy.effect")(function* (ctx: Context) {
      yield* ctx.skill.transform((editor) => {
        const current = editor.get(KILO_CONFIG_ID)
        // The host registers this transform after config discovery, so a project definition cannot
        // replace the reserved builtin. The public editor has no provenance field; report any collision.
        if (current?.location !== BUILTIN_LOCATION) {
          if (current) console.error(KILO_CONFIG_COLLISION_MESSAGE)
          editor.add(
            Skill.Info.make({
              id: KILO_CONFIG_ID,
              name: Skill.Name.make("Kilo Configuration"),
              description: KILO_CONFIG_DESCRIPTION,
              location: BUILTIN_LOCATION,
              content: KILO_CONFIG_CONTENT,
            }),
          )
          return
        }
        editor.update(KILO_CONFIG_ID, (current) => {
          current.name = Skill.Name.make("Kilo Configuration")
          current.description = KILO_CONFIG_DESCRIPTION
          current.location = BUILTIN_LOCATION
          current.content = KILO_CONFIG_CONTENT
        })
      })
      yield* ctx.skill.transform((editor) => {
        const project = realpath(ctx.location.project.directory) ?? path.resolve(ctx.location.project.directory)
        for (const skill of editor.list()) {
          const lexical = lexicalPath(skill.location)
          if (!contains(project, lexical)) continue
          const canonical = realpath(skill.location)
          if (!canonical || contains(project, canonical)) continue
          editor.remove(skill.id)
        }
      })
      const skillShell = options.skillShell
      if (!skillShell) return
      yield* ctx.tool.transform((editor) => {
        editor.update("skill", (tool) => {
          const execute = tool.execute
          tool.execute = (input, context) =>
            Effect.gen(function* () {
              const result = yield* execute(input, context)
              const skillID = skillIDFromInput(input)
              if (!skillID) return result
              const output = yield* skillShell(skillID, context)
              if (output === undefined) return result
              const prepared = preparedFromOutput(result.output)
              if (!prepared) return result
              return {
                ...result,
                output: { ...prepared, output },
                content: output,
              }
            })
        })
      })
    }),
  })
}

export const SkillPolicy = createSkillPolicy

function realpath(file: string) {
  try {
    return realpathSync.native(file)
  } catch {
    return undefined
  }
}

function lexicalPath(file: string) {
  const parent = realpath(path.dirname(file))
  return path.join(parent ?? path.resolve(path.dirname(file)), path.basename(file))
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function skillIDFromInput(input: unknown) {
  if (!input || typeof input !== "object") return undefined
  const value = Reflect.get(input, "id")
  return typeof value === "string" ? value : undefined
}

function preparedFromOutput(output: unknown): { name: string; directory: string; output: string } | undefined {
  if (!output || typeof output !== "object") return undefined
  const name = Reflect.get(output, "name")
  const directory = Reflect.get(output, "directory")
  const text = Reflect.get(output, "output")
  if (typeof name !== "string" || typeof directory !== "string" || typeof text !== "string") return undefined
  return { name, directory, output: text }
}
