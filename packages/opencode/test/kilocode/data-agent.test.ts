import { expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

const it = testEffect(Agent.defaultLayer)

it.instance("registers the native Data agent with Code permissions", () =>
  Effect.gen(function* () {
    const svc = yield* Agent.Service
    const list = yield* svc.list()
    const data = yield* svc.get("data")
    const code = yield* svc.get("code")

    expect(list.map((item) => item.name)).toContain("data")
    expect(data).toBeDefined()
    expect(code).toBeDefined()
    if (!data || !code) return

    expect(data.mode).toBe("primary")
    expect(data.native).toBe(true)
    expect(data.hidden).not.toBe(true)
    expect(data.color).toBe("#2563EB")
    expect(data.description).toBe("Run notebook-first data analysis by appending and executing cells for each request.")
    expect(data.model).toBeUndefined()
    expect(data.variant).toBeUndefined()
    expect(data.temperature).toBeUndefined()
    expect(data.topP).toBeUndefined()
    expect(data.steps).toBeUndefined()
    expect(data.permission).not.toBe(code.permission)

    const checks = [
      { permission: "edit", pattern: "analysis.py", action: "allow" },
      { permission: "bash", pattern: "python analysis.py", action: "ask" },
      { permission: "skill", pattern: "data-investigation", action: "allow" },
      { permission: "task", pattern: "general", action: "allow" },
      { permission: "todoread", pattern: "*", action: "allow" },
      { permission: "todowrite", pattern: "*", action: "allow" },
    ] as const
    for (const check of checks) {
      expect(Permission.evaluate(check.permission, check.pattern, data.permission).action).toBe(check.action)
      expect(Permission.evaluate(check.permission, check.pattern, code.permission).action).toBe(check.action)
    }

    expect(data.prompt).toContain("Use an active Jupyter notebook as the working surface")
    expect(data.prompt).toContain("If no notebook is active, create a uniquely named, descriptive `<topic>.ipynb`")
    expect(data.prompt).toContain("For every user request, append at least one focused code cell and execute it")
    expect(data.prompt).toContain("do not modify or delete existing cells unless explicitly asked")
    expect(yield* svc.defaultAgent()).toBe("code")
  }),
)
