import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { buildConfigEnv } from "../src/server"

describe("buildConfigEnv", () => {
  const originalEnv = process.env.OPENCODE_CONFIG_CONTENT

  beforeEach(() => {
    delete process.env.OPENCODE_CONFIG_CONTENT
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENCODE_CONFIG_CONTENT
    } else {
      process.env.OPENCODE_CONFIG_CONTENT = originalEnv
    }
  })

  test("returns empty config when no existing env and no incoming config", () => {
    const result = buildConfigEnv()
    const parsed = JSON.parse(result)

    expect(parsed).toEqual({
      agent: {},
      command: {},
      mcp: {},
      mode: {},
      plugin: [],
      instructions: [],
    })
  })

  test("returns incoming config when no existing env", () => {
    const result = buildConfigEnv({
      agent: { custom: { mode: "primary", prompt: "test" } },
    })
    const parsed = JSON.parse(result)

    expect(parsed.agent).toEqual({ custom: { mode: "primary", prompt: "test" } })
  })

  test("preserves existing OPENCODE_CONFIG_CONTENT when spawning with new config", () => {
    // Simulate Kilocode having injected modes via OPENCODE_CONFIG_CONTENT
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      agent: {
        translate: { mode: "primary", prompt: "You are a translator" },
      },
      instructions: [".kilocode/rules/main.md"],
    })

    // Now spawn with additional config
    const result = buildConfigEnv({
      agent: { review: { mode: "primary", prompt: "You are a reviewer" } },
      instructions: ["additional-rule.md"],
    })
    const parsed = JSON.parse(result)

    // Both agents should be present
    expect(parsed.agent.translate).toEqual({ mode: "primary", prompt: "You are a translator" })
    expect(parsed.agent.review).toEqual({ mode: "primary", prompt: "You are a reviewer" })

    // Both instructions should be present
    expect(parsed.instructions).toContain(".kilocode/rules/main.md")
    expect(parsed.instructions).toContain("additional-rule.md")
  })

  test("incoming config overrides existing config for same keys", () => {
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      agent: { code: { mode: "primary", prompt: "Original prompt" } },
      model: "original-model",
    })

    const result = buildConfigEnv({
      agent: { code: { mode: "primary", prompt: "New prompt" } },
      model: "new-model",
    })
    const parsed = JSON.parse(result)

    // Agent should be overridden
    expect(parsed.agent.code.prompt).toBe("New prompt")
    // Top-level config should be overridden
    expect(parsed.model).toBe("new-model")
  })

  test("handles invalid JSON in existing OPENCODE_CONFIG_CONTENT gracefully", () => {
    process.env.OPENCODE_CONFIG_CONTENT = "invalid json {"

    const result = buildConfigEnv({
      agent: { test: { mode: "primary", prompt: "test" } },
    })
    const parsed = JSON.parse(result)

    // Should still work with just the incoming config
    expect(parsed.agent.test).toEqual({ mode: "primary", prompt: "test" })
  })

  test("merges plugins from both sources", () => {
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      plugin: ["plugin-a", "plugin-b"],
    })

    const result = buildConfigEnv({
      plugin: ["plugin-c"],
    })
    const parsed = JSON.parse(result)

    expect(parsed.plugin).toEqual(["plugin-a", "plugin-b", "plugin-c"])
  })
})
