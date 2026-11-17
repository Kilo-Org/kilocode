import { describe, expect, test } from "bun:test"
import { describeState, grantLine, readState } from "../../src/kilocode/browser"
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

  test("the catch-all rule is the allow-all state, not a grant", () => {
    const state = readState({ permissions: [{ action: "browser", resource: "*", effect: "allow" }] })
    expect(state.allowAll).toBe(true)
    expect(state.grants).toEqual([])
  })

  test("a grant reads as its class and origin", () => {
    expect(grantLine({ action: "browser", resource: "read:https://example.com", effect: "allow" })).toBe(
      "read on https://example.com → allow",
    )
    expect(grantLine({ action: "browser", resource: "*", effect: "allow" })).toBe("every origin allowed")
  })

  test("the state line names the backend and whether it can run", () => {
    expect(describeState(readState({}))).toBe(
      [
        "Backend: Bundled browser (Playwright) — ready",
        "Observation: diff",
        "Sensitive steps: ask a person",
        "Origin grants: No origin rules yet",
      ].join("\n"),
    )
    expect(describeState(readState(document))).toContain("Kilo browser extension — unavailable")
  })
})

// The dialog takes the widest size the terminal allows, and each backend's hint has its own line, so no hint or state
// line is cut off. 80 columns is the narrowest pane where the 64-character English hint still fits whole.
for (const width of [80, 100, 200])
  test(`/browser shows every hint and the current state whole at width ${width}`, async () => {
    await using app = await createAppFixture({
      width,
      height: 40,
      fetch: async (url) => {
        if (url.pathname !== "/api/rpc/kilocode.settings/read") return undefined
        return json({
          output: {
            scope: "global",
            target: { scope: "global", path: `${directory}/kilo2.json`, revision: "rev", exists: true },
            document: { browser: { backend: "extension", observation: "none", allow_sensitive: true } },
          },
        })
      },
    })
    await app.ready
    await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))
    await app.mockInput.typeText("/browser")
    await app.waitForFrame((frame) => frame.includes("Show the browser backend"))
    app.mockInput.pressEnter()
    const frame = await app.waitForFrame(
      (frame) => frame.includes("Browser settings") && frame.includes("Sensitive steps:"),
    )
    for (const line of [
      "A Kilo-owned Chromium profile, started by the first browser call",
      "Connect the Kilo browser extension to drive your own browser",
      "Hide the browser tools from agents",
      "Backend: Kilo browser extension — unavailable",
      "Observation: none",
      "Sensitive steps: run without asking",
    ])
      expect(frame).toContain(line)
  }, 30000)
