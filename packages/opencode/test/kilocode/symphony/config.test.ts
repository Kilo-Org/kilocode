import { describe, expect, test } from "bun:test"
import {
  AgentConfig,
  HooksConfig,
  PollingConfig,
  ServerConfig,
  SymphonyConfig,
  TrackerConfig,
  WorkspaceConfig,
} from "@/devilcode/symphony/config/schema"
import { parseWorkflowMd } from "@/devilcode/symphony/config/workflow-md"

describe("SymphonyConfig schema", () => {
  const minimalTracker = {
    kind: "linear" as const,
    api_key: "test-key",
    project_slug: "TEST",
  }

  describe("TrackerConfig", () => {
    test("requires kind=linear, api_key, and project_slug", () => {
      const result = TrackerConfig.parse(minimalTracker)
      expect(result.kind).toBe("linear")
      expect(result.api_key).toBe("test-key")
      expect(result.project_slug).toBe("TEST")
    })

    test("applies default endpoint", () => {
      const result = TrackerConfig.parse(minimalTracker)
      expect(result.endpoint).toBe("https://api.linear.app/graphql")
    })

    test("applies default active_states", () => {
      const result = TrackerConfig.parse(minimalTracker)
      expect(result.active_states).toEqual(["Todo", "In Progress"])
    })

    test("applies default terminal_states", () => {
      const result = TrackerConfig.parse(minimalTracker)
      expect(result.terminal_states).toEqual(["Closed", "Cancelled", "Done", "Duplicate"])
    })

    test("rejects missing kind", () => {
      expect(() => TrackerConfig.parse({ api_key: "k", project_slug: "P" })).toThrow()
    })

    test("rejects missing api_key", () => {
      expect(() => TrackerConfig.parse({ kind: "linear", project_slug: "P" })).toThrow()
    })

    test("rejects missing project_slug", () => {
      expect(() => TrackerConfig.parse({ kind: "linear", api_key: "k" })).toThrow()
    })
  })

  describe("PollingConfig", () => {
    test("defaults interval_ms to 30000", () => {
      const result = PollingConfig.parse({})
      expect(result.interval_ms).toBe(30000)
    })

    test("accepts explicit interval_ms", () => {
      const result = PollingConfig.parse({ interval_ms: 60000 })
      expect(result.interval_ms).toBe(60000)
    })
  })

  describe("WorkspaceConfig", () => {
    test("defaults root to empty string and cleanup to true", () => {
      const result = WorkspaceConfig.parse({})
      expect(result.root).toBe("")
      expect(result.cleanup).toBe(true)
    })

    test("accepts explicit values", () => {
      const result = WorkspaceConfig.parse({ root: "/tmp/work", cleanup: false })
      expect(result.root).toBe("/tmp/work")
      expect(result.cleanup).toBe(false)
    })
  })

  describe("AgentConfig", () => {
    test("defaults max_concurrent_agents=5 and max_turns=20", () => {
      const result = AgentConfig.parse({})
      expect(result.max_concurrent_agents).toBe(5)
      expect(result.max_turns).toBe(20)
    })

    test("defaults max_retry_backoff_ms=300000", () => {
      const result = AgentConfig.parse({})
      expect(result.max_retry_backoff_ms).toBe(300000)
    })

    test("defaults max_concurrent_agents_by_state to empty record", () => {
      const result = AgentConfig.parse({})
      expect(result.max_concurrent_agents_by_state).toEqual({})
    })

    test("accepts explicit values", () => {
      const result = AgentConfig.parse({
        max_concurrent_agents: 10,
        max_turns: 50,
        model: "gpt-4",
        max_concurrent_agents_by_state: { "In Progress": 3 },
      })
      expect(result.max_concurrent_agents).toBe(10)
      expect(result.max_turns).toBe(50)
      expect(result.model).toBe("gpt-4")
      expect(result.max_concurrent_agents_by_state).toEqual({ "In Progress": 3 })
    })
  })

  describe("SymphonyConfig with all defaults", () => {
    test("parses with only tracker and fills all optional section defaults", () => {
      const result = SymphonyConfig.parse({ tracker: minimalTracker })

      expect(result.tracker.kind).toBe("linear")
      expect(result.tracker.api_key).toBe("test-key")
      expect(result.tracker.project_slug).toBe("TEST")

      // polling defaults
      expect(result.polling.interval_ms).toBe(30000)

      // workspace defaults
      expect(result.workspace.root).toBe("")
      expect(result.workspace.cleanup).toBe(true)

      // hooks defaults
      expect(result.hooks.after_create).toBeUndefined()
      expect(result.hooks.before_run).toBeUndefined()
      expect(result.hooks.after_run).toBeUndefined()
      expect(result.hooks.before_remove).toBeUndefined()
      expect(result.hooks.timeout_ms).toBe(60000)

      // agent defaults
      expect(result.agent.max_concurrent_agents).toBe(5)
      expect(result.agent.max_turns).toBe(20)
      expect(result.agent.max_retry_backoff_ms).toBe(300000)
      expect(result.agent.model).toBeUndefined()

      // server defaults
      expect(result.server.port).toBe(0)
    })
  })

  describe("SymphonyConfig with explicit values", () => {
    test("parses fully specified config", () => {
      const result = SymphonyConfig.parse({
        tracker: {
          kind: "linear",
          api_key: "explicit-key",
          project_slug: "PROJ",
          endpoint: "https://custom.linear.app/graphql",
          active_states: ["Backlog"],
          terminal_states: ["Archived"],
        },
        polling: { interval_ms: 10000 },
        workspace: { root: "/workspace", cleanup: false },
        hooks: {
          after_create: "echo created",
          before_run: "echo before",
          after_run: "echo after",
          before_remove: "echo remove",
          timeout_ms: 30000,
        },
        agent: {
          max_concurrent_agents: 3,
          max_turns: 10,
          max_retry_backoff_ms: 60000,
          model: "claude-sonnet-4-20250514",
        },
        server: { port: 8080 },
      })

      expect(result.tracker.endpoint).toBe("https://custom.linear.app/graphql")
      expect(result.tracker.active_states).toEqual(["Backlog"])
      expect(result.tracker.terminal_states).toEqual(["Archived"])
      expect(result.polling.interval_ms).toBe(10000)
      expect(result.workspace.root).toBe("/workspace")
      expect(result.workspace.cleanup).toBe(false)
      expect(result.hooks.after_create).toBe("echo created")
      expect(result.hooks.timeout_ms).toBe(30000)
      expect(result.agent.max_concurrent_agents).toBe(3)
      expect(result.agent.max_turns).toBe(10)
      expect(result.agent.model).toBe("claude-sonnet-4-20250514")
      expect(result.server.port).toBe(8080)
    })
  })

  describe("SymphonyConfig optional sections default correctly when omitted", () => {
    test("omitting polling, workspace, hooks, agent, server produces valid defaults", () => {
      const result = SymphonyConfig.parse({ tracker: minimalTracker })

      // Each optional section should be a fully resolved object, not undefined
      expect(result.polling).toBeDefined()
      expect(result.workspace).toBeDefined()
      expect(result.hooks).toBeDefined()
      expect(result.agent).toBeDefined()
      expect(result.server).toBeDefined()

      expect(typeof result.polling.interval_ms).toBe("number")
      expect(typeof result.workspace.cleanup).toBe("boolean")
      expect(typeof result.hooks.timeout_ms).toBe("number")
      expect(typeof result.agent.max_concurrent_agents).toBe("number")
      expect(typeof result.server.port).toBe("number")
    })
  })
})

