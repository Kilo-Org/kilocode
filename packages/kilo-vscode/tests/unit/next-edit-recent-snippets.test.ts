import {
  toAllowedMercuryRecentSnippets,
  toMercuryRecentSnippets,
} from "../../src/services/autocomplete/next-edit/recentSnippetsAdapter"

describe("toMercuryRecentSnippets", () => {
  it("returns an empty array when no snippets are supplied", () => {
    expect(toMercuryRecentSnippets([])).toEqual([])
  })

  it("caps the number of snippets at 5", () => {
    const snippets = Array.from({ length: 12 }, (_, i) => ({
      filepath: `file://${i}.ts`,
      content: `const x${i} = ${i}`,
    }))
    const out = toMercuryRecentSnippets(snippets)
    expect(out.length).toBe(5)
  })

  it("reverses input order (service returns newest→oldest, Mercury wants oldest→newest)", () => {
    const out = toMercuryRecentSnippets([
      { filepath: "a.ts", content: "newest" },
      { filepath: "b.ts", content: "middle" },
      { filepath: "c.ts", content: "oldest" },
    ])
    expect(out.map((s) => s.content)).toEqual(["oldest", "middle", "newest"])
  })

  it("trims content above 20 lines to a centered window", () => {
    const content = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n")
    const [snippet] = toMercuryRecentSnippets([{ filepath: "x.ts", content }])
    const lines = snippet.content.split("\n")
    expect(lines.length).toBe(20)
    // Center: lines should be drawn from somewhere in the middle of the input.
    expect(lines[0]).toMatch(/^line[12]\d$/)
  })

  it("passes through filepath verbatim when not a parsable URI", () => {
    const [out] = toMercuryRecentSnippets([{ filepath: "not a uri", content: "x" }])
    expect(out.filepath).toBe("not a uri")
  })

  it("excludes denied snippets before constructing next edit request context", () => {
    const out = toAllowedMercuryRecentSnippets(
      [
        { filepath: "secrets/.env", content: "TOKEN=do-not-send" },
        { filepath: "src/app.ts", content: "const safe = true" },
      ],
      (path) => !path.endsWith(".env"),
    )

    expect(out).toEqual([{ filepath: "src/app.ts", content: "const safe = true" }])
    expect(JSON.stringify(out)).not.toContain("do-not-send")
  })
})
