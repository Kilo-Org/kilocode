import { describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"
import { PermissionProvenance } from "../../src/kilocode/permission/provenance"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"

/** Plan agent permission in the shape patchAgents produces: the edit guard appears several times. */
function planAgentPermission() {
  const planEdit = [
    { permission: "edit", pattern: "*", action: "deny" as const },
    { permission: "edit", pattern: ".kilo/plans/*.md", action: "allow" as const },
    { permission: "edit", pattern: "plans/*.md", action: "allow" as const },
  ]
  return [
    { permission: "*", pattern: "*", action: "deny" as const },
    { permission: "read", pattern: "*", action: "allow" as const },
    ...planEdit,
    ...planEdit,
    { permission: "bash", pattern: "*", action: "deny" as const },
    ...planEdit,
  ]
}

const sessionPermission = [
  { permission: "bash", pattern: "git status", action: "allow" as const },
  { permission: "bash", pattern: "*", action: "deny" as const },
]

describe("KiloSessionPrompt.dedupeRuleset", () => {
  test("keeps the last occurrence of each distinct rule", () => {
    const rules = [
      { permission: "edit", pattern: "*", action: "deny" as const },
      { permission: "edit", pattern: "plans/*.md", action: "allow" as const },
      { permission: "edit", pattern: "*", action: "deny" as const },
      { permission: "edit", pattern: "plans/*.md", action: "allow" as const },
    ]
    const deduped = KiloSessionPrompt.dedupeRuleset(rules)
    expect(deduped).toEqual([
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "plans/*.md", action: "allow" },
    ])
  })

  test("preserves evaluation winners", () => {
    const rules = [
      { permission: "edit", pattern: "*", action: "deny" as const },
      { permission: "edit", pattern: "*.md", action: "allow" as const },
      { permission: "edit", pattern: "*", action: "deny" as const },
      { permission: "edit", pattern: "*.md", action: "allow" as const },
    ]
    const deduped = KiloSessionPrompt.dedupeRuleset(rules)
    expect(Permission.evaluate("edit", "plan.md", rules).action).toBe("allow")
    expect(Permission.evaluate("edit", "plan.md", deduped).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/x.ts", rules).action).toBe("deny")
    expect(Permission.evaluate("edit", "src/x.ts", deduped).action).toBe("deny")
  })

  test("keeps rules that differ only by provenance tag", () => {
    const tagged = PermissionProvenance.tagAgent(
      [{ permission: "bash", pattern: "git status", action: "allow" }],
      undefined,
    )
    const session = PermissionProvenance.tagSession([{ permission: "bash", pattern: "git status", action: "allow" }])
    const deduped = KiloSessionPrompt.dedupeRuleset([...tagged, ...session])
    expect(deduped).toHaveLength(2)
    expect(PermissionProvenance.classify({ rule: deduped[0], agent: "plan", origins: undefined })).toEqual({
      source: "agent",
      agent: "plan",
      rule: { permission: "bash", pattern: "git status", action: "allow" },
    })
    expect(PermissionProvenance.classify({ rule: deduped[1], agent: "plan", origins: undefined })).toEqual({
      source: "session",
      rule: { permission: "bash", pattern: "git status", action: "allow" },
    })
  })
})

describe("KiloSessionPrompt.buildAskRuleset", () => {
  test("plan mode ruleset has no stacked duplicate rule blocks", () => {
    const agent = { name: "plan", permission: planAgentPermission() }
    const { ruleset } = KiloSessionPrompt.buildAskRuleset({
      agent,
      session: { permission: sessionPermission },
    })

    const keys = (
      ruleset as PermissionProvenance.SourcedRule[]
    ).map((rule) => `${rule.permission}\u0000${rule.pattern}\u0000${rule.action}\u0000${rule.source ?? ""}`)
    expect(new Set(keys).size).toBe(keys.length)

    const editRules = ruleset.filter((rule) => rule.permission === "edit")
    expect(editRules as PermissionProvenance.SourcedRule[]).toEqual([
      { permission: "edit", pattern: "*", action: "deny", source: "agent" },
      { permission: "edit", pattern: ".kilo/plans/*.md", action: "allow", source: "agent" },
      { permission: "edit", pattern: "plans/*.md", action: "allow", source: "agent" },
    ])
  })

  test("plan mode still allows plan edits and denies source edits", () => {
    const agent = { name: "plan", permission: planAgentPermission() }
    const { ruleset } = KiloSessionPrompt.buildAskRuleset({
      agent,
      session: { permission: sessionPermission },
    })

    expect(Permission.evaluate("edit", "plans/database-cache-plan.md", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/foo.ts", ruleset).action).toBe("deny")
  })

  test("the tagged agent rule wins over the session yolo rule after dedupe", () => {
    // Mirrors provenance.test.ts: a broad agent allow must not be misread as YOLO mode even
    // though guardPermissions re-appends agent rules after session rules.
    const agent = {
      name: "plan",
      permission: [{ permission: "*", pattern: "*", action: "allow" as const }],
    }
    const { ruleset } = KiloSessionPrompt.buildAskRuleset({
      agent,
      session: { permission: [{ permission: "*", pattern: "*", action: "allow" as const }] },
    })
    const winner = Permission.evaluate("bash", "echo hi", ruleset)
    expect(PermissionProvenance.classify({ rule: winner, agent: "plan", origins: undefined })).toEqual({
      source: "agent",
      agent: "plan",
      rule: { permission: "*", pattern: "*", action: "allow" },
    })
  })

  test("hard ruleset is deduped too", () => {
    const agent = { name: "plan", permission: planAgentPermission() }
    const { hardRuleset } = KiloSessionPrompt.buildAskRuleset({
      agent,
      session: { permission: [] },
    })
    const editRules = (hardRuleset ?? []).filter((rule) => rule.permission === "edit")
    expect(editRules).toEqual([
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "edit", pattern: ".kilo/plans/*.md", action: "allow" },
      { permission: "edit", pattern: "plans/*.md", action: "allow" },
    ])
  })

  test("code mode is left untouched", () => {
    const agent = { name: "code", permission: [{ permission: "*", pattern: "*", action: "allow" as const }] }
    const { ruleset, hardRuleset } = KiloSessionPrompt.buildAskRuleset({
      agent,
      session: { permission: sessionPermission },
    })
    expect(hardRuleset).toBeUndefined()
    expect(ruleset.some((rule) => rule.permission === "edit")).toBe(false)
  })
})
