// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { LearnWriteTool, LearnReadTool } from "../../src/kilocode/learn-tool"
import { LearnTracker } from "../../src/kilocode/learn-tracker"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { Tool } from "../../src/tool/tool"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: "tool-test",
  messageID: "",
  callID: "",
  agent: "learn",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

describe("LearnWriteTool", () => {
  test("records a check and returns summary", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LearnWriteTool.init()
        const ctx: Tool.Context = { ...baseCtx, sessionID: "write-test", ask: async () => {} }

        const result = await tool.execute(
          {
            question: "What does calibrate return?",
            category: "comprehension",
            quality: "correct",
            concepts: ["calibrate", "LearnTracker"],
          },
          ctx,
        )

        expect(result.title).toContain("1 checks")
        expect(result.title).toContain("level:")
        const output = JSON.parse(result.output)
        expect(output.understood).toContain("calibrate")
        expect(output.understood).toContain("LearnTracker")
        expect(output.total).toBe(1)
      },
    })
  })

  test("accumulates checks across multiple writes", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LearnWriteTool.init()
        const ctx: Tool.Context = { ...baseCtx, sessionID: "multi-write", ask: async () => {} }

        await tool.execute({ question: "Q1", category: "comprehension", quality: "correct", concepts: ["a"] }, ctx)
        const result = await tool.execute(
          { question: "Q2", category: "reasoning", quality: "wrong", concepts: ["b"] },
          ctx,
        )

        expect(result.title).toContain("2 checks")
        const output = JSON.parse(result.output)
        expect(output.understood).toEqual(["a"])
        expect(output.gaps).toEqual(["b"])
        expect(output.total).toBe(2)
      },
    })
  })

  test("requests learnwrite permission", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LearnWriteTool.init()
        const requests: { permission: string }[] = []
        const ctx: Tool.Context = {
          ...baseCtx,
          sessionID: "perm-write",
          ask: async (req) => {
            requests.push(req as { permission: string })
          },
        }

        await tool.execute({ question: "Q1", category: "comprehension", quality: "correct", concepts: ["x"] }, ctx)

        expect(requests).toHaveLength(1)
        expect(requests[0].permission).toBe("learnwrite")
      },
    })
  })

  test("returns state in metadata", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LearnWriteTool.init()
        const ctx: Tool.Context = { ...baseCtx, sessionID: "meta-write", ask: async () => {} }

        const result = await tool.execute(
          { question: "Q1", category: "edge", quality: "partial", concepts: ["y"] },
          ctx,
        )

        expect(result.metadata.state).toBeDefined()
        expect(result.metadata.state.checks).toHaveLength(1)
        expect(result.metadata.state.level).toBe("intermediate")
      },
    })
  })
})

describe("LearnReadTool", () => {
  test("returns empty state for fresh session", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LearnReadTool.init()
        const ctx: Tool.Context = { ...baseCtx, sessionID: "read-fresh", ask: async () => {} }

        const result = await tool.execute({}, ctx)

        expect(result.title).toContain("0 checks")
        const output = JSON.parse(result.output)
        expect(output.understood).toEqual([])
        expect(output.gaps).toEqual([])
        expect(output.skipped).toEqual([])
        expect(output.total).toBe(0)
        expect(output.checks).toEqual([])
      },
    })
  })

  test("reads state written by LearnWriteTool", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await LearnWriteTool.init()
        const reader = await LearnReadTool.init()
        const ctx: Tool.Context = { ...baseCtx, sessionID: "read-after-write", ask: async () => {} }

        await writer.execute({ question: "Q1", category: "system", quality: "correct", concepts: ["Bus"] }, ctx)
        await writer.execute({ question: "Q2", category: "edge", quality: "wrong", concepts: ["SSE"] }, ctx)

        const result = await reader.execute({}, ctx)
        const output = JSON.parse(result.output)

        expect(output.understood).toEqual(["Bus"])
        expect(output.gaps).toEqual(["SSE"])
        expect(output.total).toBe(2)
        expect(output.checks).toHaveLength(2)
        expect(output.checks[0].question).toBe("Q1")
        expect(output.checks[1].question).toBe("Q2")
      },
    })
  })

  test("requests learnread permission", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LearnReadTool.init()
        const requests: { permission: string }[] = []
        const ctx: Tool.Context = {
          ...baseCtx,
          sessionID: "perm-read",
          ask: async (req) => {
            requests.push(req as { permission: string })
          },
        }

        await tool.execute({}, ctx)

        expect(requests).toHaveLength(1)
        expect(requests[0].permission).toBe("learnread")
      },
    })
  })

  test("includes full checks array in output", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Write directly via tracker to set up state
        await LearnTracker.record({
          sessionID: "read-full",
          check: { question: "Q1", category: "comprehension", quality: "correct", concepts: ["fn1"] },
        })

        const tool = await LearnReadTool.init()
        const ctx: Tool.Context = { ...baseCtx, sessionID: "read-full", ask: async () => {} }

        const result = await tool.execute({}, ctx)
        const output = JSON.parse(result.output)

        // learnread includes checks array (unlike summary-only)
        expect(output.checks).toBeDefined()
        expect(output.checks[0].id).toStartWith("chk_")
        expect(output.checks[0].timestamp).toBeGreaterThan(0)
      },
    })
  })

  test("reflects calibrated level in title", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sid = "level-title"
        // Record 4 correct to reach advanced
        await LearnTracker.record({
          sessionID: sid,
          check: { question: "Q1", category: "comprehension", quality: "correct", concepts: ["a"] },
        })
        await LearnTracker.record({
          sessionID: sid,
          check: { question: "Q2", category: "reasoning", quality: "correct", concepts: ["b"] },
        })
        await LearnTracker.record({
          sessionID: sid,
          check: { question: "Q3", category: "system", quality: "correct", concepts: ["c"] },
        })
        await LearnTracker.record({
          sessionID: sid,
          check: { question: "Q4", category: "edge", quality: "correct", concepts: ["d"] },
        })

        const tool = await LearnReadTool.init()
        const ctx: Tool.Context = { ...baseCtx, sessionID: sid, ask: async () => {} }

        const result = await tool.execute({}, ctx)
        expect(result.title).toContain("advanced")
        expect(result.title).toContain("4 checks")
      },
    })
  })
})
