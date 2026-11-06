import { expect, test } from "bun:test"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const location = { directory }
const kiloPass = {
  currentPeriodBaseCreditsUsd: 199,
  currentPeriodUsageUsd: 73.27,
  currentPeriodBonusCreditsUsd: 0,
  nextBillingAt: null,
}

// The Kilo RPCs of a signed-in fixture account. `privacy` is what the kilocode.privacy RPC answers; `undefined`
// leaves the RPC unregistered.
function account(input: { privacy: { enabled?: boolean }; organizationID?: string | null; calls: string[] }) {
  const session = {
    id: "ses_privacy",
    title: "Privacy",
    projectID: "proj_test",
    location,
    agent: "build",
    model: { providerID: "kilo", id: "kilo-auto/frontier" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 10 },
  }
  return (url: URL) => {
    if (url.pathname.startsWith("/api/rpc/kilocode.")) input.calls.push(url.pathname.slice("/api/rpc/".length))
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    if (url.pathname === "/api/integration")
      return json({
        location,
        data: [{ id: "kilo", name: "Kilo Gateway", methods: [], connections: [{ type: "env", name: "KILO_API_KEY" }] }],
      })
    if (url.pathname === "/api/rpc/kilocode.privacy/get") {
      if (input.privacy.enabled === undefined) return new Response(null, { status: 404 })
      return json({ output: { enabled: input.privacy.enabled } })
    }
    if (url.pathname === "/api/rpc/kilocode.gateway/authStatus")
      return json({ output: { authenticated: true, organizationID: input.organizationID ?? null, server: "https://api.kilo.ai" } })
    if (url.pathname === "/api/rpc/kilocode.gateway/profile")
      return json({
        output: {
          name: "Fixture User",
          email: "fixture@example.test",
          organizations: [{ id: "org_fixture", name: "Fixture Org", role: "member" }],
          hasPersonalAccount: true,
          organizationID: input.organizationID ?? null,
        },
      })
    if (url.pathname === "/api/rpc/kilocode.gateway/balance") return json({ output: { balance: 1.5 } })
    if (url.pathname === "/api/rpc/kilocode.gateway/kiloPass") return json({ output: kiloPass })
    if (url.pathname === "/api/rpc/kilocode.gateway/modes") return json({ output: [] })
  }
}

test("/profile asks for confirmation in privacy mode, and cancel shows nothing", async () => {
  const calls: string[] = []
  await using app = await createAppFixture({ fetch: account({ privacy: { enabled: true }, calls }) })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  const open = async () => {
    await app.mockInput.typeText("/profile")
    await app.waitForFrame((frame) => frame.includes("View your Kilo Gateway profile"))
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Privacy Mode Enabled"))
    expect(app.captureCharFrame()).toContain("Privacy mode is on. Revealing your profile will")
  }

  await open()
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("Privacy Mode Enabled"))
  await Bun.sleep(100)
  expect(app.captureCharFrame()).not.toContain("Kilo Gateway Profile")
  expect(calls).not.toContain("kilocode.gateway/profile")

  await open()
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Kilo Gateway Profile") && frame.includes("fixture@example.test"))
})

test("/profile opens without confirmation when privacy mode is off", async () => {
  const calls: string[] = []
  await using app = await createAppFixture({ fetch: account({ privacy: { enabled: false }, calls }) })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  await app.mockInput.typeText("/profile")
  await app.waitForFrame((frame) => frame.includes("View your Kilo Gateway profile"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Kilo Gateway Profile"))
  expect(app.captureCharFrame()).not.toContain("Privacy Mode Enabled")
})

test("an unreadable privacy mode still asks before /profile reveals the account", async () => {
  const calls: string[] = []
  await using app = await createAppFixture({ fetch: account({ privacy: {}, calls }) })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  await app.mockInput.typeText("/profile")
  await app.waitForFrame((frame) => frame.includes("View your Kilo Gateway profile"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Privacy Mode Enabled"))
})

test("the sidebar masks the personal balance and hides Kilo Pass in privacy mode, following config edits", async () => {
  const calls: string[] = []
  const privacy = { enabled: false }
  await using app = await createAppFixture({
    width: 170,
    height: 50,
    args: { sessionID: "ses_privacy" },
    fetch: account({ privacy, calls }),
  })
  await app.ready
  await app.waitForFrame((frame) => /• Personal credits\s+\$1\.50/.test(frame) && frame.includes("Kilo Pass"))

  privacy.enabled = true
  app.events.emit({ id: "evt_config_on", type: "config.updated", created: 1, location, data: {} })
  await app.waitForFrame((frame) => /• Personal credits\s+•••/.test(frame))
  const masked = app.captureCharFrame()
  expect(masked).not.toContain("$1.50")
  expect(masked).not.toContain("Kilo Pass")

  privacy.enabled = false
  app.events.emit({ id: "evt_config_off", type: "config.updated", created: 2, location, data: {} })
  await app.waitForFrame((frame) => /• Personal credits\s+\$1\.50/.test(frame) && frame.includes("Kilo Pass"))
})

test("the sidebar collapses the team name to Team credits in privacy mode", async () => {
  const calls: string[] = []
  const privacy = { enabled: false }
  await using app = await createAppFixture({
    width: 170,
    height: 50,
    args: { sessionID: "ses_privacy" },
    fetch: account({ privacy, calls, organizationID: "org_fixture" }),
  })
  await app.ready
  await app.waitForFrame((frame) => /• Fixture Org team\s+\$1\.50/.test(frame))

  privacy.enabled = true
  app.events.emit({ id: "evt_config_on", type: "config.updated", created: 1, location, data: {} })
  await app.waitForFrame((frame) => /• Team credits\s+•••/.test(frame))
  expect(app.captureCharFrame()).not.toContain("Fixture Org")
})
