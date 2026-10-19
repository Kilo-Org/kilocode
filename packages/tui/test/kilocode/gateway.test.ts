import { expect, test } from "bun:test"
import { accountOptions } from "../../src/kilocode/gateway"

const organizations = [
  { id: "acme", name: "Acme", role: "owner" },
  { id: "beta", name: "Beta" },
]

test("lists the personal account and the teams like v1, and marks the current account", () => {
  expect(accountOptions({ email: "a@example.test", organizations, hasPersonalAccount: true, organizationID: null }, "acme"))
    .toEqual([
      { title: "Personal Account", value: null, description: undefined, category: "Accounts" },
      { title: "Acme", value: "acme", description: "→ (current) owner", category: "Teams" },
      { title: "Beta", value: "beta", description: undefined, category: "Teams" },
    ])
  expect(
    accountOptions({ email: "a@example.test", organizations, hasPersonalAccount: true, organizationID: null }, null)[0],
  ).toMatchObject({ title: "Personal Account", description: "→ (current)" })
})

test("hides the personal account for team-only accounts, unless there are no teams", () => {
  const profile = { email: "a@example.test", organizations, hasPersonalAccount: false, organizationID: "beta" }
  expect(accountOptions(profile, "beta").map((option) => option.title)).toEqual(["Acme", "Beta"])
  expect(accountOptions({ ...profile, organizations: [] }, null).map((option) => option.title)).toEqual([
    "Personal Account",
  ])
})
