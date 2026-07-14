// kilocode_change - new file
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { AgentManagerEvent, type AgentManagerTask } from "@/kilocode/agent-manager/event"
import { AgentManager, HostError } from "@/kilocode/agent-manager/service"
import type { Result } from "@/kilocode/agent-manager/protocol"
import * as SandboxInheritance from "@/kilocode/sandbox/inheritance"
import { KiloSessionMessageOrder } from "@/kilocode/session/message-order"
import { Provider } from "@/provider/provider"
import { SessionID } from "@/session/schema"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import { matchesQuery } from "./model-search"
import DESCRIPTION from "./agent-manager.txt"

const Task = Schema.Struct({
  prompt: Schema.optional(Schema.String).annotate({ description: "Initial prompt to send to the new session" }),
  name: Schema.optional(Schema.String).annotate({ description: "Short display name for the Agent Manager card" }),
  branchName: Schema.optional(Schema.String).annotate({ description: "Git branch name seed for worktree mode" }),
  model: Schema.optional(Schema.String).annotate({
    description:
      "Optional model override from agent_manager_models (e.g. 'Claude Opus 4.1'). Omit unless the user requests a different model. Agent Manager otherwise inherits the current turn's model. A qualified provider/model ID is also accepted to force a specific provider.",
  }),
  variant: Schema.optional(Schema.String).annotate({
    description:
      "Optional reasoning variant override from agent_manager_models. Specify it without model to override the inherited model's variant. Omit both to inherit the current turn's selection.",
  }),
}).check(
  Schema.makeFilter((task) =>
    task.prompt?.trim() || task.name?.trim() || task.branchName?.trim()
      ? undefined
      : "Each task must include prompt, name, or branchName",
  ),
  Schema.makeFilter((task) =>
    task.model?.trim() && !task.prompt?.trim() ? "A task model requires an initial prompt" : undefined,
  ),
  Schema.makeFilter((task) =>
    task.variant?.trim() && !task.prompt?.trim() ? "A task variant requires an initial prompt" : undefined,
  ),
)

const StartParams = Schema.Struct({
  mode: Schema.Literals(["worktree", "local"]).annotate({
    description: "Use worktree for isolated git worktrees, or local for same-directory Agent Manager sessions",
  }),
  versions: Schema.optional(Schema.Boolean).annotate({
    description:
      "Set true only when tasks are alternative versions of the same work to compare. Omit or false for independent sessions.",
  }),
  tasks: Schema.Array(Task)
    .check(Schema.isMinLength(1), Schema.isMaxLength(20))
    .annotate({ description: "Agent Manager sessions to start" }),
})

const ListParams = Schema.Struct({
  action: Schema.Literal("list"),
  filter: Schema.optional(
    Schema.Struct({
      sectionIDs: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(100))),
      states: Schema.optional(
        Schema.Array(Schema.Literals(["idle", "busy", "retry", "offline", "waiting"])).check(
          Schema.isMaxLength(5),
        ),
      ),
    }),
  ),
})

const PromptParams = Schema.Struct({
  action: Schema.Literal("prompt"),
  sessionID: SessionID,
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)).check(
    Schema.makeFilter((value) => (value.trim() ? undefined : "Prompt must not be empty")),
  ),
})

export const Params = Schema.Union([StartParams, ListParams, PromptParams])

type Input = Schema.Schema.Type<typeof Task>
type Selected = { task?: AgentManagerTask; error?: string }
type Candidate = { providerID: string; model: Provider.Info["models"][string] }
type Source = { model: NonNullable<AgentManagerTask["model"]>; variant?: string }

