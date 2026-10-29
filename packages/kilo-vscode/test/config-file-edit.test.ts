import { describe, expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { aliasOf, applyConfigEdits, isKiloConfigFile, serialize } from "../src/config-file-edit"

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

describe("serialize", () => {
  test("runs two overlapping read-modify-writes so both edits land", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-write-"))
    const file = path.join(dir, "kilo2.json")
    await writeFile(file, "{}\n")
    const enqueue = serialize()
    const write = (key: string, value: unknown) =>
      enqueue(async () => {
        const text = await readFile(file, "utf8")
        await writeFile(file, applyConfigEdits(text, [{ path: [key], value }]))
      })
    try {
      await Promise.all([write("a", 1), write("b", 2)])
      expect(parse(await readFile(file, "utf8"))).toEqual({ a: 1, b: 2 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("keeps the chain usable after a rejected task", async () => {
    const enqueue = serialize()
    const failed = enqueue(async () => {
      throw new Error("boom")
    })
    await expect(failed).rejects.toThrow("boom")
    await expect(enqueue(async () => "ok")).resolves.toBe("ok")
  })
})
