import { describe, expect, it } from "bun:test"
import { fileURLToPath } from "node:url"
import type { AssistantMessage, Part } from "@kilocode/sdk/v2"
import { previewDuration, previewFrame } from "../../webview-ui/src/components/settings/session-preview-playback"
import { dict } from "../../webview-ui/src/i18n/en"

const message: AssistantMessage = {
  id: "assistant",
  sessionID: "preview",
  parentID: "user",
  role: "assistant",
  time: { created: 1000, completed: 7500 },
  modelID: "preview",
  providerID: "preview",
  mode: "default",
  agent: "default",
  path: { cwd: "/preview", root: "/preview" },
  cost: 0,
  tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 0, write: 0 } },
}
const base = { sessionID: "preview", messageID: message.id }
const tools: Part[] = (
  [
    ["sample_docs_lookup", 3500, 4000],
    ["edit", 4000, 4500],
    ["bash", 4500, 5300],
  ] as const
).map(([tool, start, end]) => ({
  ...base,
  id: tool,
  callID: tool,
  type: "tool",
  tool,
  state: {
    status: "completed",
    input: { command: "sample" },
    output: "first test passed\nsecond test passed\n2 tests passed",
    title: tool,
    metadata: { approval: { source: "project" }, filediff: { file: "/preview/greeting.ts" } },
    time: { start: 1000 + start, end: 1000 + end },
  },
}))
const sample = {
  thought: { ...message, id: "thought", time: { created: 1000, completed: 4500 } },
  thoughts: [
    {
      ...base,
      messageID: "thought",
      id: "reasoning",
      type: "reasoning",
      text: dict["settings.display.preview.reasoning"],
      time: { start: 1000 },
    },
  ] satisfies Part[],
  message,
  parts: [
    ...tools,
    { ...base, id: "answer", type: "text", text: "Updated the greeting. Both tests pass." },
    { ...base, id: "finish", type: "step-finish", reason: "stop", cost: 0, tokens: message.tokens },
  ] satisfies Part[],
}

