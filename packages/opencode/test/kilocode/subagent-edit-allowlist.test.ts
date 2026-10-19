import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { afterEach, describe, expect, test } from "bun:test"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { deriveSubagentSessionPermission } from "../../src/agent/subagent-permissions"
import { PermissionAllowlist } from "../../src/kilocode/permission/allowlist"
import { KiloTask } from "../../src/kilocode/tool/task"
import { Permission } from "../../src/permission"
import {
  disposeAllInstances,
  provideInstance,
  provideTestInstance,
  testInstanceStoreLayer,
  tmpdir,
} from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    provideInstance(dir)(Agent.Service.use(fn)).pipe(
      Effect.provide(AppNodeBuilder.build(Agent.node)),
      Effect.provide(testInstanceStoreLayer),
    ),
  )
}

async function agents(config: Partial<ConfigV1.Info>, names: string[]) {
  await using tmp = await tmpdir({ config })
  return await provideTestInstance({
    directory: tmp.path,
    fn: () => Promise.all(names.map((name) => load(tmp.path, (svc) => svc.get(name)))),
  })
}

// Mirror src/tool/task.ts: the child's session permission is the derived subagent
// permission plus KiloTask.permissions(inherited(...)), and the runtime evaluates
// merge(subagent.permission, session.permission).
function child(caller: Agent.Info, subagent: Agent.Info, session: Permission.Ruleset = []) {
  const permission = KiloTask.merge(
    deriveSubagentSessionPermission({ parentSessionPermission: session, subagent }),
    KiloTask.permissions(KiloTask.inherited({ caller, session: { permission: [...session] }, mcp: undefined })),
  )
  return Permission.merge(subagent.permission, permission)
}

const scoped: ConfigPermissionV1.Info = {
  edit: {
    "*": "deny",
    "candidate/*/*.md": "allow",
    "candidate/profile.md": "allow",
    "candidate/jobs.db": "allow",
  },
}

const worker: NonNullable<ConfigV1.Info["agent"]>[string] = {
  description: "A writable worker",
  mode: "subagent" as const,
  permission: {
    edit: {
      "*": "deny",
      "candidate/*/*.md": "allow",
      "candidate/_uploads/*": "deny",
      "candidate/profile.md": "allow",
      "candidate/jobs.db": "allow",
    },
  },
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("PermissionAllowlist", () => {
  test("a catch-all deny followed by path allows is an allowlist baseline", () => {
    const rules: Permission.Ruleset = [
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "candidate/*/*.md", action: "allow" },
    ]
    expect(PermissionAllowlist.exceptions("edit", rules)).toBe(true)
  })

  test("a catch-all deny with no later exception is a blanket deny", () => {
    const rules: Permission.Ruleset = [{ permission: "edit", pattern: "*", action: "deny" }]
    expect(PermissionAllowlist.exceptions("edit", rules)).toBe(false)
  })

  test("path allows before the catch-all do not count as exceptions", () => {
    const rules: Permission.Ruleset = [
      { permission: "edit", pattern: "candidate/*/*.md", action: "allow" },
      { permission: "edit", pattern: "*", action: "deny" },
    ]
    expect(PermissionAllowlist.exceptions("edit", rules)).toBe(false)
  })

  test("a global catch-all rule applies to a named permission", () => {
    const rules: Permission.Ruleset = [
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "candidate/*/*.md", action: "allow" },
    ]
    expect(PermissionAllowlist.catchAll("edit", rules)?.permission).toBe("*")
    expect(PermissionAllowlist.exceptions("edit", rules)).toBe(true)
  })
})

test("writable allowlist caller keeps edit tools available to a delegated subagent", async () => {
  const [lead, item] = await agents(
    {
      permission: { edit: { "*": "allow" } },
      agent: { lead: { description: "Delegating lead", mode: "primary", permission: scoped }, worker },
    },
    ["lead", "worker"],
  )
  expect(lead).toBeDefined()
  expect(item).toBeDefined()

  const inherited = KiloTask.inherited({ caller: lead!, session: { permission: [] }, mcp: undefined })
  expect(inherited).not.toContainEqual({ permission: "edit", pattern: "*", action: "deny" })

  const runtime = child(lead!, item!)
  expect(Permission.disabled(["edit", "write", "apply_patch"], runtime)).toEqual(new Set())
  expect(Permission.evaluate("edit", "candidate/a/b.md", runtime).action).toBe("allow")
  expect(Permission.evaluate("edit", "candidate/profile.md", runtime).action).toBe("allow")
  expect(Permission.evaluate("edit", "candidate/jobs.db", runtime).action).toBe("allow")
  expect(Permission.evaluate("edit", "candidate/_uploads/a.md", runtime).action).toBe("deny")
  expect(Permission.evaluate("edit", "src/index.ts", runtime).action).toBe("deny")
})

