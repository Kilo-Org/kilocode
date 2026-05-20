import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { WithInstance } from "../../src/project/with-instance"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await disposeAllInstances()
})

test("code agent defaults edit and bash to ask on clean config", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const code = await load(tmp.path, (svc) => svc.get("code"))
      expect(code).toBeDefined()
      expect(Permission.evaluate("edit", "src/index.ts", code!.permission).action).toBe("ask")
      expect(Permission.evaluate("bash", "ls -la", code!.permission).action).toBe("ask")
      // read and search tools remain non-destructive
      expect(Permission.evaluate("read", "src/index.ts", code!.permission).action).toBe("allow")
      expect(Permission.evaluate("grep", "*", code!.permission).action).toBe("allow")
      expect(Permission.evaluate("glob", "*", code!.permission).action).toBe("allow")
    },
  })
})

test("code agent respects explicit edit:allow user override", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        edit: "allow",
        bash: "allow",
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const code = await load(tmp.path, (svc) => svc.get("code"))
      expect(code).toBeDefined()
      expect(Permission.evaluate("edit", "src/index.ts", code!.permission).action).toBe("allow")
      expect(Permission.evaluate("bash", "npm install", code!.permission).action).toBe("allow")
    },
  })
})

test("code agent respects explicit edit:deny user override", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        edit: "deny",
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const code = await load(tmp.path, (svc) => svc.get("code"))
      expect(code).toBeDefined()
      expect(Permission.evaluate("edit", "src/index.ts", code!.permission).action).toBe("deny")
    },
  })
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

  await WithInstance.provide({
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

  await WithInstance.provide({
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

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(plan).toBeDefined()
      expect(Permission.evaluate("edit", "src/output.log", plan!.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", ".kilo/plans/fix.md", plan!.permission).action).toBe("allow")
    },
  })
})
