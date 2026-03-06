import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"

describe("WarpGrepTool", () => {
  // KILO_ENABLE_WARPGREP is a compile-time const in Flag — setting process.env
  // at runtime does NOT change it. We test that the tool definition is always
  // registered in the full list, and that tools() filters it based on the flag.
  test("tool definition is always registered", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("warpgrep")
      },
    })
  })

  test("tool is filtered by tools() when flag is not set", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools({ providerID: "test", modelID: "test" })
        const ids = tools.map((t) => t.id)
        expect(ids).not.toContain("warpgrep")
      },
    })
  })
})
