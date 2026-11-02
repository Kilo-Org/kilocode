import { describe, expect, test } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { filePosition, patchDocuments } from "../src/tool-diff-patch"

describe("patchDocuments", () => {
  test("reconstructs both sides of a full-context diff from the diff package", () => {
    const patch = createTwoFilesPatch(
      "src/a.ts",
      "src/a.ts",
      "one\ntwo\nthree\nfour\nfive\nsix\n",
      "one\nTWO\nthree\nfour\nfive\nsix\n",
    )

    expect(patchDocuments(patch)).toEqual({
      before: "one\ntwo\nthree\nfour\nfive\nsix\n",
      after: "one\nTWO\nthree\nfour\nfive\nsix\n",
    })
  })

  test("reads git headers and a new file", () => {
    const patch = [
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "index 0000000..e69de29",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1,2 @@",
      "+hello",
      "+world",
      "",
    ].join("\n")

    expect(patchDocuments(patch)).toEqual({ before: "", after: "hello\nworld\n" })
  })

  test("places a hunk that starts below line 1 at its real line number", () => {
    const patch = [
      "index 1234567..89abcde 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -2,2 +2,2 @@ function f() {",
      "   keep",
      "-  old",
      "+  fresh",
      "",
    ].join("\n")

    expect(patchDocuments(patch)).toEqual({ before: "\n  keep\n  old\n", after: "\n  keep\n  fresh\n" })
  })

  test("keeps a missing trailing newline on the side the marker follows", () => {
    const patch = ["@@ -1 +1 @@", "-old", "\\ No newline at end of file", "+new", ""].join("\n")

    expect(patchDocuments(patch)).toEqual({ before: "old", after: "new\n" })
  })

  test("drops the trailing newline on both sides when both markers are present", () => {
    const patch = ["@@ -1 +1 @@", "-old", "\\ No newline at end of file", "+new", "\\ No newline at end of file"].join(
      "\n",
    )

    expect(patchDocuments(patch)).toEqual({ before: "old", after: "new" })
  })

  test("pads unknown lines so each hunk keeps its line numbers", () => {
    const patch = [
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
      "@@ -8,3 +8,3 @@",
      " h",
      "-i",
      "+I",
      " j",
      "",
    ].join("\n")

    const documents = patchDocuments(patch)

    expect(documents.before.split("\n")).toEqual(["a", "b", "c", "", "", "", "", "h", "i", "j", ""])
    expect(documents.after.split("\n")).toEqual(["a", "B", "c", "", "", "", "", "h", "I", "j", ""])
  })

  test("opens only the first file of a multi-file patch", () => {
    const patch = [
      "diff --git a/one b/one",
      "--- a/one",
      "+++ b/one",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/two b/two",
      "--- a/two",
      "+++ b/two",
      "@@ -1 +1 @@",
      "-c",
      "+d",
      "",
    ].join("\n")

    expect(patchDocuments(patch)).toEqual({ before: "a\n", after: "b\n" })
  })

  test("returns empty documents for an empty patch", () => {
    expect(patchDocuments("")).toEqual({ before: "", after: "" })
  })
})

describe("filePosition", () => {
  test("converts a 1-based line and column to zero-based values", () => {
    expect(filePosition(3, 5)).toEqual({ line: 2, column: 4 })
  })

  test("defaults the column to the start of the line", () => {
    expect(filePosition(1)).toEqual({ line: 0, column: 0 })
    expect(filePosition(2, 0)).toEqual({ line: 1, column: 0 })
  })

  test("has no position without a positive line", () => {
    expect(filePosition()).toBeUndefined()
    expect(filePosition(0, 3)).toBeUndefined()
  })
})
