import { describe, expect, test } from "bun:test"
import {
  buildMercuryEditPrompt,
  currentFileContentBlock,
  editDiffHistoryBlock,
  recentlyViewedSnippetsBlock,
} from "../src/edit-prompt"

describe("recentlyViewedSnippetsBlock", () => {
  test("wraps in open/close sentinels even when empty", () => {
    const out = recentlyViewedSnippetsBlock([])
    expect(out.startsWith("<|recently_viewed_code_snippets|>")).toBe(true)
    expect(out.endsWith("<|/recently_viewed_code_snippets|>")).toBe(true)
  })

  test("emits one inner block per snippet with the file-path header", () => {
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
  test("inserts <|cursor|> at the right character and wraps the editable region", () => {
    const file = ["function foo() {", "  return 1", "}"].join("\n")
    const out = currentFileContentBlock("src/foo.ts", file, 1, 1, 1, 2)
    expect(out).toContain("<|current_file_content|>")
    expect(out).toContain("<|/current_file_content|>")
    expect(out).toContain("current_file_path: src/foo.ts")
    expect(out).toContain("  <|cursor|>return 1")
    const openIdx = out.indexOf("<|code_to_edit|>")
    const lineIdx = out.indexOf("return 1")
    const closeIdx = out.indexOf("<|/code_to_edit|>")
    expect(openIdx).toBeGreaterThan(-1)
    expect(closeIdx).toBeGreaterThan(openIdx)
    expect(lineIdx).toBeGreaterThan(openIdx)
    expect(lineIdx).toBeLessThan(closeIdx)
  })

  test("clamps an out-of-range cursor instead of throwing", () => {
    const out = currentFileContentBlock("p.ts", "only-line", 0, 0, 0, 9999)
    expect(out).toContain("only-line<|cursor|>")
  })
})

describe("editDiffHistoryBlock", () => {
  test("strips the createPatch index+separator lines from each diff", () => {
    const fakeDiff = ["Index: foo.ts", "===", "@@ -1,1 +1,1 @@", "-old", "+new"].join("\n")
    const out = editDiffHistoryBlock([fakeDiff])
    expect(out).toContain("@@ -1,1 +1,1 @@")
    expect(out).not.toContain("Index: foo.ts")
    expect(out.startsWith("<|edit_diff_history|>")).toBe(true)
    expect(out.endsWith("<|/edit_diff_history|>")).toBe(true)
  })

  test("separates multiple diffs with a blank line", () => {
    const diff1 = ["Index: a.ts", "===", "@@ -1,1 +1,1 @@", "-a", "+aa"].join("\n")
    const diff2 = ["Index: b.ts", "===", "@@ -2,1 +2,1 @@", "-b", "+bb"].join("\n")
    const out = editDiffHistoryBlock([diff1, diff2])
    const idx1 = out.indexOf("@@ -1,1 +1,1 @@")
    const idx2 = out.indexOf("@@ -2,1 +2,1 @@")
    expect(idx2).toBeGreaterThan(idx1)
    expect(out.slice(idx1, idx2)).toContain("\n\n")
  })
})

describe("buildMercuryEditPrompt", () => {
  test("assembles the three blocks in order and ends with the NES token", () => {
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
    const snippetsIdx = out.indexOf("<|recently_viewed_code_snippets|>")
    const fileIdx = out.indexOf("<|current_file_content|>")
    const diffIdx = out.indexOf("<|edit_diff_history|>")
    expect(snippetsIdx).toBeGreaterThan(-1)
    expect(fileIdx).toBeGreaterThan(snippetsIdx)
    expect(diffIdx).toBeGreaterThan(fileIdx)
    expect(out.endsWith("<|!@#IS_NEXT_EDIT!@#|>")).toBe(true)
  })
})
