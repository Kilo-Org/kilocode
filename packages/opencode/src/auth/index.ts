import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { zod } from "@/util/effect-zod"
import { NonNegativeInt } from "@/util/schema"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Telemetry } from "@kilocode/kilo-telemetry" // kilocode_change
import { makeRuntime } from "@/effect/run-service" // kilocode_change
import { Filesystem } from "@/util/filesystem" // kilocode_change - atomic writes for auth.json

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export const Info = Object.assign(_Info, { zod: zod(_Info) })
export type Info = Schema.Schema.Type<typeof _Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.KILO_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.KILO_AUTH_CONTENT)
        } catch (err) {}
      }

      // kilocode_change start - fail loud on read/parse errors so Auth.set/remove
      // never silently truncate a corrupted file and wipe valid credentials.
      // Only a genuine "file not found" maps to an empty record; every other
      // error (EACCES, EBUSY, EIO, truncated JSON, …) propagates.
      const text = yield* fsys.readFileString(file).pipe(
        Effect.matchEffect({
          onFailure: (cause) =>
            (cause as { reason?: { _tag?: string } })?.reason?._tag === "NotFound"
              ? Effect.succeed(null)
              : Effect.fail(fail("Failed to read auth data")(cause)),
          onSuccess: (value) => Effect.succeed(value),
        }),
      )
      if (text === null) return {} as Record<string, Info>
      const data = yield* Effect.try({
        try: () => JSON.parse(text) as Record<string, unknown>,
        catch: fail("Failed to parse auth data"),
      })
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
      // kilocode_change end
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    // kilocode_change start - atomic write via temp-file + rename so a crashed
    // process (OS sleep, extension reload, kill) can never leave auth.json
    // half-written. Without this, the next Auth.all() read fails, is silently
    // swallowed, and Auth.set rewrites the file with only the new entry —
    // effectively logging every other provider out.
    const writeAtomic = (data: unknown) =>
      Effect.tryPromise({
        try: () => Filesystem.writeJson(file, data, 0o600),
        catch: (cause) => new AuthError({ message: "Failed to write auth data", cause }),
      })
    // kilocode_change end

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* writeAtomic({ ...data, [norm]: info }) // kilocode_change
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* writeAtomic(data) // kilocode_change

      // kilocode_change start - Track logout and reset telemetry identity for Kilo
      if (key === "kilo") {
        yield* Effect.promise(() => Telemetry.updateIdentity(null))
      }
      Telemetry.trackAuthLogout(key)
      // kilocode_change end
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

// kilocode_change start - legacy promise helpers for Kilo callsites
const { runPromise } = makeRuntime(Service, defaultLayer)
export const get = (providerID: string) => runPromise((svc) => svc.get(providerID))
export const all = () => runPromise((svc) => svc.all())
export const set = (key: string, info: Info) => runPromise((svc) => svc.set(key, info))
export const remove = (key: string) => runPromise((svc) => svc.remove(key))
// kilocode_change end

export * as Auth from "."
