import { describe, expect, test } from "bun:test"
import { login } from "../script/cli-login"

describe("login", () => {
  test("maps an OAuth login to a device credential with the selected organization", () => {
    expect(
      login({
        kilo: {
          type: "oauth",
          access: "access-token",
          refresh: "refresh-token",
          expires: 4102444800000,
          accountId: "team-1",
        },
      }),
    ).toEqual({
      id: "cred_kilo_cli",
      integrationID: "kilo",
      label: "Kilo CLI login",
      active: true,
      value: {
        type: "oauth",
        methodID: "device",
        access: "access-token",
        refresh: "refresh-token",
        expires: 4102444800000,
        metadata: { organizationID: "team-1" },
      },
    })
  })

  test("maps an API key login and keeps a personal selection", () => {
    expect(login({ kilo: { type: "api", key: "api-key", accountId: null } })?.value).toEqual({
      type: "key",
      key: "api-key",
      metadata: { organizationID: null },
    })
  })

  test("reuses the access token as the refresh token when the file has none", () => {
    expect(login({ kilo: { type: "oauth", access: "access-token" } })?.value.refresh).toBe("access-token")
  })

  test("ignores auth files without a usable Kilo login", () => {
    expect(login(undefined)).toBeUndefined()
    expect(login({ openai: { type: "oauth", access: "x" } })).toBeUndefined()
    expect(login({ kilo: { type: "oauth" } })).toBeUndefined()
    expect(login({ kilo: { type: "api" } })).toBeUndefined()
  })
})
