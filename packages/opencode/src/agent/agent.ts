import { Config } from "@/config/config"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { Truncate } from "@/tool/truncate"
import { Auth } from "../auth"
import { ProviderTransform } from "@/provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SCOUT from "./prompt/scout.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { Permission } from "@/permission"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@opencode-ai/core/global"
import { KilocodePaths } from "@/kilocode/paths" // kilocode_change
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { Effect, Context, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { type DeepMutable } from "@opencode-ai/core/schema"
import * as KiloAgent from "@/kilocode/agent" // kilocode_change
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Reference } from "@/reference/reference" // kilocode_change
import { ConfigReference } from "@/config/reference" // kilocode_change
import * as AgentRequirements from "@/kilocode/agent-requirements" // kilocode_change
import { MCP } from "@/mcp" // kilocode_change

export type RequirementBlockedError = InstanceType<typeof AgentRequirements.BlockedError> // kilocode_change

export const Info = Schema.Struct({
  name: Schema.String,
  displayName: Schema.optional(Schema.String), // kilocode_change - human-readable name for org modes
  source: Schema.optional(Schema.String), // kilocode_change - origin marker (organization | global | project)
  description: Schema.optional(Schema.String),
  deprecated: Schema.optional(Schema.Boolean), // kilocode_change
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: Permission.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelID,
      providerID: ProviderID,
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  requirements: Schema.optional(AgentRequirements.Requirements), // kilocode_change
  steps: Schema.optional(Schema.Finite),
}).annotate({ identifier: "Agent" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

const GeneratedAgent = Schema.Struct({
  identifier: Schema.String,
  whenToUse: Schema.String,
  systemPrompt: Schema.String,
})

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultInfo: () => Effect.Effect<Info>
  readonly defaultAgent: () => Effect.Effect<string>
  readonly requirementStatus: (agent: string) => Effect.Effect<AgentRequirements.Result> // kilocode_change
  readonly guardRequirements: (agent: Info) => Effect.Effect<void, RequirementBlockedError> // kilocode_change
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderID; modelID: ModelID }
  }) => Effect.Effect<
    {
      identifier: string
      whenToUse: string
      systemPrompt: string
    },
    Provider.DefaultModelError
  >
}

type State = Omit<Interface, "generate" | "requirementStatus" | "guardRequirements"> & { version: string } // kilocode_change

