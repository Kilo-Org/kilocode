import { test, expect } from "bun:test"
import { Snapshot } from "../../src/snapshot"

test("SummaryFileDiff does not contain the `patch` field", () => {
  const keys = Object.keys(Snapshot.SummaryFileDiff.fields)
  expect(keys).not.toContain("patch")
  expect(keys.sort()).toEqual(["additions", "deletions", "file", "status"])
})

test("SummaryFileDiff parse strips `patch` when present on input", () => {
  const full = {
    file: "a.txt",
    patch: "@@ -1 +1 @@\n-old\n+new\n",
    additions: 1,
    deletions: 1,
    status: "modified" as const,
  }
  const parsed = Snapshot.SummaryFileDiff.zod.parse(full)
  expect(parsed).not.toHaveProperty("patch")
  expect(parsed).toEqual({ file: "a.txt", additions: 1, deletions: 1, status: "modified" })
})

test("SummaryFileDiff differs from FileDiff by exactly `patch`", () => {
  const full = new Set(Object.keys(Snapshot.FileDiff.fields))
  const summary = new Set(Object.keys(Snapshot.SummaryFileDiff.fields))
  expect([...full].filter((k) => !summary.has(k))).toEqual(["patch"])
  expect([...summary].filter((k) => !full.has(k))).toEqual([])
})
