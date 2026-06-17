import { describe, expect, test } from "bun:test"
import { MemoryMarkdown } from "../src/storage/markdown"

describe("memory markdown serialization", () => {
  test("parses sections and key :: text items, skipping non-items and empties", () => {
    const doc = [
      "# Project Memory",
      "",
      "## Facts",
      MemoryMarkdown.line("runtime", "Bun 1.x"),
      "- malformed line without separator",
      "- :: missing key",
      "",
      "## Decisions",
      MemoryMarkdown.line("db", "Postgres for primary store"),
    ].join("\n")

    expect(MemoryMarkdown.parse(doc)).toEqual([
      { section: "Facts", key: "runtime", text: "Bun 1.x" },
      { section: "Decisions", key: "db", text: "Postgres for primary store" },
    ])
  })

  test("items before the first heading take the default section", () => {
    expect(MemoryMarkdown.parse(MemoryMarkdown.line("k", "v"))).toEqual([{ section: "Facts", key: "k", text: "v" }])
  })

  test("upsert replaces a same-key line in the section and creates absent sections", () => {
    const base = `## Facts\n${MemoryMarkdown.line("runtime", "Bun 1.0")}\n`

    const replaced = MemoryMarkdown.upsert({ text: base, section: "Facts", line: MemoryMarkdown.line("runtime", "Bun 1.3") })
    expect(replaced.changed).toBe(true)
    expect(MemoryMarkdown.parse(replaced.text)).toEqual([{ section: "Facts", key: "runtime", text: "Bun 1.3" }])

    const added = MemoryMarkdown.upsert({ text: base, section: "Decisions", line: MemoryMarkdown.line("db", "Postgres") })
    expect(added.changed).toBe(true)
    expect(MemoryMarkdown.parse(added.text)).toContainEqual({ section: "Decisions", key: "db", text: "Postgres" })

    const noop = MemoryMarkdown.upsert({ text: base, section: "Facts", line: MemoryMarkdown.line("runtime", "Bun 1.0") })
    expect(noop.changed).toBe(false)
  })

  test("upsert scopes replacement to the target section and leaves same-key lines elsewhere", () => {
    const doc = [
      "## Facts",
      MemoryMarkdown.line("a", "facts-a"),
      "## Decisions",
      MemoryMarkdown.line("a", "decisions-a"),
    ].join("\n")

    const result = MemoryMarkdown.upsert({ text: doc, section: "Facts", line: MemoryMarkdown.line("a", "facts-a2") })
    expect(MemoryMarkdown.parse(result.text)).toEqual([
      { section: "Facts", key: "a", text: "facts-a2" },
      { section: "Decisions", key: "a", text: "decisions-a" },
    ])
  })

  test("upsert does not clobber a different key that shares a prefix", () => {
    const doc = ["## Facts", MemoryMarkdown.line("a", "one"), MemoryMarkdown.line("ab", "two")].join("\n")

    const result = MemoryMarkdown.upsert({ text: doc, section: "Facts", line: MemoryMarkdown.line("a", "one-updated") })
    expect(MemoryMarkdown.parse(result.text)).toEqual([
      { section: "Facts", key: "a", text: "one-updated" },
      { section: "Facts", key: "ab", text: "two" },
    ])
  })

  test("remove with no match leaves the document and count untouched", () => {
    const doc = ["## Facts", MemoryMarkdown.line("a", "one")].join("\n")
    const result = MemoryMarkdown.remove({ text: doc, match: () => false })
    expect(result.count).toBe(0)
    expect(result.text).toBe(doc)
  })

  test("remove drops only matching items, preserving headings and counting removals", () => {
    const doc = [
      "## Facts",
      MemoryMarkdown.line("a", "one"),
      MemoryMarkdown.line("b", "two"),
      "## Decisions",
      MemoryMarkdown.line("a", "three"),
    ].join("\n")

    const result = MemoryMarkdown.remove({ text: doc, match: (entry) => entry.section === "Facts" && entry.key === "a" })
    expect(result.count).toBe(1)
    expect(MemoryMarkdown.parse(result.text)).toEqual([
      { section: "Facts", key: "b", text: "two" },
      { section: "Decisions", key: "a", text: "three" },
    ])
  })
})
