import { describe, expect, test } from "bun:test"
import { splitDiffHunks } from "../../src/kilocode/tui/diff"

describe("splitDiffHunks", () => {
  test("returns original diff when there are no hunks", () => {
    const diff = "--- a/file.ts\n+++ b/file.ts"
    expect(splitDiffHunks(diff)).toEqual([diff])
  })

  test("returns original diff when there is one hunk", () => {
    const diff = ["--- a/file.ts", "+++ b/file.ts", "@@ -1,2 +1,2 @@", "-one", "+ONE", " two"].join("\n")

    expect(splitDiffHunks(diff)).toEqual([diff])
  })

  test("ignores header-like content lines inside a hunk", () => {
    const diff = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,1 +1,1 @@",
      "--- not-a-header",
      "+++ still-not-a-header",
    ].join("\n")

    expect(splitDiffHunks(diff)).toEqual([diff])
  })

  test("splits multi-hunk diff and preserves headers", () => {
    const diff = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,2 @@",
      "-one",
      "+ONE",
      " two",
      "@@ -10,2 +10,2 @@",
      "-ten",
      "+TEN",
      " eleven",
    ].join("\n")

    expect(splitDiffHunks(diff)).toEqual([
      ["--- a/file.ts", "+++ b/file.ts", "@@ -1,2 +1,2 @@", "-one", "+ONE", " two"].join("\n"),
      ["--- a/file.ts", "+++ b/file.ts", "@@ -10,2 +10,2 @@", "-ten", "+TEN", " eleven"].join("\n"),
    ])
  })

  test("splits concatenated multi-file diff with per-file headers", () => {
    const diff = [
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1,2 +1,2 @@",
      "-one",
      "+ONE",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -1,2 +1,2 @@",
      "-two",
      "+TWO",
    ].join("\n")

    expect(splitDiffHunks(diff)).toEqual([
      ["--- a/one.ts", "+++ b/one.ts", "@@ -1,2 +1,2 @@", "-one", "+ONE"].join("\n"),
      ["--- a/two.ts", "+++ b/two.ts", "@@ -1,2 +1,2 @@", "-two", "+TWO"].join("\n"),
    ])
  })

  test("splits multi-file diff when first file has multiple hunks", () => {
    const diff = [
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1,2 +1,2 @@",
      "-one",
      "+ONE",
      "@@ -10,2 +10,2 @@",
      "-ten",
      "+TEN",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -3,2 +3,2 @@",
      "-two",
      "+TWO",
    ].join("\n")

    expect(splitDiffHunks(diff)).toEqual([
      ["--- a/one.ts", "+++ b/one.ts", "@@ -1,2 +1,2 @@", "-one", "+ONE"].join("\n"),
      ["--- a/one.ts", "+++ b/one.ts", "@@ -10,2 +10,2 @@", "-ten", "+TEN"].join("\n"),
      ["--- a/two.ts", "+++ b/two.ts", "@@ -3,2 +3,2 @@", "-two", "+TWO"].join("\n"),
    ])
  })
})
