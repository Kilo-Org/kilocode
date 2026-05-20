import { Schema } from "effect"
import z from "zod"
import { ConfigModelID } from "@/config/model-id"
import { InvalidError } from "@/config/error"
import { ZodOverride } from "@/util/effect-zod"

export namespace KiloGatekeeperConfig {
  export const DEFAULT_MODEL = "kilo-auto/balanced" as const
  const Legacy = ["stage1_model", "stage2_model", "mode", "hard_deny", "timeout", "max_tokens", "max_token"] as const
  const Unsafe = new Set(["approve_all", "always_allow", "auto_approve", "yolo", "off", "disabled", "false"])

  const List = Schema.mutable(Schema.Array(Schema.String))
  const zInfo = z
    .object({
      enabled: z.boolean().nullable().optional(),
      model: ConfigModelID.zod.nullable().optional(),
      context_aware: z.boolean().nullable().optional(),
      environment: z.array(z.string()).nullable().optional(),
      allow: z.array(z.string()).nullable().optional(),
      soft_deny: z.array(z.string()).nullable().optional(),
    })
    .strict()

  export const Info = Schema.Struct({
    enabled: Schema.optional(Schema.NullOr(Schema.Boolean)).annotate({
      description: "Enable Gatekeeper model-assisted permission guardrails",
    }),
    model: Schema.optional(Schema.NullOr(ConfigModelID)).annotate({
      description: `Gatekeeper classifier model in provider/model format. Defaults to ${DEFAULT_MODEL}.`,
    }),
    context_aware: Schema.optional(Schema.NullOr(Schema.Boolean)).annotate({
      description:
        "Include trusted session instructions and user-task context in Gatekeeper checks. Defaults to true when Gatekeeper is enabled.",
    }),
    environment: Schema.optional(Schema.NullOr(List)).annotate({
      description: "Trusted environment statements Gatekeeper may consider when evaluating tool calls",
    }),
    allow: Schema.optional(Schema.NullOr(List)).annotate({
      description: "User policy hints for actions Gatekeeper should allow",
    }),
    soft_deny: Schema.optional(Schema.NullOr(List)).annotate({
      description: "User policy hints for actions Gatekeeper should deny with a recoverable tool result",
    }),
  }).annotate({
    description: "Gatekeeper model-assisted permission guardrail configuration",
    [ZodOverride]: zInfo,
  })

  export type Info = Schema.Schema.Type<typeof Info>

  type ConfigLike = { gatekeeper?: Info | null }
  type Value = Record<string, unknown>
  type Warn = { path: string; message: string; detail?: string }

  function cleanMode(value: unknown) {
    if (typeof value !== "string") return undefined
    const mode = value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    if (!mode) return undefined
    return mode
  }

  function parseModel(value: unknown) {
    if (typeof value !== "string") return undefined
    if (!/^[^/\s]+\/[^/\s]+$/.test(value)) return undefined
    const parsed = ConfigModelID.zod.safeParse(value)
    if (!parsed.success) return undefined
    return parsed.data
  }

  function warn(warnings: Warn[] | undefined, path: string, message: string) {
    warnings?.push({ path, message })
  }

  function migrate(base: Value, value: Value, source: string, warnings?: Warn[]) {
    const next = { ...base }
    const mode = cleanMode(value.mode)
    const hasEnabled = next.enabled !== undefined && next.enabled !== null
    const hasModel = next.model !== undefined && next.model !== null
    const stage2 = parseModel(value.stage2_model)
    const stage1 = parseModel(value.stage1_model)
    const pick = stage2 ?? stage1
    const invalid = [value.stage2_model, value.stage1_model].some((item) => item !== undefined) && !pick && !hasModel

    if (stage1 && stage2 && stage1 !== stage2) {
      warn(warnings, source, `Legacy Gatekeeper model conflict: stage2_model overrides stage1_model (${stage2} over ${stage1})`)
    }

    if (hasModel && pick && next.model !== pick) {
      warn(warnings, source, `legacy Gatekeeper model ignored because gatekeeper.model is already set to ${String(next.model)}`)
    }

    if (!hasModel && pick) next.model = pick
    if (invalid) {
      warn(warnings, source, "Legacy Gatekeeper model could not be migrated automatically; review stage1_model/stage2_model manually")
    }

    if (!mode) {
      if (!hasEnabled && pick) next.enabled = true
      return next
    }

    if (Unsafe.has(mode)) {
      if (!hasEnabled) next.enabled = false
      warn(
        warnings,
        source,
        `Legacy Gatekeeper mode '${mode}' was not migrated because approve-all/disabled behavior is unsafe`,
      )
      return next
    }

    if (!hasEnabled) next.enabled = false
    warn(warnings, source, `Legacy Gatekeeper mode '${mode}' is ambiguous and requires manual review`)
    return next
  }

  export function validate(data: unknown, source: string, warnings?: Warn[], options?: { migrate?: boolean }): unknown {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return data
    if (!("gatekeeper" in data)) return data

    const value = (data as { gatekeeper?: unknown }).gatekeeper
    if (value === null || value === undefined) return data
    if (typeof value !== "object" || Array.isArray(value)) return data

    const keys = Legacy.filter((key) => key in value)
    const base = (keys.length
      ? Object.fromEntries(Object.entries(value).filter(([key]) => !Legacy.includes(key as (typeof Legacy)[number])))
      : value) as Value
    const gatekeeper = options?.migrate && keys.length ? migrate(base, value as Value, source, warnings) : base

    const parsed = zInfo.safeParse(gatekeeper)
    if (parsed.success) {
      if (!keys.length) return data
      return {
        ...(data as Record<string, unknown>),
        gatekeeper,
      }
    }

    throw new InvalidError({
      path: source,
      issues: parsed.error.issues.map((issue) => ({
        ...issue,
        path: ["gatekeeper", ...issue.path],
      })) as z.core.$ZodIssue[],
    })
  }

  export function normalize<T extends ConfigLike>(info: T): T {
    if (info.gatekeeper === null) {
      const next = { ...info }
      delete next.gatekeeper
      return next as T
    }
    if (!info.gatekeeper) return info

    const cfg = Object.fromEntries(
      Object.entries(info.gatekeeper).filter(([, value]) => value !== null && value !== undefined),
    ) as Info
    const base = {
      ...cfg,
      model: cfg.model ?? DEFAULT_MODEL,
    }

    if (cfg.enabled !== true) {
      return {
        ...info,
        gatekeeper: base,
      }
    }

    return {
      ...info,
      gatekeeper: {
        ...base,
        context_aware: cfg.context_aware ?? true,
        environment: cfg.environment ?? [],
        allow: cfg.allow ?? [],
        soft_deny: cfg.soft_deny ?? [],
      },
    }
  }
}
