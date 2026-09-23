import { describe, expect, test } from "bun:test"
import type { PartUpdate } from "../../src/shared/stream-messages"
import { ToolInputStream } from "../../src/kilo-provider/tool-input-stream"

type Part = {
  id: string
  sessionID: string
  messageID: string
  callID: string
  tool: string
  type: "tool"
  state: { status: string; input?: Record<string, unknown>; metadata?: Record<string, unknown> }
}

function part(tool: string, status: string, input: Record<string, unknown> = {}): Part {
  return {
    id: "prt_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    callID: "call_1",
    tool,
    type: "tool",
    state: { status, input },
  }
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 80))

function setup() {
  const pushed: PartUpdate[] = []
  const stream = new ToolInputStream((update) => pushed.push(update))
  return { pushed, stream }
}

describe("ToolInputStream", () => {
  test("turns streamed input into one pending part update per interval", async () => {
    const { pushed, stream } = setup()
    stream.track(part("write", "pending"))
    stream.delta({ callID: "call_1", delta: '{"filePath":"src/a.ts",' })
    stream.delta({ callID: "call_1", delta: '"content":"one\\ntwo\\nthr' })
    await wait()

    expect(pushed).toHaveLength(1)
    const state = (pushed[0]!.part as Part).state
    expect(state.status).toBe("pending")
    // Written content only feeds the count; the text itself stays on the host.
    expect(state.input).toEqual({ filePath: "src/a.ts" })
    expect(state.metadata).toEqual({ streamChanges: { additions: 3, deletions: 0 } })
    stream.dispose()
  })

  test("keeps fragments that arrive before the pending part", async () => {
    const { pushed, stream } = setup()
    stream.delta({ callID: "call_1", delta: '{"filePath":"src/a.ts",' })
    await wait()
    expect(pushed).toHaveLength(0)

    stream.track(part("write", "pending"))
    stream.delta({ callID: "call_1", delta: '"content":"x' })
    await wait()
    expect((pushed[0]!.part as Part).state.input).toEqual({ filePath: "src/a.ts" })
    expect((pushed[0]!.part as Part).state.metadata).toEqual({ streamChanges: { additions: 1, deletions: 0 } })
    stream.dispose()
  })

  test("keeps the count on a running write and forgets the call when it settles", async () => {
    const { stream } = setup()
    stream.track(part("write", "pending"))
    stream.delta({ callID: "call_1", delta: '{"filePath":"a.ts","content":"a\\nb\\n"}' })
    await wait()

    const running = stream.track(part("write", "running", { filePath: "a.ts" }))
    expect(running.state.input).toEqual({ filePath: "a.ts" })
    expect(running.state.metadata).toEqual({ streamChanges: { additions: 2, deletions: 0 } })

    const done = part("write", "completed", { filePath: "a.ts" })
    expect(stream.track(done)).toBe(done)
    expect(stream.track(part("write", "running", { filePath: "a.ts" })).state.metadata).toBeUndefined()
    stream.dispose()
  })

  test("hides large edit strings and keeps a provisional count while running", async () => {
    const { pushed, stream } = setup()
    stream.track(part("edit", "pending"))
    stream.delta({ callID: "call_1", delta: '{"filePath":"a.ts","oldString":"x","newString":"y"' })
    await wait()
    expect((pushed[0]!.part as Part).state.input).toEqual({ filePath: "a.ts" })
    expect((pushed[0]!.part as Part).state.metadata).toEqual({
      streamChanges: { additions: 1, deletions: 1 },
    })

    const running = stream.track(part("edit", "running", { filePath: "a.ts", oldString: "x", newString: "y" }))
    expect(running.state.metadata).toEqual({ streamChanges: { additions: 1, deletions: 1 } })
    stream.delta({ callID: "call_1", delta: "}" })
    await wait()
    expect(pushed).toHaveLength(1)
    stream.dispose()
  })

  test("counts added and removed lines from a streamed patch", async () => {
    const { pushed, stream } = setup()
    stream.track(part("apply_patch", "pending"))
    stream.delta({
      callID: "call_1",
      delta: '{"patchText":"*** Update File: a.ts\\n--- a.ts\\n+++ b.ts\\n@@\\n-old\\n+new',
    })
    await wait()

    expect((pushed[0]!.part as Part).state.input).toEqual({})
    expect((pushed[0]!.part as Part).state.metadata).toEqual({
      streamChanges: { additions: 1, deletions: 1 },
    })
    stream.dispose()
  })
})
