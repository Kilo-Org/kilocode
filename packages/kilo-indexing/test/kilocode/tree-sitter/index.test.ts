import { beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

const mockLoadParsers = mock()

mock.module("../../../src/tree-sitter/languageParser", () => ({
  loadRequiredLanguageParsers: mockLoadParsers,
}))

import { parseSourceCodeDefinitionsForFile } from "../../../src/tree-sitter/index"
import { parseMarkdown } from "../../../src/tree-sitter/markdownParser"

describe("parseMarkdown", () => {
  test("ignores ATX and Setext headers inside fenced code blocks and YAML frontmatter", () => {
    const markdown = [
      "---",
      "title: Example Doc",
      "author: kilo",
      "---",
      "",
      "# Real Heading",
      "Intro paragraph.",
      "",
      "```bash",
      "# shell comment that looks like h1",
      "echo hello",
      "---",
      "```",
      "",
      "~~~python",
      "## python comment that looks like h2",
      "x = 1",
      "===",
      "~~~",
      "",
      "## Second Real Heading",
      "Closing paragraph.",
    ].join("\n")

    const captures = parseMarkdown(markdown)
    const names = captures.filter((item) => item.name.startsWith("name.definition.header."))

    expect(names.map((item) => item.node.text)).toEqual(["Real Heading", "Second Real Heading"])
    expect(names[0]?.node.startPosition.row).toBe(5)
    expect(names[0]?.node.endPosition.row).toBe(19)
    expect(names[1]?.node.startPosition.row).toBe(20)
    expect(names[1]?.node.endPosition.row).toBe(21)
  })
})

describe("parseSourceCodeDefinitionsForFile", () => {
  beforeEach(() => {
    mockLoadParsers.mockReset()
  })

  test("returns undefined for fallback-only extensions without AST definition support", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tree-sitter-index-"))
    const file = join(dir, "build.gradle")
    await Bun.write(
      file,
      `plugins { id("java") }
repositories { mavenCentral() }
dependencies { testImplementation("org.junit.jupiter:junit-jupiter:5.10.2") }
`,
    )

    mockLoadParsers.mockRejectedValue(new Error("Unsupported language: gradle"))

    const result = await parseSourceCodeDefinitionsForFile(file)
    expect(result).toBeUndefined()
  })
})
