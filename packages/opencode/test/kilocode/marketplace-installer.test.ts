import { describe, expect, test } from "bun:test"
import { mkdir, rm, symlink, writeFile } from "fs/promises"
import path from "path"
import {
  buildMcpEntry,
  findEscapedPaths,
  isSafeId,
  normalizeMcpEntry,
  substituteParams,
} from "../../src/kilocode/marketplace/installer"
import { tmpdir } from "../fixture/fixture"

describe("marketplace installer helpers", () => {
  test("normalizes legacy local and remote MCP config", () => {
    expect(normalizeMcpEntry({ command: "npx", args: ["-y", "server"], env: { KEY: "value" } })).toEqual({
      type: "local",
      command: ["npx", "-y", "server"],
      environment: { KEY: "value" },
    })
    expect(normalizeMcpEntry({ type: "sse", url: "https://example.com/sse", headers: { Authorization: "token" } })).toEqual({
      type: "remote",
      url: "https://example.com/sse",
      headers: { Authorization: "token" },
    })
    expect(normalizeMcpEntry({ type: "local", command: ["node", "server.js"] })).toEqual({
      type: "local",
      command: ["node", "server.js"],
    })
  })

  test("substitutes MCP params with JSON escaping", () => {
    const content = '{"command":"node","args":["{{token}}","${name}"]}'
    const replaced = substituteParams(content, { token: 'a"b', name: "line\nbreak" })
    expect(JSON.parse(replaced)).toEqual({ command: "node", args: ['a"b', "line\nbreak"] })
  })

  test("builds normalized MCP entries from marketplace JSON", () => {
    expect(buildMcpEntry('{"command":"npx","args":["server"]}')).toEqual({
      type: "local",
      command: ["npx", "server"],
    })
  })

  test("rejects unsafe ids", () => {
    for (const id of ["", ".", "..", "../x", "a/b", "CON", "nul.txt", "agent."]) {
      expect(isSafeId(id)).toBe(false)
    }
    for (const id of ["reviewer", "@org.agent", "skill-name"]) {
      expect(isSafeId(id)).toBe(true)
    }
  })

  test("detects archive paths that escape via symlink", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "skill")
    const outside = path.join(tmp.path, "outside")
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(path.join(root, "SKILL.md"), "# Skill\n")
    await symlink(outside, path.join(root, "escape"))

    const escaped = await findEscapedPaths(root)
    expect(escaped.some((item) => item.endsWith("escape"))).toBe(true)
    await rm(root, { recursive: true, force: true })
  })
})