describe("parseWorkflowMd", () => {
  test("parses valid YAML frontmatter and prompt template", () => {
    const md = [
      "---",
      "tracker:",
      "  kind: linear",
      "  api_key: test-key",
      "  project_slug: TEST",
      "---",
      "You are working on {{ issue.identifier }}",
    ].join("\n")

    const result = parseWorkflowMd(md)

    expect(result.config.tracker.kind).toBe("linear")
    expect(result.config.tracker.api_key).toBe("test-key")
    expect(result.config.tracker.project_slug).toBe("TEST")
    expect(result.promptTemplate).toBe("You are working on {{ issue.identifier }}")
  })

  test("throws on empty frontmatter", () => {
    const md = ["---", "---", "Some prompt"].join("\n")

    expect(() => parseWorkflowMd(md)).toThrow("SymphonyConfigError")
  })

  test("throws on missing prompt template", () => {
    const md = [
      "---",
      "tracker:",
      "  kind: linear",
      "  api_key: test-key",
      "  project_slug: TEST",
      "---",
      "",
    ].join("\n")

    expect(() => parseWorkflowMd(md)).toThrow("SymphonyConfigError")
  })

  test("throws on non-object YAML frontmatter", () => {
    // gray-matter parses a bare string as data = {} (empty object), so use an explicit
    // non-object YAML value that gray-matter will interpret as a string to trigger the check.
    // However, gray-matter normalizes most YAML to objects. The schema check itself
    // catches invalid data via SymphonyConfig.safeParse. Test the empty-frontmatter path
    // which reliably fires for the "must decode to a YAML map" or "must have YAML frontmatter" message.
    const md = ["---", "just a string", "---", "Some prompt"].join("\n")

    // gray-matter parses "just a string" as { "just a string": null } which is a non-empty object,
    // so it passes the empty check but fails SymphonyConfig.safeParse
    expect(() => parseWorkflowMd(md)).toThrow()
  })

  test("fills default optional sections from frontmatter", () => {
    const md = [
      "---",
      "tracker:",
      "  kind: linear",
      "  api_key: my-key",
      "  project_slug: PROJ",
      "polling:",
      "  interval_ms: 5000",
      "---",
      "Resolve {{ issue.identifier }}: {{ issue.title }}",
    ].join("\n")

    const result = parseWorkflowMd(md)

    expect(result.config.polling.interval_ms).toBe(5000)
    // omitted sections still get defaults
    expect(result.config.agent.max_concurrent_agents).toBe(5)
    expect(result.config.agent.max_turns).toBe(20)
    expect(result.config.workspace.cleanup).toBe(true)
    expect(result.promptTemplate).toBe("Resolve {{ issue.identifier }}: {{ issue.title }}")
  })
})
