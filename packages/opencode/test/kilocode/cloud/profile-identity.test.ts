import { Auth } from "@/auth"
import { ProfileIdentity } from "@/kilocode/cloud/profile-identity"
import { expect } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import { testEffect } from "../../lib/effect"

const state: { info: Auth.Info | undefined } = { info: new Auth.Api({ type: "api", key: "stored-token" }) }
const auth = Layer.mock(Auth.Service)({
  get: (id: string) => Effect.succeed(id === "kilo" ? state.info : undefined),
})
const it = testEffect(auth)

/** A local origin that answers `GET /api/profile` with the supplied handler. */
function serve(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler })
  return {
    env: { KILO_API_URL: server.url.origin } as Record<string, string | undefined>,
    stop: () => server.stop(true),
  }
}

it.effect("reads a non-UUID OAuth user id", () => {
  const app = serve(() => Response.json({ user: { id: "oauth/account-123" } }))
  return Effect.gen(function* () {
    const id = yield* ProfileIdentity.read(app.env)
    expect(id).toBe("oauth/account-123")
  }).pipe(Effect.ensuring(Effect.sync(app.stop)))
})

it.effect("fails closed on a malformed body", () => {
  const app = serve(() => Response.json({ user: {} }))
  return Effect.gen(function* () {
    const error = yield* ProfileIdentity.read(app.env).pipe(Effect.flip)
    expect(error.kind).toBe("invalid")
  }).pipe(Effect.ensuring(Effect.sync(app.stop)))
})

it.effect("fails signed_out on a 401", () => {
  const app = serve(() => new Response(null, { status: 401 }))
  return Effect.gen(function* () {
    const error = yield* ProfileIdentity.read(app.env).pipe(Effect.flip)
    expect(error.kind).toBe("signed_out")
  }).pipe(Effect.ensuring(Effect.sync(app.stop)))
})

it.effect("reports unavailable when the profile is unreachable", () => {
  const app = serve(() => new Response(null, { status: 503 }))
  return Effect.gen(function* () {
    const error = yield* ProfileIdentity.read(app.env).pipe(Effect.flip)
    expect(error.kind).toBe("unavailable")
  }).pipe(Effect.ensuring(Effect.sync(app.stop)))
})

it.effect("uses the exact pinned bearer instead of the stored credential", () => {
  const seen: string[] = []
  const app = serve((request) => {
    seen.push(request.headers.get("authorization") ?? "")
    return Response.json({ user: { id: "oauth/account-123" } })
  })
  return Effect.gen(function* () {
    const id = yield* ProfileIdentity.read(app.env, Redacted.make("pinned-token"))
    expect(id).toBe("oauth/account-123")
    expect(seen).toEqual(["Bearer pinned-token"])
  }).pipe(Effect.ensuring(Effect.sync(app.stop)))
})
