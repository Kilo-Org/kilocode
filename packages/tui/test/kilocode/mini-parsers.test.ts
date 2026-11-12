import { expect, mock, test } from "bun:test"

const received: unknown[] = []

mock.module("@opentui/core", () => ({
  addDefaultParsers: (parsers: unknown) => {
    received.push(parsers)
  },
}))

const { registerMiniParsers } = await import("../../src/kilocode/mini-parsers")
const { default: config } = await import("../../src/parsers-config")

test("registers the TUI parser config for mini", () => {
  registerMiniParsers()

  expect(received).toEqual([config.parsers])
})
