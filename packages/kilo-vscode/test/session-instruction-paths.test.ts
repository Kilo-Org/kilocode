import { describe, expect, test } from "bun:test"
import { readInstructionPaths } from "@opencode/schema/session-instruction-paths"

describe("readInstructionPaths", () => {
  test("reads the paths from instruction metadata", () => {
    expect(readInstructionPaths({ instruction: { paths: ["/repo/AGENTS.md", "/repo/src/AGENTS.md"] } })).toEqual([
      "/repo/AGENTS.md",
      "/repo/src/AGENTS.md",
    ])
  })

  test("keeps only string paths", () => {
    expect(readInstructionPaths({ instruction: { paths: ["/repo/AGENTS.md", 1, null, "/repo/src/AGENTS.md"] } })).toEqual(
      ["/repo/AGENTS.md", "/repo/src/AGENTS.md"],
    )
  })

  test("ignores missing or malformed metadata", () => {
    expect(readInstructionPaths(undefined)).toEqual([])
    expect(readInstructionPaths(null)).toEqual([])
    expect(readInstructionPaths("metadata")).toEqual([])
    expect(readInstructionPaths({})).toEqual([])
    expect(readInstructionPaths({ instruction: null })).toEqual([])
    expect(readInstructionPaths({ instruction: "paths" })).toEqual([])
    expect(readInstructionPaths({ instruction: [] })).toEqual([])
  })

  test("ignores a non-array paths value", () => {
    expect(readInstructionPaths({ instruction: { paths: "/repo/AGENTS.md" } })).toEqual([])
  })
})
