import { describe, expect, test } from "bun:test"
import { accountOptions, usageDetailsUrl } from "../../src/kilocode/gateway"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const location = { directory }
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

test("builds the team usage details URL and falls back to the personal URL", () => {
  expect(usageDetailsUrl("acme")).toBe("https://app.kilo.ai/organizations/acme/usage-details")
  expect(usageDetailsUrl(null)).toBe("https://app.kilo.ai/usage")
  expect(usageDetailsUrl(undefined)).toBe("https://app.kilo.ai/usage")
  expect(usageDetailsUrl("")).toBe("https://app.kilo.ai/usage")
})

function failingGateway(type: "unauthorized" | "failed") {
  return (url: URL) => {
    if (url.pathname === "/api/integration")
      return json({
        location,
        data: [{ id: "kilo", name: "Kilo Gateway", methods: [], connections: [] }],
      })
    if (url.pathname === "/api/rpc/kilocode.privacy/get") return json({ output: { enabled: false } })
    if (url.pathname === "/api/rpc/kilocode.gateway/authStatus")
      return json({ output: { authenticated: true, organizationID: null, server: "https://api.kilo.ai" } })
    if (url.pathname === "/api/rpc/kilocode.gateway/profile")
      return json({ _tag: "RpcError", type, message: type === "unauthorized" ? "Invalid token" : "500" }, { status: 400 })
    if (url.pathname === "/api/rpc/kilocode.gateway/balance") return json({ output: { balance: null } })
    if (url.pathname === "/api/rpc/kilocode.gateway/kiloPass") return json({ output: null })
    if (url.pathname === "/api/rpc/kilocode.gateway/modes") return json({ output: [] })
  }
}

const normalized = (frame: string) => frame.replace(/[┃\s]+/g, " ")

describe("TUI /profile and /teams error handling", () => {
  test("/profile distinguishes a rejected login from an outage", async () => {
    await using rejected = await createAppFixture({ fetch: failingGateway("unauthorized") })
    await rejected.ready
    await rejected.waitForFrame((frame) => frame.includes("ctrl+p commands"))
    await rejected.mockInput.typeText("/profile")
    await rejected.waitForFrame((frame) => frame.includes("View your Kilo Gateway profile"))
    rejected.mockInput.pressEnter()
    await rejected.waitForFrame((frame) => normalized(frame).includes("Kilo did not accept your login"))
    expect(normalized(rejected.captureCharFrame())).toContain(
      "Kilo did not accept your login. It may have expired or been revoked. Run /connect or `kilo auth login` to sign in again.",
    )

    await using outage = await createAppFixture({ fetch: failingGateway("failed") })
    await outage.ready
    await outage.waitForFrame((frame) => frame.includes("ctrl+p commands"))
    await outage.mockInput.typeText("/profile")
    await outage.waitForFrame((frame) => frame.includes("View your Kilo Gateway profile"))
    outage.mockInput.pressEnter()
    await outage.waitForFrame((frame) => normalized(frame).includes("Could not load your Kilo profile"))
    expect(normalized(outage.captureCharFrame())).toContain(
      "Could not load your Kilo profile. Kilo may be unreachable, try again later.",
    )
  })

  test("/teams distinguishes a rejected login from an outage", async () => {
    await using rejected = await createAppFixture({ fetch: failingGateway("unauthorized") })
    await rejected.ready
    await rejected.waitForFrame((frame) => frame.includes("ctrl+p commands"))
    await rejected.mockInput.typeText("/teams")
    await rejected.waitForFrame((frame) => frame.includes("Switch between Kilo Gateway teams"))
    rejected.mockInput.pressEnter()
    await rejected.waitForFrame((frame) => normalized(frame).includes("Kilo did not accept your login"))
    expect(normalized(rejected.captureCharFrame())).toContain(
      "Kilo did not accept your login. It may have expired or been revoked. Run /connect or `kilo auth login` to sign in again.",
    )

    await using outage = await createAppFixture({ fetch: failingGateway("failed") })
    await outage.ready
    await outage.waitForFrame((frame) => frame.includes("ctrl+p commands"))
    await outage.mockInput.typeText("/teams")
    await outage.waitForFrame((frame) => frame.includes("Switch between Kilo Gateway teams"))
    outage.mockInput.pressEnter()
    await outage.waitForFrame((frame) => normalized(frame).includes("Could not load your Kilo teams"))
    expect(normalized(outage.captureCharFrame())).toContain(
      "Could not load your Kilo teams. Kilo may be unreachable, try again later.",
    )
  })
})
