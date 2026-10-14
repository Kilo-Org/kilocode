export * as KiloAccount from "./account.js"

import { Schema } from "effect"
import { KiloServer } from "./server.js"

export const ANONYMOUS_KEY = "anonymous"

export interface Input {
  readonly token: string
  readonly server?: string
  readonly organizationID?: string | null
}

export interface Info {
  readonly token: string
  readonly server: string
  readonly organizationID: string | null
}

const AuthContent = Schema.Struct({
  kilo: Schema.optional(
    Schema.Struct({
      key: Schema.optional(Schema.String),
      access: Schema.optional(Schema.String),
      accountId: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
})
const decodeAuthContent = Schema.decodeUnknownOption(Schema.fromJsonString(AuthContent))

// Reads a token from the environment in v1 and cloud-consumer priority order:
// KILO_API_KEY > KILOCODE_TOKEN > KILO_AUTH_CONTENT.
export function envToken(env: Record<string, string | undefined> = process.env): Input | undefined {
  const direct = env.KILO_API_KEY || env.KILOCODE_TOKEN
  if (direct) return { token: direct }
  const raw = env.KILO_AUTH_CONTENT
  if (!raw) return undefined
  const parsed = decodeAuthContent(raw)
  if (parsed._tag === "None") return undefined
  const kilo = parsed.value.kilo
  const token = kilo?.key || kilo?.access
  if (!token) return undefined
  return { token, organizationID: kilo?.accountId ?? null }
}

// Server order: token-embedded URL (v1 `auth/token.ts`), then login server, then KILO_API_URL.
// Team order: KILO_ORG_ID, then selected or login team, then personal account.
export function resolve(input: Input, env: Record<string, string | undefined> = process.env): Info {
  const server = KiloServer.fromToken(input.token) ?? (input.server ? KiloServer.normalize(input.server) : KiloServer.fromEnv(env))
  return {
    token: input.token,
    server,
    organizationID: env.KILO_ORG_ID || input.organizationID || null,
  }
}
