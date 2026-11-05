import { describe, expect, test } from "bun:test"
import { indicator } from "../../src/kilocode/sandbox"

describe("sandbox TUI", () => {
  test("shows an indicator only for an active sandbox", () => {
    expect(
      indicator({ directory: "/repo", enabled: true, available: true, network: true, version: 1 }),
    ).toBe("◆ Sandbox on")
    expect(
      indicator({ directory: "/repo", enabled: true, available: false, network: false, version: 1 }),
    ).toBe("◆ Sandbox on")
    expect(
      indicator({ directory: "/repo", enabled: false, available: true, network: false, version: 2 }),
    ).toBeUndefined()
    expect(
      indicator({
        directory: "/repo",
        enabled: false,
        available: false,
        reason: "unavailable",
        network: false,
        version: 0,
      }),
    ).toBeUndefined()
  })

  test("shows no indicator without a status", () => {
    expect(indicator()).toBeUndefined()
  })
})
