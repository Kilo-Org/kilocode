import { describe, expect, it } from "bun:test"
import { shouldAutoApprove } from "../../src/commands/auto-approve-rules"

describe("shouldAutoApprove", () => {
  it("allows auto approval when no explicit config rule matches", () => {
    expect(shouldAutoApprove({ permission: "bash", patterns: ["pwd"] })).toBe(true)
  })

  it("blocks auto approval for explicit scalar ask rules", () => {
    expect(
      shouldAutoApprove({
        permission: "supabase_apply_migration",
        patterns: ["*"],
        config: { supabase_apply_migration: "ask" },
      }),
    ).toBe(false)
  })

  it("blocks auto approval for explicit wildcard ask rules", () => {
    expect(
      shouldAutoApprove({
        permission: "supabase_apply_migration",
        patterns: ["*"],
        config: { "supabase_*": "ask" },
      }),
    ).toBe(false)
  })

  it("auto approves when a specific allow overrides a wildcard ask", () => {
    expect(
      shouldAutoApprove({
        permission: "supabase_get_project_url",
        patterns: ["*"],
        config: {
          "supabase_*": "ask",
          supabase_get_project_url: "allow",
        },
      }),
    ).toBe(true)
  })

  it("blocks auto approval for matching path-pattern asks", () => {
    expect(
      shouldAutoApprove({
        permission: "bash",
        patterns: ["pwd"],
        config: {
          bash: {
            "*": "ask",
            "git status*": "allow",
          },
        },
      }),
    ).toBe(false)
  })

  it("auto approves when a path-specific allow overrides a wildcard ask", () => {
    expect(
      shouldAutoApprove({
        permission: "bash",
        patterns: ["git status --short"],
        config: {
          bash: {
            "*": "ask",
            "git status*": "allow",
          },
        },
      }),
    ).toBe(true)
  })
})
