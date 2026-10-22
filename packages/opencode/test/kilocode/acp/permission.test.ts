import { describe, expect, test } from "bun:test"
import { SkillShellPrompt } from "@/kilocode/acp/permission"

describe("SkillShellPrompt", () => {
  test("detects the skillShell metadata flag", () => {
    expect(SkillShellPrompt.is({ skillShell: true })).toBe(true)
    expect(SkillShellPrompt.is({ skillShell: false })).toBe(false)
    expect(SkillShellPrompt.is({})).toBe(false)
    expect(SkillShellPrompt.is(undefined)).toBe(false)
  })

  test("offers only allow-once and reject, never allow-always", () => {
    expect(SkillShellPrompt.options.map((o) => o.optionId)).toEqual(["once", "reject"])
    expect(SkillShellPrompt.options.some((o) => o.kind === "allow_always")).toBe(false)
  })
})
