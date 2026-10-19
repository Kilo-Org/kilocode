import { expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { KiloDevice } from "../src/index.js"
import { fixture } from "../src/testing.js"

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

test("retries temporary poll failures until the user approves", async () => {
  using backend = fixture()
  backend.state.pollErrors = [503, 429, 408, 500]
  expect((await login(backend.url)).token).toBe("fixture-token")
  expect(backend.requests.filter((item) => item.path === "/api/device-auth/codes/ABCD-1234")).toHaveLength(6)
})

test("ends at the code expiry when the Gateway keeps failing or never answers", async () => {
  using backend = fixture()
  backend.state.expiresIn = 0.05
  backend.state.pending = Number.MAX_SAFE_INTEGER
  await expect(login(backend.url)).rejects.toThrow("expired")

  backend.state.pollErrors = Array(1000).fill(503)
  await expect(login(backend.url)).rejects.toThrow("expired")

  backend.state.hang = true
  const started = Date.now()
  await expect(login(backend.url)).rejects.toThrow("expired")
  // The request timeout follows the remaining code lifetime, so a hung request cannot outlive the code.
  expect(Date.now() - started).toBeLessThan(1000)
})

test("stops polling when interrupted", async () => {
  using backend = fixture()
  backend.state.pending = Number.MAX_SAFE_INTEGER
  await Effect.runPromise(
    Effect.gen(function* () {
      const code = yield* KiloDevice.start(backend.url)
      const fiber = yield* KiloDevice.login(backend.url, code, 1).pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Effect.sleep(30)
      // With a 1 ms interval, a loop that survived the interruption would add requests below.
      expect(backend.requests.length).toBeGreaterThan(3)
      yield* Fiber.interrupt(fiber)
      yield* Effect.sleep(10)
      const count = backend.requests.length
      yield* Effect.sleep(50)
      expect(backend.requests).toHaveLength(count)
    }).pipe(Effect.scoped),
  )
})
