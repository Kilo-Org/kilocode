// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { failedDescription, renderGutter } from "../../../../../src/kilocode/cli/cmd/tui/component/dialog-provider"

describe("failedDescription", () => {
  test("returns undefined when the provider is not failed", () => {
    expect(failedDescription("kilo", [], [])).toBeUndefined()
  })

  test("falls back to a generic message when no typed failure is reported", () => {
    expect(failedDescription("kilo", ["kilo"], [])).toBe("(connection error — click to reconnect)")
  })

  test("reports unauthorized credentials with the status code", () => {
    const failures = [{ providerID: "kilo", kind: "unauthorized" as const, status: 401 }]
    expect(failedDescription("kilo", ["kilo"], failures)).toBe("(Credentials rejected (HTTP 401) — sign in again)")
  })

  test("reports unauthenticated without a status code", () => {
    const failures = [{ providerID: "kilo", kind: "unauthenticated" as const }]
    expect(failedDescription("kilo", ["kilo"], failures)).toBe("(Not signed in — sign in to continue)")
  })

  test("reports network failures", () => {
    const failures = [{ providerID: "kilo", kind: "network" as const }]
    expect(failedDescription("kilo", ["kilo"], failures)).toBe("(Couldn't reach the provider — check your connection)")
  })

  test("reports generic http failures with the status code", () => {
    const failures = [{ providerID: "kilo", kind: "http" as const, status: 503 }]
    expect(failedDescription("kilo", ["kilo"], failures)).toBe("(Provider error (HTTP 503))")
  })

  test("reports schema failures", () => {
    const failures = [{ providerID: "kilo", kind: "schema" as const }]
    expect(failedDescription("kilo", ["kilo"], failures)).toBe("(Unexpected response from the provider)")
  })

  test("only decorates the matching provider", () => {
    const failures = [{ providerID: "other", kind: "unauthorized" as const, status: 401 }]
    expect(failedDescription("kilo", ["kilo"], failures)).toBe("(connection error — click to reconnect)")
  })

  test("defaults to an empty failures list for back-compat callers", () => {
    expect(failedDescription("kilo", ["kilo"])).toBe("(connection error — click to reconnect)")
  })
})

describe("renderGutter", () => {
  const theme = { error: RGBA.fromValues(1, 0, 0, 1) }

  test("returns undefined when the provider is not failed", () => {
    expect(renderGutter("kilo", [], theme)).toBeUndefined()
  })

  test("returns a renderer when the provider is failed", () => {
    expect(renderGutter("kilo", ["kilo"], theme)).toBeTypeOf("function")
  })
})
