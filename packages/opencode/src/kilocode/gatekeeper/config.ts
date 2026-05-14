import { Schema } from "effect"
import z from "zod"
import { ConfigModelID } from "@/config/model-id"
import { InvalidError } from "@/config/error"
import { ZodOverride } from "@/util/effect-zod"

export namespace KiloGatekeeperConfig {
  export const DEFAULT_MODEL = "kilo-auto/balanced" as const
  const Legacy = ["stage1_model", "stage2_model", "mode", "hard_deny", "timeout", "max_tokens", "max_token"] as const

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
  type Warn = { path: string; message: string; detail?: string }

  export function validate(data: unknown, source: string, warnings?: Warn[]): unknown {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return data
    if (!("gatekeeper" in data)) return data

    const value = (data as { gatekeeper?: unknown }).gatekeeper
    if (value === null || value === undefined) return data
    if (typeof value !== "object" || Array.isArray(value)) return data

    const keys = Legacy.filter((key) => key in value)
    const gatekeeper = keys.length
      ? Object.fromEntries(Object.entries(value).filter(([key]) => !Legacy.includes(key as (typeof Legacy)[number])))
      : value

    if (keys.length) {
      warnings?.push({
        path: source,
        message: `Unsupported legacy Gatekeeper field${keys.length === 1 ? "" : "s"} ignored: ${keys.join(", ")}`,
      })
    }

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
