import { describe, expect, test } from "bun:test"
import type { AgentInfo } from "@opencode/client"
import { applyConfigEdits } from "../src/config-file-edit"
import type { ConfigScope } from "../src/protocol"
import {
  agentConfig,
  agentRows,
  clearDefaultAgent,
  isAgentNameTaken,
  isDefinedAgent,
  modelSelection,
  parseMaxSteps,
  parseModelSelection,
  permissionRows,
  permissionSummary,
  removeAgentConfig,
} from "../webview-ui/src/components/settings/agent-behaviour/agent-list"
import { buildExport, parseImport } from "../webview-ui/src/components/settings/agent-behaviour/mode-io"

function agent(id: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    name: id,
    request: { settings: {}, headers: {}, body: {} },
    mode: "primary",
    hidden: false,
    permissions: [],
    ...extra,
  } as AgentInfo
}

function configFiles(project: Record<string, unknown>, global: Record<string, unknown>) {
  const documents: Record<ConfigScope, string> = { project: JSON.stringify(project), global: JSON.stringify(global) }
  const writes: { path: string[]; scope: ConfigScope }[] = []
  return {
    documents,
    writes,
    config: {
      raw: (scope: ConfigScope) => JSON.parse(documents[scope]) as Record<string, unknown>,
      unset: async (path: string[], scope: ConfigScope) => {
        writes.push({ path, scope })
        documents[scope] = applyConfigEdits(documents[scope], [{ path }])
        return true
      },
    },
  }
}

describe("agentRows", () => {
  test("lists visible server agents plus config-only ids, sorted, with badges", () => {
    const server = [
      agent("plan", { name: "Plan" }),
      agent("writer", { mode: "subagent", description: "writes" }),
      agent("hidden-internal", { hidden: true }),
    ]
    const config: Record<string, { custom: boolean }> = { "my-agent": { custom: true } }
    const rows = agentRows(
      server,
      Object.keys(config),
      (id) => config[id] ?? {},
      (id) => id === "my-agent",
    )
    expect(rows.map((row) => row.id)).toEqual(["my-agent", "plan", "writer"])
    expect(rows[0]).toMatchObject({ builtIn: false, defined: true, removable: true, disabled: false })
    expect(rows[1]).toMatchObject({ label: "Plan", builtIn: true, removable: false, mode: "primary" })
    expect(rows[2]).toMatchObject({ mode: "subagent", builtIn: false, removable: false })
  })

  test("keeps a config-only, disabled agent visible with the disabled badge", () => {
    const rows = agentRows(
      [],
      ["disabled-agent"],
      () => ({ disabled: true, mode: "primary" }),
      () => true,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: "disabled-agent", disabled: true, removable: true, builtIn: false })
  })
})

describe("agent config definitions", () => {
  test("only marks ids present in a raw config or legacy alias as removable", () => {
    const project = { agents: { other: {} }, mode: { "project-mode": {} } }
    const global = { agents: { "global-agent": {} }, agent: { "legacy-agent": {} } }
    for (const id of ["other", "global-agent", "legacy-agent", "project-mode"]) {
      expect(isDefinedAgent(id, project, global)).toBe(true)
    }
    expect(isDefinedAgent("global-mode", {}, { mode: { "global-mode": {} } })).toBe(true)
    expect(isDefinedAgent("project-agent", { agent: { "project-agent": {} } }, {})).toBe(true)
    expect(isDefinedAgent("markdown-only", project, global)).toBe(false)
    expect(isDefinedAgent("constructor", project, global)).toBe(false)
    expect(isDefinedAgent("title", { small_model: "kilo/x" })).toBe(false)

    const rows = agentRows(
      [agent("markdown-only"), agent("legacy-agent")],
      [],
      () => ({}),
      (id) => isDefinedAgent(id, project, global),
    )
    expect(rows.find((row) => row.id === "markdown-only")).toMatchObject({ defined: false, removable: false })
    expect(rows.find((row) => row.id === "legacy-agent")).toMatchObject({ defined: true, removable: true })
  })

  test("removes canonical and legacy definitions from both scopes", async () => {
    const files = configFiles(
      { agent: { reviewer: {}, keep: {} }, mode: { reviewer: {}, other: {} } },
      { agents: { reviewer: {}, other: {} }, agent: { reviewer: {}, other: {} }, mode: { reviewer: {} } },
    )
    await removeAgentConfig(files.config, "reviewer")
    expect(JSON.parse(files.documents.project)).toEqual({ agent: { keep: {} }, mode: { other: {} } })
    expect(JSON.parse(files.documents.global)).toEqual({ agents: { other: {} }, agent: { other: {} }, mode: {} })
    expect(files.writes).toEqual([
      { path: ["agent", "reviewer"], scope: "project" },
      { path: ["mode", "reviewer"], scope: "project" },
      { path: ["agents", "reviewer"], scope: "global" },
    ])
  })

  test("does not delete through an absent canonical parent", async () => {
    const files = configFiles({ agents: { reviewer: {} }, mode: { reviewer: {} } }, { agent: { reviewer: {} } })
    await removeAgentConfig(files.config, "reviewer")
    expect(JSON.parse(files.documents.project)).toEqual({ agents: {}, mode: {} })
    expect(JSON.parse(files.documents.global)).toEqual({ agent: {} })
    expect(files.writes).toEqual([
      { path: ["agents", "reviewer"], scope: "project" },
      { path: ["agent", "reviewer"], scope: "global" },
    ])
    await removeAgentConfig(files.config, "missing")
    expect(files.writes).toHaveLength(2)
  })
})

