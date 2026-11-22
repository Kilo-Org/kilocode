import { describe, expect, test } from "bun:test"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { KiloWorkflowTools } from "@/kilocode/session/workflow-tools"

const execute = async () => ({ output: "", title: "", metadata: {} })
const tools = { edit: { execute }, bash: { execute }, write: { execute } }

const gate = (ruleset: PermissionV1.Ruleset) => KiloWorkflowTools.gate({ tools, ruleset })

describe("workflow tool gate", () => {
  test("answers a denied tool with a permission reason", () => {
    const result = gate([{ permission: "edit", pattern: "*", action: "deny" }])

    expect(result.preapproved).not.toContain("edit")
    for (const name of ["edit", "write"]) {
      expect(result.refuse(name)).toBe(`Permission denied for tool: ${name}`)
    }
  })

  test("preapproves a tool with no matching rule", () => {
    const result = gate([])

    expect(result.preapproved).toEqual(["edit", "bash", "write"])
    expect(result.refuse("bash")).toBeUndefined()
  })

  test("does not preapprove a tool that resolves to ask", () => {
    const result = gate([{ permission: "bash", pattern: "*", action: "ask" }])

    expect(result.preapproved).not.toContain("bash")
    expect(result.preapproved).toContain("edit")
    expect(result.refuse("bash")).toBeUndefined()
  })

  test("leaves a path-scoped deny to the tool", () => {
    const result = gate([{ permission: "edit", pattern: "secrets/**", action: "deny" }])

    expect(result.refuse("edit")).toBeUndefined()
    expect(result.preapproved).not.toContain("edit")
    expect(result.preapproved).toContain("bash")
  })

  test("answers a tool that is not offered", () => {
    expect(gate([]).refuse("mystery")).toBe("Tool not available: mystery")
  })

  test("lets the last matching rule decide", () => {
    const result = gate([
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ])

    expect(result.preapproved).toContain("bash")
    expect(result.refuse("bash")).toBeUndefined()
  })
})
