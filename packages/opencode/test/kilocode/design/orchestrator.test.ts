import { describe, expect, test } from "bun:test"
import { createOrchestrator } from "../../../src/kilocode/design/orchestrator"
import { createFakeVoice } from "../../../src/kilocode/design/voice/fake"
import type { State, Turn } from "../../../src/kilocode/design/state"

// Drives the orchestrator with the real fake-voice adapter and a stub dispatch
// sink that records turns and lets the test control agent busy/idle — exercising
// the same path real voice + a real session would take. No mocks.
function harness() {
  const dispatched: Turn[] = []
  let cancels = 0
  const renders: State[] = []
  const orchestrator = createOrchestrator({
    adapter: createFakeVoice(),
    input: "fake",
    dispatch: (turn) => {
      dispatched.push(turn)
      // Mimic the session bus: a dispatch opens an agent turn.
      orchestrator.agentOpen()
    },
    cancel: () => {
      cancels++
    },
    render: (state) => {
      renders.push(state)
    },
  })
  return {
    orchestrator,
    dispatched,
    renders,
    cancels: () => cancels,
    complete: () => orchestrator.agentClose("completed"),
  }
}

describe("orchestrator with fake voice", () => {
  test("a typed line dispatches one turn and goes listening", async () => {
    const h = harness()
    await h.orchestrator.start()
    h.orchestrator.submitLine("make the brand color green")

    expect(h.dispatched.map((t) => t.text)).toEqual(["make the brand color green"])
    expect(h.orchestrator.current().voice).toBe("listening")
    expect(h.orchestrator.current().agent).toBe("busy")
  })

  test("speech while busy queues, then drains in order on completion", async () => {
    const h = harness()
    await h.orchestrator.start()

    h.orchestrator.submitLine("first")
    h.orchestrator.submitLine("second")
    h.orchestrator.submitLine("third")

    // Only the first dispatched; the rest are queued behind the active turn.
    expect(h.dispatched.map((t) => t.text)).toEqual(["first"])
    expect(h.orchestrator.current().queue.map((t) => t.text)).toEqual(["second", "third"])

    h.complete()
    expect(h.dispatched.map((t) => t.text)).toEqual(["first", "second"])
    h.complete()
    expect(h.dispatched.map((t) => t.text)).toEqual(["first", "second", "third"])
    h.complete()
    expect(h.orchestrator.current().agent).toBe("idle")
    expect(h.orchestrator.current().queue).toEqual([])
  })

  test("Escape cancels the active turn, clears the queue, and keeps listening", async () => {
    const h = harness()
    await h.orchestrator.start()

    h.orchestrator.submitLine("first")
    h.orchestrator.submitLine("second")
    h.orchestrator.escape()

    expect(h.cancels()).toBe(1)
    expect(h.orchestrator.current().active).toBeUndefined()
    expect(h.orchestrator.current().queue).toEqual([])
    expect(h.orchestrator.current().voice).toBe("listening")

    // Still usable afterwards.
    h.orchestrator.submitLine("fresh start")
    expect(h.dispatched.at(-1)?.text).toBe("fresh start")
  })

  test("blank typed lines are ignored", async () => {
    const h = harness()
    await h.orchestrator.start()
    h.orchestrator.submitLine("   ")
    expect(h.dispatched).toEqual([])
  })

  test("reportError surfaces a dispatch failure on the surface", async () => {
    const h = harness()
    await h.orchestrator.start()
    h.orchestrator.reportError("Model not found: kilo/minimax/minimax-m2.1:free")
    expect(h.orchestrator.current().error).toContain("Model not found")
  })
})
