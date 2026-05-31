// kilocode_change - new file
import { expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"

const it = testEffect(Agent.defaultLayer)

function action(name: string, ruleset: Permission.Ruleset) {
  return Permission.evaluate("skill", name, ruleset).action
}

it.instance("skill tool available for non-system native agents and denied for system agents", () =>
  Effect.gen(function* () {
    const svc = yield* Agent.Service
    const allow = ["code", "plan", "debug", "orchestrator", "ask", "general", "explore"]
    for (const name of allow) {
      const agent = yield* svc.get(name)
      expect(agent).toBeDefined()
      expect(action("using-superpowers", agent!.permission)).toBe("allow")
      expect(Permission.disabled(["skill"], agent!.permission).has("skill")).toBe(false)
    }

    const deny = ["compaction", "title", "summary"]
    for (const name of deny) {
      const agent = yield* svc.get(name)
      expect(agent).toBeDefined()
      expect(action("using-superpowers", agent!.permission)).toBe("deny")
      expect(Permission.disabled(["skill"], agent!.permission).has("skill")).toBe(true)
    }
  }),
)
