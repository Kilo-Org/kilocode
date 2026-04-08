import { test, expect, describe } from "bun:test"
import z from "zod"
import { wrapToolAsMcp, createDevilToolServer } from "../../src/devilcode/agent-sdk-tools"
import type { Tool } from "../../src/tool/tool"

/**
 * Helper: create a fake Tool.Info for testing without importing real tools.
 */
function fakeTool(opts: {
  id: string
  description: string
  parameters: z.ZodType
  execute: (args: any, ctx: any) => Promise<{ title: string; metadata: any; output: string }>
}): Tool.Info {
  return {
    id: opts.id,
    init: async () => ({
      description: opts.description,
      parameters: opts.parameters,
      execute: opts.execute,
    }),
  }
}

describe("wrapToolAsMcp", () => {
  test("extracts name and description correctly", async () => {
    const tool = fakeTool({
      id: "my-search",
      description: "Search the codebase for patterns",
      parameters: z.object({ query: z.string() }),
      execute: async () => ({ title: "Search", metadata: {}, output: "found it" }),
    })

    const wrapped = await wrapToolAsMcp(tool)

    expect(wrapped.name).toBe("my-search")
    expect(wrapped.description).toBe("Search the codebase for patterns")
  })

  test("handler executes and returns correct CallToolResult format", async () => {
    const tool = fakeTool({
      id: "echo-tool",
      description: "Echoes input back",
      parameters: z.object({ message: z.string() }),
      execute: async (args) => ({
        title: "Echo",
        metadata: {},
        output: `Echo: ${args.message}`,
      }),
    })

    const wrapped = await wrapToolAsMcp(tool)
    const result = await wrapped.handler({ message: "hello world" }, undefined)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Echo: hello world")
    expect(result.isError).toBeUndefined()
  })

  test("handler handles execution errors gracefully", async () => {
    const tool = fakeTool({
      id: "failing-tool",
      description: "A tool that always fails",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("Something went wrong")
      },
    })

    const wrapped = await wrapToolAsMcp(tool)
    const result = await wrapped.handler({}, undefined)

    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Error: Something went wrong")
  })

  test("handler handles non-Error throws gracefully", async () => {
    const tool = fakeTool({
      id: "string-throw-tool",
      description: "Throws a string",
      parameters: z.object({}),
      execute: async () => {
        throw "raw string error"
      },
    })

    const wrapped = await wrapToolAsMcp(tool)
    const result = await wrapped.handler({}, undefined)

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Error: raw string error")
  })

  test("extracts shape from ZodObject parameters", async () => {
    const schema = z.object({
      query: z.string(),
      limit: z.number().optional(),
    })

    const tool = fakeTool({
      id: "shape-test",
      description: "Tests shape extraction",
      parameters: schema,
      execute: async () => ({ title: "ok", metadata: {}, output: "ok" }),
    })

    const wrapped = await wrapToolAsMcp(tool)

    // The inputSchema should be the raw shape, not a ZodObject
    expect(wrapped.inputSchema).toHaveProperty("query")
    expect(wrapped.inputSchema).toHaveProperty("limit")
    // Each value should be a Zod type, not a plain object
    expect(wrapped.inputSchema.query).toBeInstanceOf(z.ZodString)
  })

  test("falls back to wrapping non-ZodObject schemas under 'input' key", async () => {
    const tool = fakeTool({
      id: "string-param-tool",
      description: "Takes a raw string parameter",
      parameters: z.string(),
      execute: async (args) => ({ title: "ok", metadata: {}, output: args }),
    })

    const wrapped = await wrapToolAsMcp(tool)

    // Non-object schema should be wrapped under an "input" key
    expect(wrapped.inputSchema).toHaveProperty("input")
    expect(Object.keys(wrapped.inputSchema)).toEqual(["input"])
  })
})

describe("createDevilToolServer", () => {
  test("creates a server config with type 'sdk'", async () => {
    const tools = [
      fakeTool({
        id: "tool-a",
        description: "Tool A",
        parameters: z.object({ x: z.string() }),
        execute: async () => ({ title: "A", metadata: {}, output: "a" }),
      }),
      fakeTool({
        id: "tool-b",
        description: "Tool B",
        parameters: z.object({ y: z.number() }),
        execute: async () => ({ title: "B", metadata: {}, output: "b" }),
      }),
    ]

    const server = await createDevilToolServer(tools)

    expect(server.type).toBe("sdk")
    expect(server.name).toBe("devil-tools")
    expect(server.instance).toBeDefined()
  })

  test("creates a server with no tools when given empty array", async () => {
    const server = await createDevilToolServer([])

    expect(server.type).toBe("sdk")
    expect(server.name).toBe("devil-tools")
    expect(server.instance).toBeDefined()
  })
})
