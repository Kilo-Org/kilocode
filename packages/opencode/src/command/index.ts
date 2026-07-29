import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { legacyReviewCommand, reviewCommand } from "@/kilocode/review/command" // kilocode_change
import { EventV2 } from "@opencode-ai/core/event"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import { RuntimeFlags } from "@/effect/runtime-flags" // kilocode_change
import { ClaudeCommands } from "@/kilocode/command/claude" // kilocode_change
import { FSUtil } from "@opencode-ai/core/fs-util" // kilocode_change
import { Global } from "@opencode-ai/core/global" // kilocode_change
import { Git } from "@/git" // kilocode_change

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: EventV2.define({
    type: "command.executed",
    schema: {
      name: Schema.String,
      sessionID: SessionID,
      arguments: Schema.String,
      messageID: MessageID,
    },
  }),
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  origin: Schema.optional(Schema.String), // kilocode_change
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
function fromSkill(item: Skill.Info): Info {
  const location = item.location.replaceAll("\\", "/")
  const claude = location.includes("/.claude/") || location.startsWith(".claude/")
  return {
    name: item.name,
    description: item.description,
    source: "skill",
    ...(claude ? { origin: "claude" } : {}),
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
    const flags = yield* RuntimeFlags.Service // kilocode_change
    const fsys = yield* FSUtil.Service // kilocode_change
    const global = yield* Global.Service // kilocode_change
    const git = yield* Git.Service // kilocode_change

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

      // kilocode_change start
      const warnings = yield* config.warnings()
      for (const [name, command] of Object.entries(
        yield* ClaudeCommands.load({
          directory: ctx.directory,
          worktree: ctx.worktree,
          disabled: flags.disableClaudeCodeCommands,
          warnings,
        }).pipe(
          Effect.provideService(FSUtil.Service, fsys),
          Effect.provideService(Global.Service, global),
          Effect.provideService(Git.Service, git),
        ),
      )) {
        if (commands[name]) continue
        commands[name] = {
          name,
          agent: command.agent,
          description: command.description,
          source: "command",
          origin: "claude",
          get template() {
            return command.template
          },
          subtask: command.subtask,
          hints: hints(command.template),
        }
      }
      // kilocode_change end

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

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer), // kilocode_change
  Layer.provide(FSUtil.defaultLayer), // kilocode_change
  Layer.provide(Global.layer), // kilocode_change
  Layer.provide(Git.defaultLayer), // kilocode_change
)

export const node = LayerNode.make(layer, [Config.node, MCP.node, Skill.node, RuntimeFlags.node, FSUtil.node, Global.node, Git.node]) // kilocode_change

export * as Command from "."
