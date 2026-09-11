// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { SecurityAsk } from "@/kilocode/security-decision/ask"

// The security layer's asks must be recognizable by an explicit typed marker — never by the
// message text and never by guessing from a rule id — so clients can refuse to auto-approve them.

describe("SecurityAsk marker", () => {
  test("marks a published ask and reads the marker back", () => {
    const metadata = SecurityAsk.mark({ filepath: ".github/workflows/ci.yml" }, { rule_id: "SEC.V1.CI_AUTHORITY" })
    expect(SecurityAsk.is(metadata)).toBe(true)
    expect(SecurityAsk.of(metadata)).toMatchObject({ rule_id: "SEC.V1.CI_AUTHORITY" })
    expect(metadata["filepath"]).toBe(".github/workflows/ci.yml")
  })

  test("does not recognize an ordinary ask, however it is worded", () => {
    expect(SecurityAsk.is(undefined)).toBe(false)
    expect(SecurityAsk.is({})).toBe(false)
    expect(SecurityAsk.is({ filepath: "src/a.ts" })).toBe(false)
    expect(SecurityAsk.is({ rule_id: "SEC.V1.CI_AUTHORITY" })).toBe(false)
    expect(SecurityAsk.is({ reason: "Security policy blocked this tool call" })).toBe(false)
  })

  test("ignores a marker that is not the typed shape", () => {
    expect(SecurityAsk.is({ [SecurityAsk.KEY]: true })).toBe(false)
    expect(SecurityAsk.is({ [SecurityAsk.KEY]: { rule_id: 7 } })).toBe(false)
    expect(SecurityAsk.of({ [SecurityAsk.KEY]: {} })).toBeUndefined()
  })
})

describe("SecurityAsk.autoDecision", () => {
  const security = SecurityAsk.mark({}, { rule_id: "SEC.V1.CI_AUTHORITY" })

  test("keeps auto-approving an ordinary ask in a headless run", () => {
    expect(SecurityAsk.autoDecision({ interactive: false, metadata: { filepath: "src/a.ts" } })).toBe("once")
    expect(SecurityAsk.autoDecision({ interactive: false })).toBe("once")
  })

  test("never auto-approves a security-generated ask in a headless run", () => {
    expect(SecurityAsk.autoDecision({ interactive: false, metadata: security })).toBe("block")
  })

  test("leaves every ask to the human in an interactive run", () => {
    expect(SecurityAsk.autoDecision({ interactive: true, metadata: security })).toBe("prompt")
    expect(SecurityAsk.autoDecision({ interactive: true, metadata: { filepath: "src/a.ts" } })).toBe("prompt")
  })
})
