import { describe, test, expect, beforeEach } from "bun:test"
import { isEligible, setKillSwitch, resetEligibility } from "@/kilocode/session-export/eligibility"

const base = {
  model: {
    api: { npm: "@kilocode/kilo-gateway" },
    isFree: true,
  },
  org: undefined as string | undefined,
}

describe("isEligible", () => {
  beforeEach(() => resetEligibility())

  test("free Kilo Gateway personal context is eligible", () => {
    expect(isEligible(base)).toBe(true)
  })

  test("paid Kilo Gateway is ineligible", () => {
    expect(isEligible({ ...base, model: { ...base.model, isFree: false } })).toBe(false)
  })

  test("isFree=undefined is ineligible", () => {
    expect(isEligible({ ...base, model: { ...base.model, isFree: undefined } })).toBe(false)
  })

  test("non-Kilo provider with isFree=true is ineligible", () => {
    expect(isEligible({ ...base, model: { ...base.model, api: { npm: "@ai-sdk/openai" } } })).toBe(false)
  })

  test("org context is ineligible regardless of model", () => {
    expect(isEligible({ ...base, org: "org_xyz" })).toBe(false)
  })

  test("killSwitch blocks everything", () => {
    setKillSwitch(true, "test")
    expect(isEligible(base)).toBe(false)
  })
})
