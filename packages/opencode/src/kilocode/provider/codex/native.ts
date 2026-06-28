import { Option, Schema } from "effect"

export const Window = Schema.Struct({
  used_percent: Schema.Finite,
  limit_window_seconds: Schema.optional(Schema.Finite),
  reset_after_seconds: Schema.optional(Schema.Finite),
  reset_at: Schema.optional(Schema.Finite),
})
export type Window = typeof Window.Type

export interface RateLimit {
  allowed?: boolean
  limit_reached?: boolean
  primary_window?: Window | null
  secondary_window?: Window | null
}

export interface Additional {
  limit_name?: string
  metered_feature?: string
  rate_limit?: RateLimit | null
}

export const Credits = Schema.Struct({
  has_credits: Schema.optional(Schema.Boolean),
  unlimited: Schema.optional(Schema.Boolean),
  overage_limit_reached: Schema.optional(Schema.Boolean),
  balance: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
})
export type Credits = typeof Credits.Type

export const SpendControl = Schema.Struct({
  reached: Schema.optional(Schema.Boolean),
  individual_limit: Schema.optional(Schema.NullOr(Schema.Finite)),
})
export type SpendControl = typeof SpendControl.Type

const RateFields = Schema.Struct({
  allowed: Schema.optional(Schema.Boolean),
  limit_reached: Schema.optional(Schema.Boolean),
  primary_window: Schema.optional(Schema.Unknown),
  secondary_window: Schema.optional(Schema.Unknown),
})

const AdditionalFields = Schema.Struct({
  limit_name: Schema.optional(Schema.String),
  metered_feature: Schema.optional(Schema.String),
  rate_limit: Schema.optional(Schema.Unknown),
})

const Root = Schema.Struct({
  plan_type: Schema.optional(Schema.String),
  rate_limit: Schema.optional(Schema.Unknown),
  additional_rate_limits: Schema.optional(Schema.Unknown),
  credits: Schema.optional(Schema.Unknown),
  spend_control: Schema.optional(Schema.Unknown),
})

export interface Native {
  plan_type?: string
  rate_limit?: RateLimit
  additional_rate_limits: Additional[]
  credits?: Credits
  spend_control?: SpendControl
}

const root = Schema.decodeUnknownSync(Root)
const rateFields = Schema.decodeUnknownOption(RateFields)
const window = Schema.decodeUnknownOption(Window)
const additionalFields = Schema.decodeUnknownOption(AdditionalFields)
const credits = Schema.decodeUnknownOption(Credits)
const spend = Schema.decodeUnknownOption(SpendControl)

function rate(input: unknown): RateLimit | undefined {
  const value = Option.getOrUndefined(rateFields(input))
  if (!value) return undefined
  const primary = value.primary_window === null ? null : Option.getOrUndefined(window(value.primary_window))
  const secondary = value.secondary_window === null ? null : Option.getOrUndefined(window(value.secondary_window))
  return {
    ...(value.allowed !== undefined ? { allowed: value.allowed } : {}),
    ...(value.limit_reached !== undefined ? { limit_reached: value.limit_reached } : {}),
    ...(primary !== undefined ? { primary_window: primary } : {}),
    ...(secondary !== undefined ? { secondary_window: secondary } : {}),
  }
}

function additional(input: unknown): Additional | undefined {
  const value = Option.getOrUndefined(additionalFields(input))
  if (!value) return undefined
  const limit = value.rate_limit === null ? null : rate(value.rate_limit)
  return {
    ...(value.limit_name ? { limit_name: value.limit_name } : {}),
    ...(value.metered_feature ? { metered_feature: value.metered_feature } : {}),
    ...(limit !== undefined ? { rate_limit: limit } : {}),
  }
}

export function decode(input: unknown): Native {
  const value = root(input)
  const limits = Array.isArray(value.additional_rate_limits)
    ? value.additional_rate_limits.flatMap((item) => {
        const result = additional(item)
        return result ? [result] : []
      })
    : []
  const rateLimit = rate(value.rate_limit)
  const credit = Option.getOrUndefined(credits(value.credits))
  const control = Option.getOrUndefined(spend(value.spend_control))
  return {
    ...(value.plan_type ? { plan_type: value.plan_type } : {}),
    ...(rateLimit ? { rate_limit: rateLimit } : {}),
    additional_rate_limits: limits,
    ...(credit ? { credits: credit } : {}),
    ...(control ? { spend_control: control } : {}),
  }
}