describe("clearDefaultAgent", () => {
  test("clears both scopes without changing other settings", async () => {
    const files = configFiles(
      { default_agent: "project", username: "project-user" },
      { default_agent: "global", username: "global-user" },
    )
    await clearDefaultAgent(files.config)
    expect(JSON.parse(files.documents.project)).toEqual({ username: "project-user" })
    expect(JSON.parse(files.documents.global)).toEqual({ username: "global-user" })
    expect(files.writes).toEqual([
      { path: ["default_agent"], scope: "project" },
      { path: ["default_agent"], scope: "global" },
    ])
    await clearDefaultAgent(files.config)
    expect(files.writes).toHaveLength(2)
  })

  test("also clears an optimistic selection before raw files refresh", async () => {
    const files = configFiles({}, { default_agent: "pending", username: "global-user" })
    await clearDefaultAgent({ ...files.config, raw: () => ({}) }, "global")
    expect(JSON.parse(files.documents.global)).toEqual({ username: "global-user" })
    expect(files.writes).toEqual([{ path: ["default_agent"], scope: "global" }])
  })

  test("leaves a scope without a default untouched", async () => {
    const project = configFiles({ default_agent: "project" }, { username: "global-user" })
    await clearDefaultAgent(project.config)
    expect(project.writes).toEqual([{ path: ["default_agent"], scope: "project" }])
    expect(JSON.parse(project.documents.global)).toEqual({ username: "global-user" })

    const global = configFiles({ username: "project-user" }, { default_agent: "global" })
    await clearDefaultAgent(global.config)
    expect(global.writes).toEqual([{ path: ["default_agent"], scope: "global" }])
    expect(JSON.parse(global.documents.project)).toEqual({ username: "project-user" })
  })
})

