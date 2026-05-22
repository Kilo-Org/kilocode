import {
  MERCURY_CODE_TO_EDIT_CLOSE,
  MERCURY_CODE_TO_EDIT_OPEN,
  MERCURY_CURRENT_FILE_CONTENT_CLOSE,
  MERCURY_CURRENT_FILE_CONTENT_OPEN,
  MERCURY_CURSOR,
  MERCURY_EDIT_DIFF_HISTORY_CLOSE,
  MERCURY_EDIT_DIFF_HISTORY_OPEN,
  MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE,
  MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN,
  MERCURY_UNIQUE_TOKEN,
} from "../constants"
import {
  buildMercuryEditPrompt,
  currentFileContentBlock,
  editDiffHistoryBlock,
  recentlyViewedSnippetsBlock,
} from "../mercuryPromptTemplate"

describe("mercuryPromptTemplate", () => {
  describe("recentlyViewedSnippetsBlock", () => {
    it("wraps in open/close sentinels even when empty", () => {
      const out = recentlyViewedSnippetsBlock([])
      expect(out.startsWith(MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN)).toBe(true)
      expect(out.endsWith(MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE)).toBe(true)
    })

    it("emits one inner block per snippet with the file-path header", () => {
      const out = recentlyViewedSnippetsBlock([
        { filepath: "src/a.ts", content: "const a = 1" },
        { filepath: "src/b.ts", content: "const b = 2" },
      ])
      expect(out).toContain("code_snippet_file_path: src/a.ts")
      expect(out).toContain("code_snippet_file_path: src/b.ts")
      expect(out).toContain("const a = 1")
      expect(out).toContain("const b = 2")
    })
  })

  describe("currentFileContentBlock", () => {
    it("inserts <|cursor|> at the right character and wraps the editable region", () => {
      const file = ["function foo() {", "  return 1", "}"].join("\n")
      const out = currentFileContentBlock("src/foo.ts", file, 1, 1, 1, 2)
      expect(out).toContain(MERCURY_CURRENT_FILE_CONTENT_OPEN)
      expect(out).toContain(MERCURY_CURRENT_FILE_CONTENT_CLOSE)
      expect(out).toContain("current_file_path: src/foo.ts")
      expect(out).toContain(`  ${MERCURY_CURSOR}return 1`)
      // Open marker precedes the editable region's first line; close marker follows it.
      const openIdx = out.indexOf(MERCURY_CODE_TO_EDIT_OPEN)
      const lineIdx = out.indexOf("return 1")
      const closeIdx = out.indexOf(MERCURY_CODE_TO_EDIT_CLOSE)
      expect(openIdx).toBeGreaterThan(-1)
      expect(closeIdx).toBeGreaterThan(openIdx)
      expect(lineIdx).toBeGreaterThan(openIdx)
      expect(lineIdx).toBeLessThan(closeIdx)
    })

    it("clamps an out-of-range cursor instead of throwing", () => {
      const file = "only-line"
      const out = currentFileContentBlock("p.ts", file, 0, 0, 0, 9999)
      expect(out).toContain(`only-line${MERCURY_CURSOR}`)
    })
  })

  describe("editDiffHistoryBlock", () => {
    it("strips the createPatch index+separator lines from each diff", () => {
      const fakeDiff = ["Index: foo.ts", "===", "@@ -1,1 +1,1 @@", "-old", "+new"].join("\n")
      const out = editDiffHistoryBlock([fakeDiff])
      expect(out).toContain("@@ -1,1 +1,1 @@")
      expect(out).not.toContain("Index: foo.ts")
      expect(out).not.toContain("===")
      expect(out.startsWith(MERCURY_EDIT_DIFF_HISTORY_OPEN)).toBe(true)
      expect(out.endsWith(MERCURY_EDIT_DIFF_HISTORY_CLOSE)).toBe(true)
    })

    it("separates multiple diffs with a blank line so Mercury parses them as distinct hunks", () => {
      const diff1 = ["Index: a.ts", "===", "@@ -1,1 +1,1 @@", "-a", "+aa"].join("\n")
      const diff2 = ["Index: b.ts", "===", "@@ -2,1 +2,1 @@", "-b", "+bb"].join("\n")
      const out = editDiffHistoryBlock([diff1, diff2])
      // Both hunk headers should appear separated by a blank line.
      const idx1 = out.indexOf("@@ -1,1 +1,1 @@")
      const idx2 = out.indexOf("@@ -2,1 +2,1 @@")
      expect(idx1).toBeGreaterThan(-1)
      expect(idx2).toBeGreaterThan(idx1)
      const between = out.slice(idx1, idx2)
      // The body between the two hunk headers must contain at least one empty line.
      expect(between).toContain("\n\n")
    })
  })

  describe("buildMercuryEditPrompt", () => {
    it("assembles all three blocks in the documented order", () => {
      const out = buildMercuryEditPrompt({
        currentFilePath: "p.ts",
        currentFileContent: "a\nb\nc",
        cursorLine: 1,
        cursorCharacter: 0,
        editableRegionStartLine: 1,
        editableRegionEndLine: 1,
        recentlyViewedSnippets: [],
        editDiffHistory: [],
      })
      const snippetsIdx = out.indexOf(MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN)
      const fileIdx = out.indexOf(MERCURY_CURRENT_FILE_CONTENT_OPEN)
      const diffIdx = out.indexOf(MERCURY_EDIT_DIFF_HISTORY_OPEN)
      expect(snippetsIdx).toBeGreaterThan(-1)
      expect(fileIdx).toBeGreaterThan(snippetsIdx)
      expect(diffIdx).toBeGreaterThan(fileIdx)
    })

    it("trails the user prompt with the NES unique token so Mercury recognises the call as next-edit", () => {
      const out = buildMercuryEditPrompt({
        currentFilePath: "p.ts",
        currentFileContent: "a\nb",
        cursorLine: 0,
        cursorCharacter: 0,
        editableRegionStartLine: 0,
        editableRegionEndLine: 1,
        recentlyViewedSnippets: [],
        editDiffHistory: [],
      })
      expect(out.endsWith(MERCURY_UNIQUE_TOKEN)).toBe(true)
    })
  })
})
