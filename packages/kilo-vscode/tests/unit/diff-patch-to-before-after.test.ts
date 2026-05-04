import { describe, it, expect } from "bun:test"
import { patchToBeforeAfter } from "../../src/diff/sources/patch-to-before-after"

// Patches in these fixtures come straight from `git diff --unified=INT_MAX
// --no-renames` (the format the backend emits). Each hunk contains every
// line of the file with ` `, `+` or `-` prefixes.

describe("patchToBeforeAfter", () => {
  it("returns empty strings for empty input (binary / summarized)", () => {
    expect(patchToBeforeAfter("")).toEqual({ before: "", after: "" })
  })

  it("reconstructs modified file with context + adds + dels", () => {
    const patch = [
      "diff --git a/foo.txt b/foo.txt",
      "index abc..def 100644",
      "--- a/foo.txt",
      "+++ b/foo.txt",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+dos",
      " three",
    ].join("\n")

    const { before, after } = patchToBeforeAfter(patch)
    expect(before).toBe("one\ntwo\nthree")
    expect(after).toBe("one\ndos\nthree")
  })

  it("reconstructs added file (only '+')", () => {
    const patch = [
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1,2 @@",
      "+hello",
      "+world",
    ].join("\n")

    const { before, after } = patchToBeforeAfter(patch)
    expect(before).toBe("")
    expect(after).toBe("hello\nworld")
  })

  it("reconstructs deleted file (only '-')", () => {
    const patch = [
      "diff --git a/gone.txt b/gone.txt",
      "deleted file mode 100644",
      "--- a/gone.txt",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-bye",
      "-world",
    ].join("\n")

    const { before, after } = patchToBeforeAfter(patch)
    expect(before).toBe("bye\nworld")
    expect(after).toBe("")
  })

  it("skips '\\ No newline at end of file' markers", () => {
    const patch = [
      "diff --git a/x b/x",
      "--- a/x",
      "+++ b/x",
      "@@ -1 +1 @@",
      "-one",
      "\\ No newline at end of file",
      "+two",
      "\\ No newline at end of file",
    ].join("\n")

    const { before, after } = patchToBeforeAfter(patch)
    expect(before).toBe("one")
    expect(after).toBe("two")
  })

  it("ignores extra '@@' headers inside a hunk", () => {
    // Defensive — INT_MAX context means only one hunk, but the parser
    // shouldn't leak the marker content if a second ever appears.
    const patch = [
      "diff --git a/a b/a",
      "--- a/a",
      "+++ b/a",
      "@@ -1,2 +1,2 @@",
      " line1",
      "-old",
      "@@ -10,0 +10,1 @@",
      "+new",
    ].join("\n")

    const { before, after } = patchToBeforeAfter(patch)
    expect(before).toBe("line1\nold")
    expect(after).toBe("line1\nnew")
  })

  it("does not emit content before the first hunk header", () => {
    // Any data-like line that precedes "@@" is part of the patch header
    // region and must be discarded.
    const patch = ["diff --git a/a b/a", "--- a/a", "+++ b/a", "@@ -1 +1 @@", "+only"].join("\n")

    const { before, after } = patchToBeforeAfter(patch)
    expect(before).toBe("")
    expect(after).toBe("only")
  })

  it("preserves leading whitespace in content", () => {
    const patch = [
      "diff --git a/a b/a",
      "--- a/a",
      "+++ b/a",
      "@@ -1,2 +1,2 @@",
      "   indented with spaces",
      "-\told tab",
      "+\tnew tab",
    ].join("\n")

    const { before, after } = patchToBeforeAfter(patch)
    expect(before).toBe("  indented with spaces\n\told tab")
    expect(after).toBe("  indented with spaces\n\tnew tab")
  })
})
