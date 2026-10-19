import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Parameters } from "../../src/tool/task"

test("ignores the removed background parameter for older callers", () => {
  for (const background of [true, false]) {
    const decoded = Schema.decodeUnknownSync(Parameters)({
      description: "inspect",
      prompt: "inspect the cache",
      subagent_type: "general",
      background,
    })
    expect(decoded).toEqual({
      description: "inspect",
      prompt: "inspect the cache",
      subagent_type: "general",
    })
  }
})
