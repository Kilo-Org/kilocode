import { expect, test } from "bun:test"
import { at, older, recent, redoTarget, slot } from "../../src/kilocode/message-order"

const old = { id: "msg_ff0cb2300001Z6YIo5V52u114f", time: { created: 1 } }
const next = { id: "msg_019f1d3da001955TwEJ8qKEbj3", time: { created: 2 } }

test("a later message with an earlier id sorts after the older one", () => {
  expect(older(old, next)).toBeLessThan(0)
  expect(older(next, old)).toBeGreaterThan(0)
})

test("equal created times fall back to id order", () => {
  const a = { id: "msg_a", time: { created: 1 } }
  const b = { id: "msg_b", time: { created: 1 } }
  expect(older(a, b)).toBeLessThan(0)
  expect(older(a, a)).toBe(0)
})

test("a later message with an earlier id inserts at the tail", () => {
  expect(slot([old], next)).toEqual({ found: false, index: 1 })
})

test("slot finds an existing message by id", () => {
  expect(slot([old, next], next)).toEqual({ found: true, index: 1 })
})

test("the message window keeps newest by created time, not id", () => {
  expect(recent([next, old], 1).map((item) => item.id)).toEqual([next.id])
})

test("lookup by id is linear so time-ordered lists still find removals", () => {
  expect(at([old, next], next.id)).toEqual({ found: true, index: 1 })
  expect(at([old, next], "msg_missing")).toEqual({ found: false, index: -1 })
})

// The conversation below is in conversational order. Order comes from position,
// so the expected answers below follow the array and nothing else.
const conversation = [
  { id: "msg_ff0cb2300001Z6YIo5V52u114f", role: "user" },
  { id: "msg_ff0cb2300002Z6YIo5V52u114f", role: "assistant" },
  { id: "msg_019f1d3da001955TwEJ8qKEbj3", role: "user" },
  { id: "msg_019f1d3da002955TwEJ8qKEbj3", role: "assistant" },
  { id: "msg_010000000003955TwEJ8qKEbj3", role: "user" },
  { id: "msg_010000000004955TwEJ8qKEbj3", role: "assistant" },
]

test("redo steps to the next user message in conversation order", () => {
  const first = redoTarget(conversation, conversation[0]!.id)
  expect(first).toEqual({ kind: "next", message: conversation[2] })
  const second = redoTarget(conversation, conversation[2]!.id)
  expect(second).toEqual({ kind: "next", message: conversation[4] })
})

test("redo restores everything only when the boundary is the newest user message", () => {
  expect(redoTarget(conversation, conversation[4]!.id)).toEqual({ kind: "newest" })
})

test("redo with no later user message is the newest case, even past assistant turns", () => {
  expect(redoTarget(conversation.slice(0, 5), conversation[4]!.id)).toEqual({ kind: "newest" })
})

test("redo reports an absent boundary and changes nothing", () => {
  expect(redoTarget(conversation, "msg_not_in_window")).toEqual({ kind: "absent" })
  expect(redoTarget([], conversation[0]!.id)).toEqual({ kind: "absent" })
})

test("redo advances past a boundary that is not a user message", () => {
  expect(redoTarget(conversation, conversation[1]!.id)).toEqual({ kind: "next", message: conversation[2] })
})

test("redo picks the nearest following user message when several are adjacent", () => {
  const list = [
    { id: "msg_a", role: "user" },
    { id: "msg_b", role: "user" },
    { id: "msg_c", role: "user" },
  ]
  expect(redoTarget(list, "msg_a")).toEqual({ kind: "next", message: list[1] })
})
