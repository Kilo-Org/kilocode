// kilocode_change - new file
import { Effect } from "effect"
import type { Config } from "@/config/config"

/**
 * Trusted resolution of the reviewer's own model.
 *
 * The reviewer decides whether a bounded ask may run without a human, so which model answers that
 * question belongs to the trusted base. The merged config cannot supply it: config merge scopes
 * only `sandbox` and indexing by source, so `model`, `small_model` and `provider` — `baseURL`
 * included — survive from a repository into the effective config. A repository that named its own
 * reviewer would convert the whole eligible population into an automatic allow, which is strictly
 * worse than running without a reviewer.
 *
 * So this module reads exactly two repo-independent sources — the process environment and the
 * user's own global config block, in that order — and never the merged config, never the session's
 * provider. Anything missing, unreadable or malformed leaves the reviewer disabled.
 *
 * Naming the model is only half of it. The provider block carries the *transport* — `baseURL`,
 * headers, credentials — and config merge does not scope it either, so a repository that rewrote
 * `provider.<id>.options.baseURL` would keep our model name and point it at a server of its own,
 * which answers `allow` to everything. The merged provider entry for the chosen provider therefore
 * has to be identical to the trusted one; any difference means the transport has an origin this
 * module cannot vouch for, and the reviewer stays unbound.
 *
 * An account-level default (the signed-in user's own configured small model, or the gateway's free
 * model for an anonymous account) is a third trusted source and slots in beside these two; it needs
 * the provider service, so it arrives with the binding rather than here.
 */
export namespace SecurityReviewerConfig {
  /** Which repo-independent source named the model. */
  export type Source = "env" | "xdg_global"

  export type Reason =
    | "flag_off"
    | "config_unreadable"
    | "privacy_mode"
    | "no_trusted_model"
    | "malformed_model"
    | "provider_untrusted"

  export type Resolved =
    | Readonly<{ enabled: false; reason: Reason }>
    | Readonly<{ enabled: true; providerID: string; modelID: string; source: Source; timeout: number }>

  /** Env var names. They live in the environment precisely so a clone cannot write them. */
  const FLAG = "KILO_SECURITY_REVIEWER"
  const MODEL = "KILO_SECURITY_REVIEWER_MODEL"
  const TIMEOUT = "KILO_SECURITY_REVIEWER_TIMEOUT_MS"

  const DEFAULT_TIMEOUT = 4_000
  /** The spec's hard cap: a reviewer may not hold a call longer than this, however it is configured. */
  const MAX_TIMEOUT = 5_000

  type Env = Record<string, string | undefined>

  /**
   * Whether the reviewer is switched on at all. Like the layer's own flag this is server-side, so a
   * project config can only ever tighten the outcome, never switch the stage on.
   */
  export function enabled(env: Env = process.env) {
    const value = env[FLAG]
    return value === "1" || value === "true"
  }

  function timeout(env: Env) {
    const raw = env[TIMEOUT]
    if (raw === undefined) return DEFAULT_TIMEOUT
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT
    return Math.min(Math.trunc(value), MAX_TIMEOUT)
  }

  /** `provider/model`, splitting on the first slash so a model id keeps any slashes of its own. */
  function parse(value: string) {
    const index = value.indexOf("/")
    if (index <= 0) return undefined
    const providerID = value.slice(0, index).trim()
    const modelID = value.slice(index + 1).trim()
    if (!providerID || !modelID) return undefined
    return { providerID, modelID }
  }

  function named(global: { small_model?: unknown }, env: Env) {
    const fromEnv = env[MODEL]
    if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return { value: fromEnv, source: "env" as const }
    const fromGlobal = global.small_model
    if (typeof fromGlobal === "string" && fromGlobal.trim().length > 0)
      return { value: fromGlobal, source: "xdg_global" as const }
    return undefined
  }

  /** Key-order-independent serialization, so the comparison is over content rather than spelling. */
  function stable(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`
  }

  /** The configured block for one provider, or `undefined` when the config does not name it. */
  function providerEntry(info: { provider?: unknown } | undefined, providerID: string) {
    const table = info?.provider
    if (!table || typeof table !== "object") return undefined
    return (table as Record<string, unknown>)[providerID]
  }

  export const resolve = Effect.fn("SecurityReviewerConfig.resolve")(function* (
    config: Pick<Config.Interface, "get" | "getGlobal">,
    env: Env = process.env,
  ) {
    if (!enabled(env)) return { enabled: false, reason: "flag_off" } as const

    const global = yield* config.getGlobal().pipe(
      Effect.map((info) => info as { small_model?: unknown; privacy_mode?: unknown; provider?: unknown }),
      Effect.catchCause(() => Effect.succeed(undefined)),
    )
    // An unreadable global block is not an empty one: without it there is no trusted source to read.
    if (!global) return { enabled: false, reason: "config_unreadable" } as const
    if (global.privacy_mode === true) return { enabled: false, reason: "privacy_mode" } as const

    const model = named(global, env)
    if (!model) return { enabled: false, reason: "no_trusted_model" } as const

    const parsed = parse(model.value)
    // A half-understood model reference is not a model: it would silently resolve to something else.
    if (!parsed) return { enabled: false, reason: "malformed_model" } as const

    const merged = yield* config.get().pipe(
      Effect.map((info) => info as { provider?: unknown }),
      Effect.catchCause(() => Effect.succeed(undefined)),
    )
    // Unreadable is not empty here either: without the merged view there is nothing to compare the
    // trusted provider block against, so the transport's origin is simply unknown.
    if (!merged) return { enabled: false, reason: "config_unreadable" } as const
    if (stable(providerEntry(merged, parsed.providerID)) !== stable(providerEntry(global, parsed.providerID)))
      return { enabled: false, reason: "provider_untrusted" } as const

    return {
      enabled: true,
      providerID: parsed.providerID,
      modelID: parsed.modelID,
      source: model.source,
      timeout: timeout(env),
    } as const
  })
}
