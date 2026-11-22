import { describe, expect, test } from "bun:test"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "@/permission"
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

  test("keeps a scoped deny out of the whole-tool answer in either order", () => {
    const catchAll: PermissionV1.Rule = { permission: "edit", pattern: "*", action: "allow" }
    const scoped: PermissionV1.Rule = { permission: "edit", pattern: "private/**", action: "deny" }
    const last = gate([catchAll, scoped])
    const first = gate([scoped, catchAll])

    // Neither order changes the whole-tool answer: the scoped rule cannot speak
    // for the tool, so the tool stays preapproved and runs its own path check.
    for (const result of [last, first]) {
      expect(result.preapproved).toContain("edit")
      expect(result.refuse("edit")).toBeUndefined()
      expect(result.preapproved).toContain("bash")
    }
    expect(Permission.disabled(["edit"], [catchAll, scoped])).toEqual(new Set())
    expect(Permission.disabled(["edit"], [scoped, catchAll])).toEqual(new Set())

    // The per-path answer still follows the order: the last matching rule wins.
    expect(Permission.evaluate("edit", "private/key.txt", [catchAll, scoped]).action).toBe("deny")
    expect(Permission.evaluate("edit", "private/key.txt", [scoped, catchAll]).action).toBe("allow")
  })

  test("answers a name that is not a known alias with a ruleset in force", () => {
    const result = gate([{ permission: "edit", pattern: "*", action: "deny" }])

    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(result.refuse(name)).toBe(`Tool not available: ${name}`)
    }
  })
})
