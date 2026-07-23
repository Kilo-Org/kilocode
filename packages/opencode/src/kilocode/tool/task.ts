// kilocode_change - new file
import { Effect, Schema } from "effect"
import path from "path"
import { Permission } from "@/permission"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { resolveAgentVariant, resolveConfiguredVariant } from "../cli/cmd/tui/model-variant"
import type { Session } from "../../session/session"
import type { Agent } from "../../agent/agent"
import type { Config } from "../../config/config"
import type { Provider } from "../../provider/provider"
import z from "zod"

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
    variant: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export namespace KiloTask {
  /** Reject primary agents used as subagents */
  export function validate(info: Agent.Info, name: string) {
    if (info.mode === "primary") throw new Error(`Agent "${name}" is a primary agent and cannot be used as a subagent`)
  }

  /** Kilo keeps delegation one level deep to avoid recursive subagent chains. */
  export function nestedTask(): false {
    return false
  }

  /**
   * Build inherited permission ceilings from the calling agent.
   * Merges the static agent definition with the session's accumulated permissions
   * so denials survive multi-hop chains (plan → general → explore) without
   * overriding the selected subagent's own allowlist with parent ask/allow rules.
   *
   * OpenCode removed parent-agent inheritance entirely in anomalyco/opencode#31696.
   * Kilo intentionally differs: parent denials remain hard ceilings for Plan Mode
   * and MCP restrictions, while parent ask/allow rules must not replace the
   * selected subagent's policy. Preserve this distinction during upstream merges.
   *
   * The caller must resolve `caller` (Agent.Info) and `session` (Session.Info)
   * before calling. This function is pure/synchronous.
   */
  export function inherited(input: {
    caller: Agent.Info
    session: Session.Info
    mcp: Config.Info["mcp"]
  }): Permission.Ruleset {
    const rules = Permission.merge(input.caller.permission ?? [], input.session.permission ?? [])
    const prefixes = Object.keys(input.mcp ?? {}).map((k) => k.replace(/[^a-zA-Z0-9_-]/g, "_") + "_")
    const isMcp = (p: string) => prefixes.some((prefix) => p.startsWith(prefix))
    const mutation = new Set(["edit", "bash", "notebook_edit", "notebook_execute"])
    const inherited = rules.filter(
      (r: Permission.Rule) => r.action === "deny" && (mutation.has(r.permission) || isMcp(r.permission)),
    )
    for (const permission of mutation) {
      if (Permission.evaluate(permission, "*", rules).action !== "deny") continue
      inherited.push({ permission, pattern: "*", action: "deny" })
    }
    return merge(inherited)
  }

  /** Extra permission rules appended to subagent sessions */
  export function permissions(rules: Permission.Ruleset): Permission.Ruleset {
    return [
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "question", pattern: "*", action: "deny" },
      { permission: "interactive_terminal", pattern: "*", action: "deny" },
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
  type Saved = { model: Model; variant?: string }

  function key(model: Model) {
    return `${model.providerID}/${model.modelID}`
  }

  function parse(value: string | null | undefined): Model | undefined {
    if (!value) return undefined
    const [providerID, ...parts] = value.split("/")
    return {
      providerID: ProviderV2.ID.make(providerID),
      modelID: ModelV2.ID.make(parts.join("/")),
    }
  }

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
    const variant = state.variant?.[key(model)]
    if (typeof variant === "string") return { model, variant }
    return { model }
  })

  const lookup = Effect.fn("KiloTask.lookupModel")(function* (provider: Provider.Interface, model: Model) {
    return yield* provider.getModel(model.providerID, model.modelID).pipe(
      Effect.catchTag("ProviderModelNotFoundError", (err) =>
        Effect.sync(() => {
          log.debug("skipping unavailable task subagent model", {
            providerID: model.providerID,
            modelID: model.modelID,
            err,
          })
          return undefined
        }),
      ),
    )
  })

  function variant(input: {
    current: Model
    agent: Pick<Agent.Info, "model" | "variant">
    config: Model | undefined
    configVariant: string | undefined
    variants?: Record<string, unknown>
  }) {
    return (
      resolveAgentVariant({
        current: input.current,
        config: input.agent.model,
        variant: input.agent.variant,
        variants: input.variants,
      }) ??
      (input.config
        ? resolveAgentVariant({
            current: input.current,
            config: input.config,
            variant: input.configVariant,
            variants: input.variants,
          })
        : undefined)
    )
  }

  /** Resolve the task subagent model while discarding stale unavailable overrides. */
  export const resolveModel = Effect.fn("KiloTask.resolveModel")(function* (input: {
    name: string
    agent: Pick<Agent.Info, "model" | "variant">
    config: Pick<Config.Info, "subagent_model" | "subagent_variant" | "subagent_variant_overrides">
    parent: Model
    variant?: string
    provider: Provider.Interface
  }) {
    const state = yield* saved(input.name)
    const cfg = parse(input.config.subagent_model)
    const configVariant = input.config.subagent_variant ?? undefined
    const choose = (
      model: Model,
      variants: Record<string, unknown> | undefined,
      fallback?: string,
      legacy?: string,
    ) => {
      const value = input.config.subagent_variant_overrides?.[key(model)] ?? undefined
      return (
        (value && variants?.[value] ? value : undefined) ??
        resolveConfiguredVariant({ variant: legacy, variants }) ??
        variant({
          current: model,
          agent: input.agent,
          config: cfg,
          configVariant,
          variants,
        }) ??
        fallback
      )
    }

    if (state) {
      const full = yield* lookup(input.provider, state.model)
      if (full) {
        return {
          model: state.model,
          variant: choose(state.model, full.variants, undefined, state.variant),
        }
      }
    }

    if (input.agent.model) {
      const full = yield* lookup(input.provider, input.agent.model)
      return {
        model: input.agent.model,
        variant: choose(input.agent.model, full?.variants),
      }
    }

    if (cfg) {
      const full = yield* lookup(input.provider, cfg)
      if (full) {
        return {
          model: cfg,
          variant: choose(cfg, full.variants),
        }
      }
    }

    const full = yield* lookup(input.provider, input.parent)
    return {
      model: input.parent,
      variant: choose(input.parent, full?.variants, input.variant),
    }
  })
}
