import { describe, expect, test } from "bun:test"
import type { TestRendererSetup } from "@opentui/core/testing"
import { browserOptions, describeState, grantLine, readState } from "../../src/kilocode/browser"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const document = {
  browser: { backend: "extension", observation: "diff", allow_sensitive: true },
  permissions: [
    { action: "browser", resource: "read:https://example.com", effect: "allow" },
    { action: "browser", resource: "act:http://localhost:5173", effect: "ask" },
    { action: "provider.use", resource: "kilo", effect: "allow" },
  ],
}

describe("/browser state", () => {
  test("defaults to the bundled browser with diff observation, as the browser plugin does", () => {
    expect(readState({})).toEqual({
      backend: "playwright",
      observation: "diff",
      allowSensitive: false,
      grants: [],
      allowAll: false,
    })
  })

  test("reads the backend, the observation and the grants", () => {
    expect(readState(document)).toEqual({
      backend: "extension",
      observation: "diff",
      allowSensitive: true,
      grants: [
        { action: "browser", resource: "read:https://example.com", effect: "allow" },
        { action: "browser", resource: "act:http://localhost:5173", effect: "ask" },
      ],
      allowAll: false,
    })
  })

  test("the catch-all rule is shown, and the allow-all state follows it", () => {
    const state = readState({ permissions: [{ action: "browser", resource: "*", effect: "allow" }] })
    expect(state.allowAll).toBe(true)
    expect(state.grants).toEqual([{ action: "browser", resource: "*", effect: "allow" }])
  })

  test("a catch-all that is not an allow is kept and reads as its effect", () => {
    const state = readState({ permissions: [{ action: "browser", resource: "*", effect: "ask" }] })
    expect(state.allowAll).toBe(false)
    expect(state.grants).toEqual([{ action: "browser", resource: "*", effect: "ask" }])
    expect(grantLine({ action: "browser", resource: "*", effect: "deny" })).toBe("every origin → deny")
    expect(grantLine({ action: "browser", resource: "*", effect: "ask" })).toBe("every origin → ask")
  })

  test("the last catch-all decides allow-all, as the CLI's evaluator does", () => {
    const later = readState({
      permissions: [
        { action: "browser", resource: "*", effect: "allow" },
        { action: "browser", resource: "*", effect: "deny" },
      ],
    })
    expect(later.allowAll).toBe(false)
    expect(later.grants).toEqual([{ action: "browser", resource: "*", effect: "deny" }])
    const raised = readState({
      permissions: [
        { action: "browser", resource: "*", effect: "deny" },
        { action: "browser", resource: "*", effect: "allow" },
      ],
    })
    expect(raised.allowAll).toBe(true)
  })

  test("a later rule for the same origin wins over the earlier one", () => {
    const state = readState({
      permissions: [
        { action: "browser", resource: "read:https://example.com", effect: "allow" },
        { action: "browser", resource: "read:https://example.com", effect: "deny" },
      ],
    })
    expect(state.grants).toEqual([{ action: "browser", resource: "read:https://example.com", effect: "deny" }])
  })

  test("a grant reads as its class and origin", () => {
    expect(grantLine({ action: "browser", resource: "read:https://example.com", effect: "allow" })).toBe(
      "read on https://example.com → allow",
    )
    expect(grantLine({ action: "browser", resource: "*", effect: "allow" })).toBe("every origin allowed")
  })

  test("the state line names the backend and whether it can run", () => {
    expect(describeState(readState({}), true)).toBe(
      [
        "Backend: Bundled browser (Playwright) — ready",
        "Observation: Only what changed",
        "Sensitive steps: ask a person",
        "Origin grants: No origin rules yet",
      ].join("\n"),
    )
    expect(describeState(readState({}), false)).toContain("Bundled browser (Playwright) — unavailable")
    expect(describeState(readState(document), true)).toContain("Kilo browser extension — unavailable")
    expect(describeState(readState(document), true)).toContain("Observation: Only what changed")
  })

  test("the backend hints are one detail line each, and none on a short terminal", () => {
    const backends = (hints: boolean) => browserOptions(readState({}), hints).slice(0, 3)
    expect(backends(true).every((option) => option.details?.length === 1)).toBe(true)
    expect(backends(false).every((option) => option.details === undefined)).toBe(true)
  })
})

const settings = (document: unknown) => (url: URL) => {
  if (url.pathname === "/api/rpc/kilocode.settings/read") {
    return json({
      output: {
        scope: "global",
        target: { scope: "global", path: `${directory}/kilo2.json`, revision: "rev", exists: true },
        document,
      },
    })
  }
  if (url.pathname === "/api/rpc/kilocode.browser/status")
    return json({ output: { playwright: { ready: true }, backend: "playwright" } })
  return undefined
}

/**
 * `/browser` from the slash list: picking it fills in `/browser `, and submitting that with no argument opens the
 * settings. Returns the slash list's frame and the dialog's.
 */
