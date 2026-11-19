export * as HostedManagement from "./hosted-management.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export const Title = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
  Schema.makeFilter((value) => !!value.trim() || "Title cannot be empty"),
)
export const Info = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  model: optional(Schema.String),
  agent: optional(Schema.String),
  totalCostMicrodollars: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}).annotate({ identifier: "KiloHosted.SessionInfo" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Deleted = Schema.Struct({ cleanup: Schema.Literals(["complete", "pending"]) })
