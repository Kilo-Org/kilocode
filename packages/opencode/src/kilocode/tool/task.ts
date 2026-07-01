// kilocode_change - new file
import { Effect, Schema } from "effect"
import path from "path"
import { Permission } from "@/permission"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Session } from "../../session/session"
import type { Agent } from "../../agent/agent"
import type { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { REVIEWER_AGENT } from "@/kilocode/agent"
import { Wildcard } from "@/util/wildcard"
import z from "zod"

const log = Log.create({ service: "kilocode-task-model" })

const restricted = [
  "read",
  "grep",
  "glob",
  "list",
  "skill",
  "webfetch",
  "websearch",
  "codebase_search",
  "semantic_search",
  "external_directory",
  "suggest",
]

// RATIONALE: Mirror narrow state slice Task tool consumes and ignore unrelated TUI fields.
const ModelState = z
  .object({
    model: z
      .record(
        z.string(),
        z.object({
          providerID: z.custom<ProviderID>(Schema.is(ProviderID)),
          modelID: z.custom<ModelID>(Schema.is(ModelID)),
        }),
      )
      .optional(),
    variant: z.record(z.string(), z.string().optional()).optional(),
  })
  .passthrough()

export namespace KiloTask {
  /** Reject primary agents used as subagents */
  export function validate(info: Agent.Info, name: string) {
    if (info.mode === "primary") throw new Error(`Agent "${name}" is a primary agent and cannot be used as a subagent`)
  }

  /** Kilo keeps delegation one level deep except for Reviewer -> Explore. */
  export function nestedTask(name: string) {
    return name === REVIEWER_AGENT
  }

  /**
   * Build inherited permission ceilings from the calling agent.
   * Merges the static agent definition with the session's accumulated permissions
   * so denials survive multi-hop chains (plan → general → explore) without
   * overriding the selected subagent's own allowlist with parent ask/allow rules.
   * Restricted read-only tools (read, grep, glob, list, skill, webfetch, websearch,
   * codebase_search, semantic_search, external_directory, suggest) also inherit
   * this ceiling so Explore respects Reviewer's own restrictions when nested.
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
    const prefixes = Object.keys(input.mcp ?? {}).map((k) => k.replace(/[^a-zA-Z0-9_-]/g, "_") + "_")
    const isMcp = (p: string) => prefixes.some((prefix) => p.startsWith(prefix))
    const isRestricted = (p: string) => restricted.some((tool) => Wildcard.match(tool, p))
    // A blanket "*" pattern rule is only kept when it denies; a bare ask/allow catch-all
    // (typically a raw global permission default) must not dilute the subagent's own
    // catch-all policy. Narrower patterns (specific commands/paths) always survive so
    // purpose-built guards like reviewerBash keep their scoped allow exceptions.
    const keep = (rule: Permission.Rule, session: boolean) => {
      if (rule.permission === "*") return session && rule.action !== "allow"
      if (rule.permission === "bash") return rule.pattern !== "*" || rule.action === "deny"
      if (rule.permission === "edit") return rule.action !== "allow"
      if (rule.permission === "external_directory") return true
      if (isMcp(rule.permission)) return true
      if (!isRestricted(rule.permission)) return false
      return rule.action !== "allow"
    }
    return [
      ...(input.caller.permission ?? []).filter((rule) => keep(rule, false)),
      ...(input.session.permission ?? []).filter((rule) => keep(rule, true)),
    ]
  }

  /** Extra permission rules appended to subagent sessions */
  export function permissions(rules: Permission.Ruleset, canTask: boolean): Permission.Ruleset {
    return [
      ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
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

  type Model = { providerID: ProviderID; modelID: ModelID }
  type Saved = Model & { variant?: string }
  type Choice = { model: Model; variant?: string; sticky?: boolean; direct?: boolean }

  function key(model: Model) {
    return `${model.providerID}/${model.modelID}`
  }

  function parse(value: string | null | undefined): Model | undefined {
    if (!value) return undefined
    const [providerID, ...parts] = value.split("/")
    return {
      providerID: ProviderID.make(providerID),
      modelID: ModelID.make(parts.join("/")),
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
    return {
      ...model,
      variant: state?.variant?.[`${model.providerID}/${model.modelID}`],
    }
  })

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
    const override = (model: Model) => input.config.subagent_variant_overrides?.[key(model)] ?? undefined
    const choices: Array<Choice | undefined> = [
      state
        ? {
            model: { providerID: state.providerID, modelID: state.modelID },
            variant: state.variant,
            sticky: true,
          }
        : undefined,
      input.agent.model ? { model: input.agent.model, variant: input.agent.variant, direct: true } : undefined,
      cfg ? { model: cfg, variant: input.config.subagent_variant ?? undefined } : undefined,
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
}
