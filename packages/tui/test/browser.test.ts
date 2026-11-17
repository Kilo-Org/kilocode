import { describe, expect, test } from "bun:test"
import { describeState, grantLine, readState } from "../src/kilocode/browser"

const document = {
  browser: { backend: "extension", observation: "diff", allow_sensitive: true },
  permissions: [
    { action: "browser", resource: "read:https://example.com", effect: "allow" },
    { action: "browser", resource: "act:http://localhost:5173", effect: "ask" },
    { action: "provider.use", resource: "kilo", effect: "allow" },
  ],
}

describe("/browser state", () => {
  test("defaults to the bundled browser with full observation", () => {
    expect(readState({})).toEqual({
      backend: "playwright",
      observation: "full",
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
      ["Backend: Bundled browser (Playwright) — ready", "Observation: full", "Sensitive steps: ask a person", "Origin grants: No origin rules yet"].join("\n"),
    )
    expect(describeState(readState(document))).toContain("Kilo browser extension — unavailable")
  })
})
