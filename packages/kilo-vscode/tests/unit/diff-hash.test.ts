import { describe, expect, it } from "bun:test"
import { hashFileDiffs } from "../../src/diff/shared/hash"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"

type Diff = SnapshotFileDiff & {
  tracked?: boolean
  generatedLike?: boolean
  summarized?: boolean
  stamp?: string
}

function diff(overrides: Partial<Diff> = {}): Diff {
  return {
    file: "src/app.ts",
    patch: "patch",
    additions: 1,
    deletions: 0,
    status: "modified",
    tracked: true,
    generatedLike: false,
    summarized: false,
    stamp: "1:1",
    ...overrides,
  } as Diff
}

describe("hashFileDiffs", () => {
  it("returns empty string for an empty array", () => {
    expect(hashFileDiffs([])).toBe("")
  })

  it("is stable for identical input", () => {
    expect(hashFileDiffs([diff()])).toBe(hashFileDiffs([diff()]))
  })

  it("changes when any metadata field changes", () => {
    const base = hashFileDiffs([diff()])
    expect(hashFileDiffs([diff({ file: "other.ts" })])).not.toBe(base)
    expect(hashFileDiffs([diff({ status: "added" })])).not.toBe(base)
    expect(hashFileDiffs([diff({ additions: 2 })])).not.toBe(base)
    expect(hashFileDiffs([diff({ deletions: 5 })])).not.toBe(base)
    expect(hashFileDiffs([diff({ tracked: false })])).not.toBe(base)
    expect(hashFileDiffs([diff({ generatedLike: true })])).not.toBe(base)
    expect(hashFileDiffs([diff({ stamp: "2:2" })])).not.toBe(base)
  })

  it("ignores patch content when summarized=true", () => {
    // Regression guard: summary entries have unstable `patch` values from git
    // (can even be ""). If this hashed the patch, the poller would spam the
    // webview with "new" diffs every tick.
    const a = hashFileDiffs([diff({ summarized: true, patch: "one" })])
    const b = hashFileDiffs([diff({ summarized: true, patch: "two" })])
    expect(a).toBe(b)
  })

  it("includes patch content when summarized=false", () => {
    const a = hashFileDiffs([diff({ summarized: false, patch: "one" })])
    const b = hashFileDiffs([diff({ summarized: false, patch: "two" })])
    expect(a).not.toBe(b)
  })

  it("distinguishes summarized vs detail for the same metadata", () => {
    // Flipping `summarized` must change the hash even when stamp/counts match —
    // otherwise a summary-only re-fetch would silently keep stale detail.
    const summary = hashFileDiffs([diff({ summarized: true })])
    const detail = hashFileDiffs([diff({ summarized: false })])
    expect(summary).not.toBe(detail)
  })
})
