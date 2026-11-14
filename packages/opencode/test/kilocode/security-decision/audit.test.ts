import { test, expect, describe } from "bun:test"
import { PermissionProvenance } from "../../../src/kilocode/permission/provenance"
import { SecurityBlocked } from "../../../src/kilocode/security-decision/block"

describe("security audit metadata", () => {
  test("the audit key survives a tool overwriting its metadata", () => {
    const prev = { approval: { source: "agent" }, securityDecision: { rule_id: "SEC.V1.NO_OPINION" } }
    const next = PermissionProvenance.carryApproval(prev, { output: "done" })
    expect(next).toMatchObject({ output: "done", securityDecision: { rule_id: "SEC.V1.NO_OPINION" } })
  })

  test("a replacement that carries its own audit wins", () => {
    const prev = { securityDecision: { rule_id: "SEC.V1.NO_OPINION" } }
    const next = PermissionProvenance.carryApproval(prev, { securityDecision: { rule_id: "SEC.V1.CI_AUTHORITY" } })
    expect(next).toMatchObject({ securityDecision: { rule_id: "SEC.V1.CI_AUTHORITY" } })
  })

  test("metadata without a prior audit is left alone", () => {
    expect(PermissionProvenance.carryApproval(undefined, { output: "done" })).toEqual({ output: "done" })
  })
})

describe("SecurityBlocked.is", () => {
  test("recognizes the typed security block and nothing else", () => {
    expect(SecurityBlocked.is(SecurityBlocked.of("SEC.V1.GIT_HOOK_WRITE", {} as any))).toBe(true)
    expect(SecurityBlocked.is(new Error("boom"))).toBe(false)
    expect(SecurityBlocked.is(undefined)).toBe(false)
  })
})
