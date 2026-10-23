import { expect, test } from "bun:test"
import { createAppFixture } from "../fixture/app"
import { tmpdir } from "../fixture/fixture"
import { directory, json } from "../fixture/tui-client"

const wait = { maxPasses: 200 }
const item = (id: string, extra: object = {}) => ({ id, title: `${id} title`, message: `${id} message`, ...extra })

function gateway(list: () => object[]) {
  const calls: string[] = []
  return {
    calls,
    fetch: (url: URL) => {
      if (url.pathname !== "/api/rpc/kilocode.gateway/notifications") return
      calls.push(url.searchParams.get("location[directory]")!)
      return json({ output: list() })
    },
  }
}

test("home screen shows unread CLI news, opens it, and keeps it read after a restart", async () => {
  await using state = await tmpdir()
  let list = [
    item("first", { showIn: ["cli"], action: { actionText: "Learn more", actionURL: "https://kilo.ai" } }),
    item("second"),
    item("vscode-only", { showIn: ["vscode"] }),
  ]
  const server = gateway(() => list)
  {
    await using app = await createAppFixture({ state: state.path, fetch: server.fetch, width: 100, height: 34 })
    await app.waitForFrame((frame) => frame.includes("first title"), wait)
    const frame = app.captureCharFrame()
    expect(frame).toContain("(2 new)")
    expect(frame).toContain("first message")
    expect(frame).not.toContain("vscode-only")
    expect(server.calls[0]).toBe(directory)

    const row = frame.split("\n").findIndex((line) => line.includes("first title"))
    await app.mockMouse.click(frame.split("\n")[row]!.indexOf("first title"), row)
    await app.waitForFrame((frame) => frame.includes("News") && frame.includes("second message"), wait)
    expect(app.captureCharFrame()).toContain("[Learn more]")
    expect(app.captureCharFrame()).not.toContain("vscode-only")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => !frame.includes("first title") && !frame.includes("second message"), wait)
  }

  list = [...list, item("third")]
  server.calls.length = 0
  await using app = await createAppFixture({ state: state.path, fetch: server.fetch, width: 100, height: 34 })
  await app.waitForFrame((frame) => frame.includes("third title"), wait)
  expect(app.captureCharFrame()).not.toContain("first title")
  expect(app.captureCharFrame()).not.toContain("(2 new)")
}, 60_000)

test("refetches news when the Kilo account or team changes", async () => {
  let list: object[] = []
  const server = gateway(() => list)
  await using app = await createAppFixture({ fetch: server.fetch, width: 100, height: 34 })
  await app.waitForFrame((frame) => frame.includes("ctrl+p"), wait)
  await Bun.sleep(50)
  expect(server.calls.length).toBeGreaterThan(0)
  expect(app.captureCharFrame()).not.toContain("●")

  list = [item("team")]
  app.events.emit({
    id: "evt_team",
    created: 0,
    type: "credential.switched",
    location: { directory },
    data: { integrationID: "kilo", credentialID: null },
  })
  await app.waitForFrame((frame) => frame.includes("team title"), wait)

  list = [item("other-team")]
  app.events.emit({
    id: "evt_org",
    created: 0,
    type: "rpc.kilocode.gateway.organization",
    location: { directory },
    data: { organizationID: "org_2" },
  } as never)
  await app.waitForFrame((frame) => frame.includes("other-team title"), wait)
}, 60_000)
