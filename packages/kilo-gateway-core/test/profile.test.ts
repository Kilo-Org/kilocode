import { expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloProfile } from "../src/index.js"
import { fixture } from "./fixture.js"

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

test("selects the default team like v1", () => {
  const profile = { email: "a@example.test", organizations: teams }
  expect(KiloProfile.defaultOrganizationID({ ...profile, selectedOrganizationId: "second" })).toBe("second")
  // A selected team that the account no longer belongs to is ignored.
  expect(KiloProfile.defaultOrganizationID({ ...profile, selectedOrganizationId: "missing" })).toBeNull()
  expect(KiloProfile.defaultOrganizationID(profile)).toBeNull()
  expect(KiloProfile.defaultOrganizationID({ ...profile, hasPersonalAccount: false })).toBe("first")
  expect(KiloProfile.defaultOrganizationID({ email: "a@example.test", organizations: [], hasPersonalAccount: false })).toBeNull()
})
