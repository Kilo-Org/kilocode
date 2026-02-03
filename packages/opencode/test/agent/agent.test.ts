import { test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"

// Helper to evaluate permission for a tool with wildcard pattern
function evalPerm(agent: Agent.Info | undefined, permission: string): PermissionNext.Action | undefined {
  if (!agent) return undefined
  return PermissionNext.evaluate(permission, "*", agent.permission).action
}

test("returns default native agents when no config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).toContain("code") // kilocode_change
      expect(names).toContain("plan")
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
      expect(evalPerm(code, "bash")).toBe("allow")
    },
  })
})
// kilocode_change end

test("plan agent denies edits except .opencode/plans/*", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await Agent.get("plan")
      expect(plan).toBeDefined()
      // Wildcard is denied
      expect(evalPerm(plan, "edit")).toBe("deny")
      // But specific path is allowed
      expect(PermissionNext.evaluate("edit", ".opencode/plans/foo.md", plan!.permission).action).toBe("allow")
    },
  })
})

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
      expect(evalPerm(explore, "todoread")).toBe("deny")
      expect(evalPerm(explore, "todowrite")).toBe("deny")
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
      expect(evalPerm(general, "todoread")).toBe("deny")
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
      expect(custom?.model?.providerID).toBe("openai")
      expect(custom?.model?.modelID).toBe("gpt-4")
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
      expect(code?.model?.providerID).toBe("anthropic")
      expect(code?.model?.modelID).toBe("claude-3")
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
      expect(PermissionNext.evaluate("bash", "rm -rf *", code!.permission).action).toBe("deny")
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

test("Truncate.DIR is allowed even when user denies external_directory globally", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
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
      const code = await Agent.get("code")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, code!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, code!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", "/some/other/path", code!.permission).action).toBe("deny")
      // kilocode_change end
    },
  })
})

test("Truncate.DIR is allowed even when user denies external_directory per-agent", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
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
      const code = await Agent.get("code")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, code!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, code!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", "/some/other/path", code!.permission).action).toBe("deny")
      // kilocode_change end
    },
  })
})

test("explicit Truncate.DIR deny is respected", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: {
          "*": "deny",
          [Truncate.DIR]: "deny",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change start - renamed from "build" to "code"
      const code = await Agent.get("code")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, code!.permission).action).toBe("deny")
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, code!.permission).action).toBe("deny")
      // kilocode_change end
    },
  })
})

// kilocode_change start - renamed from "build" to "code"
test("defaultAgent returns code when no default_agent config", async () => {
  // kilocode_change end
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
        // kilocode_change start - renamed from "build" to "code"
        code: { disable: true },
        // kilocode_change end
        plan: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // kilocode_change - code and plan are disabled, no primary-capable agents remain
      await expect(Agent.defaultAgent()).rejects.toThrow("no primary visible agent found")
    },
  })
})