describe("session preview playback", () => {
  it("streams reasoning and settles it before tools without mutating the fixture", () => {
    const early = previewFrame(sample, 400)
    const later = previewFrame(sample, 1200)
    expect(early.thoughts[0]?.type === "reasoning" && early.thoughts[0].text.length).toBeLessThan(
      later.thoughts[0]?.type === "reasoning" ? later.thoughts[0].text.length : 0,
    )
    expect(early.thought.time.completed).toBeUndefined()
    expect(early.parts).toEqual([])
    expect(later.thoughts[0]?.type === "reasoning" && later.thoughts[0].text).toBe(sample.thoughts[0]?.text)
    expect(previewFrame(sample, 1199).thought.time.completed).toBeUndefined()
    expect(previewFrame(sample, 1199).parts).toEqual([])
    const settled = previewFrame(sample, 1200)
    expect(settled.thought.time.completed).toBe(2200)
    expect(settled.thoughts[0]?.type === "reasoning" && settled.thoughts[0].time.end).toBe(2200)
    expect(sample.thoughts[0]?.text).toBe(dict["settings.display.preview.reasoning"])
    expect(sample.thought.time.completed).toBe(4500)
    const reasoning = dict["settings.display.preview.reasoning"]
    expect(reasoning.split("\n\n")).toHaveLength(6)
    expect(reasoning.split(/\s+/).length).toBeGreaterThanOrEqual(220)
    expect(reasoning.split(/\s+/).length).toBeLessThanOrEqual(300)
  })

  it("streams tool input while pending, then shows whole output and completes at the exact boundary", () => {
    for (const [name, start, run, end] of [
      ["sample_docs_lookup", 1200, 1260, 1400],
      ["edit", 1400, 1480, 1600],
      ["bash", 1600, 1760, 2000],
    ] as const) {
      expect(previewFrame(sample, start - 1).parts.find((part) => part.id === `${name}-0`)).toBeUndefined()
      const pending = previewFrame(sample, start).parts.find((part) => part.id === `${name}-0`)
      expect(pending?.type === "tool" && pending.state.status).toBe("pending")
      // The command types in while pending, like streamed tool input.
      const typed = previewFrame(sample, start + 1).parts.find((part) => part.id === `${name}-0`)
      expect(typed?.type === "tool" && (typed.state.input.command as string).length).toBeLessThan("sample".length)
      for (const reduced of [false, true]) {
        for (const elapsed of [run, run + 1, (run + end) / 2, end - 1]) {
          const running = previewFrame(sample, elapsed, reduced).parts.find((part) => part.id === `${name}-0`)
          expect(running?.type === "tool" && running.state.status).toBe("running")
          expect(running?.type === "tool" && running.state.metadata?.output).toBe(
            "first test passed\nsecond test passed\n2 tests passed",
          )
        }
      }
      const complete = previewFrame(sample, end).parts.find((part) => part.id === `${name}-0`)
      expect(complete?.type === "tool" && complete.state.status).toBe("completed")
      expect(complete?.type === "tool" && complete.state.status === "completed" && complete.state.output).toContain(
        "2 tests passed",
      )
      expect(complete?.type === "tool" && complete.state.metadata).toEqual({
        approval: { source: "project" },
        filediff: { file: "/preview/greeting.ts" },
      })
      expect(complete?.type === "tool" && complete.state.status === "completed" && complete.state.time).toEqual({
        start: 1000 + run,
        end: 1000 + end,
      })
    }
  })

  it("streams the answer, completes it, and holds a bounded final frame before replay", () => {
    expect(previewFrame(sample, 1999).parts.find((part) => part.type === "text")).toBeUndefined()
    expect(previewFrame(sample, 2000).parts.find((part) => part.type === "text")?.text).toBe("")
    const live = previewFrame(sample, 2250)
    expect(live.message.time.completed).toBeUndefined()
    expect(live.parts.find((part) => part.type === "step-finish")).toBeUndefined()
    const answer = live.parts.find((part) => part.type === "text")
    expect(answer?.text.length).toBeGreaterThan(0)
    expect(answer?.time?.end).toBeUndefined()
    expect(previewFrame(sample, 2499).message.time.completed).toBeUndefined()
    const complete = previewFrame(sample, 2500)
    expect(complete.message.time.completed).toBe(3500)
    expect(complete.parts.find((part) => part.type === "text")).toMatchObject({
      text: "Updated the greeting. Both tests pass.",
      time: { start: 3000, end: 3500 },
    })
    expect(previewDuration).toBe(3500)
    expect(complete).toEqual(previewFrame(sample, previewDuration - 1))
    expect(complete.parts).toHaveLength(sample.parts.length)
    expect(previewFrame(sample, 0).parts).toEqual([])
  })

  it("preserves message and reasoning identities through reconciliation", () => {
    // Bun normally resolves Solid's server store, which has no reactive reconciliation.
    const child = Bun.spawnSync(
      [
        process.execPath,
        "--conditions=browser",
        "-e",
        `import { createStore, reconcile } from "solid-js/store";
       import { strict as assert } from "node:assert";
       import { previewFrame } from "./webview-ui/src/components/settings/session-preview-playback";
       const sample = ${JSON.stringify(sample)};
       const [state, setState] = createStore(previewFrame(sample, 100));
       const thought = state.thought;
       const part = state.thoughts[0];
         for (const elapsed of [400, 1000, 1200, 2500]) {
         setState(reconcile(previewFrame(sample, elapsed)));
         assert.equal(state.thought, thought);
         assert.equal(state.thoughts[0], part);
       }
         assert.equal(state.thought.time.completed, 2200);`,
      ],
      { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "pipe", stderr: "pipe" },
    )
    expect(child.stderr.toString()).toBe("")
    expect(child.exitCode).toBe(0)
  })

  it("uses whole text in reduced motion while retaining running and settled phases", () => {
    const frame = previewFrame(sample, 100, true)
    expect(frame.thoughts[0]?.type === "reasoning" && frame.thoughts[0].text).toBe(sample.thoughts[0]?.text)
    expect(frame.thought.time.completed).toBeUndefined()
    expect(previewFrame(sample, 1200, true).thought.time.completed).toBe(2200)
    expect(previewFrame(sample, 2000, true).parts.find((part) => part.type === "text")?.text).toBe(
      "Updated the greeting. Both tests pass.",
    )
  })

  it("refreshes part identities each replay cycle and keeps them stable within a cycle", () => {
    const first = previewFrame(sample, 2000, false, 0).parts.map((part) => part.id)
    const second = previewFrame(sample, 2000, false, 1).parts.map((part) => part.id)
    expect(first).not.toEqual(second)
    expect(previewFrame(sample, 2100, false, 1).parts.map((part) => part.id)).toEqual(second)
    const tool = previewFrame(sample, 2000, false, 1).parts.find((part) => part.type === "tool")
    expect(tool?.id).toBe("sample_docs_lookup-1")
    expect(tool?.type === "tool" && tool.callID).toBe("sample_docs_lookup-1")
  })
})
