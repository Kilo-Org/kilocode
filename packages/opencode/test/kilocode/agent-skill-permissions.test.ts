// kilocode_change - new file
import { afterEach, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"

afterEach(async () => {
  await Instance.disposeAll()
})

function action(name: string, ruleset: Permission.Ruleset) {
  return Permission.evaluate("skill", name, ruleset).action
}

test("skill tool available for non-system native agents and denied for system agents", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const allow = ["code", "plan", "debug", "orchestrator", "ask", "general", "explore"]
      for (const name of allow) {
        const agent = await Agent.get(name)
        expect(agent).toBeDefined()
        expect(action("using-superpowers", agent!.permission)).toBe("allow")
        expect(Permission.disabled(["skill"], agent!.permission).has("skill")).toBe(false)
      }

      const deny = ["compaction", "title", "summary"]
      for (const name of deny) {
        const agent = await Agent.get(name)
        expect(agent).toBeDefined()
        expect(action("using-superpowers", agent!.permission)).toBe("deny")
        expect(Permission.disabled(["skill"], agent!.permission).has("skill")).toBe(true)
      }
    },
  })
})