test("a caller's specific deny still reaches the child", async () => {
  const [lead, item] = await agents(
    {
      agent: {
        lead: {
          description: "Delegating lead",
          mode: "primary",
          permission: {
            edit: { "*": "deny", "candidate/*/*.md": "allow", "secrets/*": "deny" },
          },
        },
        worker: { ...worker, permission: { edit: "allow" as const } },
      },
    },
    ["lead", "worker"],
  )

  const runtime = child(lead!, item!)
  expect(Permission.disabled(["edit", "write", "apply_patch"], runtime)).toEqual(new Set())
  expect(Permission.evaluate("edit", "secrets/a.txt", runtime).action).toBe("deny")
  expect(Permission.evaluate("edit", "notes/a.md", runtime).action).toBe("allow")
})

test("a caller's true blanket deny still hides edit tools", async () => {
  const [lead, item] = await agents(
    {
      agent: {
        lead: { description: "Read-write lead", mode: "primary", permission: { edit: "deny" } },
        worker: { ...worker, permission: { edit: "allow" as const } },
      },
    },
    ["lead", "worker"],
  )

  const inherited = KiloTask.inherited({ caller: lead!, session: { permission: [] }, mcp: undefined })
  expect(inherited).toContainEqual({ permission: "edit", pattern: "*", action: "deny" })

  const runtime = child(lead!, item!)
  expect(Permission.disabled(["edit", "write", "apply_patch"], runtime)).toEqual(
    new Set(["edit", "write", "apply_patch"]),
  )
})

test("Plan delegation keeps the read-only ceiling", async () => {
  const [plan, item] = await agents({ agent: { worker } }, ["plan", "worker"])
  expect(plan).toBeDefined()

  const inherited = KiloTask.inherited({ caller: plan!, session: { permission: [] }, mcp: undefined })
  expect(inherited).toContainEqual({ permission: "edit", pattern: "*", action: "deny" })

  const runtime = child(plan!, item!)
  expect(Permission.disabled(["edit", "write", "apply_patch"], runtime)).toEqual(
    new Set(["edit", "write", "apply_patch"]),
  )
  expect(Permission.evaluate("edit", "candidate/a/b.md", runtime).action).toBe("deny")
})

test("a user-level deny-all keeps the ceiling for a custom primary", async () => {
  const [lead, item] = await agents(
    {
      permission: { "*": "deny" },
      agent: { lead: { description: "Delegating lead", mode: "primary", permission: scoped }, worker },
    },
    ["lead", "worker"],
  )

  const runtime = child(lead!, item!)
  expect(Permission.disabled(["edit", "write", "apply_patch"], runtime)).toEqual(
    new Set(["edit", "write", "apply_patch"]),
  )
})

test("refresh drops stale flattened denies the fresh ceiling no longer reproduces", () => {
  const stale: Permission.Ruleset = [
    { permission: "edit", pattern: "*", action: "deny" },
    { permission: "task", pattern: "*", action: "deny" },
    { permission: "edit", pattern: "secrets/*", action: "deny" },
  ]
  const result = KiloTask.refresh(stale, [])
  expect(result).not.toContainEqual({ permission: "edit", pattern: "*", action: "deny" })
  // `task` is in the mutation set, so a stale catch-all only survives when the fresh ceiling keeps it.
  expect(result).not.toContainEqual({ permission: "task", pattern: "*", action: "deny" })
  expect(result).toContainEqual({ permission: "edit", pattern: "secrets/*", action: "deny" })
})

test("refresh keeps a blanket deny the fresh ceiling still requires", () => {
  const stale: Permission.Ruleset = [{ permission: "edit", pattern: "*", action: "deny" }]
  const fresh: Permission.Ruleset = [{ permission: "edit", pattern: "*", action: "deny" }]
  expect(KiloTask.refresh(stale, fresh)).toEqual([{ permission: "edit", pattern: "*", action: "deny" }])
})
