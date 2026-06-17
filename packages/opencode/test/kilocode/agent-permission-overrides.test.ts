import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Agent } from "../../src/agent/agent"
import { processConfigItem } from "../../src/kilocode/agent"
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

test("plan agent preserves plan file edits after per-agent edit deny", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        plan: {
          permission: {
            "*": "deny",
            edit: { "*": "deny" },
          },
        },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(plan).toBeDefined()
      expect(Permission.evaluate("plan_exit", "*", plan!.permission).action).toBe("allow")
      expect(Permission.disabled(["write"], plan!.permission).has("write")).toBe(false)
      expect(Permission.evaluate("edit", "src/output.log", plan!.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", ".kilo/plans/fix.md", plan!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", "plans/fix.md", plan!.permission).action).toBe("allow")
    },
  })
})

test("architect agent receives plan file permissions", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        architect: {
          mode: "primary",
          permission: {
            "*": "deny",
            read: "allow",
            edit: {
              "*.md": "allow",
              "*": "deny",
            },
          },
        },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.get("architect"))
      expect(agent).toBeDefined()
      expect(Permission.evaluate("plan_exit", "*", agent!.permission).action).toBe("allow")
      expect(Permission.disabled(["write"], agent!.permission).has("write")).toBe(false)
      expect(Permission.evaluate("edit", "src/output.log", agent!.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", ".kilo/plans/fix.md", agent!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", "plans/fix.md", agent!.permission).action).toBe("allow")
    },
  })
})

test("root workspace plan-like agent allows configured local and global plan paths", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        architect: {
          mode: "primary",
          permission: {
            "*": "deny",
            edit: {
              "*": "deny",
              "docs/*.md": "allow",
            },
          },
        },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async (ctx) => {
      const agent = await load(tmp.path, (svc) => svc.get("architect"))
      const docs = path.relative(ctx.worktree, path.join(tmp.path, "docs", "test-session.md"))
      const local = path.relative(ctx.worktree, path.join(tmp.path, ".kilo", "plans", "test-session.md"))
      const global = path.join(Global.Path.data, "plans", "test-session.md")

      expect(ctx.worktree).toBe("/")
      expect(Permission.evaluate("edit", docs, agent!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", local, agent!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", path.relative(ctx.worktree, global), agent!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", global, agent!.permission).action).toBe("allow")
      expect(Permission.evaluate("external_directory", global, agent!.permission).action).toBe("allow")
      expect(
        Permission.evaluate(
          "edit",
          path.relative(ctx.worktree, path.join(tmp.path, "src", "main.ts")),
          agent!.permission,
        ).action,
      ).toBe("deny")
    },
  })
})

test("root workspace scopes Windows drive paths", () => {
  const dir = String.raw`C:\Users\developer\projects\EAM_SLA`
  const global = String.raw`C:\Users\developer\.local\share\kilo\plans`
  const rules = Permission.fromConfig({
    "*": "deny",
    edit: {
      "*": "deny",
      "docs/*.md": "allow",
      [path.win32.join(global, "*.md")]: "allow",
    },
  })
  const agent = { name: "architect", permission: rules, options: {} }
  const request = (file: string) => (process.platform === "win32" ? path.win32.relative("/", file) : file)

  processConfigItem("architect", agent, { worktree: "/", directory: dir }, rules)

  expect(
    Permission.evaluate("edit", request(path.win32.join(dir, "docs", "test-session.md")), agent.permission).action,
  ).toBe("allow")
  expect(
    Permission.evaluate("edit", request(path.win32.join(dir, ".kilo", "plans", "test-session.md")), agent.permission)
      .action,
  ).toBe("allow")
  expect(
    Permission.evaluate("edit", request(path.win32.join(global, "test-session.md")), agent.permission).action,
  ).toBe("allow")
  expect(Permission.evaluate("edit", request(path.win32.join(dir, "src", "main.ts")), agent.permission).action).toBe(
    "deny",
  )
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
