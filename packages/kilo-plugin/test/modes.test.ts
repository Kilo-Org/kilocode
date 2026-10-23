import { describe, expect, test } from "bun:test"
import type { KiloModes } from "@kilocode/gateway-core"
import { Permission } from "@opencode/core/permission"
import { Agent } from "@opencode/schema/agent"
import { KiloOrganizationModes } from "../src/gateway/modes"

const mode: KiloModes.OrganizationMode = {
  id: "mode-1",
  organization_id: "org-1",
  slug: "reviewer",
  name: "Organization Reviewer",
  created_by: "user-1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  config: { roleDefinition: "Review the code.", groups: ["read"] },
}

describe("convertOrganizationMode", () => {
  test("missing groups preserve native permissions while explicit empty groups deny core actions", () => {
    expect(KiloOrganizationModes.convert({ ...mode, config: {} }).permissions).toEqual([])
    expect(KiloOrganizationModes.convert({ ...mode, config: { groups: [] } }).permissions).toHaveLength(4)
  })

  test("uses the real agent name without sending metadata to the provider", () => {
    expect(KiloOrganizationModes.convert(mode)).toEqual({
      name: Agent.Name.make("Organization Reviewer"),
      mode: "primary",
      description: "Organization Reviewer",
      system: "Review the code.",
      permissions: KiloOrganizationModes.convertPermissions(["read"]),
    })
  })

  test.each([
    [{ roleDefinition: "Role", customInstructions: "Instructions" }, "Role\n\nInstructions"],
    [{ roleDefinition: "Role" }, "Role"],
    [{ customInstructions: "Instructions" }, "Instructions"],
    [{ roleDefinition: "", customInstructions: "Instructions" }, "Instructions"],
    [{ roleDefinition: "", customInstructions: "" }, undefined],
    [{}, undefined],
  ] satisfies [KiloModes.OrganizationMode["config"], string | undefined][])(
    "combines nonempty prompt fields: %j",
    (config, system) => {
      expect(KiloOrganizationModes.convert({ ...mode, config }).system).toBe(system)
    },
  )

  test.each([
    [{ description: "Description", whenToUse: "When" }, "Description"],
    [{ whenToUse: "When" }, "When"],
    [{}, mode.name],
    [{ description: "", whenToUse: "When" }, ""],
  ])("uses nullish description precedence: %j", (config, description) => {
    expect(KiloOrganizationModes.convert({ ...mode, config }).description).toBe(description)
  })

  test.each(["code", "build", "architect", "ask", "debug", "orchestrator"])(
    "converts built-in slug %s rather than skipping it",
    (slug) => {
      expect(KiloOrganizationModes.convert({ ...mode, slug })).toMatchObject({
        name: mode.name,
        mode: "primary",
        system: "Review the code.",
      })
    },
  )

  test("does not mutate the source mode", () => {
    const before = structuredClone(mode)
    const converted = KiloOrganizationModes.convert(mode)
    converted.permissions.push({ action: "read", resource: "*", effect: "deny" })
    expect(mode).toEqual(before)
    expect(KiloOrganizationModes.convert(mode).permissions).not.toEqual(converted.permissions)
  })
})

