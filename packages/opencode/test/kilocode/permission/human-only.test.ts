// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { PermissionHumanOnly } from "@/kilocode/permission/human-only"
import { SecurityAsk } from "@/kilocode/security-decision/ask"

/**
 * One predicate, used by the server guard and by every client that answers on the user's behalf.
 * Two copies of it is what produced a prompt the server would not accept an answer for and the
 * client would not display.
 */
describe("PermissionHumanOnly.requires", () => {
  test.each([
    ["a skill shell batch", { skillShell: true }],
    ["a sandbox escalation", { sandboxEscalation: true }],
    ["a security-raised ask", SecurityAsk.mark({}, { rule_id: "SEC.V1.CONTAINED_EXEC" })],
  ])("%s may only be answered by a human", (_name, metadata) => {
    expect(PermissionHumanOnly.requires(metadata)).toBe(true)
  })

  test.each([
    ["an ordinary ask", {}],
    ["no metadata at all", undefined],
    ["a false flag", { sandboxEscalation: false, skillShell: false }],
  ])("%s may be answered automatically", (_name, metadata) => {
    expect(PermissionHumanOnly.requires(metadata)).toBe(false)
  })
})
