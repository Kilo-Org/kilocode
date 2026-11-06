import { describe, expect, test } from "bun:test"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
} from "@opencode/client"
import { previewDuration, previewFrame } from "../webview-ui/src/components/settings/session-preview-playback"

const reasoning = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
const stamp = 1000

const tool = (name: string, start: number, run: number, end: number): SessionMessageAssistantTool => ({
  type: "tool",
  id: name,
  name,
  state: {
    status: "completed",
    input: { command: "sample" },
    content: [{ type: "text", text: "first test passed\nsecond test passed\n2 tests passed" }],
    metadata: { approval: { source: "project" } },
  },
  time: { created: stamp + start, ran: stamp + run, completed: stamp + end },
})

const answer: SessionMessageAssistantText = {
  type: "text",
  text: "Updated the greeting. Both tests pass.",
}

const sample: { message: SessionMessageAssistant } = {
  message: {
    id: "assistant",
    time: { created: stamp, completed: stamp + 7500, streamed: stamp + 7500 },
    type: "assistant",
    agent: "default",
    model: { id: "preview", providerID: "preview" },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 0, write: 0 } },
    content: [
      { type: "reasoning", text: reasoning, time: { created: stamp } },
      tool("sample_docs_lookup", 1200, 1260, 1400),
      tool("edit", 1400, 1480, 1600),
      tool("shell", 1600, 1760, 2000),
      answer,
    ],
  },
}

type Frame = ReturnType<typeof previewFrame>

const reasoningPart = (frame: Frame) =>
  frame.message.content.find((item): item is SessionMessageAssistantReasoning => item.type === "reasoning")

const textPart = (frame: Frame) =>
  frame.message.content.find((item): item is SessionMessageAssistantText => item.type === "text")

const toolPart = (frame: Frame, name: string) =>
  frame.message.content.find((item): item is SessionMessageAssistantTool => item.type === "tool" && item.name === name)

describe("session preview playback", () => {
  test("streams reasoning and settles it before the tools appear", () => {
    const early = reasoningPart(previewFrame(sample, 400))
    const later = reasoningPart(previewFrame(sample, 1200))
    expect(early?.text.length).toBeLessThan(later?.text.length ?? 0)
    expect(early?.time?.completed).toBeUndefined()
    expect(previewFrame(sample, 1199).message.content).toHaveLength(1)
    const settled = reasoningPart(previewFrame(sample, 1200))
    expect(settled?.time?.completed).toBe(stamp + 1200)
    expect(settled?.text).toBe(reasoning)
    const original = sample.message.content[0]
    expect(original?.type === "reasoning" && original.text).toBe(reasoning)
  })

  test("shows each tool pending, running and completed at its own boundaries", () => {
    for (const [name, start, run, end] of [
      ["sample_docs_lookup", 1200, 1260, 1400],
      ["edit", 1400, 1480, 1600],
      ["shell", 1600, 1760, 2000],
    ] as const) {
      expect(toolPart(previewFrame(sample, start - 1), name)).toBeUndefined()
      const pending = toolPart(previewFrame(sample, start), name)
      expect(pending?.state.status).toBe("streaming")
      expect(pending?.time).toEqual({ created: stamp + start })
      for (const elapsed of [run, run + 1, (run + end) / 2, end - 1]) {
        const running = toolPart(previewFrame(sample, elapsed, true), name)
        expect(running?.state.status).toBe("running")
        expect(running?.state.status === "running" && running.state.metadata).toEqual({
          approval: { source: "project" },
        })
      }
      const complete = toolPart(previewFrame(sample, end), name)
      expect(complete?.state.status).toBe("completed")
      expect(complete?.state.status === "completed" && complete.state.content).toEqual([
        { type: "text", text: "first test passed\nsecond test passed\n2 tests passed" },
      ])
      expect(complete?.time).toEqual({ created: stamp + start, ran: stamp + run, completed: stamp + end })
    }
  })

  test("streams the answer, completes the message, and holds a final frame before the replay", () => {
    expect(textPart(previewFrame(sample, 1999))).toBeUndefined()
    expect(textPart(previewFrame(sample, 2000))?.text).toBe("")
    const live = previewFrame(sample, 2250)
    expect(live.message.time.completed).toBeUndefined()
    const liveAnswer = textPart(live)
    expect(liveAnswer?.text.length).toBeGreaterThan(0)
    expect(liveAnswer?.text.length).toBeLessThan(answer.text.length)
    expect(previewFrame(sample, 2499).message.time.completed).toBeUndefined()
    const complete = previewFrame(sample, 2500)
    expect(complete.message.time.completed).toBe(stamp + 2500)
    expect(textPart(complete)?.text).toBe(answer.text)
    expect(previewDuration).toBe(3500)
    expect(complete).toEqual(previewFrame(sample, previewDuration - 1))
    expect(previewFrame(sample, 0).message.content).toEqual([
      { type: "reasoning", text: "", time: { created: stamp, completed: undefined } },
    ])
  })

  test("uses whole text in reduced motion while keeping every phase", () => {
    expect(reasoningPart(previewFrame(sample, 100, true))?.text).toBe(reasoning)
    expect(textPart(previewFrame(sample, 2000, true))?.text).toBe(answer.text)
  })

  test("refreshes tool identities each replay cycle and keeps them stable within a cycle", () => {
    const first = previewFrame(sample, 2000, false, 0)
    const second = previewFrame(sample, 2000, false, 1)
    expect(first.message.id).toBe("assistant-0")
    expect(second.message.id).toBe("assistant-1")
    expect(toolPart(first, "sample_docs_lookup")?.id).toBe("sample_docs_lookup-0")
    expect(toolPart(second, "sample_docs_lookup")?.id).toBe("sample_docs_lookup-1")
    expect(toolPart(previewFrame(sample, 2100, false, 1), "sample_docs_lookup")?.id).toBe("sample_docs_lookup-1")
    expect(textPart(previewFrame(sample, 2500, false, 1))?.text).toBe(answer.text)
  })

  test("does not mutate the fixture", () => {
    previewFrame(sample, 2500)
    expect(sample.message.time.completed).toBe(stamp + 7500)
    const original = sample.message.content[0]
    expect(original?.type === "reasoning" && original.text).toBe(reasoning)
  })
})
