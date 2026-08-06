// kilocode_change - new file
import { describe, expect, it } from "bun:test"
import { formatMarkdownTables } from "@tui/util/markdown"

describe("formatMarkdownTables", () => {
  it("formats a simple table with fixed-width columns", () => {
    const input = `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`

    const result = formatMarkdownTables(input)

    // Each column should be padded to consistent width
    const lines = result.split("\n")
    expect(lines).toHaveLength(4)

    // Check that all pipes are aligned
    const pipePositions = lines.map((line) => {
      const positions: number[] = []
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "|") positions.push(i)
      }
      return positions
    })

    // All rows should have same pipe positions
    for (let i = 1; i < pipePositions.length; i++) {
      expect(pipePositions[i]).toEqual(pipePositions[0])
    }
  })

  it("handles tables with varying cell widths", () => {
    const input = `| Short | Very Long Header |
| --- | --- |
| A | B |
| Much Longer Cell | X |`

    const result = formatMarkdownTables(input)
    const lines = result.split("\n")

    // Column widths should be normalized
    expect(lines[0]).toContain("Short")
    expect(lines[0]).toContain("Very Long Header")
    expect(lines[3]).toContain("Much Longer Cell")
  })

  it("preserves column alignment", () => {
    const input = `| Left | Center | Right |
| :--- | :---: | ---: |
| 1 | 2 | 3 |`

    const result = formatMarkdownTables(input)
    const lines = result.split("\n")

    // Check that alignment markers are preserved
    expect(lines[1]).toContain(":--")
    expect(lines[1]).toMatch(/:.*:/) // center has colons on both sides
    expect(lines[1]).toMatch(/-+:/) // right-aligned ends with colon
  })

  it("handles content without tables unchanged", () => {
    const input = `# Hello World

This is a paragraph.

- List item 1
- List item 2`

    const result = formatMarkdownTables(input)
    expect(result).toBe(input)
  })

  it("handles multiple tables in content", () => {
    const input = `# First Table

| A | B |
| --- | --- |
| 1 | 2 |

Some text between tables.

| Column One | Column Two |
| --- | --- |
| Value | Another Value |`

    const result = formatMarkdownTables(input)

    // Both tables should be formatted
    expect(result).toContain("| A ")
    expect(result).toContain("| Column One ")
  })

  it("handles tables with empty cells", () => {
    const input = `| Header 1 | Header 2 |
| --- | --- |
| Value |  |
|  | Value |`

    const result = formatMarkdownTables(input)
    const lines = result.split("\n")

    // Should still format correctly with empty cells
    expect(lines).toHaveLength(4)
    // Pipes should still be aligned
    const firstPipe = lines[0].indexOf("|")
    for (const line of lines) {
      expect(line[firstPipe]).toBe("|")
    }
  })

  it("handles tables with extra columns in some rows", () => {
    const input = `| A | B |
| --- | --- |
| 1 | 2 | 3 |`

    const result = formatMarkdownTables(input)
    const lines = result.split("\n")

    // Should handle the extra column
    expect(lines[2]).toContain("3")
  })

  it("ignores malformed tables", () => {
    const input = `| Not a table
Just some text with pipes |`

    const result = formatMarkdownTables(input)
    expect(result).toBe(input)
  })

  it("handles tables without leading/trailing pipes", () => {
    // Standard markdown tables require pipes
    const input = `Name | Age
--- | ---
Alice | 30`

    const result = formatMarkdownTables(input)
    // Without proper pipe syntax, this shouldn't be formatted as a table
    expect(result).toBe(input)
  })

  it("formats table embedded in markdown content", () => {
    const input = `Here is some information:

| Feature | Status |
| --- | --- |
| Tables | Supported |
| Lists | Supported |

And some more text after the table.`

    const result = formatMarkdownTables(input)

    // The table portion should be formatted
    expect(result).toContain("| Feature")
    expect(result).toContain("| Tables")
    // Non-table content should be preserved
    expect(result).toContain("Here is some information:")
    expect(result).toContain("And some more text after the table.")
  })
})
