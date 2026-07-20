import { Schema } from "effect"

const NumberField = Schema.Finite
const IntegerField = Schema.Int

export const ModelRemains = Schema.Struct({
  model_name: Schema.String,
  current_interval_total_count: Schema.optional(IntegerField),
  current_interval_usage_count: Schema.optional(IntegerField),
  start_time: Schema.optional(IntegerField),
  end_time: Schema.optional(IntegerField),
  remains_time: Schema.optional(IntegerField),
  interval_boost_permill: Schema.optional(IntegerField),
  interval_boost_permille: Schema.optional(IntegerField),
  current_interval_remaining_percent: Schema.optional(NumberField),
  current_interval_status: Schema.optional(IntegerField),
  current_weekly_total_count: Schema.optional(IntegerField),
  current_weekly_usage_count: Schema.optional(IntegerField),
  weekly_start_time: Schema.optional(IntegerField),
  weekly_end_time: Schema.optional(IntegerField),
  weekly_remains_time: Schema.optional(IntegerField),
  weekly_boost_permill: Schema.optional(IntegerField),
  weekly_boost_permille: Schema.optional(IntegerField),
  current_weekly_remaining_percent: Schema.optional(NumberField),
  current_weekly_status: Schema.optional(IntegerField),
}).annotate({ identifier: "MiniMaxModelRemains" })
export type ModelRemains = typeof ModelRemains.Type

export const Native = Schema.Struct({
  base_resp: Schema.Struct({ status_code: IntegerField }),
  model_remains: Schema.Array(ModelRemains),
}).annotate({ identifier: "MiniMaxNativeUsage" })
export type Native = typeof Native.Type

export const decode = Schema.decodeUnknownSync(Native)
