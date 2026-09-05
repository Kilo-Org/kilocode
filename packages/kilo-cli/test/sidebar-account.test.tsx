import { expect, test } from "bun:test"
import type { KiloGatewayAccount } from "@kilocode/client"
import { accountRequestIdentity, creditLabel, currency, renewal } from "../src/tui-plugin/sidebar-account"

const account: KiloGatewayAccount = {
  currentOrganizationID: "fixture-team",
  selectionAvailable: true,
  profile: {
    organizations: [{ id: "fixture-team", name: "Fixture team" }],
  },
}

test("sidebar labels and request identities retain their account scope", () => {
  expect(creditLabel({ ...account, currentOrganizationID: null }, false)).toBe("Personal credits")
  expect(creditLabel(account, true)).toBe("Team credits")
  expect(currency(0)).toBe("$0.00")
  expect(renewal("2026-10-01T00:00:00.000Z")).toBe("Oct 1")
  expect(renewal("not-a-date")).toBeUndefined()
  expect(accountRequestIdentity(account, 1, "session", { directory: "/fixture" })).not.toBe(
    accountRequestIdentity(account, 2, "session", { directory: "/fixture" }),
  )
})
