import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { legacyReviewCommand, reviewCommand } from "@/kilocode/review/command" // kilocode_change
import PROMPT_INITIALIZE from "./template/initialize.txt"
import { LegacyEvent } from "@opencode-ai/schema/legacy-event"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: LegacyEvent.CommandExecuted,
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  trusted: Schema.optional(Schema.Boolean), // kilocode_change - skill-sourced templates only run `!`cmd`` shell when trusted
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "Command" })

export type Info = Omit<Schema.Schema.Type<typeof Info>, "template"> & { template: Promise<string> | string }

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  INIT: "init",
  REVIEW: "review",
} as const

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

// kilocode_change start - skills can share names with slash commands
function fromSkill(item: Skill.Info, dir?: string): Info {
  return {
    name: item.name,
    description: item.description,
    source: "skill",
    trusted: item.trusted === true,
    get template() {
      if (!dir) return item.content
      return [
        item.content,
        "",
        `Base directory for this skill: ${dir}`,
        "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
      ].join("\n")
    },
    hints: [],
  }
}

function skillName(name: string) {
  return name.endsWith(":skill") ? name.slice(0, -6) : undefined
}

function mcpName(name: string) {
  return name.endsWith(":mcp") ? name.slice(0, -4) : undefined
}
// kilocode_change end

export class Service extends Context.Service<Service, Interface>()("@opencode/Command") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      }
      // kilocode_change start
      commands[Default.REVIEW] = reviewCommand()
      commands["local-review"] = legacyReviewCommand("local-review")!
      commands["local-review-uncommitted"] = legacyReviewCommand("local-review-uncommitted")!
      // kilocode_change end

      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        commands[name] = {
          name,
          agent: command.agent,
          model: command.model,
          description: command.description,
          source: "command",
          get template() {
            return command.template
          },
          subtask: command.subtask,
          hints: hints(command.template),
        }
      }

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                .pipe(
                  Effect.map(
                    (template) =>
                      template?.messages
                        .map((message) => (message.content.type === "text" ? message.content.text : ""))
                        .join("\n") || "",
                  ),
                ),
            )
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }

      for (const item of yield* skill.all()) {
        if (commands[item.name]) continue
        const dir = item.location === "<built-in>" ? undefined : path.dirname(item.location)
        commands[item.name] = fromSkill(item, dir) // kilocode_change
      }

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      const exact = s.commands[name] // kilocode_change
      if (exact) return exact // kilocode_change
      const alias = legacyReviewCommand(name) // kilocode_change
      if (alias) return alias // kilocode_change

      // kilocode_change start
      const target = skillName(name)
      if (target) {
        const item = yield* skill.get(target)
        if (item) return fromSkill(item)
        return undefined
      }
      // kilocode_change end
      // kilocode_change start
      const prompt = mcpName(name)
      if (prompt) {
        const cmd = s.commands[prompt]
        return cmd?.source === "mcp" ? cmd : undefined
      }
      // kilocode_change end
      return undefined // kilocode_change
    })

    // kilocode_change start
    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      const result = Object.values(s.commands)
      const names = new Set(result.map((item) => item.name))
      for (const item of yield* skill.all()) {
        if (s.commands[item.name]?.source === "skill") continue
        if (names.has(item.name)) result.push(fromSkill(item))
      }
      return result
    })
    // kilocode_change end

    return Service.of({ get, list })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Config.node, MCP.node, Skill.node] })

export * as Command from "."
