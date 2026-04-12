import { afterEach, test, expect } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"

// Helper to evaluate permission for a tool with wildcard pattern
function evalPerm(agent: Agent.Info | undefined, permission: string): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate(permission, "*", agent.permission).action
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("returns default native agents when no config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).toContain("code") // kilocode_change
      expect(names).toContain("plan")
      expect(names).toContain("debug") // kilocode_change
      expect(names).toContain("orchestrator") // kilocode_change
      expect(names).toContain("ask") // kilocode_change
      expect(names).toContain("general")
      expect(names).toContain("explore")
      expect(names).toContain("compaction")
      expect(names).toContain("title")
      expect(names).toContain("summary")
    },
  })
})

// kilocode_change start - renamed from "build" to "code"
test("code agent has correct default properties", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const code = await Agent.get("code")
      expect(code).toBeDefined()
      expect(code?.mode).toBe("primary")
      expect(code?.native).toBe(true)
      expect(evalPerm(code, "edit")).toBe("allow")
      expect(evalPerm(code, "bash")).toBe("ask")
    },
  })
})
// kilocode_change end

// kilocode_change start - ask agent tests
test("ask agent has correct default properties", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ask = await Agent.get("ask")
      expect(ask).toBeDefined()
      expect(ask?.mode).toBe("primary")
      expect(ask?.native).toBe(true)
      // ask agent should allow read-only tools
      expect(evalPerm(ask, "read")).toBe("allow")
      expect(evalPerm(ask, "grep")).toBe("allow")
      expect(evalPerm(ask, "glob")).toBe("allow")
      expect(evalPerm(ask, "webfetch")).toBe("allow")
      expect(evalPerm(ask, "websearch")).toBe("allow")
      expect(evalPerm(ask, "codesearch")).toBe("allow")
      // ask agent should deny edit and bash
      expect(evalPerm(ask, "edit")).toBe("deny")
      expect(evalPerm(ask, "bash")).toBe("deny")
      expect(evalPerm(ask, "task")).toBe("deny")
      // ask agent should gate .env files
      expect(Permission.evaluate("read", ".env", ask!.permission).action).toBe("ask")
      expect(Permission.evaluate("read", "config.env.local", ask!.permission).action).toBe("ask")
      expect(Permission.evaluate("read", ".env.example", ask!.permission).action).toBe("allow")
      expect(Permission.evaluate("read", "src/index.ts", ask!.permission).action).toBe("allow")
    },
  })
})
test("ask agent denies edit/write/bash even when user config adds a specific edit allow", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        edit: { "src/output.log": "allow" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ask = await Agent.get("ask")
      expect(ask).toBeDefined()
      // user config must not leak edit capability into ask mode — even for the
      // specific path the user allowed, ask mode must still deny it
      expect(Permission.evaluate("edit", "src/output.log", ask!.permission).action).toBe("deny")
      expect(evalPerm(ask, "bash")).toBe("deny")
      expect(evalPerm(ask, "task")).toBe("deny")
      // safe tools still work
      expect(evalPerm(ask, "read")).toBe("allow")
      expect(evalPerm(ask, "grep")).toBe("allow")
      // disabled() hides tools entirely from LLM — bash is NOT disabled because it has specific allow rules
      const disabled = Permission.disabled(["edit", "write", "bash"], ask!.permission)
      expect(disabled.has("edit")).toBe(true)
      expect(disabled.has("write")).toBe(true)
      expect(disabled.has("bash")).toBe(false)
    },
  })
})
// kilocode_change end

// kilocode_change start
test("plan agent asks before edits except .kilo/plans/* and .opencode/plans/*", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await Agent.get("plan")
      expect(plan).toBeDefined()
      // Wildcard requires permission
      expect(evalPerm(plan, "edit")).toBe("ask")
      // kilocode_change start
      // .kilo/plans/ is the primary allowed path
      expect(Permission.evaluate("edit", ".kilo/plans/foo.md", plan!.permission).action).toBe("allow")
      // kilocode_change end
      // .opencode/plans/ is also allowed as backward compat fallback
      expect(Permission.evaluate("edit", ".opencode/plans/foo.md", plan!.permission).action).toBe("allow")
    },
  })
})
// kilocode_change end

test("explore agent denies edit and write", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore).toBeDefined()
      expect(explore?.mode).toBe("subagent")
      expect(evalPerm(explore, "edit")).toBe("deny")
      expect(evalPerm(explore, "write")).toBe("deny")
      expect(evalPerm(explore, "todowrite")).toBe("deny")
    },
  })
})

test("explore agent asks for external directories and allows Truncate.GLOB", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore).toBeDefined()
      expect(Permission.evaluate("external_directory", "/some/other/path", explore!.permission).action).toBe("ask")
      expect(Permission.evaluate("external_directory", Truncate.GLOB, explore!.permission).action).toBe("allow")
    },
  })
})

test("general agent denies todo tools", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const general = await Agent.get("general")
      expect(general).toBeDefined()
      expect(general?.mode).toBe("subagent")
      expect(general?.hidden).toBeUndefined()
      expect(evalPerm(general, "todowrite")).toBe("deny")
    },
  })
})

