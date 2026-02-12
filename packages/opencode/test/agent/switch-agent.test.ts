// kilocode_change - new file
import { test, expect, describe } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"

function evalPerm(agent: Agent.Info | undefined, permission: string, pattern = "*"): PermissionNext.Action | undefined {
  if (!agent) return undefined
  return PermissionNext.evaluate(permission, pattern, agent.permission).action
}

describe("switch_agent permissions", () => {
  test("code agent can switch agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const code = await Agent.get("code")
        expect(evalPerm(code, "switch_agent")).toBe("ask")
      },
    })
  })

  test("plan agent can switch agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plan = await Agent.get("plan")
        expect(evalPerm(plan, "switch_agent")).toBe("ask")
      },
    })
  })

  test("debug agent can switch agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const debug = await Agent.get("debug")
        expect(evalPerm(debug, "switch_agent")).toBe("ask")
      },
    })
  })

  test("orchestrator agent can switch agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const orchestrator = await Agent.get("orchestrator")
        expect(evalPerm(orchestrator, "switch_agent")).toBe("ask")
      },
    })
  })

  test("general subagent cannot switch agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const general = await Agent.get("general")
        expect(evalPerm(general, "switch_agent")).toBe("deny")
      },
    })
  })

  test("explore subagent cannot switch agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const explore = await Agent.get("explore")
        expect(evalPerm(explore, "switch_agent")).toBe("deny")
      },
    })
  })

  test("compaction agent cannot switch agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const compaction = await Agent.get("compaction")
        expect(evalPerm(compaction, "switch_agent")).toBe("deny")
      },
    })
  })

  test("user config can deny switch_agent", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          code: {
            permission: {
              switch_agent: "deny",
            },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const code = await Agent.get("code")
        expect(evalPerm(code, "switch_agent")).toBe("deny")
      },
    })
  })

  test("user config can allow switch_agent without prompting", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          code: {
            permission: {
              switch_agent: "allow",
            },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const code = await Agent.get("code")
        expect(evalPerm(code, "switch_agent")).toBe("allow")
      },
    })
  })
})
