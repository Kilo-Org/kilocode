import { expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { defaultOrganizationID, deviceAuth, fetchProfile, serverUrl } from "../src/index.js"
import { fixture } from "./fixture.js"

function connect(url: string) {
  return Effect.gen(function* () {
    const authorization = yield* deviceAuth({ server: url, pollIntervalMs: 1 }).authorize({})
    expect(authorization.mode).toBe("auto")
    expect(authorization.instructions).toContain("fixture/code")
    expect(authorization.expiresAt).toBeGreaterThan(Date.now())
    if (authorization.mode !== "auto") throw new Error("Expected automatic device authorization")
    return yield* authorization.callback
  }).pipe(Effect.scoped, Effect.runPromise)
}

test("device authorization uses the real protocol and retains selected account metadata", async () => {
  using backend = fixture()
  const credential = await connect(backend.url)
  expect(credential).toMatchObject({
    type: "oauth",
    methodID: "device",
    refresh: "fixture-token",
    access: "fixture-token",
    expires: 0,
    metadata: {
      server: backend.url,
      email: "profile@example.test",
      name: "Fixture",
      organizationID: "selected",
      organizationName: "Selected",
      selectedOrganizationId: "selected",
      hasPersonalAccount: true,
    },
  })
  expect(credential.metadata?.organizations).toHaveLength(2)
  expect(backend.requests.map((item) => [item.method, item.path])).toEqual([
    ["POST", "/api/device-auth/codes"],
    ["GET", "/api/device-auth/codes/fixture%2Fcode"],
    ["GET", "/api/device-auth/codes/fixture%2Fcode"],
    ["GET", "/api/profile"],
  ])
  expect(backend.requests[0].body).toBe("")
  expect(backend.requests[0].authorization).toBeNull()
  expect(backend.requests.at(-1)?.authorization).toBe("Bearer fixture-token")
  const registration = deviceAuth({ server: backend.url })
  expect(registration.refresh).toBeUndefined()
  expect(registration.label?.(credential)).toBe("Selected")
})

test("flat profiles preserve explicit personal selection even with organizations", async () => {
  using backend = fixture()
  backend.state.profile = {
    email: "personal@example.test",
    organizations: [{ id: "team", name: "Team" }],
    selectedOrganizationId: null,
    hasPersonalAccount: true,
  }
  const profile = await Effect.runPromise(fetchProfile(backend.url, "fixture-token"))
  expect(profile.selectedOrganizationId).toBeNull()
  const credential = await connect(backend.url)
  expect(credential.metadata?.organizationID).toBeNull()
  expect(credential.metadata).not.toHaveProperty("organizationName")
  expect(deviceAuth().label?.(credential)).toBe("personal@example.test")
})

test("org-only ambiguity fails rather than selecting the first organization", async () => {
  using backend = fixture()
  backend.state.profile = {
    organizations: [
      { id: "first", name: "First" },
      { id: "second", name: "Second" },
    ],
    hasPersonalAccount: false,
  }
  await expect(connect(backend.url)).rejects.toThrow("ambiguous")
})

test("sole organization is the only available org-only default", () => {
  expect(defaultOrganizationID({ organizations: [{ id: "only", name: "Only" }], hasPersonalAccount: false })).toBe(
    "only",
  )
  expect(() => defaultOrganizationID({ organizations: [], hasPersonalAccount: false })).toThrow("ambiguous")
  expect(() => defaultOrganizationID({ organizations: [], selectedOrganizationId: "missing" })).toThrow("not available")
  expect(() =>
    defaultOrganizationID({ organizations: [], selectedOrganizationId: null, hasPersonalAccount: false }),
  ).toThrow("no personal account")
})

test("missing profile email uses the actual device email", async () => {
  using backend = fixture()
  backend.state.profile = { organizations: [], hasPersonalAccount: true }
  expect((await connect(backend.url)).metadata?.email).toBe("device@example.test")
})

for (const [status, message] of [
  [403, "denied"],
  [410, "expired"],
] as const) {
  test(`poll HTTP ${status} fails without creating a credential`, async () => {
    using backend = fixture()
    backend.state.pollStatus = status
    await expect(connect(backend.url)).rejects.toThrow(message)
    expect(backend.requests.some((item) => item.path === "/api/profile")).toBe(false)
  })
}

for (const status of [401, 403, 500]) {
  test(`profile HTTP ${status} is not silently treated as a personal account`, async () => {
    using backend = fixture()
    backend.state.profileStatus = status
    await expect(connect(backend.url)).rejects.toThrow(status === 500 ? "HTTP 500" : "authentication expired")
  })
}

test("rate limiting and malformed approval errors do not expose response secrets", async () => {
  using backend = fixture()
  backend.state.createStatus = 429
  await expect(connect(backend.url)).rejects.toThrow("Too many pending")
  backend.state.createStatus = 200
  backend.state.approved = { status: "approved", token: "fixture-response-secret", userEmail: 42 }
  const failure = await connect(backend.url).catch(String)
  expect(failure).toContain("Invalid Kilo response")
  expect(failure).not.toContain("fixture-response-secret")
})

test("pending authorization expires locally and cancellation stops polling", async () => {
  using backend = fixture()
  backend.state.pending = Number.MAX_SAFE_INTEGER
  backend.state.expiresIn = 0.02
  await expect(connect(backend.url)).rejects.toThrow("expired")
  backend.state.expiresIn = 60
  await Effect.runPromise(
    Effect.gen(function* () {
      const authorization = yield* deviceAuth({ server: backend.url, pollIntervalMs: 1000 }).authorize({})
      if (authorization.mode !== "auto") throw new Error("Expected automatic authorization")
      const fiber = yield* authorization.callback.pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Effect.sleep(10)
      yield* Fiber.interrupt(fiber)
      const count = backend.requests.length
      yield* Effect.sleep(20)
      expect(backend.requests).toHaveLength(count)
    }).pipe(Effect.scoped),
  )
})

test("validates API and verification URLs without making external requests", async () => {
  expect(serverUrl()).toBe("https://api.kilo.ai")
  expect(serverUrl("https://example.test/prefix///")).toBe("https://example.test/prefix")
  expect(serverUrl("http://localhost:3000/")).toBe("http://localhost:3000")
  expect(serverUrl("http://[::1]:3000/")).toBe("http://[::1]:3000")
  for (const input of [
    "http://example.test",
    "ftp://example.test",
    "https://user:secret@example.test",
    "https://example.test/?token=x",
    "https://example.test/#x",
  ]) {
    expect(() => serverUrl(input)).toThrow()
  }
  using backend = fixture()
  await expect(Effect.runPromise(fetchProfile("ftp://127.0.0.1", "fixture-token"))).rejects.toThrow("HTTPS")
  await expect(Effect.runPromise(fetchProfile(`${backend.url}?token=fixture-token`, "fixture-token"))).rejects.toThrow(
    "query or fragment",
  )
  backend.state.verificationUrl = "javascript:alert(1)"
  await expect(connect(backend.url)).rejects.toThrow("HTTPS")
  expect(backend.requests).toHaveLength(1)
  expect(() => deviceAuth({ pollIntervalMs: 0 })).toThrow("positive")
})
