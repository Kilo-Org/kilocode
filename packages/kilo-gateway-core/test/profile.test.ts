import { expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloProfile } from "../src/index.js"
import { fixture } from "../src/testing.js"

const teams = [
  { id: "first", name: "First" },
  { id: "second", name: "Second" },
]

test("reads nested and flat profile responses", async () => {
  using backend = fixture()
  expect(await Effect.runPromise(KiloProfile.get(backend.url, "token"))).toEqual({
    email: "profile@example.test",
    name: "Fixture",
    organizations: [
      { id: "first", name: "First", role: "member" },
      { id: "selected", name: "Selected", role: "owner" },
    ],
    selectedOrganizationId: "selected",
    hasPersonalAccount: true,
  })
  backend.state.profile = { email: "flat@example.test", selectedOrganizationId: null, hasPersonalAccount: null }
  expect(await Effect.runPromise(KiloProfile.get(backend.url, "token"))).toEqual({
    email: "flat@example.test",
    organizations: [],
  })
  backend.state.profileStatus = 401
  await expect(Effect.runPromise(KiloProfile.get(backend.url, "token"))).rejects.toThrow("Invalid token")
})

test("classifies profile failures like catalog failures", async () => {
  using backend = fixture()
  const reason = async () => (await Effect.runPromise(Effect.flip(KiloProfile.get(backend.url, "token")))).reason
  backend.state.profileStatus = 403
  expect(await reason()).toEqual({ kind: "unauthorized", status: 403 })
  backend.state.profileStatus = 502
  expect(await reason()).toEqual({ kind: "http", status: 502 })
  backend.state.profileStatus = 200
  backend.state.profile = { organizations: "invalid" }
  expect(await reason()).toEqual({ kind: "schema" })
  const offline = fixture()
  offline[Symbol.dispose]()
  expect((await Effect.runPromise(Effect.flip(KiloProfile.get(offline.url, "token")))).reason).toEqual({ kind: "network" })
})

test("fetches balance from the API root of an organization-scoped token server", async () => {
  using backend = fixture()
  expect(
    await Effect.runPromise(KiloProfile.balance(`${backend.url}/api/organizations/selected`, "token", "selected")),
  ).toEqual({ balance: 42.5, isDepleted: false })
  expect(backend.requests).toEqual([
    {
      method: "GET",
      path: "/api/profile/balance",
      authorization: "Bearer token",
      organizationID: "selected",
    },
  ])
})

test("selects the default team like v1", () => {
  const profile = { email: "a@example.test", organizations: teams }
  expect(KiloProfile.defaultOrganizationID({ ...profile, selectedOrganizationId: "second" })).toBe("second")
  // A selected team that the account no longer belongs to is ignored.
  expect(KiloProfile.defaultOrganizationID({ ...profile, selectedOrganizationId: "missing" })).toBeNull()
  expect(KiloProfile.defaultOrganizationID(profile)).toBeNull()
  expect(KiloProfile.defaultOrganizationID({ ...profile, hasPersonalAccount: false })).toBe("first")
  expect(
    KiloProfile.defaultOrganizationID({ ...profile, hasPersonalAccount: false, selectedOrganizationId: "second" }),
  ).toBe("second")
  expect(
    KiloProfile.defaultOrganizationID({ ...profile, hasPersonalAccount: false, selectedOrganizationId: "missing" }),
  ).toBe("first")
  expect(
    KiloProfile.defaultOrganizationID({ email: "a@example.test", organizations: [], hasPersonalAccount: false }),
  ).toBeNull()
})
