import { describe, expect, test } from "bun:test"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { accountAction, readProfile, type ProfileRpc } from "../webview-ui/src/v2/profile-account"

const account = (organizationID: string | null) => ({ profile: { organizationID } })
const shown = (organizationID: string | null) => account(organizationID)

const profile: KiloGatewayRpc.Profile = {
  email: "user@example.test",
  name: "Test User",
  organizations: [],
  hasPersonalAccount: true,
  organizationID: null,
}

function mockRpc(overrides: Partial<ProfileRpc> = {}): ProfileRpc {
  return {
    authStatus: async () => ({ authenticated: true, organizationID: null, server: "https://api.kilo.ai", method: "oauth" }),
    profile: async () => profile,
    balance: async () => ({ balance: 4.25 }),
    kiloPass: async () => null,
    ...overrides,
  }
}

describe("accountAction", () => {
  test("reloads the account after a sign-in", () => {
    expect(accountAction(null, { authenticated: true, organizationID: "selected" }, false)).toBe("refresh")
  })

  test("keeps the shown account while the reading still matches it", () => {
    expect(accountAction(shown("selected"), { authenticated: true, organizationID: "selected" }, false)).toBe("none")
  })

  test("reloads a stale account when provider.updated confirms authentication", () => {
    expect(
      accountAction(shown("selected"), { authenticated: true, organizationID: "selected" }, false, "unavailable"),
    ).toBe("refresh")
  })

  test("reloads the account after a team switch in another client", () => {
    expect(accountAction(shown("selected"), { authenticated: true, organizationID: "first" }, false)).toBe("refresh")
  })

  test("keeps the account through the signed-out reading the Gateway publishes before a reload", () => {
    expect(accountAction(shown("selected"), { authenticated: false, organizationID: null }, false)).toBe("hold")
    // A token refresh, a retry, or a team switch can publish several of these readings.
    expect(accountAction(shown("selected"), undefined, false)).toBe("hold")
  })

  test("clears the account when the next reading also reports signed out", () => {
    expect(accountAction(shown("selected"), { authenticated: false, organizationID: null }, true)).toBe("clear")
    expect(accountAction(shown("selected"), undefined, true)).toBe("clear")
  })

  test("clears an expired or unavailable status when a real sign-out follows", () => {
    expect(accountAction(null, { authenticated: false, organizationID: null }, false, "expired")).toBe("hold")
    expect(accountAction(null, { authenticated: false, organizationID: null }, true, "expired")).toBe("clear")
    expect(accountAction(null, { authenticated: false, organizationID: null }, false, "unavailable")).toBe("hold")
    expect(accountAction(null, { authenticated: false, organizationID: null }, true, "unavailable")).toBe("clear")
  })

  test("does nothing before the first read or after a shown sign-out", () => {
    expect(accountAction(undefined, undefined, false)).toBe("none")
    expect(accountAction(null, { authenticated: false, organizationID: null }, false)).toBe("none")
    expect(accountAction(null, undefined, true)).toBe("none")
  })
})

describe("readProfile", () => {
  test("returns ok with profile, balance and kiloPass", async () => {
    expect(await readProfile(mockRpc())).toEqual({
      kind: "ok",
      data: { profile, balance: { balance: 4.25 }, kiloPass: null },
    })
  })

  test("returns signedOut when nobody is signed in", async () => {
    expect(
      await readProfile(
        mockRpc({
          authStatus: async () => ({ authenticated: false, organizationID: null, server: "https://api.kilo.ai" }),
        }),
      ),
    ).toEqual({ kind: "signedOut" })
  })

  test("returns expired when a stored OAuth login is rejected with unauthorized", async () => {
    expect(
      await readProfile(
        mockRpc({
          profile: async () => {
            throw { type: "unauthorized", message: "Invalid token" }
          },
        }),
      ),
    ).toEqual({ kind: "expired" })
  })

  test("returns signedOut if the OAuth login was removed before the second authStatus check", async () => {
    let calls = 0
    expect(
      await readProfile(
        mockRpc({
          authStatus: async () =>
            calls++ === 0
              ? { authenticated: true, organizationID: null, server: "https://api.kilo.ai", method: "oauth" }
              : { authenticated: false, organizationID: null, server: "https://api.kilo.ai" },
          profile: async () => {
            throw { type: "unauthorized", message: "Not signed in" }
          },
        }),
      ),
    ).toEqual({ kind: "signedOut" })
  })

  test("does not call a stored API key or env login expired on unauthorized", async () => {
    for (const method of ["key", undefined] as const) {
      expect(
        await readProfile(
          mockRpc({
            authStatus: async () => ({
              authenticated: true,
              organizationID: null,
              server: "https://api.kilo.ai",
              ...(method ? { method } : {}),
            }),
            profile: async () => {
              throw { type: "unauthorized", message: "Invalid token" }
            },
          }),
        ),
      ).toEqual({ kind: "signedOut" })
    }
  })

  test("returns unavailable when rpc.profile fails with failed or throws", async () => {
    expect(
      await readProfile(
        mockRpc({
          profile: async () => {
            throw { type: "failed", message: "Profile fetch failed with status 500" }
          },
        }),
      ),
    ).toEqual({ kind: "unavailable" })

    expect(
      await readProfile(
        mockRpc({
          profile: async () => {
            throw new TypeError("fetch failed")
          },
        }),
      ),
    ).toEqual({ kind: "unavailable" })
  })

  test("returns unavailable when rpc.authStatus throws a transport error", async () => {
    expect(
      await readProfile(
        mockRpc({
          authStatus: async () => {
            throw new TypeError("fetch failed")
          },
        }),
      ),
    ).toEqual({ kind: "unavailable" })
  })
})
