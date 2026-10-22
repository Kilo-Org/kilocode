import { Option, Schema } from "effect"
import { NonNegativeInt } from "../schema"

const OAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
})

const Key = Schema.Struct({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

const Account = Schema.Struct({
  id: Schema.String,
  serviceID: Schema.String,
  description: Schema.String,
  credential: Schema.Union([OAuth, Key]),
})

const Store = Schema.Struct({
  version: Schema.Literal(2),
  accounts: Schema.Record(Schema.String, Account),
  active: Schema.Record(Schema.String, Schema.String),
})

export function parse(input: unknown) {
  const decoded = Schema.decodeUnknownOption(Store)(input)
  if (Option.isNone(decoded)) return []
  const first = new Set<string>()
  return Object.values(decoded.value.accounts).map((account) => {
    const fallback = !first.has(account.serviceID)
    first.add(account.serviceID)
    return {
      id: account.id,
      connectorID: account.serviceID,
      label: account.description,
      credential: account.credential,
      active: decoded.value.active[account.serviceID]
        ? decoded.value.active[account.serviceID] === account.id
        : fallback,
    }
  })
}
