import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { deriveSubagentSessionPermission } from "../../src/agent/subagent-permissions"
import type { Config } from "../../src/config/config"
import { KiloTask } from "../../src/kilocode/tool/task"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Agent.node))
const tools = ["write", "edit", "apply_patch"]
const config = {
  agent: {
    "job-scout": {
      mode: "primary",
      permission: { edit: "deny", task: { "career-consultant": "allow" } },
    },
    "career-consultant": {
      mode: "subagent",
      permission: {
        edit: {
          "*": "deny",
          "candidate/*/*.md": "allow",
          "candidate/_uploads/*": "deny",
          "candidate/profile.md": "allow",
          "candidate/jobs.db": "allow",
          "candidate/review.md": "ask",
        },
      },
    },
  },
} satisfies Partial<Config.Info>

function policy(caller: Agent.Info, child: Agent.Info, permission: Permission.Ruleset = []) {
  return Permission.merge(
    child.permission,
    KiloTask.merge(
      deriveSubagentSessionPermission({ parentSessionPermission: [...permission], subagent: child }),
      KiloTask.permissions(KiloTask.inherited({ caller, session: { permission: [...permission] }, mcp: {} })),
    ),
  )
}

it.instance(
  "a custom read-only delegator preserves its writer's scoped edit policy",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const caller = yield* agents.get("job-scout")
      const child = yield* agents.get("career-consultant")
      expect(caller.native).toBe(false)
      expect(Permission.evaluate("edit", "candidate/profile.md", caller.permission).action).toBe("deny")
      const rules = policy(caller, child)
      expect(Permission.disabled(tools, rules)).toEqual(new Set())
      for (const file of ["candidate/profile.md", "candidate/jobs.db", "candidate/reports/summary.md"]) {
        expect(Permission.evaluate("edit", file, rules).action).toBe("allow")
      }
      for (const file of ["candidate/_uploads/private.md", "src/app.ts"]) {
        expect(Permission.evaluate("edit", file, rules).action).toBe("deny")
      }
      expect(Permission.evaluate("edit", "candidate/review.md", rules).action).toBe("ask")
    }),
  { config },
)

it.instance(
  "a custom caller's catch-all denial does not synthesize an edit ceiling",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const caller = yield* agents.get("job-scout")
      const child = yield* agents.get("career-consultant")
      const rules = policy({ ...caller, permission: Permission.fromConfig({ "*": "deny", task: "allow" }) }, child)
      expect(Permission.disabled(tools, rules)).toEqual(new Set())
      expect(Permission.evaluate("edit", "candidate/profile.md", rules).action).toBe("allow")
      expect(Permission.evaluate("edit", "src/app.ts", rules).action).toBe("deny")
    }),
  { config },
)

for (const permission of [Permission.fromConfig({ edit: "deny" }), Permission.fromConfig({ "*": "deny" })]) {
  it.instance(
    `custom delegation preserves the session's ${permission.at(0)?.permission} lockdown`,
    () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const caller = yield* agents.get("job-scout")
        const child = yield* agents.get("career-consultant")
        const rules = policy(caller, child, permission)
        expect(Permission.disabled(tools, rules)).toEqual(new Set(tools))
        expect(Permission.evaluate("edit", "candidate/profile.md", rules).action).toBe("deny")
      }),
    { config },
  )
}

it.instance(
  "custom delegation preserves session-specific edit denials",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const caller = yield* agents.get("job-scout")
      const child = yield* agents.get("career-consultant")
      const rules = policy(caller, child, Permission.fromConfig({ edit: { "candidate/jobs.db": "deny" } }))
      expect(Permission.evaluate("edit", "candidate/jobs.db", rules).action).toBe("deny")
      expect(Permission.evaluate("edit", "candidate/profile.md", rules).action).toBe("allow")
    }),
  { config },
)

it.instance(
  "Plan edit restrictions survive delegation through a custom intermediate agent",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const plan = yield* agents.get("plan")
      const caller = yield* agents.get("job-scout")
      const child = yield* agents.get("career-consultant")
      const inherited = KiloTask.inherited({ caller: plan, session: { permission: [] }, mcp: {} })
      const rules = policy(caller, child, KiloTask.permissions(inherited))
      expect(Permission.disabled(tools, rules)).toEqual(new Set(tools))
      expect(Permission.evaluate("edit", "candidate/profile.md", rules).action).toBe("deny")
      expect(Permission.evaluate("notebook_edit", "notebook.ipynb", rules).action).toBe("deny")
    }),
  { config },
)

it.instance(
  "callers without explicit custom-agent provenance retain their edit ceiling",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const caller = yield* agents.get("job-scout")
      const child = yield* agents.get("career-consultant")
      const rules = policy({ ...caller, native: undefined }, child)
      expect(Permission.disabled(tools, rules)).toEqual(new Set(tools))
    }),
  { config },
)

it.instance(
  "custom delegators retain their MCP, notebook, and explicit board ceilings",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const caller = yield* agents.get("job-scout")
      const child = yield* agents.get("career-consultant")
      const inherited = KiloTask.inherited({
        caller: {
          ...caller,
          permission: Permission.merge(
            caller.permission,
            Permission.fromConfig({ records_search: "deny", notebook_edit: "deny", board_post: "deny" }),
          ),
        },
        session: { permission: [] },
        mcp: { records: { type: "local", command: ["unused"] } },
      })
      const rules = Permission.merge(child.permission, inherited)
      expect(Permission.evaluate("edit", "candidate/profile.md", rules).action).toBe("allow")
      for (const permission of ["records_search", "notebook_edit", "board_post"]) {
        expect(Permission.evaluate(permission, "*", rules).action).toBe("deny")
      }
    }),
  { config },
)

for (const name of ["plan", "ask", "orchestrator"]) {
  it.instance(
    `${name} retains its native edit ceiling`,
    () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const caller = yield* agents.get(name)
        const child = yield* agents.get("career-consultant")
        expect(caller.native).toBe(true)
        expect(Permission.disabled(tools, policy(caller, child))).toEqual(new Set(tools))
      }),
    { config },
  )
}

// Documents the semantic change: a custom delegator's edit policy, including a path-scoped
// deny, governs that agent only. The child's own policy is the boundary; only session-level
// edit denials confine delegated writes.
it.instance(
  "a custom delegator's path-scoped edit denial does not confine its subagent",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const base = yield* agents.get("job-scout")
      const child = yield* agents.get("career-consultant")
      const caller = { ...base, permission: Permission.fromConfig({ edit: { "candidate/**": "deny" }, task: "allow" }) }
      expect(Permission.evaluate("edit", "candidate/profile.md", caller.permission).action).toBe("deny")
      const rules = policy(caller, child)
      expect(Permission.disabled(tools, rules)).toEqual(new Set())
      expect(Permission.evaluate("edit", "candidate/profile.md", rules).action).toBe("allow")
    }),
  { config },
)
