import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { afterEach, describe, expect, test } from "bun:test"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { AutonomousAgents } from "@/kilocode/autonomous/agents"
import { disposeAllInstances, provideInstance, provideTestInstance, testInstanceStoreLayer, tmpdir } from "../../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    provideInstance(dir)(Agent.Service.use(fn)).pipe(
      Effect.provide(AppNodeBuilder.build(Agent.node)),
      Effect.provide(testInstanceStoreLayer),
    ),
  )
}

async function agents(config: Partial<ConfigV1.Info>) {
  await using tmp = await tmpdir({ config })
  return await provideTestInstance({
    directory: tmp.path,
    fn: () => load(tmp.path, (svc) => svc.list()),
  })
}

afterEach(async () => {
  await disposeAllInstances()
})

const action = (agent: Agent.Info, permission: string, pattern: string) =>
  Permission.evaluate(permission, pattern, agent.permission).action

describe("autonomous agents", () => {
  test("are not registered unless the engine is enabled", async () => {
    const list = await agents({})
    expect(list.some((a) => a.name.startsWith("autonomous-"))).toBe(false)
  })

  test("worker may edit and run checks but never push, sudo or ask", async () => {
    const list = await agents({ autonomous_goal: { enabled: true }, permission: { bash: { "git push *": "allow" } } })
    const worker = list.find((a) => a.name === AutonomousAgents.WORKER)!
    expect(worker).toBeDefined()
    expect(worker.hidden).toBe(true)
    expect(worker.mode).toBe("subagent")
    expect(action(worker, "edit", "src/a.ts")).toBe("allow")
    expect(action(worker, "write", "src/a.ts")).toBe("allow")
    expect(action(worker, "bash", "bun test ./x")).toBe("allow")
    expect(action(worker, "bash", "git status")).toBe("allow")
    expect(action(worker, "bash", "git push origin main")).toBe("deny")
    expect(action(worker, "bash", "sudo rm x")).toBe("deny")
    expect(action(worker, "bash", "rm -rf node_modules")).toBe("deny")
    expect(action(worker, "bash", "npm publish")).toBe("deny")
    expect(action(worker, "bash", "git commit -m x")).toBe("deny")
    // Alternate spellings that reach the same forbidden programs.
    expect(action(worker, "bash", "git -C repo push origin main")).toBe("deny")
    expect(action(worker, "bash", "git -c user.name=x push")).toBe("deny")
    expect(action(worker, "bash", "/usr/bin/git push")).toBe("deny")
    expect(action(worker, "bash", "command git push")).toBe("deny")
    expect(action(worker, "bash", "env GIT_DIR=.git git push")).toBe("deny")
    expect(action(worker, "bash", "sh -c 'git push'")).toBe("deny")
    expect(action(worker, "bash", "bash -lc 'rm -rf /'")).toBe("deny")
    expect(action(worker, "bash", "rm -r -f node_modules")).toBe("deny")
    expect(action(worker, "bash", "rm --recursive --force x")).toBe("deny")
    expect(action(worker, "bash", "rm x -rf")).toBe("deny")
    expect(action(worker, "bash", "git -C repo status")).toBe("allow")
    expect(action(worker, "bash", "rm file.txt")).toBe("allow")
    expect(action(worker, "question", "*")).toBe("deny")
    expect(action(worker, "task", "general")).toBe("deny")
    expect(action(worker, "goal", "start")).toBe("deny")
  })

  test("user denies are kept for the worker", async () => {
    const list = await agents({ autonomous_goal: { enabled: true }, permission: { edit: { "secrets/*": "deny" } } })
    const worker = list.find((a) => a.name === AutonomousAgents.WORKER)!
    expect(action(worker, "edit", "secrets/key.pem")).toBe("deny")
    expect(action(worker, "edit", "src/a.ts")).toBe("allow")
  })

  test("planner, reviewer, checker and final are read-only", async () => {
    const list = await agents({ autonomous_goal: { enabled: true } })
    for (const name of [AutonomousAgents.PLANNER, AutonomousAgents.REVIEWER, AutonomousAgents.CHECKER, AutonomousAgents.FINAL]) {
      const agent = list.find((a) => a.name === name)!
      expect(agent).toBeDefined()
      expect(action(agent, "read", "src/a.ts")).toBe("allow")
      expect(action(agent, "grep", "*")).toBe("allow")
      expect(action(agent, "edit", "src/a.ts")).toBe("deny")
      expect(action(agent, "write", "src/a.ts")).toBe("deny")
      expect(action(agent, "bash", "git diff HEAD")).toBe("allow")
      expect(action(agent, "bash", "git push origin main")).toBe("deny")
      expect(action(agent, "bash", "bun test")).toBe("deny")
      expect(action(agent, "bash", "find . -delete")).toBe("deny")
      expect(action(agent, "question", "*")).toBe("deny")
      expect(action(agent, "task", "explore")).toBe("deny")
    }
  })
})