describe("parseMaxSteps", () => {
  test("accepts positive safe integers and unsets blank input", () => {
    expect(parseMaxSteps("  12 ")).toBe(12)
    expect(parseMaxSteps("0001")).toBe(1)
    expect(parseMaxSteps(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
    expect(parseMaxSteps("")).toBeUndefined()
    expect(parseMaxSteps("  ")).toBeUndefined()
  })

  test("rejects values that cannot be written as positive integers", () => {
    for (const value of ["0", "-1", "1.5", "1.0", "2abc", "1e2", "+2", "Infinity", "9007199254740992"]) {
      expect(parseMaxSteps(value)).toBeNull()
    }
  })
})

describe("isAgentNameTaken", () => {
  test("reserves built-in ids even when they are not listed", () => {
    for (const id of ["build", "compaction", "title", "summary"]) {
      expect(isAgentNameTaken(id, [])).toBe(true)
    }
    expect(isAgentNameTaken("reviewer", ["reviewer"])).toBe(true)
    expect(isAgentNameTaken("reviewer", [])).toBe(false)
  })
})

describe("agentConfig", () => {
  test("reads each field from its own path so staged edits show", () => {
    const store: Record<string, unknown> = {
      '["agents","a","description"]': "desc",
      '["agents","a","request","body","temperature"]': 0.2,
    }
    const value = (path: string[]) => store[JSON.stringify(path)]
    expect(agentConfig(value, "a")).toEqual({
      description: "desc",
      request: { body: { temperature: 0.2 } },
    })
  })
})

describe("parseModelSelection and modelSelection", () => {
  test("round trips the explicit selection", () => {
    expect(parseModelSelection({ providerID: "kilo", model: "x", variant: "high" })).toEqual({
      providerID: "kilo",
      modelID: "x",
      variant: "high",
    })
    expect(modelSelection({ providerID: "kilo", modelID: "x", variant: "high" })).toEqual({
      providerID: "kilo",
      model: "x",
      variant: "high",
    })
  })

  test("parses the string selection with an optional variant", () => {
    expect(parseModelSelection("kilo/x#high")).toEqual({ providerID: "kilo", modelID: "x", variant: "high" })
    expect(parseModelSelection("kilo/x")).toEqual({ providerID: "kilo", modelID: "x" })
    expect(parseModelSelection("broken")).toBeUndefined()
  })
})

describe("permissionSummary", () => {
  test("keeps the last wildcard rule per tool", () => {
    const rows = permissionRows([
      { action: "read", resource: "*", effect: "allow" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "deny" },
      { action: "read", resource: "src/*", effect: "allow" },
    ])
    expect(permissionSummary(rows)).toEqual([
      ["edit", "deny"],
      ["read", "deny"],
    ])
  })
})

describe("parseImport", () => {
  test("accepts the v2 shape and defaults the mode", () => {
    const result = parseImport(
      JSON.stringify({ name: "reviewer", description: "d", system: "s", request: { body: { temperature: 0.1 } } }),
      [],
    )
    expect(result).toEqual({
      ok: true,
      name: "reviewer",
      config: { mode: "primary", description: "d", system: "s", request: { body: { temperature: 0.1 } } },
    })
  })

  test("rejects invalid JSON, invalid names and taken names", () => {
    expect(parseImport("{", [])).toEqual({ ok: false, error: "invalidJson" })
    expect(parseImport(JSON.stringify({ name: "Bad Name" }), [])).toEqual({ ok: false, error: "invalidName" })
    expect(parseImport(JSON.stringify({ name: "taken" }), ["taken"])).toEqual({ ok: false, error: "nameTaken" })
  })

  test("rejects hidden and visible built-in ids even when they are not listed", () => {
    for (const name of ["build", "compaction", "title", "summary", " title "]) {
      expect(parseImport(JSON.stringify({ name }), [])).toEqual({ ok: false, error: "nameTaken" })
    }
  })

  test("keeps only valid permission rules", () => {
    const result = parseImport(
      JSON.stringify({
        name: "a",
        permissions: [
          { action: "read", resource: "*", effect: "allow" },
          { action: "edit", resource: "*", effect: "nope" },
        ],
      }),
      [],
    )
    expect(result.ok && result.config.permissions).toEqual([{ action: "read", resource: "*", effect: "allow" }])
  })

  test("keeps valid model selections and drops malformed ones", () => {
    const valid = parseImport(JSON.stringify({ name: "a", model: "kilo/x#high" }), [])
    expect(valid.ok && valid.config.model).toBe("kilo/x#high")
    const multi = parseImport(JSON.stringify({ name: "b", model: "openrouter/openai/gpt-5#high" }), [])
    expect(multi.ok && multi.config.model).toBe("openrouter/openai/gpt-5#high")
    const explicit = parseImport(JSON.stringify({ name: "c", model: { providerID: "kilo", model: "x" } }), [])
    expect(explicit.ok && explicit.config.model).toEqual({ providerID: "kilo", model: "x" })
    for (const model of ["claude-sonnet-4", "kilo/x#", { providerID: "kilo", model: "x#high" }, { providerID: "kilo/x", model: "y" }]) {
      const result = parseImport(JSON.stringify({ name: "d", model }), [])
      expect(result.ok && result.config.model).toBeUndefined()
    }
  })

  test("keeps only a positive integer steps value", () => {
    const valid = parseImport(JSON.stringify({ name: "a", steps: 3 }), [])
    expect(valid.ok && valid.config.steps).toBe(3)
    for (const steps of [0, -1, 1.5]) {
      const result = parseImport(JSON.stringify({ name: "a", steps }), [])
      expect(result.ok && result.config.steps).toBeUndefined()
    }
  })
})

describe("buildExport", () => {
  test("prefixes the config with the name", () => {
    expect(buildExport("reviewer", { mode: "primary" })).toEqual({ name: "reviewer", mode: "primary" })
  })
})
