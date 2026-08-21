import { describe, expect, it } from "bun:test"
import { category, settled } from "../../webview-ui/src/components/chat/tool-activity"

let seq = 0
const tool = (name: string, status = "completed") => ({
  id: `prt_${++seq}`,
  type: "tool",
  tool: name,
  state: { status },
})
const think = (end = 2) => ({ id: `prt_${++seq}`, type: "reasoning", time: { start: 1, end } })
const thinking = () => ({ id: `prt_${++seq}`, type: "reasoning", time: { start: 1 } })
const text = () => ({ id: `prt_${++seq}`, type: "text" })

describe("tool activity categories", () => {
  it("maps investigative tools onto shared categories", () => {
    expect(category(tool("read"))).toBe("read")
    expect(category(tool("grep"))).toBe("search")
    expect(category(tool("glob"))).toBe("search")
    expect(category(tool("codesearch"))).toBe("search")
    expect(category(tool("bash"))).toBe("run")
    expect(category(tool("apply_patch"))).toBe("change")
    expect(category(think())).toBe("think")
  })

  it("sends unknown and MCP tools to the other category", () => {
    expect(category(tool("some_mcp_tool"))).toBe("other")
  })

  it("keeps interactive and self-summarizing tools out of activity rows", () => {
    for (const name of ["question", "suggest", "plan_exit", "todowrite", "todoread", "task"]) {
      expect(category(tool(name))).toBeUndefined()
    }
    expect(category(text())).toBeUndefined()
  })

  it("keeps failed tools immediately visible outside activity rows", () => {
    expect(category(tool("bash", "error"))).toBeUndefined()
  })
})

describe("tool activity settling", () => {
  it("treats completed and errored tools as settled", () => {
    expect(settled(tool("read", "completed"))).toBe(true)
    expect(settled(tool("read", "error"))).toBe(true)
    expect(settled(tool("read", "running"))).toBe(false)
    expect(settled(tool("read", "pending"))).toBe(false)
  })

  it("settles reasoning on reasoning-end and treats untimed parts as historical", () => {
    expect(settled(think(9))).toBe(true)
    expect(settled(thinking())).toBe(false)
    expect(settled({ id: "prt_v1", type: "reasoning" })).toBe(true)
  })
})
