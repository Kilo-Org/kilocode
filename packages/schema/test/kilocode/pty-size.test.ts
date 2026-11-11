import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Pty } from "../../src/pty.js"

test("a create payload carries an optional size and omits it when absent", () => {
  expect(Schema.encodeSync(Pty.CreateInput)(Schema.decodeUnknownSync(Pty.CreateInput)({ title: "Terminal" }))).toEqual({
    title: "Terminal",
  })
  expect(
    Schema.encodeSync(Pty.CreateInput)(
      Schema.decodeUnknownSync(Pty.CreateInput)({ title: "Terminal", size: { cols: 132, rows: 41 } }),
    ),
  ).toEqual({ title: "Terminal", size: { cols: 132, rows: 41 } })
})

test("a create size must be positive", () => {
  expect(() => Schema.decodeUnknownSync(Pty.CreateInput)({ size: { cols: 0, rows: 41 } })).toThrow()
  expect(() => Schema.decodeUnknownSync(Pty.CreateInput)({ size: { cols: 132, rows: 0 } })).toThrow()
})
