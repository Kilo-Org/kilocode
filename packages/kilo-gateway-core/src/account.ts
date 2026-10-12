export * as KiloAccount from "./account.js"

import { KiloServer } from "./server.js"

/** The key that signed-out requests send. The Gateway serves free models to it. */
export const ANONYMOUS_KEY = "anonymous"

export interface Info {
  readonly token: string
  readonly server: string
  /** `null` is the personal account. */
  readonly organizationID: string | null
}

/**
 * The account a stored token belongs to. Applies the v1 order: a server in the token wins over the
 * login server, and `KILO_ORG_ID` wins over the stored team.
 */
export function resolve(
  input: { readonly token: string; readonly server?: string; readonly organizationID?: string | null },
  env: Record<string, string | undefined> = process.env,
): Info {
  return {
    token: input.token,
    server: KiloServer.fromToken(input.token) ?? (input.server ? KiloServer.normalize(input.server) : KiloServer.fromEnv(env)),
    organizationID: env.KILO_ORG_ID || input.organizationID || null,
  }
}
