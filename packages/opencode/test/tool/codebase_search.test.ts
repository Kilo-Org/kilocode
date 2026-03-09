// kilocode_change - new file
import { describe, expect, test, spyOn } from "bun:test"
import path from "path"
import { CodebaseSearchTool } from "../../src/tool/codebase_search"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

const baseCtx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.codebase_search", () => {
  test("throws when query is empty", async () => {
    const tool = await CodebaseSearchTool.init()
    expect(tool.execute({ query: "" }, baseCtx)).rejects.toThrow("query is required")
  })

  test("asks permission and forwards normalized relative path to indexing search", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const search = spyOn(KiloIndexing, "search").mockResolvedValue([])

        try {
          const tool = await CodebaseSearchTool.init()
          const result = await tool.execute(
            {
              query: "authentication middleware",
              path: "./src/../src/tool",
            },
            {
              ...baseCtx,
              ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
                requests.push(req)
              },
            },
          )

          expect(requests).toHaveLength(1)
          expect(requests[0]?.permission).toBe("codebase_search")
          expect(requests[0]?.metadata).toEqual({
            query: "authentication middleware",
            path: "./src/../src/tool",
          })
          expect(search).toHaveBeenCalledWith("authentication middleware", path.normalize("src/tool"))
          expect(result.output).toBe('No relevant code found for "authentication middleware" in src/tool.')
        } finally {
          search.mockRestore()
        }
      },
    })
  })

  test("searches entire workspace when path is omitted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const search = spyOn(KiloIndexing, "search").mockResolvedValue([])

        try {
          const tool = await CodebaseSearchTool.init()
          const result = await tool.execute({ query: "database connection" }, baseCtx)

          expect(search).toHaveBeenCalledWith("database connection", undefined)
          expect(result.output).toBe('No relevant code found for "database connection".')
          expect(result.metadata.results).toEqual([])
        } finally {
          search.mockRestore()
        }
      },
    })
  })

  test("formats and normalizes search results", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const search = spyOn(KiloIndexing, "search").mockResolvedValue([
          {
            id: "1",
            score: 0.812345,
            payload: {
              filePath: "src\\auth\\index.ts",
              codeChunk: "export const verify = () => true",
              startLine: 10,
              endLine: 18,
            },
          },
          {
            id: "2",
            score: 0.7,
            payload: {
              filePath: "src/invalid.ts",
              codeChunk: 123,
              startLine: 1,
              endLine: 2,
            },
          },
          {
            id: "3",
            score: 0.6,
            payload: null,
          },
        ] as never)

        try {
          const tool = await CodebaseSearchTool.init()
          const result = await tool.execute({ query: "verify token" }, baseCtx)

          expect(result.metadata.results).toEqual([
            {
              filePath: "src/auth/index.ts",
              score: 0.812345,
              startLine: 10,
              endLine: 18,
              codeChunk: "export const verify = () => true",
            },
          ])
          expect(result.output).toContain('Found 1 result for "verify token".')
          expect(result.output).toContain("1. src/auth/index.ts:10-18 (score 0.8123)")
          expect(result.output).toContain("export const verify = () => true")
        } finally {
          search.mockRestore()
        }
      },
    })
  })

  test("rejects paths outside the workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const search = spyOn(KiloIndexing, "search").mockResolvedValue([])

        try {
          const tool = await CodebaseSearchTool.init()
          expect(tool.execute({ query: "auth", path: "../outside" }, baseCtx)).rejects.toThrow(
            "path must be within the current workspace: ../outside",
          )
          expect(search).not.toHaveBeenCalled()
        } finally {
          search.mockRestore()
        }
      },
    })
  })
})
