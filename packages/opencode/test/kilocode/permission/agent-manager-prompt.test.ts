import { describe, expect, test } from "bun:test"
import { Permission } from "../../../src/permission"

const broad = Permission.fromConfig({ agent_manager: "allow" })

describe("Agent Manager prompt permissions", () => {
  test("requires consent despite a broad Agent Manager allow rule", () => {
    expect(Permission.resolve("agent_manager", "prompt", broad).action).toBe("ask")
    expect(Permission.resolve("agent_manager", "local", broad).action).toBe("allow")
    expect(Permission.resolve("agent_manager", "worktree", broad).action).toBe("allow")
  })

  test("requires consent despite a global allow rule", () => {
    const rules = [{ permission: "*", pattern: "*", action: "allow" as const }]
    expect(Permission.resolve("agent_manager", "prompt", rules).action).toBe("ask")
  })

  test("requires consent despite a saved wildcard approval", () => {
    const rules = Permission.fromConfig({ agent_manager: "ask" })
    const saved = [{ permission: "agent_manager", pattern: "*", action: "allow" as const }]
    expect(Permission.resolve("agent_manager", "prompt", rules, saved).action).toBe("ask")
  })

  test("allows only an explicit prompt approval", () => {
    const rules = Permission.fromConfig({ agent_manager: { prompt: "allow" } })
    expect(Permission.resolve("agent_manager", "prompt", rules).action).toBe("allow")
  })
})
