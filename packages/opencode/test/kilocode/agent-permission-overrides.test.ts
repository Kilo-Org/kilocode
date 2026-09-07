import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { afterEach, expect, test } from "bun:test"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { KiloTask } from "../../src/kilocode/tool/task"
import { deriveSubagentSessionPermission } from "../../src/agent/subagent-permissions"
import { provideTestInstance } from "../fixture/fixture"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    provideInstance(dir)(Agent.Service.use(fn)).pipe(
      Effect.provide(AppNodeBuilder.build(Agent.node)),
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

test("ask agent honors per-agent MCP allow over generated ask rule", async () => {
  await using tmp = await tmpdir({
    config: {
      mcp: {
        context7: { type: "local", command: ["context7"] },
      },
      agent: {
        ask: { permission: { "context7_query-docs": { "*": "allow" } } },
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

// An MCP server is arbitrary third-party code, so the guard prompts for it rather than
// denying it. A top-level rule must not raise that ceiling in a read-only mode: the
// "Allow everything" toggle would otherwise auto-approve a filesystem or shell MCP
// server's write tools in Ask. (#12053)
for (const [label, permission] of [
  ["allow-everything toggle", { "*": { "*": "allow" } }],
  ["scalar catch-all", { "*": "allow" }],
  ["server-wide allow", { "filesystem_*": "allow" }],
  ["specific tool allow", { filesystem_write_file: { "*": "allow" } }],
] as const) {
  test(`read-only agents keep MCP tools at ask under a global ${label}`, async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: { filesystem: { type: "local", command: ["filesystem-mcp"] } },
        permission: permission as never,
      },
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const ask = await load(tmp.path, (svc) => svc.get("ask"))
        const plan = await load(tmp.path, (svc) => svc.get("plan"))
        const code = await load(tmp.path, (svc) => svc.get("code"))
        expect(Permission.evaluate("filesystem_write_file", "/etc/passwd", ask!.permission).action).toBe("ask")
        expect(Permission.evaluate("filesystem_write_file", "/etc/passwd", plan!.permission).action).toBe("ask")
        expect(Permission.evaluate("filesystem_write_file", "/etc/passwd", code!.permission).action).toBe("allow")
      },
    })
  })
}

test("read-only agents still honor a user MCP deny", async () => {
  await using tmp = await tmpdir({
    config: {
      mcp: { filesystem: { type: "local", command: ["filesystem-mcp"] } },
      permission: { "*": "allow", filesystem_write_file: "deny" },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(Permission.evaluate("filesystem_write_file", "/etc/passwd", ask!.permission).action).toBe("deny")
      expect(Permission.evaluate("filesystem_write_file", "/etc/passwd", plan!.permission).action).toBe("deny")
    },
  })
})

// Reapplying the guard's catch-all deny must not strand the read-only allowlist it sits
// in front of. Without this, Ask cannot read a file and Plan cannot leave plan mode —
// and every other test here still passes, because none of them exercises a safe tool.
for (const [label, config] of [
  ["a default install", {}],
  ["a global catch-all allow", { permission: { "*": { "*": "allow" } } }],
  ["a global catch-all ask", { permission: { "*": "ask" } }],
] as const) {
  test(`read-only agents keep their safe tools under ${label}`, async () => {
    await using tmp = await tmpdir({ config: config as never })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const ask = await load(tmp.path, (svc) => svc.get("ask"))
        const plan = await load(tmp.path, (svc) => svc.get("plan"))
        const expected = label === "a global catch-all ask" ? "ask" : "allow"
        for (const permission of ["read", "grep", "glob", "list", "skill", "question", "webfetch"]) {
          expect(Permission.evaluate(permission, "src/index.ts", ask!.permission).action).toBe(expected)
          expect(Permission.evaluate(permission, "src/index.ts", plan!.permission).action).toBe(expected)
        }
        expect(Permission.evaluate("plan_exit", "*", plan!.permission).action).toBe(expected)
        expect(Permission.evaluate("open_plan", "*", plan!.permission).action).toBe(expected)
        expect(Permission.disabled(["read", "grep"], ask!.permission)).toEqual(new Set())
      },
    })
  })
}