export class Service extends Context.Service<Service, Interface>()("@opencode/Agent") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const mcp = yield* MCP.Service // kilocode_change
    const provider = yield* Provider.Service
    const flags = yield* RuntimeFlags.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        // kilocode_change start - include global config dirs so agents can read them without prompting
        const whitelistedDirs = [
          Truncate.GLOB,
          path.join(Global.Path.tmp, "*"),
          ...skillDirs.map((dir) => path.join(dir, "*")),
          path.join(Global.Path.config, "*"),
          ...KilocodePaths.globalDirs().map((dir) => path.join(dir, "*")),
        ]
        // kilocode_change end
        const readonlyExternalDirectory = {
          "*": "ask",
          ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
        } satisfies Record<string, "allow" | "ask" | "deny">

        const baseDefaults = Permission.fromConfig({
          // kilocode_change
          "*": "allow",
          doom_loop: "ask",
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          suggest: "deny", // kilocode_change
          question: "deny",
          interactive_terminal: "deny", // kilocode_change - human-driven tools are primary-agent only
          plan_enter: "deny",
          plan_exit: "deny",
          repo_clone: "deny",
          repo_overview: "deny",
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
        })

        // kilocode_change start - patch defaults with bash allowlist and recall permission
        const kilo = KiloAgent.prepare(cfg)
        const defaults = Permission.merge(baseDefaults, kilo.defaultsPatch)
        // kilocode_change end

        const user = Permission.fromConfig(cfg.permission ?? {})

        const agents: Record<string, Info> = {
          build: {
            name: "build",
            description: "The default agent. Executes tools based on configured permissions.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                interactive_terminal: "allow", // kilocode_change
                suggest: "allow", // kilocode_change
                plan_enter: "allow",
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          plan: {
            name: "plan",
            description: "Plan mode. Disallows all edit tools.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_exit: "allow",
                external_directory: {
                  [path.join(Global.Path.data, "plans", "*")]: "allow",
                },
                edit: {
                  "*": "deny",
                  [path.join(".opencode", "plans", "*.md")]: "allow",
                  [path.relative(ctx.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          general: {
            name: "general",
            description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                todowrite: "deny",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          explore: {
            name: "explore",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                grep: "allow",
                glob: "allow",
                list: "allow",
                bash: "allow",
                webfetch: "allow",
                websearch: "allow",
                read: "allow",
                external_directory: readonlyExternalDirectory,
              }),
              user,
            ),
            description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
            prompt: PROMPT_EXPLORE,
            options: {},
            mode: "subagent",
            native: true,
          },
          ...(flags.experimentalScout
            ? {
                scout: {
                  name: "scout",
                  permission: Permission.merge(
                    defaults,
                    Permission.fromConfig({
                      "*": "deny",
                      grep: "allow",
                      glob: "allow",
                      webfetch: "allow",
                      websearch: "allow",
                      read: "allow",
                      repo_clone: "allow",
                      repo_overview: "allow",
                      external_directory: {
                        ...readonlyExternalDirectory,
                        [path.join(Global.Path.repos, "*")]: "allow",
                      },
                    }),
                    user,
                  ),
                  description: `Docs and dependency-source specialist. Use this when you need to inspect external documentation, clone dependency repositories into the managed cache, and research library implementation details without modifying the user's workspace.`,
                  prompt: PROMPT_SCOUT,
                  options: {},
                  mode: "subagent" as const,
                  native: true,
                },
              }
            : {}),
          compaction: {
            name: "compaction",
            mode: "primary",
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                "*": "deny",
              }),
            ),
            options: {},
          },
          title: {
            name: "title",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                "*": "deny",
              }),
            ),
            prompt: PROMPT_TITLE,
          },
          summary: {
            name: "summary",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              user,
              Permission.fromConfig({
                "*": "deny",
              }),
            ),
            prompt: PROMPT_SUMMARY,
          },
        }

        // kilocode_change start - rename build→code, add debug/orchestrator/ask, patch plan/explore
        KiloAgent.patchAgents(agents, defaults, user, cfg, kilo, ctx.worktree, whitelistedDirs)

        const agentConfigs = KiloAgent.preprocessConfig(cfg.agent ?? {})
        for (const [key, value] of Object.entries(agentConfigs)) {
          // kilocode_change end
          if (value.disable) {
            delete agents[key]
            continue
          }
          let item = agents[key]
          if (!item)
            item = agents[key] = {
              name: key,
              mode: "all",
              permission: Permission.merge(defaults, user),
              options: {},
              native: false,
            }
          if (value.model) item.model = Provider.parseModel(value.model)
          item.variant = value.variant ?? item.variant
          item.prompt = value.prompt ?? item.prompt
          item.description = value.description ?? item.description
          item.temperature = value.temperature ?? item.temperature
          item.topP = value.top_p ?? item.topP
          item.mode = value.mode ?? item.mode
          item.color = value.color ?? item.color
          item.hidden = value.hidden ?? item.hidden
          item.name = value.name ?? item.name
          item.steps = value.steps ?? item.steps
          // kilocode_change start - carry metadata as typed fields, never as provider options
          item.displayName = value.displayName ?? item.displayName
          item.source = value.source ?? item.source
          item.requirements = value.requirements ?? item.requirements
          // kilocode_change end
          item.options = mergeDeep(item.options, value.options ?? {})
          item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission ?? {}))
          KiloAgent.processConfigItem(item) // kilocode_change - populate displayName from options
        }

        function referencePrompt(reference: Reference.Resolved) {
          if (reference.kind === "local") {
            return [
              `You are configured reference @${reference.name}, a read-only research agent for external reference material.`,
              `Local directory: ${reference.path}`,
              `Inspect this directory as the primary reference source. Prefer repo_overview with path ${JSON.stringify(reference.path)} before broader searches. Do not edit files.`,
              `Return exact absolute file paths for findings whenever possible.`,
            ].join("\n\n")
          }

          if (reference.kind === "invalid") {
            return [
              `You are configured reference @${reference.name}, but this reference is not usable yet.`,
              `Configured repository: ${reference.repository}`,
              `Problem: ${reference.message}`,
              `Explain this configuration problem if invoked. Do not edit files or attempt fallback clones.`,
            ].join("\n\n")
          }

          return [
            `You are configured reference @${reference.name}, a read-only research agent for external reference material.`,
            `Repository: ${reference.repository}`,
            ...(reference.branch ? [`Branch/ref: ${reference.branch}`] : []),
            `Cached directory: ${reference.path}`,
            `Kilo materializes this configured repository before use. Do not call repo_clone for this reference.`, // kilocode_change
            `Inspect the cached directory as the primary reference source. Prefer repo_overview with path ${JSON.stringify(reference.path)} before broader searches, then use Glob, Grep, and Read inside that directory. Do not edit files.`,
            `Return exact absolute file paths for findings whenever possible.`,
          ].join("\n\n")
        }

        function referenceDescription(reference: Reference.Resolved) {
          if (reference.kind === "local") return `Scout reference for local directory ${reference.path}`
          if (reference.kind === "git") return `Scout reference for repository ${reference.repository}`
          return `Invalid Scout reference for repository ${reference.repository}`
        }

        if (flags.experimentalScout) {
          const resolvedReferences = Reference.resolveAll({
            references: ConfigReference.normalize(cfg.reference ?? {}), // kilocode_change
            directory: ctx.directory,
            worktree: ctx.worktree,
          })
          for (const resolved of resolvedReferences) {
            if (agents[resolved.name]) continue
            const localPath = resolved.kind === "invalid" ? undefined : resolved.path
            agents[resolved.name] = {
              name: resolved.name,
              description: referenceDescription(resolved),
              permission: Permission.merge(
                agents.scout.permission,
                Permission.fromConfig({
                  repo_clone: "deny",
                  ...(localPath
                    ? {
                        external_directory: {
                          [localPath]: "allow",
                          [path.join(localPath, "*")]: "allow",
                        },
                      }
                    : {}),
                }),
              ),
              prompt: referencePrompt(resolved),
              options: { reference: cfg.reference?.[resolved.name], resolved },
              mode: "subagent",
              native: false,
            }
          }
        }

        // Ensure Truncate.GLOB is allowed unless explicitly configured
        for (const name in agents) {
          const agent = agents[name]
          const explicit = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === Truncate.GLOB
          })
          if (explicit) continue

          agents[name].permission = Permission.merge(
            agents[name].permission,
            Permission.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
          )
        }

        KiloAgent.hardenSystemAgents(agents) // kilocode_change - keep system utility agents deny-only after config merges

        const get = Effect.fnUntraced(function* (agent: string) {
          return agents[KiloAgent.resolveKey(agent)] // kilocode_change - treat "build" as "code"
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          return pipe(
            agents,
            values(),
            sortBy(
              [(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "code"), "desc"], // kilocode_change - renamed from "build" to "code"
              [(x) => x.name, "asc"],
            ),
          )
        })

        const defaultInfo = Effect.fnUntraced(function* () {
          const c = yield* config.get()
          if (c.default_agent) {
            // kilocode_change start
            const effective = KiloAgent.resolveKey(c.default_agent)
            const agent = agents[effective]
            // kilocode_change end
            if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${c.default_agent}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${c.default_agent}" is hidden`)
            return agent
          }
          // kilocode_change start - prefer "code" as default agent (key order changes after rename from "build")
          const code = agents.code
          if (code && code.mode !== "subagent" && code.hidden !== true) return code
          // kilocode_change end
          const visible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
          if (!visible) throw new Error("no primary visible agent found")
          return visible
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          return (yield* defaultInfo()).name
        })

        return {
          version: KiloAgent.cacheKey(cfg), // kilocode_change
          get,
          list,
          defaultInfo,
          defaultAgent,
        } satisfies State
      }),
    )

    // kilocode_change start - rebuild cached agents when permission-relevant config changes
    const current = Effect.fnUntraced(function* <A>(select: (s: State) => Effect.Effect<A>) {
      const cfg = yield* config.get()
      const s = yield* InstanceState.get(state)
      if (s.version === KiloAgent.cacheKey(cfg)) return yield* select(s)
      yield* InstanceState.invalidate(state)
      return yield* select(yield* InstanceState.get(state))
    })
    // kilocode_change end

    // kilocode_change start - agent requirement status and guard hooks
    const requirementStatus = Effect.fn("Agent.requirementStatus")(function* (name: string) {
      const ctx = yield* InstanceState.context
      return yield* AgentRequirements.status({
        name,
        directory: ctx.directory,
        config,
        skills: skill,
        mcp,
        agents: { get: (agent) => current((s) => s.get(agent)) },
      })
    })

    const guardRequirements = Effect.fn("Agent.guardRequirements")(function* (agent: Info) {
      const ctx = yield* InstanceState.context
      yield* AgentRequirements.guard({
        agent,
        directory: ctx.directory,
        config,
        skills: skill,
        mcp,
        agents: { get: (name) => current((s) => s.get(name)) },
      })
    })
    // kilocode_change end

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        return yield* current((s) => s.get(agent)) // kilocode_change
      }),
      list: Effect.fn("Agent.list")(function* () {
        return yield* current((s) => s.list()) // kilocode_change
      }),
      defaultInfo: Effect.fn("Agent.defaultInfo")(function* () {
        return yield* current((s) => s.defaultInfo()) // kilocode_change
      }),
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return yield* current((s) => s.defaultAgent()) // kilocode_change
      }),
      requirementStatus, // kilocode_change
      guardRequirements, // kilocode_change
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderID; modelID: ModelID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          // kilocode_change start - enable telemetry with custom PostHog tracer
          experimental_telemetry: KiloAgent.telemetryOptions(cfg),
          // kilocode_change end
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: Object.assign(
            Schema.toStandardSchemaV1(GeneratedAgent),
            Schema.toStandardJSONSchemaV1(GeneratedAgent),
          ),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(MCP.defaultLayer), // kilocode_change
  Layer.provide(RuntimeFlags.defaultLayer),
)

export * as Agent from "./agent"