describe("convertPermissions", () => {
  test("allows the mapped core actions", () => {
    const rules = KiloOrganizationModes.convertPermissions(["read", "edit", "command", "mcp"])
    expect(Permission.evaluate("read", "src/index.ts", rules).effect).toBe("allow")
    expect(Permission.evaluate("edit", "src/index.ts", rules).effect).toBe("allow")
    expect(Permission.evaluate("shell", "git status", rules).effect).toBe("allow")
    expect(Permission.evaluate("mcp", "*", rules).effect).toBe("allow")
  })

  test.each(["browser", "command", "bash"])("maps %s to shell and denies missing core actions", (group) => {
    const rules = KiloOrganizationModes.convertPermissions([group])
    expect(Permission.evaluate("shell", "git status", rules).effect).toBe("allow")
    expect(Permission.evaluate("read", "src/index.ts", rules).effect).toBe("deny")
    expect(Permission.evaluate("edit", "src/index.ts", rules).effect).toBe("deny")
    expect(Permission.evaluate("mcp", "*", rules).effect).toBe("deny")
  })

  test.each([{ groups: undefined }, { groups: [] }])(
    "denies all core actions when groups are absent or empty: %j",
    (config) => {
      const rules = KiloOrganizationModes.convertPermissions(config.groups)
      for (const action of ["read", "edit", "shell", "mcp"]) {
        expect(Permission.evaluate(action, "*", rules).effect).toBe("deny")
      }
      expect(Permission.evaluate("question", "*", rules).effect).toBe("ask")
      expect(KiloOrganizationModes.convert({ ...mode, config }).permissions).toEqual(
        config.groups === undefined ? [] : rules,
      )
    },
  )

  test("retains the main MCP group action without allowing shell or file access", () => {
    const rules = KiloOrganizationModes.convertPermissions(["mcp"])
    expect(Permission.evaluate("mcp", "*", rules).effect).toBe("allow")
    for (const action of ["read", "edit", "shell"]) {
      expect(Permission.evaluate(action, "*", rules).effect).toBe("deny")
    }
  })

  test("keeps unknown groups and their file restrictions", () => {
    const rules = KiloOrganizationModes.convertPermissions(["custom-group", ["custom-files", { fileRegex: "docs/*" }]])
    expect(Permission.evaluate("custom-group", "*", rules).effect).toBe("allow")
    expect(Permission.evaluate("custom-files", "docs/guide.md", rules).effect).toBe("deny")
    expect(Permission.evaluate("custom-files", "src/index.ts", rules).effect).toBe("deny")
    for (const action of ["read", "edit", "shell", "mcp"]) {
      expect(Permission.evaluate(action, "*", rules).effect).toBe("deny")
    }
  })

  test("retains main's specific allow followed by catch-all deny", () => {
    const rules = KiloOrganizationModes.convertPermissions([
      "read",
      ["edit", { fileRegex: "src/*.md", description: "Markdown only" }],
    ])
    expect(rules.filter((rule) => rule.action === "edit")).toEqual([
      { action: "edit", resource: "src/*.md", effect: "allow" },
      { action: "edit", resource: "*", effect: "deny" },
    ])
    expect(Permission.evaluate("edit", "src/guide.md", rules).effect).toBe("deny")
    expect(Permission.evaluate("edit", "src/nested/guide.md", rules).effect).toBe("deny")
    expect(Permission.evaluate("edit", "src/index.ts", rules).effect).toBe("deny")
    expect(Permission.evaluate("edit", "docs/guide.md", rules).effect).toBe("deny")
    expect(Permission.evaluate("read", "src/index.ts", rules).effect).toBe("allow")
  })

  test("passes regex-looking patterns through without adding regex semantics", () => {
    const rules = KiloOrganizationModes.convertPermissions([["edit", { fileRegex: "\\.md$" }]])
    expect(rules).toContainEqual({ action: "edit", resource: "\\.md$", effect: "allow" })
    expect(Permission.evaluate("edit", "README.md", rules).effect).toBe("deny")
    expect(Permission.evaluate("edit", "\\.md$", rules).effect).toBe("deny")
  })

  test.each([{}, { fileRegex: "" }])("allows tuples without a nonempty file pattern: %j", (config) => {
    const rules = KiloOrganizationModes.convertPermissions([["edit", config]])
    expect(Permission.evaluate("edit", "src/index.ts", rules).effect).toBe("allow")
  })

  test("lets the last group for an action replace earlier restrictions", () => {
    const restricted = KiloOrganizationModes.convertPermissions(["edit", ["edit", { fileRegex: "docs/*" }]])
    const unrestricted = KiloOrganizationModes.convertPermissions([["edit", { fileRegex: "docs/*" }], "edit"])
    expect(Permission.evaluate("edit", "docs/guide.md", restricted).effect).toBe("deny")
    expect(Permission.evaluate("edit", "src/index.ts", restricted).effect).toBe("deny")
    expect(Permission.evaluate("edit", "src/index.ts", unrestricted).effect).toBe("allow")
  })
})