// MCP rules are spread into the guards, so a server named `agent` emits `agent_*`, which
// wildcard-matches `agent_manager`. The guarded denies have to be emitted after them.
test("read-only agents keep guarded tools denied against colliding MCP server names", async () => {
  await using tmp = await tmpdir({
    config: {
      mcp: {
        agent: { type: "local", command: ["agent-mcp"] },
        notebook: { type: "local", command: ["notebook-mcp"] },
        repo: { type: "local", command: ["repo-mcp"] },
        interactive: { type: "local", command: ["interactive-mcp"] },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      for (const permission of ["agent_manager", "notebook_edit", "notebook_execute", "interactive_terminal"]) {
        expect(Permission.evaluate(permission, "start", ask!.permission).action).toBe("deny")
        expect(Permission.evaluate(permission, "start", plan!.permission).action).toBe("deny")
      }
    },
  })
})

for (const [label, permission, action] of [
  ["scalar catch-all", { "*": "allow" }, "allow"],
  ["object catch-all", { "*": { "*": "allow" } }, "allow"],
  ["explicit custom deny", { "*": "allow", project_mutator: "deny" }, "deny"],
] as const) {
  test(`read-only agents keep a custom mutator disabled under a global ${label}`, async () => {
    await using tmp = await tmpdir({ config: { permission: permission as never } })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const ask = await load(tmp.path, (svc) => svc.get("ask"))
        const plan = await load(tmp.path, (svc) => svc.get("plan"))
        const code = await load(tmp.path, (svc) => svc.get("code"))
        const tools = ["project_mutator"]
        for (const agent of [ask, plan]) {
          expect(agent).toBeDefined()
          expect(Permission.evaluate("project_mutator", "write", agent!.permission).action).toBe("deny")
          expect(Permission.disabled(tools, agent!.permission)).toEqual(new Set(tools))
        }
        expect(code).toBeDefined()
        expect(Permission.evaluate("project_mutator", "write", code!.permission).action).toBe(action)
        expect(Permission.disabled(tools, code!.permission)).toEqual(action === "deny" ? new Set(tools) : new Set())
      },
    })
  })
}

test("read-only agents reject broad global shell and task approvals", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        "*": "ask",
        bash: {
          "*": "ask",
          "cargo search *": "allow",
        },
        task: "allow",
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      const code = await load(tmp.path, (svc) => svc.get("code"))
      const python = "python - <<'PY'\nfrom pathlib import Path\nPath('ask-bypass.txt').write_text('unsafe')\nPY"
      expect(ask).toBeDefined()
      expect(plan).toBeDefined()
      expect(code).toBeDefined()
      expect(Permission.evaluate("bash", python, ask!.permission).action).toBe("deny")
      expect(Permission.evaluate("bash", python, plan!.permission).action).toBe("deny")
      expect(Permission.evaluate("bash", python, code!.permission).action).toBe("ask")
      // A narrowly written global allow does not reach a read-only mode either.
      expect(Permission.evaluate("bash", "cargo search serde", ask!.permission).action).toBe("deny")
      expect(Permission.evaluate("bash", "cargo search serde", code!.permission).action).toBe("allow")
      expect(Permission.evaluate("skill", "review", ask!.permission).action).toBe("ask")
      expect(Permission.evaluate("skill", "review", plan!.permission).action).toBe("ask")
      expect(Permission.evaluate("skill", "review", code!.permission).action).toBe("ask")
      expect(Permission.evaluate("edit", "src/ask-bypass.ts", ask!.permission).action).toBe("deny")
      expect(Permission.evaluate("task", "general", ask!.permission).action).toBe("deny")
      expect(Permission.evaluate("task", "general", plan!.permission).action).toBe("deny")
      expect(Permission.disabled(["task"], ask!.permission)).toEqual(new Set(["task"]))
      expect(Permission.evaluate("task", "general", code!.permission).action).toBe("allow")
    },
  })
})

// `*` is not the only way to spell a catch-all: wildcard-only patterns of any minimum
// length can broadly grant bash/task, and a globbed permission key reaches `bash` too.
// Each of these re-opened arbitrary shell execution or editing delegation. (#12053)
for (const [label, permission] of [
  ["double star", { bash: { "**": "allow" }, task: { "**": "allow" } }],
  ["question star", { bash: { "?*": "allow" }, task: { "?*": "allow" } }],
  ["star space star", { bash: { "* *": "allow" }, task: { "* *": "allow" } }],
  ["double question star", { bash: { "??*": "allow" }, task: { "??*": "allow" } }],
  ["triple question star", { bash: { "???*": "allow" }, task: { "???*": "allow" } }],
  ["four question star question", { bash: { "????*?": "allow" }, task: { "????*?": "allow" } }],
  ["globbed permission key", { "ba*": { "**": "allow" }, task: { "**": "allow" } }],
] as const) {
  test(`read-only agents reject catch-all spelled as ${label}`, async () => {
    await using tmp = await tmpdir({ config: { permission } })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const ask = await load(tmp.path, (svc) => svc.get("ask"))
        const plan = await load(tmp.path, (svc) => svc.get("plan"))
        const code = await load(tmp.path, (svc) => svc.get("code"))
        const python = "python - <<'PY'\nfrom pathlib import Path\nPath('bypass.txt').write_text('unsafe')\nPY"
        expect(Permission.evaluate("bash", python, ask!.permission).action).toBe("deny")
        expect(Permission.evaluate("bash", python, plan!.permission).action).toBe("deny")
        expect(Permission.evaluate("task", "general", ask!.permission).action).toBe("deny")
        expect(Permission.evaluate("task", "general", plan!.permission).action).toBe("deny")
        // Code mode still honors both grants, and the read-only allowlist still applies.
        expect(Permission.evaluate("bash", python, code!.permission).action).toBe("allow")
        expect(Permission.evaluate("task", "general", code!.permission).action).toBe("allow")
        expect(Permission.evaluate("bash", "ls -la", ask!.permission).action).toBe("allow")
      },
    })
  })
}

