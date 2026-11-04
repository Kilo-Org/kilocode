import { describe, expect, test } from "bun:test"
import { accountAction } from "../webview-ui/src/v2/profile-account"

const account = (organizationID: string | null) => ({ profile: { organizationID } })
const shown = (organizationID: string | null) => account(organizationID)

describe("accountAction", () => {
  test("reloads the account after a sign-in", () => {
    expect(accountAction(null, { authenticated: true, organizationID: "selected" }, false)).toBe("refresh")
  })

  test("keeps the shown account while the reading still matches it", () => {
    expect(accountAction(shown("selected"), { authenticated: true, organizationID: "selected" }, false)).toBe("none")
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

  test("does nothing before the first read or after a shown sign-out", () => {
    expect(accountAction(undefined, undefined, false)).toBe("none")
    expect(accountAction(null, { authenticated: false, organizationID: null }, false)).toBe("none")
    expect(accountAction(null, undefined, true)).toBe("none")
  })
})
