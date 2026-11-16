export * as KiloAccount from "./account.js"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Option, Schema } from "effect"
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
  readonly baseURL: string
  readonly organizationID: string | null
}

const AuthContent = Schema.Struct({
  kilo: Schema.optional(
    Schema.Struct({
      type: Schema.optional(Schema.String),
      key: Schema.optional(Schema.String),
      access: Schema.optional(Schema.String),
      accountId: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
})
const decodeAuthContent = Schema.decodeUnknownOption(Schema.fromJsonString(AuthContent))

// Direct headless credentials override the saved credential, including KILO_AUTH_CONTENT.
export function envToken(env: Record<string, string | undefined> = process.env): Input | undefined {
  const direct = env.KILO_API_KEY || env.KILOCODE_TOKEN
  return direct ? { token: direct } : undefined
}

// A valid auth-content override replaces the saved store, including when it has no Kilo entry.
// `undefined` means no override; `null` means the replacement store has no usable Kilo credential.
export function authContent(env: Record<string, string | undefined> = process.env): Input | null | undefined {
  const raw = env.KILO_AUTH_CONTENT
  if (!raw) return undefined
  const parsed = decodeAuthContent(raw)
  if (parsed._tag === "None") return undefined
  const kilo = parsed.value.kilo
  const token = kilo?.type === "oauth" ? kilo.access : (kilo?.key ?? kilo?.access)
  if (token === undefined) return null
  return { token, ...(kilo?.accountId !== undefined ? { organizationID: kilo.accountId } : {}) }
}

/**
 * The team of the Kilo v1 login on this machine: its `auth.json` in `<XDG data>/kilo`, beside the kilo2 data directory
 * `data` (the same directory once the release renames it). The file is only read. A team ID, `null` for the personal
 * account (an OAuth login without a team), or undefined without a v1 OAuth login.
 */
export function v1Organization(data: string): Effect.Effect<string | null | undefined> {
  return Effect.promise(() =>
    readFile(path.join(path.dirname(data), "kilo", "auth.json"), "utf8").catch(() => undefined),
  ).pipe(
    Effect.map((content) => {
      const kilo = content === undefined ? undefined : Option.getOrUndefined(decodeAuthContent(content))?.kilo
      if (kilo?.type !== "oauth" || !kilo.access) return undefined
      return kilo.accountId ?? null
    }),
  )
}

// The caller supplies saved/config precedence. A token URL overrides the server, but cannot silently change a
// selected organization. `null` is an explicit personal selection, not a missing selection.
export function resolve(input: Input, env: Record<string, string | undefined> = process.env): Info {
  const tokenServer = KiloServer.fromToken(input.token)
  const baseURL = tokenServer ?? (input.server ? KiloServer.normalize(input.server) : KiloServer.aiGatewayFromEnv(env))
  const tokenOrg = KiloServer.organizationFromUrl(baseURL)
  return {
    token: input.token,
    server: KiloServer.apiBase(baseURL, env),
    baseURL,
    organizationID: env.KILO_ORG_ID || (input.organizationID !== undefined ? input.organizationID : tokenOrg || null),
  }
}

export function compatible(account: Info) {
  const organizationID = KiloServer.organizationFromUrl(account.baseURL)
  return !organizationID || organizationID === account.organizationID
}
