import { describe, expect, test } from "bun:test"
import { resolveCurrentOrganizationId } from "../../src/api/profile"

const profile = {
  email: "member@example.com",
  organizations: [
    { id: "child-one", name: "Child One", role: "member" },
    { id: "child-two", name: "Child Two", role: "member" },
  ],
}

describe("resolveCurrentOrganizationId", () => {
  test("keeps an organization returned by the profile", () => {
    expect(resolveCurrentOrganizationId(profile, "child-two")).toBe("child-two")
  })

  test("clears an organization omitted from the profile", () => {
    expect(resolveCurrentOrganizationId(profile, "parent")).toBeNull()
  })

  test("keeps personal account selection", () => {
    expect(resolveCurrentOrganizationId(profile, null)).toBeNull()
  })

  test("clears an organization when the user has no organizations", () => {
    expect(resolveCurrentOrganizationId({ email: "member@example.com" }, "former-organization")).toBeNull()
  })
})
