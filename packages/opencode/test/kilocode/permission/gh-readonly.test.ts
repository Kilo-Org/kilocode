import { describe, expect, test } from "bun:test"
import { hardenExplore, patchAgents } from "../../../src/kilocode/agent"
import { Permission } from "../../../src/permission"

function agents(user: Permission.Ruleset = []) {
  const items: Parameters<typeof patchAgents>[0] = Object.fromEntries(
    ["build", "plan", "explore"].map((name) => [name, { name, mode: "primary", options: {}, permission: [] }]),
  )
  patchAgents(items, [], user, { mcpRules: {}, defaultsPatch: [], board: false, autonomous: false }, "/repo", [])
  hardenExplore("explore", items.explore, user)
  return items
}

test("Code honors a Bash allow exception after the catch-all", () => {
  const user = Permission.fromConfig({ bash: { "*": "allow", "gh pr list *": "allow" } })
  expect(Permission.resolve("bash", "gh pr list", agents(user).code.permission)).toEqual({
    permission: "bash",
    pattern: "gh pr list *",
    action: "allow",
  })
})

for (const name of ["plan", "ask", "explore"]) {
  describe(`${name} gh permissions`, () => {
    const items = agents(Permission.fromConfig({ bash: { "*": "allow", "gh pr list *": "allow" } }))
    const rules = items[name].permission

    test("allows read-only commands with and without arguments", () => {
      for (const command of [
        "gh pr view 123",
        "gh pr list",
        "gh pr status",
        "gh pr diff 123",
        "gh pr checks 123",
        "gh issue view 123",
        "gh issue list",
        "gh issue status",
        "gh repo view",
        "gh run list",
        "gh run view 123",
        "gh release list",
        "gh release view v1.0.0",
        "gh search issues bug",
      ]) {
        expect(Permission.resolve("bash", command, rules).action, command).toBe("allow")
      }
    })

    test("keeps other gh commands restricted despite the user allow", () => {
      for (const command of [
        "gh pr create",
        "gh api repos/org/repo",
        "gh api repos/org/repo -X POST",
        "gh auth status",
        "gh auth status --show-token",
        "gh auth status -t",
      ]) {
        expect(Permission.resolve("bash", command, rules)).toEqual({
          permission: "bash",
          pattern: "gh *",
          action: name === "explore" ? "deny" : "ask",
        })
      }
    })

    test("keeps shell operators denied after the gh allows", () => {
      for (const command of ["gh pr view 1 | tee x", "gh pr view 1 > x", "gh pr view 1; touch x"]) {
        expect(Permission.resolve("bash", command, rules).action, command).toBe("deny")
      }
    })
  })
}
