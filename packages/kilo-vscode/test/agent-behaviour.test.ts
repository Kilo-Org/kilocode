import { describe, expect, test } from "bun:test"
import type { AgentInfo } from "@opencode/client"
import {
  agentConfig,
  agentRows,
  modelSelection,
  parseModelSelection,
  permissionRows,
  permissionSummary,
} from "../webview-ui/src/components/settings/agent-behaviour/agents"
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
})

describe("buildExport", () => {
  test("prefixes the config with the name", () => {
    expect(buildExport("reviewer", { mode: "primary" })).toEqual({ name: "reviewer", mode: "primary" })
  })
})
