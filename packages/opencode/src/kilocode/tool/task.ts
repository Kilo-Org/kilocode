import { Effect, Exit, Schema } from "effect"
import type { BackgroundJob } from "@/background/job"
import type { SessionID } from "@/session/schema"
import path from "path"
import { Permission } from "@/permission"
import { guarded } from "../agent"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Session } from "../../session/session"
import type { Agent } from "../../agent/agent"
import type { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import z from "zod"
import { selectModel } from "./model-selection"

const log = Log.create({ service: "kilocode-task-model" })

// RATIONALE: Mirror narrow state slice Task tool consumes and ignore unrelated TUI fields.
const ModelState = z
  .object({
    model: z
      .record(
        z.string(),
        z.object({
          providerID: z.custom<ProviderV2.ID>(Schema.is(ProviderV2.ID)),
          modelID: z.custom<ModelV2.ID>(Schema.is(ModelV2.ID)),
        }),
      )
      .optional(),
    variant: z.record(z.string(), z.string().optional()).optional(),
  })
  .passthrough()

export namespace KiloTask {
  export const ModelFields = {
    model: Schema.optional(Schema.NullOr(Schema.String)).annotate({
      description:
        "Optional subagent model name or qualified provider/model ID from agent_manager_models. Only set when the user explicitly requests a different model. Omit or send null to keep the normal subagent model.",
    }),
    provider: Schema.optional(Schema.NullOr(Schema.String)).annotate({
      description:
        "Optional provider ID from agent_manager_models. Only set when the user explicitly requests a provider. Requires model; omit or send null to prefer the current turn's provider, then Kilo Gateway.",
    }),
    variant: Schema.optional(Schema.NullOr(Schema.String)).annotate({
      description:
        "Optional reasoning effort override from agent_manager_models. Only set when the user explicitly requests a different reasoning effort. Omit or send null to keep the normal reasoning effort. Can be used without model.",
    }),
  }

  export const modelDescription =
    "Experimental subagent model selection is enabled. Omit these fields, or send null, to keep the normal subagent model and reasoning defaults. Only override model, provider, or variant when the user explicitly requests it. Do not choose overrides on your own based on task complexity, cost, or latency. Use agent_manager_models only when an override is requested to find available models, providers, and variants; do not guess names or use model knowledge from training. This does not create Agent Manager sessions. Resumed tasks keep their last model and variant unless overridden. A variant-only override keeps the resolved model. A model override does not inherit the parent's reasoning effort."

  export const cancelForeground = Effect.fn("KiloTask.cancelForeground")(function* (
    jobs: Pick<BackgroundJob.Interface, "get">,
    id: SessionID,
    work: Effect.Effect<void>,
  ) {
    const job = yield* jobs.get(id)
    if (job?.metadata?.background === true || job?.status !== "running") return
    yield* work
  })

  export function start(
    jobs: Pick<BackgroundJob.Interface, "start" | "get" | "cancel">,
    cancel: (id: SessionID) => Effect.Effect<void>,
    notify?: (id: string) => Effect.Effect<void>,
  ) {
    return Effect.fn("KiloTask.start")(function* (input: BackgroundJob.StartInput & { id: SessionID }) {
      return yield* Effect.acquireRelease(
        jobs
          .start({ ...input, run: Effect.interruptible(input.run) })
          .pipe(Effect.tap((job) => (notify ? notify(job.id) : Effect.void))),
        (_, exit) =>
          Exit.hasInterrupts(exit)
            ? cancelForeground(jobs, input.id, Effect.all([cancel(input.id), jobs.cancel(input.id)], { discard: true }))
            : Effect.void,
      )
    })
  }

  /** Reject primary agents used as subagents */
  export function validate(info: Agent.Info, name: string) {
    if (info.mode === "primary") throw new Error(`Agent "${name}" is a primary agent and cannot be used as a subagent`)
  }

  /**
   * Build inherited permission ceilings from the calling agent.
   * Merges the static agent definition with the session's accumulated permissions
   * so denials survive multi-hop chains (plan → general → explore) without
   * overriding the selected subagent's own allowlist with parent ask/allow rules.
   *
   * OpenCode removed parent-agent inheritance entirely in anomalyco/opencode#31696.
   * Kilo intentionally differs: parent edit/notebook/MCP denials remain hard ceilings
   * for Plan Mode and MCP restrictions, while parent ask/allow rules must not replace
   * the selected subagent's policy. Preserve this distinction during upstream merges.
   *
   * Broad bash denies are deliberately NOT inherited from the calling agent. A read-only/delegating
   * agent (plan, ask, orchestrator) carries a `readOnlyBash` allowlist whose deny rules
   * (`*`, `git *`, shell-operator guards) exist only to shape that allowlist. Projecting
   * those denies onto a writable subagent capped commands the subagent's own config
   * explicitly allows (e.g. `git status`), surfacing phantom deny rules the user never
   * wrote (#11523). The subagent's own bash policy governs its bash capabilities; an
   * explicit session-scoped bash lockdown (sandbox / session deny) still reaches the
   * child via `deriveSubagentSessionPermission`, which inherits session deny rules. Built-in
   * Explore has its own enforcement-level read-only bash policy, so every caller retains that
   * boundary without projecting a delegator's bash rules onto custom writable subagents.
   *
   * The caller must resolve `caller` (Agent.Info) and `session` (Session.Info)
   * before calling. This function is pure/synchronous.
   */
  export function inherited(input: {
    caller: Agent.Info
    session: Pick<Session.Info, "permission">
    mcp: Config.Info["mcp"]
  }): Permission.Ruleset {
    const rules = Permission.merge(input.caller.permission ?? [], input.session.permission ?? [])
    const prefixes = Object.keys(input.mcp ?? {}).map((k) => k.replace(/[^a-zA-Z0-9_-]/g, "_") + "_")
    const isMcp = (p: string) => prefixes.some((prefix) => p.startsWith(prefix))
    // `guarded` covers the tools a read-only mode may never regain from config; keeping
    // it here too stops a Plan-launched subagent from reaching them under a catch-all.
    // `bash` is intentionally excluded — see the doc comment above (#11523).
    const mutation = new Set(["edit", ...guarded.filter((p) => p !== "bash")])
    const inherited = rules.filter(
      (r: Permission.Rule) => r.action === "deny" && (mutation.has(r.permission) || isMcp(r.permission)),
    )
    for (const permission of mutation) {
      if (Permission.evaluate(permission, "*", rules).action !== "deny") continue
      inherited.push({ permission, pattern: "*", action: "deny" })
    }
    const scoped = rules.filter((rule) => rule.permission !== "*")
    for (const permission of ["board_read", "board_post"]) {
      if (Permission.evaluate(permission, "*", scoped).action !== "deny") continue
      if (Permission.evaluate(permission, "*", rules).action !== "deny") continue
      inherited.push({ permission, pattern: "*", action: "deny" })
    }
    return merge(inherited)
  }

  /** Extra permission rules appended to subagent sessions */
  export function permissions(rules: Permission.Ruleset, task = false): Permission.Ruleset {
    return [
      ...(task ? [] : [{ permission: "task", pattern: "*", action: "deny" as const }]),
      { permission: "question", pattern: "*", action: "deny" },
      { permission: "suggest", pattern: "*", action: "deny" },
      ...rules,
    ]
  }

  export function merge(...rulesets: Permission.Ruleset[]): Permission.Rule[] {
    const result: Permission.Rule[] = []
    const seen = new Set<string>()
    for (const rule of rulesets.flat()) {
      const key = `${rule.permission}\u0000${rule.pattern}\u0000${rule.action}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(rule)
    }
    return result
  }

  type Model = { providerID: ProviderV2.ID; modelID: ModelV2.ID }
  type Saved = Model & { variant?: string }
  type Choice = { model: Model; variant?: string; sticky?: boolean; direct?: boolean }
  type Workflow = { model: Model; variant?: string }

  function key(model: Model) {
    return `${model.providerID}/${model.modelID}`
  }

  function parse(value: string | null | undefined): Model | undefined {
    if (!value) return undefined
    const [providerID, ...parts] = value.split("/")
    const modelID = parts.join("/")
    if (!providerID || !modelID) return undefined
    return {
      providerID: ProviderV2.ID.make(providerID),
      modelID: ModelV2.ID.make(modelID),
    }
  }

  /**
   * Resolve a configured model reference. A value is matched against the
   * provider catalog by qualified `provider/model` key, model ID, then display
   * name, preferring the parent session's provider so a custom provider's
   * display name (e.g. "codestral (latest)") resolves to that provider's model
   * instead of failing with an empty model ID. A model ID or display name may
   * itself contain `/`, so the catalog is consulted before a slash is treated
   * as a provider separator. Unresolvable or ambiguous names log a warning and
   * resolve to undefined, so the caller falls back to the next model source.
   */
  const resolve = Effect.fn("KiloTask.resolve")(function* (input: {
    value: string
    preferred: string
    provider: Provider.Interface
  }) {
    const value = input.value.trim()
    if (!value) return undefined
    const providers = yield* input.provider.list()
    const all = Object.values(providers).flatMap((provider) =>
      Object.values(provider.models).map((model) => ({ providerID: provider.id, model })),
    )
    const query = value.toLowerCase()
    const keys = all.filter((item) => `${item.providerID}/${item.model.id}`.toLowerCase() === query)
    const ids = all.filter((item) => item.model.id.toLowerCase() === query)
    const named = all.filter((item) => item.model.name.toLowerCase() === query)
    const matched = keys.length ? keys : ids.length ? ids : named
    if (matched.length === 0) {
      if (value.includes("/")) return parse(value)
      log.warn("task model name is not available", { value })
      return undefined
    }
    const preferred = matched.filter((item) => item.providerID === input.preferred)
    const pool = preferred.length ? preferred : matched
    if (pool.length > 1) {
      log.warn("task model name is ambiguous", {
        value,
        providers: pool.map((item) => item.providerID),
      })
      return undefined
    }
    return {
      providerID: ProviderV2.ID.make(pool[0].providerID),
      modelID: ModelV2.ID.make(pool[0].model.id),
    }
  })

  const saved = Effect.fn("KiloTask.savedModel")(function* (name: string) {
    if (Flag.KILO_CLIENT !== "cli") return undefined
    const file = path.join(Global.Path.state, "model.json")
    const state = yield* Effect.tryPromise({
      try: () =>
        Bun.file(file)
          .text()
          .then((raw) => ModelState.safeParse(JSON.parse(raw)))
          .then((result) => (result.success ? result.data : undefined))
          .catch(() => undefined),
      catch: () => undefined,
    })
    const model = state?.model?.[name]
    if (!model) return undefined
    return {
      ...model,
      variant: state?.variant?.[`${model.providerID}/${model.modelID}`],
    }
  })

  const defaults = Effect.fn("KiloTask.defaultModel")(function* (input: {
    name: string
    agent: Pick<Agent.Info, "model" | "variant">
    config: Pick<Config.Info, "subagent_model" | "subagent_variant" | "subagent_variant_overrides">
    parent: Model
    variant?: string
    workflow?: Workflow
    provider: Provider.Interface
  }) {
    const state = yield* saved(input.name)
    const configured = input.config.subagent_model
      ? yield* resolve({
          value: input.config.subagent_model,
          preferred: input.parent.providerID,
          provider: input.provider,
        })
      : undefined
    // A bare model name in the agent config is parsed by Provider.parseModel
    // into an empty modelID (providerID holds the name); resolve it to a real
    // provider/model pair instead of launching a child with an empty ID.
    const agentModel = input.agent.model
      ? input.agent.model.modelID
        ? input.agent.model
        : yield* resolve({
            value: input.agent.model.providerID,
            preferred: input.parent.providerID,
            provider: input.provider,
          })
      : undefined
    const override = (model: Model) => input.config.subagent_variant_overrides?.[key(model)] ?? undefined
    const choices: Array<Choice | undefined> = [
      input.workflow ? { ...input.workflow, direct: true } : undefined,
      state
        ? {
            model: { providerID: state.providerID, modelID: state.modelID },
            variant: state.variant,
            sticky: true,
          }
        : undefined,
      agentModel ? { model: agentModel, variant: input.agent.variant, direct: true } : undefined,
      configured ? { model: configured, variant: input.config.subagent_variant ?? undefined } : undefined,
    ]

    for (const choice of choices) {
      if (!choice) continue
      if (choice.direct) {
        const value = override(choice.model)
        if (!value) return { model: choice.model, variant: choice.variant }
        const full = yield* input.provider.getModel(choice.model.providerID, choice.model.modelID)
        const variant = full.variants?.[value] ? value : choice.variant
        return { model: choice.model, variant }
      }
      const full = yield* input.provider.getModel(choice.model.providerID, choice.model.modelID).pipe(
        Effect.catchTag("ProviderModelNotFoundError", (err) =>
          Effect.sync(() => {
            log.debug("skipping unavailable task subagent model", {
              providerID: choice.model.providerID,
              modelID: choice.model.modelID,
              err,
            })
            return undefined
          }),
        ),
      )
      if (!full) continue
      const fallback = choice.variant && full.variants?.[choice.variant] ? choice.variant : undefined
      const value = override(choice.model)
      const variant = value && full.variants?.[value] ? value : fallback
      return {
        model: choice.sticky && variant ? { ...choice.model, variant } : choice.model,
        variant,
      }
    }

    const value = override(input.parent)
    if (!value) return { model: input.parent, variant: input.variant }
    const full = yield* input.provider
      .getModel(input.parent.providerID, input.parent.modelID)
      .pipe(Effect.catchTag("ProviderModelNotFoundError", () => Effect.succeed(undefined)))
    const variant = full?.variants?.[value] ? value : input.variant
    return { model: input.parent, variant }
  })

  export const resolveModel = Effect.fn("KiloTask.resolveModel")(function* (
    input: Parameters<typeof defaults>[0] & {
      enabled?: boolean
      selection?: { model?: string | null; provider?: string | null; variant?: string | null }
      resume?: Session.Info["model"]
    },
  ) {
    const selection = input.selection ?? {}
    const requested = Object.values(selection).some((value) => value != null)
    if (requested && !input.enabled) {
      return yield* Effect.fail(
        new Error("Task model selection requires experimental.task_model_selection=true in Kilo config"),
      )
    }
    if (requested && Object.values(selection).some((value) => value != null && !value.trim())) {
      return yield* Effect.fail(new Error("Task model, provider, and variant must not be empty when specified"))
    }
    if (selection.provider && !selection.model) {
      return yield* Effect.fail(new Error("Task provider requires a model"))
    }
    const source = selection.model
      ? undefined
      : input.enabled && input.resume
        ? {
            model: { providerID: input.resume.providerID, modelID: input.resume.id },
            variant: input.resume.variant === "default" ? undefined : input.resume.variant,
          }
        : yield* defaults(input)
    if (!requested && source) return source
    const providers = yield* input.provider.list()
    const selected = selectModel(selection, providers, source, input.parent.providerID)
    if ("error" in selected) return yield* Effect.fail(new Error(`Task ${selected.error}`))
    return selected
  })

  export function workflow(value: unknown): Workflow | undefined {
    if (!value || typeof value !== "object") return undefined
    const item = (value as { workflow?: unknown }).workflow
    if (!item || typeof item !== "object") return undefined
    const model = (item as { model?: unknown }).model
    if (!model || typeof model !== "object") return undefined
    const providerID = (model as { providerID?: unknown }).providerID
    const modelID = (model as { modelID?: unknown }).modelID
    if (typeof providerID !== "string" || typeof modelID !== "string") return undefined
    const variant = (item as { variant?: unknown }).variant
    return {
      model: { providerID: ProviderV2.ID.make(providerID), modelID: ModelV2.ID.make(modelID) },
      variant: typeof variant === "string" ? variant : undefined,
    }
  }
}