test("compaction agent denies all permissions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const compaction = await Agent.get("compaction")
      expect(compaction).toBeDefined()
      expect(compaction?.hidden).toBe(true)
      expect(evalPerm(compaction, "bash")).toBe("deny")
      expect(evalPerm(compaction, "edit")).toBe("deny")
      expect(evalPerm(compaction, "read")).toBe("deny")
    },
  })
})

test("custom agent from config creates new agent", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        my_custom_agent: {
          model: "openai/gpt-4",
          description: "My custom agent",
          temperature: 0.5,
          top_p: 0.9,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const custom = await Agent.get("my_custom_agent")
      expect(custom).toBeDefined()
      expect(String(custom?.model?.providerID)).toBe("openai")
      expect(String(custom?.model?.modelID)).toBe("gpt-4")
      expect(custom?.description).toBe("My custom agent")
      expect(custom?.temperature).toBe(0.5)
      expect(custom?.topP).toBe(0.9)
      expect(custom?.native).toBe(false)
      expect(custom?.mode).toBe("all")
    },
  })
})

test("custom agent config overrides native agent properties", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        // kilocode_change start
        code: {
          model: "anthropic/claude-3",
          description: "Custom code agent",
          temperature: 0.7,
          color: "#FF0000",
        },
        // kilocode_change end
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(code).toBeDefined()
      expect(String(code?.model?.providerID)).toBe("anthropic")
      expect(String(code?.model?.modelID)).toBe("claude-3")
      expect(code?.description).toBe("Custom code agent")
      expect(code?.temperature).toBe(0.7)
      expect(code?.color).toBe("#FF0000")
      expect(code?.native).toBe(true)
      // kilocode_change end
    },
  })
})

test("agent disable removes agent from list", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore).toBeUndefined()
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).not.toContain("explore")
    },
  })
})

test("agent permission config merges with defaults", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        // kilocode_change start
        code: {
          // kilocode_change end
          permission: {
            bash: {
              "rm -rf *": "deny",
            },
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(code).toBeDefined()
      // Specific pattern is denied
      expect(Permission.evaluate("bash", "rm -rf *", code!.permission).action).toBe("deny")
      // Edit still allowed
      expect(evalPerm(code, "edit")).toBe("allow")
      // kilocode_change end
    },
  })
})

test("global permission config applies to all agents", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        bash: "deny",
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(code).toBeDefined()
      expect(evalPerm(code, "bash")).toBe("deny")
      // kilocode_change end
    },
  })
})

test("agent steps/maxSteps config sets steps property", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        // kilocode_change start - renamed from "build" to "code"
        code: { steps: 50 },
        // kilocode_change end
        plan: { maxSteps: 100 },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const code = await Agent.get("code") // kilocode_change
      const plan = await Agent.get("plan")
      expect(code?.steps).toBe(50) // kilocode_change
      expect(plan?.steps).toBe(100)
    },
  })
})

test("agent mode can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { mode: "primary" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore?.mode).toBe("primary")
    },
  })
})

test("agent name can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        code: { name: "Coder" }, // kilocode_change
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(code?.name).toBe("Coder")
      // kilocode_change end
    },
  })
})

test("agent prompt can be set from config", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        code: { prompt: "Custom system prompt" }, // kilocode_change
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(code?.prompt).toBe("Custom system prompt")
      // kilocode_change end
    },
  })
})

test("unknown agent properties are placed into options", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        code: {
          random_property: "hello",
          another_random: 123,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(code?.options.random_property).toBe("hello")
      expect(code?.options.another_random).toBe(123)
      // kilocode_change end
    },
  })
})

test("agent options merge correctly", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        // kilocode_change start - renamed from "build" to "code"
        code: {
          // kilocode_change end
          options: {
            custom_option: true,
            another_option: "value",
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(code?.options.custom_option).toBe(true)
      expect(code?.options.another_option).toBe("value")
      // kilocode_change end
    },
  })
})

test("multiple custom agents can be defined", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        agent_a: {
          description: "Agent A",
          mode: "subagent",
        },
        agent_b: {
          description: "Agent B",
          mode: "primary",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agentA = await Agent.get("agent_a")
      const agentB = await Agent.get("agent_b")
      expect(agentA?.description).toBe("Agent A")
      expect(agentA?.mode).toBe("subagent")
      expect(agentB?.description).toBe("Agent B")
      expect(agentB?.mode).toBe("primary")
    },
  })
})

test("Agent.list keeps the default agent first and sorts the rest by name", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "plan",
      agent: {
        zebra: {
          description: "Zebra",
          mode: "subagent",
        },
        alpha: {
          description: "Alpha",
          mode: "subagent",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const names = (await Agent.list()).map((a) => a.name)
      expect(names[0]).toBe("plan")
      expect(names.slice(1)).toEqual(names.slice(1).toSorted((a, b) => a.localeCompare(b)))
    },
  })
})

