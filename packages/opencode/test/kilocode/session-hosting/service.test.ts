import { Auth } from "@/auth"
import { SessionHost } from "@/kilocode/session-hosting"
import { Effect, Layer } from "effect"
import { expect } from "bun:test"
import { testEffect } from "../../lib/effect"

const state: { info: Auth.Info | undefined } = { info: new Auth.Api({ type: "api", key: "kilo-token" }) }

const auth = Layer.mock(Auth.Service)({
  get: (id: string) => Effect.succeed(id === "kilo" ? state.info : undefined),
})

const it = testEffect(SessionHost.layer().pipe(Layer.provide(auth)))

it.effect("provides the registry with kilo-cloud as the authenticated default", () =>
  Effect.gen(function* () {
    const host = yield* SessionHost.Service
    expect(host.registry.providers.map((provider) => String(provider.id))).toEqual(["kilo-cloud"])
    expect(String((yield* host.default)?.id)).toBe("kilo-cloud")
  }),
)

it.effect("exposes no default and an actionable provider state when signed out", () =>
  Effect.gen(function* () {
    state.info = undefined
    const host = yield* SessionHost.Service
    expect(yield* host.default).toBeUndefined()
    const provider = host.registry.providers[0]!
    expect(yield* provider.availability).toMatchObject({ state: "unavailable", reason: "signed_out" })
    yield* Effect.sync(() => {
      state.info = new Auth.Api({ type: "api", key: "kilo-token" })
    })
  }),
)