async function openSettings(app: TestRendererSetup) {
  await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  await app.mockInput.typeText("/browser")
  const list = await app.waitForFrame((frame) => frame.includes("Show the browser backend"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => !frame.includes("Show the browser backend"))
  app.mockInput.pressEnter()
  const dialog = await app.waitForFrame(
    (frame) => frame.includes("Browser settings") && frame.includes("Sensitive steps:"),
  )
  return { list, dialog }
}

// The dialog takes the widest size the terminal allows, and each backend's hint has its own line, so no hint or state
// line is cut off. 80 columns is the narrowest pane where the 64-character English hint still fits whole.
for (const width of [80, 100, 200])
  test(`/browser shows every hint and the current state whole at width ${width}`, async () => {
    await using app = await createAppFixture({
      width,
      height: 40,
      fetch: settings({ browser: { backend: "extension", observation: "none", allow_sensitive: true } }),
    })
    await app.ready
    const { list, dialog } = await openSettings(app)
    // One command serves `/browser`, `/browser share` and `/browser adopt`, so the slash list has one `/browser` row.
    expect(list.split("\n").filter((line) => /\/browser\s{2,}\p{L}/u.test(line))).toHaveLength(1)
    for (const line of [
      "A Kilo-owned Chromium profile, started by the first browser call",
      "Connect the Kilo browser extension to drive your own browser",
      "Hide the browser tools from agents",
      "Backend: Kilo browser extension — unavailable",
      "Observation: Status only",
      "Sensitive steps: run without asking",
    ])
      expect(dialog).toContain(line)
  }, 30000)

// 30 rows is a short pane: the dialog list is capped to half the screen, so the hints are dropped and the groups keep
// their rows. The state lines still name the backend and whether it can run.
test("/browser drops the hints on a short terminal", async () => {
  await using app = await createAppFixture({
    width: 100,
    height: 30,
    fetch: settings({ browser: { backend: "playwright" } }),
  })
  await app.ready
  const { dialog: frame } = await openSettings(app)
  expect(frame).not.toContain("Hide the browser tools from agents")
  expect(frame).toContain("Backend: Bundled browser (Playwright) — ready")
  expect(frame).toContain("Observation: Only what changed")
}, 30000)

// The status RPC is what makes "ready" true: without a browser it must read as unavailable.
test("/browser reports the backend unavailable when no browser is installed", async () => {
  await using app = await createAppFixture({
    width: 100,
    height: 40,
    fetch: async (url) =>
      url.pathname === "/api/rpc/kilocode.browser/status"
        ? json({ output: { playwright: { ready: false }, backend: "playwright" } })
        : settings({})(url),
  })
  await app.ready
  const { dialog: frame } = await openSettings(app)
  expect(frame).toContain("Backend: Bundled browser (Playwright) — unavailable")
}, 30000)

// The settings RPC answers for a location. The command must ask for the TUI's own project, the same location every
// other Kilo command reads, not whatever directory the process happened to start in.
test("/browser reads the settings for the TUI's location, not the process directory", async () => {
  const asked: string[] = []
  await using app = await createAppFixture({
    width: 100,
    height: 40,
    fetch: async (url) => {
      if (url.pathname.startsWith("/api/rpc/kilocode.")) asked.push(url.searchParams.get("location[directory]") ?? "")
      return settings({})(url)
    },
  })
  await app.ready
  await openSettings(app)
  expect(asked.length).toBeGreaterThan(0)
  expect(new Set(asked)).toEqual(new Set([directory]))
}, 30000)

// A write sends the changed key alone: the block's other keys keep their values server-side, so an unrelated value the
// reader rejects cannot refuse this edit.
test("/browser writes only the setting that changed", async () => {
  const writes: unknown[] = []
  const written = Promise.withResolvers<void>()
  await using app = await createAppFixture({
    width: 100,
    height: 40,
    fetch: async (url, request) => {
      if (url.pathname === "/api/rpc/kilocode.settings/write") {
        writes.push(await request.clone().json())
        written.resolve()
        return json({
          output: {
            scope: "global",
            target: { scope: "global", path: `${directory}/kilo2.json`, revision: "next", exists: true },
            changed: true,
          },
        })
      }
      return settings({ browser: { backend: "extension", observation: "full", allow_sensitive: true } })(url)
    },
  })
  await app.ready
  await openSettings(app)
  app.mockInput.pressEnter()
  await written.promise
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ input: { scope: "global", set: { browser: { backend: "extension" } } } })
  expect(JSON.stringify(writes[0])).not.toContain("allow_sensitive")
  expect(JSON.stringify(writes[0])).not.toContain("observation")
}, 30000)

// An RPC failure is the client's `{ type, message }` object, not an Error, so the toast must read its message instead
// of calling String() on it.
test("/browser shows the message of a refused write", async () => {
  await using app = await createAppFixture({
    width: 100,
    height: 40,
    fetch: async (url) => {
      if (url.pathname === "/api/rpc/kilocode.settings/write") {
        return json(
          { _tag: "RpcError", type: "invalid", message: "Unrecognized key: browser.backend" },
          { status: 400 },
        )
      }
      return settings({ browser: { backend: "playwright" } })(url)
    },
  })
  await app.ready
  await openSettings(app)
  app.mockInput.pressEnter()
  const frame = await app.waitForFrame((frame) => frame.includes("Unrecognized key: browser.backend"))
  expect(frame).not.toContain("[object Object]")
}, 30000)