test("Agent.get returns undefined for non-existent agent", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const nonExistent = await Agent.get("does_not_exist")
      expect(nonExistent).toBeUndefined()
    },
  })
})

test("default permission includes doom_loop and external_directory as ask", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(evalPerm(code, "doom_loop")).toBe("ask")
      expect(evalPerm(code, "external_directory")).toBe("ask")
      // kilocode_change end
    },
  })
})

test("webfetch is allowed by default", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(evalPerm(code, "webfetch")).toBe("allow")
      // kilocode_change end
    },
  })
})

test("legacy tools config converts to permissions", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        // kilocode_change start - renamed from "build" to "code"
        code: {
          // kilocode_change end
          tools: {
            bash: false,
            read: false,
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(evalPerm(code, "bash")).toBe("deny")
      expect(evalPerm(code, "read")).toBe("deny")
      // kilocode_change end
    },
  })
})

test("legacy tools config maps write/edit/patch/multiedit to edit permission", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        // kilocode_change start - renamed from "build" to "code"
        code: {
          // kilocode_change end
          tools: {
            write: false,
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(evalPerm(code, "edit")).toBe("deny")
      // kilocode_change end
    },
  })
})

test("Truncate.GLOB is allowed even when user denies external_directory globally", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: "deny",
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const build = await Agent.get("code")
      // kilocode_change end
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("allow")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    },
  })
})

test("Truncate.GLOB is allowed even when user denies external_directory per-agent", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir({
    config: {
      agent: {
        // kilocode_change start - renamed from "build" to "code"
        code: {
          // kilocode_change end
          permission: {
            external_directory: "deny",
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const build = await Agent.get("code")
      // kilocode_change end
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("allow")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    },
  })
})

test("explicit Truncate.GLOB deny is respected", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: {
          "*": "deny",
          [Truncate.GLOB]: "deny",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const build = await Agent.get("code")
      // kilocode_change end
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
    },
  })
})

test("skill directories are allowed for external_directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".kilo", "skill", "perm-skill") // kilocode_change: .kilo is primary
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: perm-skill
description: Permission skill.
---

# Permission Skill
`,
      )
    },
  })

  const home = process.env.KILO_TEST_HOME
  process.env.KILO_TEST_HOME = tmp.path

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const skillDir = path.join(tmp.path, ".kilo", "skill", "perm-skill") // kilocode_change: .kilo is primary
        const target = path.join(skillDir, "reference", "notes.md")
        expect(Permission.evaluate("external_directory", target, build!.permission).action).toBe("allow")
      },
    })
  } finally {
    process.env.KILO_TEST_HOME = home
  }
})

test("defaultAgent returns build when no default_agent config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("code") // kilocode_change
    },
  })
})

test("defaultAgent respects default_agent config set to plan", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "plan",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("plan")
    },
  })
})

test("defaultAgent respects default_agent config set to custom agent with mode all", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "my_custom",
      agent: {
        my_custom: {
          description: "My custom agent",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("my_custom")
    },
  })
})

test("defaultAgent throws when default_agent points to subagent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "explore",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "explore" is a subagent')
    },
  })
})

test("defaultAgent throws when default_agent points to hidden agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "compaction",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "compaction" is hidden')
    },
  })
})

test("defaultAgent throws when default_agent points to non-existent agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "does_not_exist",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "does_not_exist" not found')
    },
  })
})

// kilocode_change start - renamed from "build" to "code"
test("defaultAgent returns plan when code is disabled and default_agent not set", async () => {
  // kilocode_change end
  await using tmp = await tmpdir({
    config: {
      agent: {
        // kilocode_change start - renamed from "build" to "code"
        code: { disable: true },
        // kilocode_change end
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      // kilocode_change - code is disabled, so it should return plan (next primary agent)
      expect(agent).toBe("plan")
    },
  })
})

test("defaultAgent throws when all primary agents are disabled", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        // kilocode_change start - disable all primary agents
        code: { disable: true },
        plan: { disable: true },
        debug: { disable: true },
        orchestrator: { disable: true },
        ask: { disable: true },
        // kilocode_change end
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change - all primary agents are disabled
      await expect(Agent.defaultAgent()).rejects.toThrow("no primary visible agent found")
    },
  })
})

// kilocode_change start - Backward compatibility tests for "build" -> "code" rename
test("Agent.get('build') returns code agent for backward compatibility", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      const code = await Agent.get("code")
      expect(build).toBeDefined()
      expect(build).toBe(code)
      expect(build?.name).toBe("code")
    },
  })
})

test("agent.build config applies to code agent for backward compatibility", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          temperature: 0.8,
          color: "#00FF00",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const code = await Agent.get("code")
      expect(code).toBeDefined()
      expect(code?.temperature).toBe(0.8)
      expect(code?.color).toBe("#00FF00")
    },
  })
})

test("default_agent: 'build' returns code agent for backward compatibility", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "build",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("code")
    },
  })
})

test("agent.build disable removes code agent for backward compatibility", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const code = await Agent.get("code")
      expect(code).toBeUndefined()
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).not.toContain("code")
    },
  })
})
// kilocode_change end
