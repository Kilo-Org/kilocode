import { describe, it, expect } from "vitest"
import { color, palette, label } from "../../webview-ui/src/utils/timeline/colors"
import type {
  Part,
  ToolPart,
  TextPart,
  ReasoningPart,
  StepStartPart,
  StepFinishPart,
} from "../../webview-ui/src/types/messages"

function mkText(text = "hello"): TextPart {
  return { id: "t1", type: "text", text }
}

function mkReasoning(text = "thinking..."): ReasoningPart {
  return { id: "r1", type: "reasoning", text }
}

function mkTool(name: string, status: "pending" | "running" | "completed" | "error" = "completed"): ToolPart {
  const base = { id: "tool1", type: "tool" as const, tool: name }
  if (status === "pending") return { ...base, state: { status: "pending", input: {} } }
  if (status === "running") return { ...base, state: { status: "running", input: {} } }
  if (status === "error") return { ...base, state: { status: "error", input: {}, error: "fail" } }
  return { ...base, state: { status: "completed", input: {}, output: "ok", title: name } }
}

function mkStepStart(): StepStartPart {
  return { id: "ss1", type: "step-start" }
}

function mkStepFinish(): StepFinishPart {
  return { id: "sf1", type: "step-finish", reason: "done" }
}

describe("timeline colors", () => {
  it("classifies text parts as text color", () => {
    expect(color(mkText())).toBe(palette.text)
  })

  it("classifies reasoning parts as reasoning color", () => {
    expect(color(mkReasoning())).toBe(palette.reasoning)
  })

  it("classifies read tools as read color", () => {
    expect(color(mkTool("read"))).toBe(palette.read)
    expect(color(mkTool("glob"))).toBe(palette.read)
    expect(color(mkTool("grep"))).toBe(palette.read)
    expect(color(mkTool("ls"))).toBe(palette.read)
    expect(color(mkTool("diagnostics"))).toBe(palette.read)
    expect(color(mkTool("warpgrep"))).toBe(palette.read)
  })

  it("classifies write tools as write color", () => {
    expect(color(mkTool("edit"))).toBe(palette.write)
    expect(color(mkTool("write"))).toBe(palette.write)
    expect(color(mkTool("patch"))).toBe(palette.write)
    expect(color(mkTool("multiedit"))).toBe(palette.write)
    expect(color(mkTool("apply_patch"))).toBe(palette.write)
  })

  it("classifies generic tools as tool color", () => {
    expect(color(mkTool("bash"))).toBe(palette.tool)
    expect(color(mkTool("task"))).toBe(palette.tool)
    expect(color(mkTool("browser"))).toBe(palette.tool)
  })

  it("classifies errored tools as error color", () => {
    expect(color(mkTool("bash", "error"))).toBe(palette.error)
    expect(color(mkTool("read", "error"))).toBe(palette.error)
  })

  it("classifies step-start as step color", () => {
    expect(color(mkStepStart())).toBe(palette.step)
  })

  it("classifies step-finish as success color", () => {
    expect(color(mkStepFinish())).toBe(palette.success)
  })

  it("returns fallback for unknown part types", () => {
    const weird = { id: "w1", type: "snapshot" } as unknown as Part
    expect(color(weird)).toBe(palette.fallback)
  })
})

describe("timeline labels", () => {
  it("returns 'Text' for text parts", () => {
    expect(label(mkText())).toBe("Text")
  })

  it("returns 'Reasoning' for reasoning parts", () => {
    expect(label(mkReasoning())).toBe("Reasoning")
  })

  it("returns tool name for tool parts", () => {
    expect(label(mkTool("bash"))).toBe("bash")
    expect(label(mkTool("read"))).toBe("read")
  })

  it("returns 'Step start' for step-start", () => {
    expect(label(mkStepStart())).toBe("Step start")
  })

  it("returns 'Step finish' for step-finish", () => {
    expect(label(mkStepFinish())).toBe("Step finish")
  })
})
