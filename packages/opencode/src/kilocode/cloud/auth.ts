import { Auth } from "@/auth"
import { Effect, Redacted, Schema } from "effect"
import z from "zod"

export namespace CloudAuth {
  export type Environment = Readonly<Record<string, string | undefined>>

  export interface Input {
    readonly orgID?: string
    readonly env?: Environment
  }

  export interface Resolved {
    readonly token: Redacted.Redacted
    readonly organizationID?: string
  }

  export class ResolutionError extends Schema.TaggedErrorClass<ResolutionError>()("CloudAuthResolutionError", {
    kind: Schema.Literals(["missing", "organization"]),
    message: Schema.String,
  }) {}

  const Uuid = z.uuid()

  const credentials = Effect.fn("CloudAuth.credentials")(function* (env: Environment) {
    const service = yield* Auth.Service
    const info = yield* service.get("kilo")
    const stored = info?.type === "api" ? info.key.trim() : info?.type === "oauth" ? info.access.trim() : undefined
    const fallback = env.KILO_API_KEY?.trim()
    const value = stored || fallback
    if (!value) {
      return yield* Effect.fail(
        new ResolutionError({
          kind: "missing",
          message: "Kilo credentials are required; run `kilo auth login`",
        }),
      )
    }
    return { token: Redacted.make(value), accountID: info?.type === "oauth" ? info.accountId : undefined }
  })

  export const token = Effect.fn("CloudAuth.token")(function* (env: Environment = process.env) {
    return (yield* credentials(env)).token
  })

  export const resolve = Effect.fn("CloudAuth.resolve")(function* (input: Input = {}) {
    const env = input.env ?? process.env
    const auth = yield* credentials(env)
    const explicit = input.orgID
    const setting = env.KILO_ORG_ID?.trim()
    const organizationID = explicit !== undefined ? explicit : setting || auth.accountID
    if (organizationID !== undefined && !Uuid.safeParse(organizationID).success) {
      return yield* Effect.fail(
        new ResolutionError({
          kind: "organization",
          message: "Kilo organization ID must be a valid UUID",
        }),
      )
    }

    return {
      token: auth.token,
      ...(organizationID ? { organizationID } : {}),
    } satisfies Resolved
  })
}
