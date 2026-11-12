import { describe, expect, test } from "bun:test"
import { inputChanges, streamedTool, streamInterval } from "../src/components/tool-stream"

describe("streamedTool", () => {
  test("shows a streamed write path and counts the content lines", () => {
    const value = streamedTool("write", '{"path":"src/a.ts","content":"one\\ntwo\\nthree')

    expect(value.input).toEqual({ path: "src/a.ts" })
    expect(value.changes).toEqual({ additions: 3, deletions: 0 })
  })

  test("keeps an incomplete streamed field out of the card", () => {
    const value = streamedTool("write", '{"path":"src/a')

    expect(value.input).toEqual({})
    expect(value.changes).toBeUndefined()
  })

  test("counts streamed edit strings without sending their text", () => {
    const value = streamedTool("edit", '{"path":"a.ts","oldString":"x","newString":"y\\nz')

    expect(value.input).toEqual({ path: "a.ts" })
    expect(value.changes).toEqual({ additions: 2, deletions: 1 })
  })

  test("counts change lines in a streamed patch, including content that starts with -- or ++", () => {
    const value = streamedTool(
      "patch",
      '{"patchText":"*** Begin Patch\\n*** Update File: a.ts\\n@@\\n-old\\n---x\\n+new\\n+++y',
    )

    expect(value.input).toEqual({})
    expect(value.changes).toEqual({ additions: 2, deletions: 2 })
  })

  test("streams a shell description while it is still being written", () => {
    expect(streamedTool("shell", '{"description":"Show recent com').input).toEqual({ description: "Show recent com" })
    expect(streamedTool("shell", '{"description":"Show recent commits","command":"git lo').input).toEqual({
      description: "Show recent commits",
      command: "git lo",
    })
  })

  test("keeps a half-written description of other tools out of the card", () => {
    expect(streamedTool("subagent", '{"description":"Find usa').input).toEqual({})
  })

  test("shows a complete field of a tool that has no change count", () => {
    const value = streamedTool("read", '{"path":"src/a.ts"')

    expect(value.input).toEqual({ path: "src/a.ts" })
    expect(value.changes).toBeUndefined()
  })

  test("ignores an input that is not a JSON object", () => {
    expect(streamedTool("write", "not json")).toEqual({ input: {} })
  })
})

describe("inputChanges", () => {
  test("counts a complete write without a trailing newline line", () => {
    expect(inputChanges("write", { path: "a.ts", content: "a\nb\n" })).toEqual({ additions: 2, deletions: 0 })
  })

  test("counts a streamed edit before its path arrives", () => {
    const value = streamedTool("edit", '{"oldString":"x","newString":"y\\nz')

    expect(value.input).toEqual({})
    expect(value.changes).toEqual({ additions: 2, deletions: 1 })
  })

  test("counts a complete edit", () => {
    expect(inputChanges("edit", { oldString: "x", newString: "y\nz" })).toEqual({ additions: 2, deletions: 1 })
  })

  test("counts a complete patch", () => {
    expect(inputChanges("patch", { patchText: "*** Begin Patch\n@@\n-a\n+b\n+c\n*** End Patch" })).toEqual({
      additions: 2,
      deletions: 1,
    })
  })

  test("returns nothing for a counted tool before its counted field arrives", () => {
    expect(inputChanges("edit", { path: "a.ts" })).toBeUndefined()
    expect(inputChanges("patch", { path: "a.ts" })).toBeUndefined()
  })

  test("returns nothing for a tool that has no change count", () => {
    expect(inputChanges("read", { content: "a\nb" })).toBeUndefined()
  })
})

test("the parse interval widens with the streamed input", () => {
  expect(streamInterval(0)).toBe(50)
  expect(streamInterval(64_000)).toBe(100)
  expect(streamInterval(10_000_000)).toBe(400)
})
