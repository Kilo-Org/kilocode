import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { provideTestInstance } from "../fixture/fixture"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
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
