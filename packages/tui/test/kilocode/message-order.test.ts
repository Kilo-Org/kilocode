import { expect, test } from "bun:test"
import { at, older, recent, slot } from "../../src/kilocode/message-order"

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
