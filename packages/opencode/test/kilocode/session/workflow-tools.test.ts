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
    // The tool stays preapproved, so calls this rule allows need no prompt; the
    // call that matches the path is still decided by the tool's own check.
    expect(result.preapproved).toContain("edit")
    expect(result.preapproved).toContain("bash")
  })

  test("answers a tool that is not offered", () => {
    expect(gate([]).refuse("mystery")).toBe("Tool not available: mystery")
  })

  test("applies the edit and read permissions to their aliases", () => {
    const result = KiloWorkflowTools.gate({
      tools: { edit: { execute }, write: { execute }, apply_patch: { execute }, bash: { execute } },
      ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
    })

    expect(result.preapproved).not.toContain("edit")
    expect(result.preapproved).not.toContain("write")
    expect(result.preapproved).not.toContain("apply_patch")
    expect(result.preapproved).toContain("bash")
  })

  test("reads the resource tools through the read permission", () => {
    const names = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]
    const tools = Object.fromEntries(names.map((name) => [name, { execute }]))

    const asked = KiloWorkflowTools.gate({ tools, ruleset: [{ permission: "read", pattern: "*", action: "ask" }] })
    const denied = KiloWorkflowTools.gate({ tools, ruleset: [{ permission: "read", pattern: "*", action: "deny" }] })

    expect(asked.preapproved).toEqual([])
    for (const name of names) {
      expect(denied.preapproved).not.toContain(name)
      expect(denied.refuse(name)).toBe(`Permission denied for tool: ${name}`)
    }
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
