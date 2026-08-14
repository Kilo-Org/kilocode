import { expect, test } from "bun:test"
import {
  STALL_GRACE_MS,
  apply,
  drop,
  live,
  liveAssistantMarkdown,
  liveReasoningCode,
  mark,
  queue,
  take,
  wait,
} from "../../src/kilocode/live-output"

test("live reasoning always paints unstyled text and stops streaming when done", () => {
  expect(liveReasoningCode(false)).toEqual({ drawUnstyledText: true, streaming: true })
  expect(liveReasoningCode(true)).toEqual({ drawUnstyledText: true, streaming: false })
})

test("live assistant markdown streams until the part or message is done", () => {
  expect(liveAssistantMarkdown(false)).toEqual({ streaming: true })
  expect(liveAssistantMarkdown(true)).toEqual({ streaming: false })
})

test("queued deltas fill an empty part and do not clobber existing text", () => {
  const pending = new Map()
  queue(pending, { sessionID: "s", messageID: "m", partID: "p", field: "text", delta: "hel" })
  queue(pending, { sessionID: "s", messageID: "m", partID: "p", field: "text", delta: "lo" })
  expect(apply("", take(pending, "p"))).toBe("hello")
  expect(apply("hydrated", take(pending, "p"))).toBe("hydrated")
})

test("drop removes only deltas for the evicted session", () => {
  const pending = new Map()
  queue(pending, { sessionID: "keep", messageID: "m", partID: "a", field: "text", delta: "a" })
  queue(pending, { sessionID: "gone", messageID: "m", partID: "b", field: "text", delta: "b" })
  drop(pending, "gone")
  expect(take(pending, "a")[0]?.delta).toBe("a")
  expect(take(pending, "b")).toEqual([])
})

test("busy and retry count as live", () => {
  expect(live({ type: "idle" })).toBe(false)
  expect(live({ type: "busy" })).toBe(true)
  expect(live({ type: "retry" })).toBe(true)
})

test("watchdog backoff doubles until the ceiling", () => {
  expect(wait(0)).toBe(STALL_GRACE_MS)
  expect(wait(1)).toBe(6000)
  expect(wait(4)).toBe(30_000)
  expect(wait(8)).toBe(30_000)
})

test("mark changes when live text or tool state changes and stays put otherwise", () => {
  const last = { id: "a", role: "assistant", time: {} }
  const first = mark({
    status: { type: "busy" },
    last,
    parts: [{ id: "p", type: "text", text: "hi" }],
  })
  expect(
    mark({
      status: { type: "busy" },
      last,
      parts: [{ id: "p", type: "text", text: "hi" }],
    }),
  ).toBe(first)
  expect(
    mark({
      status: { type: "busy" },
      last,
      parts: [{ id: "p", type: "text", text: "hi!" }],
    }),
  ).not.toBe(first)
  expect(
    mark({
      status: { type: "busy" },
      last,
      parts: [{ id: "t", type: "tool", state: { status: "running" } }],
    }),
  ).not.toBe(
    mark({
      status: { type: "busy" },
      last,
      parts: [{ id: "t", type: "tool", state: { status: "completed" } }],
    }),
  )
})
