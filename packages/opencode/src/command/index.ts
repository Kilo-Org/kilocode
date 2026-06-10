import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { localReviewCommand, localReviewUncommittedCommand } from "@/kilocode/review/command" // kilocode_change
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: BusEvent.define(
    "command.executed",
    Schema.Struct({
      name: Schema.String,
      sessionID: SessionID,
      arguments: Schema.String,
      messageID: MessageID,
    }),
  ),
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
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
  // kilocode_change start
  LOCAL_REVIEW: "local-review",
  LOCAL_REVIEW_UNCOMMITTED: "local-review-uncommitted",
  // kilocode_change end
} as const

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

// kilocode_change start - skills can share names with slash commands
function fromSkill(item: Skill.Info): Info {
  return {
    name: item.name,
    description: item.description,
    source: "skill",
    get template() {
      return item.content
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

export const layer = Layer.effect(
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
      commands[Default.REVIEW] = {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", ctx.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      }

      // kilocode_change start
      commands[Default.LOCAL_REVIEW] = localReviewCommand()
      commands[Default.LOCAL_REVIEW_UNCOMMITTED] = localReviewUncommittedCommand()
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
        commands[item.name] = fromSkill(item) // kilocode_change
      }

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      // kilocode_change start
      const exact = s.commands[name]
      if (exact) return exact
      // kilocode_change end

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

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export * as Command from "."
