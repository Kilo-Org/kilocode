import { expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { KiloDevice } from "../src/index.js"
import { fixture } from "./fixture.js"

const login = (url: string) =>
  Effect.runPromise(
    KiloDevice.start(url).pipe(Effect.flatMap((code) => KiloDevice.login(url, code, 1))),
  )

test("logs in with the device protocol and selects the backend team", async () => {
  using backend = fixture()
  expect(await login(backend.url)).toEqual({
    token: "fixture-token",
    email: "device@example.test",
    organizationID: "selected",
  })
  expect(backend.requests).toEqual([
    { method: "POST", path: "/api/device-auth/codes", authorization: null },
    { method: "GET", path: "/api/device-auth/codes/ABCD-1234", authorization: null },
    { method: "GET", path: "/api/device-auth/codes/ABCD-1234", authorization: null },
    { method: "GET", path: "/api/profile", authorization: "Bearer fixture-token" },
  ])
})

test("starts on the personal account when the profile request fails", async () => {
  using backend = fixture()
  backend.state.profileStatus = 500
  expect((await login(backend.url)).organizationID).toBeNull()
})

for (const [status, body, message] of [
  [403, {}, "denied"],
  [410, {}, "expired"],
  [200, { status: "denied" }, "denied"],
  [200, { status: "approved" }, "Invalid Kilo response"],
] as const) {
  test(`poll HTTP ${status} ${JSON.stringify(body)} fails without a profile request`, async () => {
    using backend = fixture()
    backend.state.pollStatus = status
    backend.state.approved = body
    await expect(login(backend.url)).rejects.toThrow(message)
    expect(backend.requests.some((item) => item.path === "/api/profile")).toBe(false)
  })
}

test("reports rate limits and rejects a verification URL that is not HTTP(S)", async () => {
  using backend = fixture()
  backend.state.createStatus = 429
  await expect(login(backend.url)).rejects.toThrow("Too many pending authorization requests")
  backend.state.createStatus = 200
  backend.state.verificationUrl = "javascript:alert(1)"
  await expect(login(backend.url)).rejects.toThrow("Invalid device verification URL")
})

test("expires locally and stops polling when interrupted", async () => {
  using backend = fixture()
  backend.state.pending = Number.MAX_SAFE_INTEGER
  backend.state.expiresIn = 0.02
  await expect(login(backend.url)).rejects.toThrow("expired")

  backend.state.expiresIn = 60
  await Effect.runPromise(
    Effect.gen(function* () {
      const code = yield* KiloDevice.start(backend.url)
      const fiber = yield* KiloDevice.login(backend.url, code, 1000).pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Effect.sleep(20)
      yield* Fiber.interrupt(fiber)
      const count = backend.requests.length
      yield* Effect.sleep(20)
      expect(backend.requests).toHaveLength(count)
    }).pipe(Effect.scoped),
  )
})
