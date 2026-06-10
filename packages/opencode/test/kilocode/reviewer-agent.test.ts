import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { WithInstance } from "../../src/project/with-instance"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"

function perm(agent: Agent.Info | undefined, name: string): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate(name, "*", agent.permission).action
}

function bash(agent: Agent.Info | undefined, command: string): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate("bash", command, agent.permission).action
}

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await disposeAllInstances()
})

test("registers reviewer as a hidden read-only primary agent", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const reviewer = await load(tmp.path, (svc) => svc.get("reviewer"))

      expect(reviewer).toBeDefined()
      expect(reviewer?.mode).toBe("primary")
      expect(reviewer?.hidden).toBe(true)
      expect(reviewer?.native).toBe(true)
      expect(reviewer?.prompt).toBeTruthy()
      expect(perm(reviewer, "edit")).toBe("deny")
      expect(perm(reviewer, "task")).toBe("allow")
      expect(perm(reviewer, "read")).toBe("allow")
      expect(perm(reviewer, "grep")).toBe("allow")
      expect(perm(reviewer, "glob")).toBe("allow")
      expect(bash(reviewer, "git merge-base HEAD main")).toBe("allow")
      expect(bash(reviewer, "git show-ref --verify --quiet refs/heads/main")).toBe("allow")
      expect(bash(reviewer, "git -c core.quotepath=false diff HEAD")).toBe("allow")
      expect(bash(reviewer, "touch file")).toBe("deny")
    },
  })
})

test("keeps reviewer available when config disables reviewer", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        reviewer: { disable: true },
      },
    },
  })

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const reviewer = await load(tmp.path, (svc) => svc.get("reviewer"))

      expect(reviewer).toBeDefined()
      expect(reviewer?.mode).toBe("primary")
      expect(reviewer?.hidden).toBe(true)
      expect(reviewer?.native).toBe(true)
      expect(perm(reviewer, "edit")).toBe("deny")
    },
  })
})

test("ignores reviewer config that would change prompt or permissions", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        reviewer: {
          prompt: "custom reviewer prompt",
          mode: "subagent",
          hidden: false,
          permission: {
            edit: "allow",
            bash: "allow",
            task: "deny",
          },
        },
      },
    },
  })

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const reviewer = await load(tmp.path, (svc) => svc.get("reviewer"))

      expect(reviewer).toBeDefined()
      expect(reviewer?.mode).toBe("primary")
      expect(reviewer?.hidden).toBe(true)
      expect(reviewer?.prompt).not.toBe("custom reviewer prompt")
      expect(perm(reviewer, "edit")).toBe("deny")
      expect(perm(reviewer, "task")).toBe("allow")
      expect(bash(reviewer, "touch file")).toBe("deny")
      expect(bash(reviewer, "git status")).toBe("allow")
    },
  })
})
