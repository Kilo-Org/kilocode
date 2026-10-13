import { expect, test } from "bun:test"
import { coveredLines, parseDiff } from "./shared"

test("added lines that start with ++ count", () => {
  const diff = ["--- a/x.ts", "+++ b/x.ts", "@@ -3,0 +4,2 @@", "+++i", "+const a = 1", "@@ -9 +10,0 @@", "---j"].join("\n")
  expect(parseDiff(diff)).toEqual({ added: new Set([4, 5]), removed: 1 })
})

test("a block without its end covers only marker lines", () => {
  const lines = ["// kilocode_change start", "const a = 1", "const b = 2"]
  expect([...coveredLines(lines)]).toEqual([1])
  expect([...coveredLines([...lines, "// kilocode_change end"])]).toEqual([1, 2, 3, 4])
})

test("a new-file header covers the whole file only when the file is new", () => {
  const lines = ["// kilocode_change - new file", "const a = 1"]
  expect([...coveredLines(lines, true)]).toEqual([1, 2])
  expect([...coveredLines(lines, false)]).toEqual([1])
})
