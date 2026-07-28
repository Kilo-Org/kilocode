import { describe, expect, test } from "bun:test"
import { resolveToolApproval } from "./tool-approval"

// Echo the key + params so assertions can see which string was chosen without a real dictionary.
const t = (key: string, params?: Record<string, string | number | boolean>) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")})`
    : key

describe("resolveToolApproval", () => {
  test("returns undefined when there is no approval on the metadata", () => {
    expect(resolveToolApproval(undefined, t)).toBeUndefined()
    expect(resolveToolApproval({ other: 1 }, t)).toBeUndefined()
  })

  test("manual approvals show only the decision, no source or rule", () => {
    const out = resolveToolApproval({ approval: { source: "manual" } }, t)
    expect(out).toEqual({
      approval: { source: "manual" },
      decision: "ui.approval.manual",
      source: undefined,
      rule: undefined,
    })
  })

  test("a specific rule is shown with permission + pattern", () => {
    const approval = { source: "project" as const, rule: { permission: "bash", pattern: "git *", action: "allow" } }
    const out = resolveToolApproval({ approval }, t)
    expect(out?.decision).toBe("ui.approval.auto")
    expect(out?.source).toBe("ui.approval.source.project")
    expect(out?.rule).toBe("ui.approval.rule(permission=bash,pattern=git *)")
  })

  test("a per-tool rule with a wildcard pattern still shows the tool name", () => {
    const approval = {
      source: "agent" as const,
      agent: "explore",
      rule: { permission: "task", pattern: "*", action: "allow" },
    }
    const out = resolveToolApproval({ approval }, t)
    expect(out?.rule).toBe("ui.approval.rule(permission=task,pattern=*)")
  })

  test("the catch-all */* rule is dropped so the line is not noisy for blanket agent defaults", () => {
    // e.g. the code agent auto-approving `task`/`todowrite` via its "*": "allow" default.
    const approval = {
      source: "agent" as const,
      agent: "code",
      rule: { permission: "*", pattern: "*", action: "allow" },
    }
    const out = resolveToolApproval({ approval }, t)
    expect(out?.source).toBe("ui.approval.source.agent(agent=code)")
    expect(out?.rule).toBeUndefined()
  })
})
