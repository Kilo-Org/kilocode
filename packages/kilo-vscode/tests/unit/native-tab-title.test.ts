import { describe, expect, it } from "bun:test"
import type { Session } from "@kilocode/sdk/v2/client"
import { nativeTitle } from "../../src/kilo-provider/native-tab-title"

const session = (title: string | null) => ({ title }) as Session

describe("nativeTitle", () => {
  it("uses the default title without a useful session title", () => {
    expect(nativeTitle(null)).toBe("Kilo Code")
    expect(nativeTitle(session(""))).toBe("Kilo Code")
    expect(nativeTitle(session("New session - 2026-05-06T10:39:00.000Z"))).toBe("Kilo Code")
  })

  it("keeps short session titles", () => {
    expect(nativeTitle(session("Greeting"))).toBe("Greeting")
  })

  it("truncates long session titles", () => {
    expect(nativeTitle(session("Dynamic VS Code tab titles for Kilo sessions"))).toBe("Dynamic VS Code tab...")
  })
})
