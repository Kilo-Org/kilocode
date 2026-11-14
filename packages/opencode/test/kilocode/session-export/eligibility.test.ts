import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  exportableAgent,
  isEligible,
  setKillSwitch,
  resetEligibility,
  type OrgState,
} from "@/kilocode/session-export/eligibility"

const base = {
  model: {
    api: { npm: "@kilocode/kilo-gateway" },
    isFree: true,
  },
  org: { type: "personal" } as OrgState,
}

describe("isEligible", () => {
  beforeEach(() => resetEligibility())
  afterEach(() => resetEligibility())

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
    expect(isEligible({ ...base, org: { type: "org", id: "org_xyz" } })).toBe(false)
  })

  test("unknown org state is ineligible", () => {
    expect(isEligible({ ...base, org: { type: "unknown" } })).toBe(false)
  })

  test("killSwitch blocks everything", () => {
    setKillSwitch(true, "test")
    expect(isEligible(base)).toBe(false)
  })
})

/**
 * The security reviewer is a service of the policy layer, not a turn of the user's conversation.
 * Its prompt carries the command line under review, so letting it reach the export stream would
 * reopen through a side channel exactly what the trusted-config and privacy-mode work closed.
 */
describe("exportableAgent", () => {
  test("excludes the security reviewer", () => {
    expect(exportableAgent("security-reviewer")).toBe(false)
  })

  test("still excludes the title agent", () => {
    expect(exportableAgent("title")).toBe(false)
  })

  test("keeps ordinary agents exportable", () => {
    expect(exportableAgent("code")).toBe(true)
    expect(exportableAgent("plan")).toBe(true)
  })
})
