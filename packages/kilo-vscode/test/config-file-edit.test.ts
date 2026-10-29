import { describe, expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import { aliasOf, applyConfigEdits, isKiloConfigFile } from "../src/config-file-edit"

describe("applyConfigEdits", () => {
  test("keeps comments and existing content", () => {
    const text = `{
  // keep me
  "theme": "dark"
}
`
    const result = applyConfigEdits(text, [{ path: ["username"], value: "alice" }])
    expect(result).toContain("// keep me")
    expect(parse(result)).toEqual({ theme: "dark", username: "alice" })
  })

  test("creates a new file body from empty text", () => {
    const result = applyConfigEdits("", [{ path: ["username"], value: "alice" }])
    expect(parse(result)).toEqual({ username: "alice" })
  })

  test("does not throw when the alias parent does not exist", () => {
    const result = applyConfigEdits("", [{ path: ["permissions"], value: [{ tool: "bash", action: "allow" }] }])
    expect(parse(result)).toEqual({ permissions: [{ tool: "bash", action: "allow" }] })
  })

  test("does not throw when the alias exists under a different parent", () => {
    const result = applyConfigEdits(`{ "mode": { "build": { "prompt": "old" } } }`, [
      { path: ["agents", "build", "system"], value: "new" },
    ])
    const parsed = parse(result)
    expect(parsed.agents.build.system).toBe("new")
    expect(parsed.mode.build.prompt).toBeUndefined()
  })

  test("removes the v1 agent field alias when it writes the v2 field", () => {
    const text = `{
  "agent": { "build": { "prompt": "old" } },
  "mode": { "build": { "prompt": "old" } }
}
`
    const result = applyConfigEdits(text, [{ path: ["agents", "build", "system"], value: "new" }])
    const parsed = parse(result)
    expect(parsed.agents.build.system).toBe("new")
    expect(parsed.agent.build.prompt).toBeUndefined()
    expect(parsed.mode.build.prompt).toBeUndefined()
  })

  test("removes the v1 direct MCP alias when it writes under mcp.servers", () => {
    const text = `{
  "mcp": { "foo": { "type": "local", "command": ["x"] } }
}
`
    const result = applyConfigEdits(text, [
      { path: ["mcp", "servers", "foo"], value: { type: "local", command: ["y"] } },
    ])
    const parsed = parse(result)
    expect(parsed.mcp.servers.foo.command).toEqual(["y"])
    expect(parsed.mcp.foo).toBeUndefined()
  })

  test("removes the whole v1 top-level alias", () => {
    const result = applyConfigEdits(`{ "permission": { "bash": "ask" } }`, [
      { path: ["permissions"], value: { bash: "allow" } },
    ])
    const parsed = parse(result)
    expect(parsed.permissions).toEqual({ bash: "allow" })
    expect(parsed.permission).toBeUndefined()
  })

  test("removes an unset path", () => {
    const result = applyConfigEdits(`{ "username": "alice", "theme": "dark" }`, [{ path: ["username"] }])
    expect(parse(result)).toEqual({ theme: "dark" })
  })

  test("accumulates two consecutive writes to the same file", () => {
    const first = applyConfigEdits("", [{ path: ["a"], value: 1 }])
    const second = applyConfigEdits(first, [{ path: ["b"], value: 2 }])
    expect(parse(second)).toEqual({ a: 1, b: 2 })
  })
})

describe("aliasOf", () => {
  test("maps the v2 paths to every v1 key normalize.ts reads", () => {
    expect(aliasOf(["agents"])).toEqual([["agent"], ["mode"]])
    expect(aliasOf(["agents", "build", "model"])).toEqual([
      ["agent", "build", "model"],
      ["mode", "build", "model"],
    ])
    expect(aliasOf(["agents", "build", "system"])).toEqual([
      ["agent", "build", "prompt"],
      ["mode", "build", "prompt"],
    ])
    expect(aliasOf(["agents", "build", "disabled"])).toEqual([
      ["agent", "build", "disable"],
      ["mode", "build", "disable"],
    ])
    expect(aliasOf(["agents", "title", "model"])).toEqual([["small_model"]])
    expect(aliasOf(["permissions"])).toEqual([["permission"], ["tools"]])
    expect(aliasOf(["commands"])).toEqual([["command"]])
    expect(aliasOf(["providers"])).toEqual([["provider"]])
    expect(aliasOf(["snapshots"])).toEqual([["snapshot"]])
    expect(aliasOf(["compaction", "keep", "tokens"])).toEqual([["compaction", "preserve_recent_tokens"]])
    expect(aliasOf(["compaction", "buffer"])).toEqual([["compaction", "reserved"]])
    expect(aliasOf(["compaction", "auto"])).toEqual([])
    expect(aliasOf(["plugins"])).toEqual([["plugin"]])
    expect(aliasOf(["media"])).toEqual([["attachment"]])
    expect(aliasOf(["update"])).toEqual([["autoupdate"]])
    expect(aliasOf(["share"])).toEqual([["autoshare"]])
    expect(aliasOf(["references"])).toEqual([["reference"]])
    expect(aliasOf(["mcp", "servers", "foo"])).toEqual([["mcp", "foo"]])
    expect(aliasOf(["model"])).toEqual([])
  })
})

describe("isKiloConfigFile", () => {
  test("accepts only the Kilo v2 config file names", () => {
    expect(isKiloConfigFile("/home/.config/kilo2/kilo2.json")).toBe(true)
    expect(isKiloConfigFile("/home/.config/kilo2/kilo2.jsonc")).toBe(true)
    expect(isKiloConfigFile("/home/.config/kilo2/kilo.json")).toBe(false)
    expect(isKiloConfigFile("/home/.config/kilo2/other.json")).toBe(false)
  })
})
