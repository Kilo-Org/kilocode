import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer, Schema } from "effect"
import { expect } from "bun:test"
import { create } from "../../../src/kilocode/session-hosting/registry"
import { key } from "../../../src/kilocode/session-hosting/types"
import {
  HostedFailure,
  ProviderID,
  type Availability,
  type Provider,
} from "../../../src/kilocode/session-hosting/types"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const SESSION = "ses_00000000000000000000000001"
const brand = (value: string) => Schema.decodeUnknownSync(ProviderID)(value)

function provider(name: string, session: string, options: { default?: boolean; availability?: Availability } = {}) {
  const availability = { current: options.availability ?? ({ state: "available" } as Availability) }
  const value: Provider = {
    id: brand(name),
    ...(options.default === undefined ? {} : { default: options.default }),
    availability: Effect.sync(() => availability.current),
    transport: Effect.succeed({ state: "unknown" }),
    list: () =>
      Effect.succeed({
        items: [
          {
            id: { providerID: brand(name), sessionID: session },
            session: sessionInfo(session, name),
          },
        ],
      }),
    get: (input) => Effect.succeed({ id: input.id, session: sessionInfo(input.id.sessionID, name) }),
    transcript: () => Effect.succeed({ items: [] }),
    start: () => Effect.fail(new HostedFailure({ code: "rejected", message: "unused", retryable: false })),
    attach: (input) => Effect.succeed({ session: input.id, expiresAt: 1 }),
  }
  return { value, availability }
}

function sessionInfo(id: string, title: string) {
  return Schema.decodeUnknownSync(SessionV1.SessionInfo)({
    id,
    slug: id,
    projectID: "project",
    directory: `/work/${title}`,
    title,
    version: "test",
    time: { created: 1, updated: 2 },
  })
}

it.effect("rejects a duplicate provider identity instead of silently shadowing it", () =>
  Effect.sync(() => {
    const a = provider("alpha", SESSION)
    expect(() => create([a.value, a.value])).toThrow("Duplicate session host provider: alpha")
  }),
)

it.effect("keeps two providers with colliding remote session ids isolated", () =>
  Effect.gen(function* () {
    const alpha = provider("alpha", SESSION)
    const beta = provider("beta", SESSION)
    const registry = create([alpha.value, beta.value])

    const first = yield* alpha.value.list()
    const second = yield* beta.value.list()
    expect(key(first.items[0].id)).toBe(`alpha:${SESSION}`)
    expect(key(second.items[0].id)).toBe(`beta:${SESSION}`)

    const a = yield* alpha.value.get({ id: first.items[0].id })
    const b = yield* beta.value.get({ id: second.items[0].id })
    expect(a.session.title).toBe("alpha")
    expect(b.session.title).toBe("beta")

    const fromAlpha = yield* registry.require(brand("alpha"))
    const fromBeta = yield* registry.require(brand("beta"))
    expect(fromAlpha).toBe(alpha.value)
    expect(fromBeta).toBe(beta.value)
    expect(registry.providers.map((item) => String(item.id))).toEqual(["alpha", "beta"])
  }),
)

it.effect("fails an unregistered provider instead of borrowing another provider", () =>
  Effect.gen(function* () {
    const registry = create([provider("alpha", SESSION).value])
    expect(registry.get(brand("missing"))).toBeUndefined()
    const error = yield* registry.require(brand("missing")).pipe(Effect.flip)
    expect(error.code).toBe("unknown_provider")
    expect(error.retryable).toBe(false)
  }),
)

it.effect("selects the default provider only while it is available", () =>
  Effect.gen(function* () {
    const primary = provider("kilo-cloud", SESSION, { default: true })
    const secondary = provider("other", SESSION)
    const registry = create([primary.value, secondary.value])

    expect(String((yield* registry.default)?.id)).toBe("kilo-cloud")

    primary.availability.current = {
      state: "unavailable",
      reason: "signed_out",
      message: "Sign in to Kilo to use cloud sessions",
    }
    expect(yield* registry.default).toBeUndefined()
  }),
)

it.effect("does not promote a non-default provider when the default is unavailable", () =>
  Effect.gen(function* () {
    const primary = provider("kilo-cloud", SESSION, {
      default: true,
      availability: { state: "unavailable", reason: "signed_out", message: "Sign in to Kilo to use cloud sessions" },
    })
    const registry = create([primary.value, provider("other", SESSION).value])
    expect(yield* registry.default).toBeUndefined()
  }),
)
