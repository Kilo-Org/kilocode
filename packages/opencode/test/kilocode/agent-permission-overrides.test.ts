import { afterEach, expect, test } from "bun:test"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { provideTestInstance } from "../fixture/fixture"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    provideInstance(dir)(Agent.Service.use(fn)).pipe(
      Effect.provide(Agent.defaultLayer),
      Effect.provide(testInstanceStoreLayer),
    ),
  )
}

async function get(config: Partial<ConfigV1.Info>, name = "plan") {
  await using tmp = await tmpdir({ config })
  const item = await provideTestInstance({
    directory: tmp.path,
    fn: () => load(tmp.path, (svc) => svc.get(name)),
  })
  return item
}

function expectPlan(item: Agent.Info | undefined, action: Permission.Action = "allow") {
  expect(item).toBeDefined()
  expect(Permission.evaluate("edit", "src/output.log", item!.permission).action).toBe("deny")
  expect(Permission.evaluate("edit", ".kilo/plans/fix.md", item!.permission).action).toBe(action)
}

afterEach(async () => {
  await disposeAllInstances()
})

test("ask agent honors user MCP allow over generated ask rule", async () => {
  await using tmp = await tmpdir({
    config: {
      mcp: {
        context7: { type: "local", command: ["context7"] },
      },
      permission: {
        "context7_query-docs": { "*": "allow" },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      expect(ask).toBeDefined()
      expect(Permission.evaluate("context7_query-docs", "*", ask!.permission).action).toBe("allow")
    },
  })
})

test("plan agent honors user bash allow over read-only deny default", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        bash: { "cargo search *": "allow" },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(plan).toBeDefined()
      expect(Permission.evaluate("bash", "cargo search serde", plan!.permission).action).toBe("allow")
    },
  })
})

test("plan agent still hard-denies non-plan edits after user edit allow", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        edit: { "src/output.log": "allow" },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(plan).toBeDefined()
      expect(Permission.evaluate("edit", "src/output.log", plan!.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", ".kilo/plans/fix.md", plan!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", "plans/fix.md", plan!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", ".plans/fix.md", plan!.permission).action).toBe("allow")
    },
  })
})

test("plan agent still hard-denies non-plan edits after per-agent edit ask", async () => {
  const plan = await get(
    {
      agent: {
        plan: {
          permission: {
            edit: "ask",
          },
        },
      },
    },
  )
  expectPlan(plan)
})

test("plan agent honors global and per-agent plan allows after wildcard edit deny", async () => {
  const edit = {
    "*": "deny" as const,
    ".kilo/plans/*": "allow" as const,
  }
  for (const config of [
    { permission: { edit } },
    {
      agent: {
        plan: {
          permission: {
            edit,
          },
        },
      },
    },
  ]) {
    expectPlan(await get(config))
  }
})

test("plan agent preserves scalar edit deny", async () => {
  const plan = await get(
    {
      agent: {
        plan: {
          permission: {
            edit: "deny",
          },
        },
      },
    },
  )
  expectPlan(plan, "deny")
})

test("plan agent preserves a terminal wildcard edit deny", async () => {
  const plan = await get(
    {
      agent: {
        plan: {
          permission: {
            edit: {
              ".kilo/plans/*": "allow",
              "*": "deny",
            },
          },
        },
      },
    },
  )
  expectPlan(plan, "deny")
})

test("plan agent preserves explicit per-agent edit denies", async () => {
  const plan = await get(
    {
      agent: {
        plan: {
          permission: {
            edit: {
              ".kilo/plans/private.md": "deny",
            },
          },
        },
      },
    },
  )
  expectPlan(plan)
  expect(Permission.evaluate("edit", ".kilo/plans/private.md", plan!.permission).action).toBe("deny")
})

test("plan agent preserves global edit denies after per-agent edit ask", async () => {
  const plan = await get(
    {
      permission: {
        edit: {
          ".kilo/plans/private.md": "deny",
        },
      },
      agent: {
        plan: {
          permission: {
            edit: "ask",
          },
        },
      },
    },
  )
  expectPlan(plan)
  expect(Permission.evaluate("edit", ".kilo/plans/private.md", plan!.permission).action).toBe("deny")
})

test("plan agent preserves global non-edit denies before broader allows", async () => {
  const plan = await get({
    permission: {
      bash: {
        "rm *": "deny",
        "*": "allow",
      },
    },
  })
  expect(Permission.evaluate("bash", "rm -rf x", plan!.permission).action).toBe("deny")
  expect(Permission.evaluate("bash", "ls", plan!.permission).action).toBe("allow")
})

test("plan agent preserves per-agent tool allows with a wildcard deny", async () => {
  const plan = await get(
    {
      agent: {
        plan: {
          permission: {
            "*": "deny",
            read: "allow",
            glob: "allow",
            edit: "ask",
          },
        },
      },
    },
  )
  expectPlan(plan)
  expect(Permission.evaluate("read", "src/output.log", plan!.permission).action).toBe("allow")
  expect(Permission.evaluate("glob", "*", plan!.permission).action).toBe("allow")
})

test("marketplace architect honors plan allow after wildcard edit deny", async () => {
  const architect = await get(
    {
      agent: {
        architect: {
          mode: "primary",
          options: {
            displayName: "Architect",
          },
          permission: {
            "*": "deny",
            read: "allow",
            glob: "allow",
            edit: {
              "*": "deny",
              ".kilo/plans/*": "allow",
            },
          },
        },
      },
    },
    "architect",
  )
  expectPlan(architect)
  expect(architect!.name).toBe("architect")
  expect(architect!.displayName).toBe("Architect")
  expect(Permission.evaluate("read", "src/output.log", architect!.permission).action).toBe("allow")
  expect(Permission.evaluate("glob", "*", architect!.permission).action).toBe("allow")
})

test("non-planning agents retain per-agent edit permissions", async () => {
  const code = await get(
    {
      agent: {
        code: {
          permission: {
            edit: "ask",
          },
        },
      },
    },
    "code",
  )
  expect(code).toBeDefined()
  expect(Permission.evaluate("edit", "src/output.log", code!.permission).action).toBe("ask")
})

test("system utility agents ignore per-agent permission allows", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        title: {
          permission: {
            bash: "allow",
          },
        },
        summary: {
          permission: {
            read: "allow",
          },
        },
        compaction: {
          permission: {
            skill: "allow",
          },
        },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const title = await load(tmp.path, (svc) => svc.get("title"))
      const summary = await load(tmp.path, (svc) => svc.get("summary"))
      const compaction = await load(tmp.path, (svc) => svc.get("compaction"))
      expect(title).toBeDefined()
      expect(summary).toBeDefined()
      expect(compaction).toBeDefined()
      expect(Permission.evaluate("bash", "*", title!.permission).action).toBe("deny")
      expect(Permission.evaluate("read", "*", summary!.permission).action).toBe("deny")
      expect(Permission.evaluate("skill", "using-superpowers", compaction!.permission).action).toBe("deny")
    },
  })
})

test("system utility agents deny tools after configured name override", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        title: {
          name: "custom-title",
          permission: {
            bash: "allow",
            read: "allow",
            skill: "allow",
          },
        },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const title = await load(tmp.path, (svc) => svc.get("title"))
      expect(title).toBeDefined()
      expect(title?.name).toBe("custom-title")
      expect(Permission.evaluate("bash", "*", title!.permission).action).toBe("deny")
      expect(Permission.evaluate("read", "README.md", title!.permission).action).toBe("deny")
      expect(Permission.evaluate("skill", "using-superpowers", title!.permission).action).toBe("deny")
    },
  })
})