test("plan agent honors per-agent bash allow over read-only deny default", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        plan: { permission: { bash: { "cargo search *": "allow" } } },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      expect(plan).toBeDefined()
      expect(Permission.evaluate("bash", "cargo search serde", plan!.permission).action).toBe("allow")
      // Opting one mode in leaves the others alone.
      expect(Permission.evaluate("bash", "cargo search serde", ask!.permission).action).toBe("deny")
    },
  })
})

// The "Always allow" reply persists `<prefix> *` rules into the *global* config, so a
// single approval in code mode used to hand every read-only mode the interpreter it
// approved — the original #12053 payload, reachable without touching a config file.
// Each case checks the whole command and, where they differ, the per-command-node source
// the shell tool actually asks with — a heredoc's node source stops at the redirect, so
// the newline deny in readOnlyBash never sees the body at runtime.
for (const [label, pattern, ...commands] of [
  [
    "python",
    "python - *",
    "python - <<'PY'\nfrom pathlib import Path\nPath('x').write_text('unsafe')\nPY",
    "python - <<'PY'",
  ],
  ["node", "node *", "node -e \"require('fs').writeFileSync('x', 'unsafe')\""],
  ["bash -c", "bash *", "bash -c 'rm -rf x'"],
] as const) {
  test(`read-only agents reject persisted always-allow rule for ${label}`, async () => {
    await using tmp = await tmpdir({ config: { permission: { bash: { [pattern]: "allow" } } } })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const ask = await load(tmp.path, (svc) => svc.get("ask"))
        const plan = await load(tmp.path, (svc) => svc.get("plan"))
        const code = await load(tmp.path, (svc) => svc.get("code"))
        for (const command of commands) {
          expect(Permission.evaluate("bash", command, ask!.permission).action).toBe("deny")
          expect(Permission.evaluate("bash", command, plan!.permission).action).toBe("deny")
          expect(Permission.evaluate("bash", command, code!.permission).action).toBe("allow")
        }
      },
    })
  })
}

// A pattern keeping one literal character still matches almost every command, so the
// read-only baseline cannot be decided by inspecting the pattern's shape. (#12053)
for (const pattern of ["*e*", "*.*", "* -*", "*p*n*"] as const) {
  test(`read-only agents reject near-catch-all pattern ${pattern}`, async () => {
    await using tmp = await tmpdir({ config: { permission: { bash: { [pattern]: "allow" } } } })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const ask = await load(tmp.path, (svc) => svc.get("ask"))
        const plan = await load(tmp.path, (svc) => svc.get("plan"))
        const python = "python - <<'PY'\nfrom pathlib import Path\nPath('x').write_text('unsafe')\nPY"
        expect(Permission.evaluate("bash", python, ask!.permission).action).toBe("deny")
        expect(Permission.evaluate("bash", python, plan!.permission).action).toBe("deny")
      },
    })
  })
}

// The allow-everything toggle persists exactly this, and every mutating tool asks under
// its own permission, not under `edit`. `agent_manager` is the sharpest: it launches a
// session running the default code agent, and it persists an always-rule of its own.
test("read-only agents keep every mutating tool denied under a global allow", async () => {
  await using tmp = await tmpdir({ config: { permission: { "*": { "*": "allow" } } } })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      const code = await load(tmp.path, (svc) => svc.get("code"))
      for (const permission of [
        "notebook_edit",
        "notebook_execute",
        "write",
        "agent_manager",
        "repo_clone",
        "interactive_terminal",
      ]) {
        expect(Permission.evaluate(permission, "start", ask!.permission).action).toBe("deny")
        expect(Permission.evaluate(permission, "start", plan!.permission).action).toBe("deny")
        expect(Permission.evaluate(permission, "start", code!.permission).action).toBe("allow")
      }
    },
  })
})

// agent_manager persists an always-rule per mode the same way the shell tool does.
test("read-only agents reject a persisted agent_manager approval", async () => {
  await using tmp = await tmpdir({ config: { permission: { agent_manager: { start: "allow" } } } })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      const code = await load(tmp.path, (svc) => svc.get("code"))
      expect(Permission.evaluate("agent_manager", "start", ask!.permission).action).toBe("deny")
      expect(Permission.evaluate("agent_manager", "start", plan!.permission).action).toBe("deny")
      expect(Permission.evaluate("agent_manager", "start", code!.permission).action).toBe("allow")
      expect(Permission.disabled(["agent_manager"], ask!.permission)).toEqual(new Set(["agent_manager"]))
    },
  })
})

