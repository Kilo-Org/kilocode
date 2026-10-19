import { describe, expect, test } from "bun:test"
import { KiloAutocomplete } from "../src/index.js"

describe("Mercury Next Edit prompt", () => {
  test("wraps recently viewed snippets, also when there are none", () => {
    const empty = KiloAutocomplete.recentlyViewedSnippetsBlock([])
    expect(empty).toBe("<|recently_viewed_code_snippets|>\n\n<|/recently_viewed_code_snippets|>")
    const out = KiloAutocomplete.recentlyViewedSnippetsBlock([
      { filepath: "src/a.ts", content: "const a = 1" },
      { filepath: "src/b.ts", content: "const b = 2" },
    ])
    expect(out).toContain("<|recently_viewed_code_snippet|>\ncode_snippet_file_path: src/a.ts\nconst a = 1\n")
    expect(out).toContain("code_snippet_file_path: src/b.ts\nconst b = 2\n<|/recently_viewed_code_snippet|>")
  })

  test("inserts the cursor and wraps the editable region", () => {
    const file = ["function foo() {", "  return 1", "}"].join("\n")
    expect(KiloAutocomplete.currentFileContentBlock("src/foo.ts", file, 1, 1, 1, 2)).toBe(
      [
        "<|current_file_content|>",
        "current_file_path: src/foo.ts",
        "function foo() {",
        "<|code_to_edit|>",
        "  <|cursor|>return 1",
        "<|/code_to_edit|>",
        "}",
        "<|/current_file_content|>",
      ].join("\n"),
    )
  })

  test("clamps an out-of-range cursor character instead of throwing", () => {
    expect(KiloAutocomplete.currentFileContentBlock("p.ts", "only-line", 0, 0, 0, 9999)).toContain(
      "only-line<|cursor|>",
    )
  })

  test("strips the createPatch header of each diff and separates diffs with a blank line", () => {
    const out = KiloAutocomplete.editDiffHistoryBlock([
      ["Index: a.ts", "===", "@@ -1,1 +1,1 @@", "-a", "+aa"].join("\n"),
      ["Index: b.ts", "===", "@@ -2,1 +2,1 @@", "-b", "+bb"].join("\n"),
    ])
    expect(out).toBe(
      ["<|edit_diff_history|>", "@@ -1,1 +1,1 @@", "-a", "+aa", "", "@@ -2,1 +2,1 @@", "-b", "+bb", "<|/edit_diff_history|>"].join(
        "\n",
      ),
    )
  })

  test("assembles snippets, file content, and diff history in order and ends with the next-edit token", () => {
    const out = KiloAutocomplete.buildMercuryEditPrompt({
      currentFilePath: "p.ts",
      currentFileContent: "a\nb\nc",
      cursorLine: 1,
      cursorCharacter: 0,
      editableRegionStartLine: 1,
      editableRegionEndLine: 1,
      recentlyViewedSnippets: [],
      editDiffHistory: [],
    })
    const snippets = out.indexOf("<|recently_viewed_code_snippets|>")
    const file = out.indexOf("<|current_file_content|>")
    const diffs = out.indexOf("<|edit_diff_history|>")
    expect(snippets).toBe(0)
    expect(file).toBeGreaterThan(snippets)
    expect(diffs).toBeGreaterThan(file)
    expect(out.endsWith("<|/edit_diff_history|>\n\n<|!@#IS_NEXT_EDIT!@#|>")).toBe(true)
  })
})