function abort(signal: AbortSignal) {
  return Effect.callback<never, HostError>((resume) => {
    const err = () => new HostError({ code: "cancelled", detail: "The Agent Manager tool call was cancelled" })
    if (signal.aborted) return resume(Effect.fail(err()))
    const handler = () => resume(Effect.fail(err()))
    signal.addEventListener("abort", handler, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", handler))
  })
}

function run(effect: Effect.Effect<Result, HostError>, signal: AbortSignal) {
  return effect.pipe(Effect.raceFirst(abort(signal)), Effect.orDie)
}

function candidates(providers: Record<string, Provider.Info>): Candidate[] {
  return Object.values(providers).flatMap((provider) =>
    Object.values(provider.models).map((model) => ({ providerID: provider.id, model })),
  )
}

// Resolve a model query to the candidates for a single logical model (possibly
// offered by several providers). Exact id/name win first so a precise request is
// never drowned out; otherwise fall back to lenient fuzzy matching so the agent
// does not need the exact model name.
function lookup(all: Candidate[], value: string): { pool: Candidate[]; names: string[] } {
  const query = value.toLowerCase()
  const exactId = all.filter((item) => `${item.providerID}/${item.model.id}`.toLowerCase() === query)
  const exactName = exactId.length ? exactId : all.filter((item) => item.model.name.toLowerCase() === query)
  const pool = exactName.length
    ? exactName
    : all.filter((item) => matchesQuery([item.model.name, `${item.providerID}/${item.model.id}`], value))
  const names = [...new Set(pool.map((item) => item.model.name))]
  return { pool, names }
}

// Closest model names to a query that found no full match, so a wrong guess is
// self-correcting without a separate agent_manager_models round-trip.
function suggest(all: Candidate[], value: string): string[] {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (tokens.length === 0) return []
  const scored = new Map<string, number>()
  for (const item of all) {
    const text = `${item.model.name} ${item.providerID}/${item.model.id}`.toLowerCase().replace(/[^a-z0-9]+/g, "")
    const score = tokens.filter((token) => text.includes(token)).length
    if (score > 0) scored.set(item.model.name, Math.max(scored.get(item.model.name) ?? 0, score))
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map((entry) => entry[0])
}

// Prefer the provider the user already uses for the invoking turn, then the Kilo Gateway,
// so a model name resolves to the provider with the best chance of working
// without forcing the agent to know about provider plumbing.
function rank(providerID: string, preferred: string | undefined): number {
  if (providerID === preferred) return 0
  if (providerID === "kilo") return 1
  return 2
}

function select(
  task: Input,
  all: Candidate[],
  preferred: string | undefined,
  source: Source | undefined,
  index: number,
): Selected {
  const base = {
    ...(task.prompt !== undefined ? { prompt: task.prompt } : {}),
    ...(task.name !== undefined ? { name: task.name } : {}),
    ...(task.branchName !== undefined ? { branchName: task.branchName } : {}),
  }
  const value = task.model?.trim()
  const variant = task.variant?.trim()
  if (!value) {
    if (!variant) {
      if (!task.prompt?.trim() || !source) return { task: base }
      return { task: { ...base, ...source } }
    }
    if (!source) {
      return { error: `Task ${index + 1} variant override requires an available current model.` }
    }
    const active = all.find(
      (item) => item.providerID === source.model.providerID && item.model.id === source.model.modelID,
    )
    if (!active) {
      return {
        error: `Task ${index + 1} current model is no longer available: ${source.model.providerID}/${source.model.modelID}. Specify a model override.`,
      }
    }
    if (!active.model.variants || !Object.hasOwn(active.model.variants, variant)) {
      const available = Object.keys(active.model.variants ?? {})
      return {
        error: `Task ${index + 1} variant "${variant}" is not available for ${active.model.name}. Available variants: ${available.join(", ") || "none"}`,
      }
    }
    return { task: { ...base, model: source.model, variant } }
  }

  const { pool, names } = lookup(all, value)
  if (pool.length === 0) {
    const close = suggest(all, value)
    const hint = close.length ? ` Closest matches: ${close.join(", ")}.` : ""
    return {
      error: `Task ${index + 1} model is not available: ${value}.${hint} Use agent_manager_models to search models.`,
    }
  }
  if (names.length > 1) {
    return {
      error: `Task ${index + 1} model "${value}" is ambiguous and matches several models: ${names.slice(0, 5).join(", ")}. Use a more specific name.`,
    }
  }

  const eligible = variant
    ? pool.filter((item) => item.model.variants && Object.hasOwn(item.model.variants, variant))
    : pool
  if (variant && eligible.length === 0) {
    const available = [...new Set(pool.flatMap((item) => Object.keys(item.model.variants ?? {})))]
    return {
      error: `Task ${index + 1} variant "${variant}" is not available for ${names[0]}. Available variants: ${available.join(", ") || "none"}`,
    }
  }

  const chosen = [...eligible].sort(
    (a, b) =>
      rank(a.providerID, preferred) - rank(b.providerID, preferred) ||
      a.providerID.localeCompare(b.providerID) ||
      a.model.id.localeCompare(b.model.id),
  )[0]!
  return {
    task: {
      ...base,
      model: { providerID: chosen.model.providerID, modelID: chosen.model.id },
      ...(variant ? { variant } : {}),
    },
  }
}

export const AgentManagerTool = Tool.define<
  typeof Params,
  { action: "start" | "list" | "prompt"; requestID?: string; count?: number; sessionID?: string },
  AgentManager.Service | Bus.Service | Provider.Service,
  "agent_manager"
>(
  "agent_manager",
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const host = yield* AgentManager.Service
    const provider = yield* Provider.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          if ("action" in params) {
            if (params.action === "list") {
              yield* ctx.ask({
                permission: "agent_manager",
                patterns: ["overview"],
                always: ["overview"],
                metadata: { action: "list" },
              })
              const result = yield* run(
                host.request({ operation: "overview", sessionID: ctx.sessionID, filter: params.filter }),
                ctx.abort,
              )
              if (result.operation !== "overview")
                return yield* Effect.die(new Error("Agent Manager host returned the wrong result type"))
              const count =
                (result.overview.local?.sessions.length ?? 0) +
                result.overview.ungrouped.length +
                result.overview.sections.reduce((sum, section) => sum + section.worktrees.length, 0)
              return {
                title: "Agent Manager overview",
                output: JSON.stringify(result.overview),
                metadata: { action: "list", count },
              }
            }
            yield* ctx.ask({
              permission: "agent_manager",
              patterns: ["prompt"],
              always: ["prompt"],
              metadata: { action: "prompt", sessionID: params.sessionID },
            })
            const result = yield* run(
              host.request({
                operation: "prompt",
                sessionID: ctx.sessionID,
                targetSessionID: params.sessionID,
                prompt: params.prompt.trim(),
              }),
              ctx.abort,
            )
            if (result.operation !== "prompt")
              return yield* Effect.die(new Error("Agent Manager host returned the wrong result type"))
            return {
              title: "Prompt delivered",
              output: `Delivered the prompt to Agent Manager session ${result.sessionID}. The session accepted it asynchronously.`,
              metadata: { action: "prompt", sessionID: result.sessionID },
            }
          }

          const msg = KiloSessionMessageOrder.latest(ctx.messages).user
          const source: Source | undefined = msg
            ? {
                model: {
                  providerID: msg.model.providerID,
                  modelID: msg.model.modelID,
                },
                ...(msg.model.variant ? { variant: msg.model.variant } : {}),
              }
            : undefined
          const need = params.tasks.some((task) => task.model?.trim() || task.variant?.trim())
          const all = need ? candidates(yield* provider.list()) : []
          const preferred = need
            ? (source?.model.providerID ??
              (yield* provider.defaultModel().pipe(
                Effect.map((model) => model.providerID as string),
                Effect.catch(() => Effect.succeed(undefined)),
              )))
            : undefined
          const selected = params.tasks.map((task, index) => select(task, all, preferred, source, index))
          const errors = selected.flatMap((item) => (item.error ? [item.error] : []))
          if (errors.length > 0) {
            return {
              title: "Invalid Agent Manager model selection",
              output: [
                "No Agent Manager sessions were requested.",
                ...errors,
                "Use agent_manager_models to find available model names and reasoning variants.",
              ].join("\n"),
              metadata: { action: "start", count: 0 },
            }
          }
          const tasks = selected.flatMap((item) => (item.task ? [item.task] : []))

          yield* ctx.ask({
            permission: "agent_manager",
            patterns: [params.mode],
            always: [params.mode],
            metadata: { mode: params.mode, count: tasks.length },
          })

          const requestID = `am-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const directory = yield* InstanceState.directory
          const sandboxInheritanceToken = SandboxInheritance.issue({
            sessionID: ctx.sessionID,
            directory,
            count: params.tasks.length,
          })
          yield* bus.publish(AgentManagerEvent.Start, {
            requestID,
            sessionID: ctx.sessionID,
            sandboxInheritanceToken,
            mode: params.mode,
            versions: params.versions,
            tasks,
          })

          // Echo how each named model resolved (provider + variant) so the agent
          // and the user can confirm the resolution without opening the session.
          const resolved = tasks.flatMap((task, index) => {
            if (!params.tasks[index]?.model?.trim() || !task.model) return []
            const name = all.find(
              (item) => item.providerID === task.model!.providerID && item.model.id === task.model!.modelID,
            )?.model.name
            const label = task.name?.trim() || task.branchName?.trim() || "session"
            const variant = task.variant ? ` · ${task.variant}` : ""
            return [`- ${label}: ${name ?? task.model.modelID} (${task.model.providerID})${variant}`]
          })

          return {
            title: `Requested ${tasks.length} Agent Manager ${params.mode === "worktree" ? "worktree" : "local"} session${tasks.length === 1 ? "" : "s"}`,
            output: [
              `Requested ${tasks.length} Agent Manager ${params.mode === "worktree" ? "worktree" : "local"} session${tasks.length === 1 ? "" : "s"}.`,
              `request_id: ${requestID}`,
              ...(resolved.length ? ["Resolved models:", ...resolved] : []),
              "The VS Code extension will create the sessions asynchronously and show progress in Agent Manager.",
            ].join("\n"),
            metadata: { action: "start", requestID, count: tasks.length },
          }
        }),
    }
  }),
)
