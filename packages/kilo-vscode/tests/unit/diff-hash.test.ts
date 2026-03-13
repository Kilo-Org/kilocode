import { describe, expect, it } from "bun:test"
import { hashFileDiffs } from "../../src/diff-hash"
import type { FileDiff } from "@kilocode/sdk/v2/client"

function diff(after: string): FileDiff {
  return {
    file: "big.ts",
    before: "",
    after,
    additions: 1,
    deletions: 1,
    status: "modified",
  }
}

describe("hashFileDiffs", () => {
  it("changes when a large file changes outside the old sampled windows", () => {
    const base = "a".repeat(600_000)
    const next = `${base.slice(0, 80_000)}${"b".repeat(2_000)}${base.slice(82_000)}`

    expect(hashFileDiffs([diff(base)])).not.toBe(hashFileDiffs([diff(next)]))
  })
})
