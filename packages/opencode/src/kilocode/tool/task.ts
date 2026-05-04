// kilocode_change - new file
import { Effect } from "effect"
import path from "path"
import { Permission } from "@/permission"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Session } from "../../session"
import type { Agent } from "../../agent/agent"
import type { Config } from "../../config"
import z from "zod"

// RATIONALE: Mirror narrow state slice Task tool consumes and ignore unrelated TUI fields.
const ModelState = z
  .object({
    model: z.record(z.string(), z.object({ providerID: ProviderID.zod, modelID: ModelID.zod })).optional(),
    variant: z.record(z.string(), z.string().optional()).optional(),
  })
  .passthrough()

export namespace KiloTask {
  /** Reject primary agents used as subagents */
  export function validate(info: Agent.Info, name: string) {
    if (info.mode === "primary") throw new Error(`Agent "${name}" is a primary agent and cannot be used as a subagent`)
  }

  /**
   * Build inherited permission rules from the calling agent.
   * Merges the static agent definition with the session's accumulated permissions
   * so restrictions survive multi-hop chains (plan → general → explore).
   *
   * The caller must resolve `caller` (Agent.Info) and `session` (Session.Info)
   * before calling — this function is pure/synchronous.
   */
  export function inherited(input: {
    caller: Agent.Info
    session: Session.Info
    mcp: Config.Info["mcp"]
  }): Permission.Ruleset {
    const rules = Permission.merge(input.caller.permission ?? [], input.session.permission ?? [])
    const prefixes = Object.keys(input.mcp ?? {}).map((k) => k.replace(/[^a-zA-Z0-9_-]/g, "_") + "_")
    const isMcp = (p: string) => prefixes.some((prefix) => p.startsWith(prefix))
    return rules.filter(
      (r: Permission.Rule) => r.permission === "edit" || r.permission === "bash" || isMcp(r.permission),
    )
  }

  /** Extra permission rules appended to subagent sessions */
  export function permissions(rules: Permission.Ruleset): Permission.Ruleset {
    return [{ permission: "task", pattern: "*", action: "deny" }, ...rules]
  }

  /** Return saved CLI model for agent, if any. */
  export const resolveModel = Effect.fn("KiloTask.resolveModel")(function* (name: string) {
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
}
