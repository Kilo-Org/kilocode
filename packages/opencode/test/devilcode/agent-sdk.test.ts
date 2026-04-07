import { describe, test, expect } from "bun:test"
import { provider, mapPermissions, AGENT_SDK_ID, AGENT_SDK_RUNTIME } from "../../src/devilcode/agent-sdk"
import { PermissionNext } from "@/permission/next"

// ── Constants ─────────────────────────────────────────────────────

describe("constants", () => {
  test("AGENT_SDK_ID equals 'agent-sdk'", () => {
    expect(AGENT_SDK_ID).toBe("agent-sdk")
  })

  test("AGENT_SDK_RUNTIME equals 'external-agent'", () => {
    expect(AGENT_SDK_RUNTIME).toBe("external-agent")
  })
})

// ── provider() ────────────────────────────────────────────────────

describe("provider()", () => {
  test("returns correct id and name", () => {
    const p = provider()
    expect(p.id).toBe("agent-sdk")
    expect(p.name).toBe("Claude (Agent SDK)")
  })

  test("exposes three models: opus-4-6, sonnet-4-6, haiku-4-5", () => {
    const p = provider()
    const modelIds = Object.keys(p.models)
    expect(modelIds).toEqual(["opus-4-6", "sonnet-4-6", "haiku-4-5"])
  })

  test("all models have runtime: 'external-agent' in options", () => {
    const p = provider()
    for (const m of Object.values(p.models)) {
      expect(m.options.runtime).toBe("external-agent")
    }
  })

  test("opus and sonnet have 1M context, haiku has 200K", () => {
    const p = provider()
    expect(p.models["opus-4-6"].limit.context).toBe(1000000)
    expect(p.models["sonnet-4-6"].limit.context).toBe(1000000)
    expect(p.models["haiku-4-5"].limit.context).toBe(200000)
  })

  test("opus-4-6 has output limit of 128000", () => {
    const p = provider()
    expect(p.models["opus-4-6"].limit.output).toBe(128000)
  })

  test("sonnet-4-6 has output limit of 64000", () => {
    const p = provider()
    expect(p.models["sonnet-4-6"].limit.output).toBe(64000)
  })

  test("haiku-4-5 has output limit of 64000", () => {
    const p = provider()
    expect(p.models["haiku-4-5"].limit.output).toBe(64000)
  })

  test("all models have reasoning: true and tool_call: false", () => {
    const p = provider()
    for (const m of Object.values(p.models)) {
      expect(m.reasoning).toBe(true)
      expect(m.tool_call).toBe(false)
    }
  })

  test("opus-4-6 cost values are correct", () => {
    const p = provider()
    expect(p.models["opus-4-6"].cost).toEqual({ input: 5, output: 25 })
  })

  test("sonnet-4-6 cost values are correct", () => {
    const p = provider()
    expect(p.models["sonnet-4-6"].cost).toEqual({ input: 3, output: 15 })
  })

  test("haiku-4-5 cost values are correct", () => {
    const p = provider()
    expect(p.models["haiku-4-5"].cost).toEqual({ input: 1, output: 5 })
  })
})

// ── mapPermissions() ──────────────────────────────────────────────

describe("mapPermissions()", () => {
  test("no agent → returns acceptEdits with default read-only tools", () => {
    const result = mapPermissions()
    expect(result.permissionMode).toBe("acceptEdits")
    expect(result.allowedTools).toEqual(["Read", "Glob", "Grep", "WebFetch", "WebSearch"])
    expect(result.disallowedTools).toEqual([])
  })

  test("agent with no permission field → returns acceptEdits with defaults", () => {
    const result = mapPermissions({})
    expect(result.permissionMode).toBe("acceptEdits")
    expect(result.allowedTools).toEqual(["Read", "Glob", "Grep", "WebFetch", "WebSearch"])
    expect(result.disallowedTools).toEqual([])
  })

  test("agent with all-allow rules → returns acceptEdits with those tools in allowedTools", () => {
    const result = mapPermissions({
      permission: PermissionNext.fromConfig({
        bash: "allow",
        edit: "allow",
      }),
    })
    expect(result.permissionMode).toBe("acceptEdits")
    expect(result.allowedTools).toEqual(["Bash", "Edit", "Write"])
    expect(result.disallowedTools).toEqual([])
  })

  test("agent with all-deny rules → returns plan mode", () => {
    const result = mapPermissions({
      permission: PermissionNext.fromConfig({
        bash: "deny",
        edit: "deny",
        read: "deny",
        glob: "deny",
        grep: "deny",
        webfetch: "deny",
        websearch: "deny",
        task: "deny",
      }),
    })
    expect(result.permissionMode).toBe("plan")
    expect(result.allowedTools).toEqual([])
    expect(result.disallowedTools).toEqual(["Read", "Glob", "Grep", "WebFetch", "WebSearch", "Bash", "Edit", "Write", "Agent"])
  })

  test("agent with mixed rules → returns acceptEdits with correct allow/deny lists", () => {
    const result = mapPermissions({
      permission: PermissionNext.fromConfig({
        "*": "deny",
        read: "allow",
        glob: "allow",
        grep: "allow",
        webfetch: "allow",
        websearch: "allow",
        bash: "allow",
        edit: "deny",
        task: "deny",
      }),
    })
    expect(result.permissionMode).toBe("acceptEdits")
    expect(result.allowedTools).toEqual(["Read", "Glob", "Grep", "WebFetch", "WebSearch", "Bash"])
    expect(result.disallowedTools).toEqual(["Edit", "Write", "Agent"])
  })

  test("bash allowlists keep Bash enabled when wildcard bash is denied", () => {
    const result = mapPermissions({
      permission: PermissionNext.fromConfig({
        "*": "allow",
        bash: {
          "*": "deny",
          "cat *": "allow",
        },
      }),
    })
    expect(result.allowedTools).toContain("Bash")
    expect(result.disallowedTools).not.toContain("Bash")
  })
})