test("plan agent keeps asking for subagents when the user configured task ask", async () => {
  await using tmp = await tmpdir({ config: { permission: { task: "ask" } } })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      expect(Permission.evaluate("task", "explore", plan!.permission).action).toBe("ask")
      // The guard's own deny still wins over a user-configured prompt.
      expect(Permission.evaluate("task", "general", plan!.permission).action).toBe("deny")
      expect(Permission.evaluate("task", "explore", ask!.permission).action).toBe("deny")
    },
  })
})

// Guarding a tool on the agent is not enough: Plan may delegate, and a subagent builds its
// own ruleset from the same global config. KiloTask.inherited has to carry the guarded set
// into the child session or the boundary leaks through `explore`.
test("plan carries guarded denies into delegated sessions under a global catch-all", async () => {
  await using tmp = await tmpdir({ config: { permission: { "*": { "*": "allow" } } } })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      const child = KiloTask.merge(
        deriveSubagentSessionPermission({ parentSessionPermission: [], subagent: explore! }),
        KiloTask.permissions(KiloTask.inherited({ caller: plan!, session: { permission: [] }, mcp: undefined })),
      )
      // A subagent session is evaluated as merge(agent, session), so session rules win.
      const runtime = Permission.merge(explore!.permission, child)
      for (const permission of ["agent_manager", "repo_clone", "write", "interactive_terminal", "bash", "edit"]) {
        expect(Permission.evaluate(permission, "*", runtime).action).toBe("deny")
      }
    },
  })
})

// Upstream's per-subagent opt-in (test/agent/agent.test.ts). Naming `general` exactly is
// the one thing that lifts plan's deny — a wildcard covering it never does, and ask seals
// `task` outright, so neither form reaches it there.
test("plan agent honors an exact user allow for the general subagent", async () => {
  await using tmp = await tmpdir({ config: { permission: { task: { general: "allow" } } } })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      expect(Permission.evaluate("task", "general", plan!.permission).action).toBe("allow")
      expect(Permission.evaluate("task", "general", ask!.permission).action).toBe("deny")
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

// A custom agent whose name collides with `architect` must keep its own edit
// permission. The previous name check appended the plan-mode edit guard after the
// agent's rules, so last-match-wins made its `*.md` allows unreachable (#13581).
test("custom architect agent keeps its own edit rules instead of plan hardening", async () => {
  const architect = await get(
    {
      agent: {
        architect: {
          mode: "primary",
          permission: {
            edit: {
              "*": "ask",
              "*.md": "allow",
              "**/*.md": "allow",
            },
          },
        },
      },
    },
    "architect",
  )
  expect(architect).toBeDefined()
  expect(architect!.name).toBe("architect")
  // No plan guard may be appended after the agent's own rules.
  expect(
    architect!.permission.some((rule) => rule.permission === "edit" && rule.pattern === "*" && rule.action === "deny"),
  ).toBe(false)
  expect(Permission.evaluate("edit", "src/output.log", architect!.permission).action).toBe("ask")
  expect(Permission.evaluate("edit", "docs/notes/test.md", architect!.permission).action).toBe("allow")
})

test("custom architect agent is not plan-hardened by name", async () => {
  const architect = await get(
    {
      agent: {
        architect: {
          mode: "primary",
          permission: {
            edit: "allow",
          },
        },
      },
    },
    "architect",
  )
  expect(architect).toBeDefined()
  expect(Permission.evaluate("edit", "src/output.log", architect!.permission).action).toBe("allow")
  expect(Permission.evaluate("edit", ".kilo/plans/fix.md", architect!.permission).action).toBe("allow")
})

// A custom `agent.plan` config reuses the built-in plan object, so it stays native
// and the plan-mode ceiling keeps applying instead of being replaced by the user
// rules. Custom-plan replacement is out of scope for the #13581 fix.
test("custom agent.plan config stays native and plan-hardened", async () => {
  const plan = await get(
    {
      agent: {
        plan: {
          mode: "primary",
          permission: {
            edit: {
              "*": "allow",
              "**/*.md": "allow",
            },
          },
        },
      },
    },
    "plan",
  )
  expect(plan).toBeDefined()
  expect(plan!.native).toBe(true)
  expect(Permission.evaluate("edit", "src/output.log", plan!.permission).action).toBe("deny")
  expect(Permission.evaluate("edit", ".kilo/plans/fix.md", plan!.permission).action).toBe("allow")
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
